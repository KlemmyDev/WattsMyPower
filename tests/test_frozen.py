"""
Frozen readings: the WiNet dongle answering with the same registers poll after poll (sh_rs.frozen),
left out of the readings like missed polls (transform.Freeze) and shown in the live status.

The word blocks are real SH5.0RS polls (2026-10-03, the info registers left out), each with the
words that changed by the next poll.
"""

from __future__ import annotations

import time
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.features.inverters.sungrow import sh_rs
from app.features.live.ingest import CollectorIngest
from app.features.live.reprocess import reprocess
from app.features.live.transform import Freeze, Pv2Carry, snapshots
from tests.test_ingest import FakeCollector, _services, pv2_words


def _block(a: list[int], b: list[int], d: list[int]) -> dict[str, int]:
    """The words of one poll from its ranges: (5008, 29), (13000, 43) and (13045, 3)."""
    assert (len(a), len(b), len(d)) == (29, 43, 3)
    starts = ((5008, a), (13000, b), (13045, d))
    return {str(start + i): w for start, ws in starts for i, w in enumerate(ws)}


# 02:10: no solar, the battery covering 354 W of home use. By 02:11 only reactive power (5033)
# and power factor (5035) had moved: the fewest changes between any two real polls.
NIGHT = _block(
    [273, *[0] * 10, 2449, *[0] * 13, 928, 0, 377, 500],
    [0, 12, 0, 28132, 2, 0, 27549, 1, 354, 0, 0, 0, 0, 45048, *[0] * 6, 3311, 12, 354, 697, 960, 206, 8, 55518,
     0, 0, 0, 18, 0, 0, 354, 0, 0, 28626, 0, 160, 0, 59705, 0],
    [0, 13138, 2],
)  # fmt: skip
NIGHT_NEXT = {**NIGHT, "5033": 939, "5035": 357}

# 11:20: solar held at 4,665 W (for 54 polls in a row), the battery full, the second inverter's
# output showing as negative home use. By 11:21 solar, home use and the battery hadn't moved.
MIDDAY = _block(
    [555, 0, 0, 2015, 107, 2289, 109, 0, 0, 4665, 0, 2495, *[0] * 13, 1680, 0, 940, 500],
    [0, 145, 161, 28293, 2, 20, 27569, 1, 61482, 65535, 8573, 0, 87, 45135, *[0] * 6, 3474, 0, 0, 1000, 960, 281,
     79, 55589, 0, 0, 0, 181, 0, 0, 4529, 0, 0, 28626, 0, 160, 122, 59827, 0],
    [0, 13199, 2],
)  # fmt: skip
MIDDAY_NEXT = {**MIDDAY, "5011": 2025, "5033": 1698, "5035": 939, "13002": 162, "13003": 28294, "13005": 21,
               "13006": 27570, "13020": 3463, "13046": 13200}  # fmt: skip

# The info registers, read on start and every 6 hours (a made-up serial).
SERIAL = "TEST0000001".ljust(20, "\x00").encode()
INFO = {
    **{str(4990 + i): int.from_bytes(SERIAL[2 * i : 2 * i + 2], "big") for i in range(10)},
    "5000": 0x0D0F, "5001": 50, "5002": 0, "5639": 1600,
}  # fmt: skip

T0 = int(time.mktime(time.strptime("2026-10-01 12:25", "%Y-%m-%d %H:%M")))


def poll(words: dict[str, int]) -> dict[str, Any]:
    return {"input": words}


def hybrid(ts: int, words: dict[str, int], **extra: Any) -> dict[str, Any]:
    return {"ts": ts, "device": "hybrid", "driver": "sungrow.sh_rs", "input": words, **extra}


def pv2(ts: int, watts: int) -> dict[str, Any]:
    return {"ts": ts, "device": "pv2", "driver": "sungrow.sg_d", "input": {**pv2_words(), "5031": watts}}


def run(rows: list[dict[str, Any]], freeze: Freeze, carry: Pv2Carry | None = None) -> list[int]:
    out = snapshots(rows, has_pv2=False, behind_meter=True, poll_interval=60, carry=carry or Pv2Carry(), freeze=freeze)
    return [ts for ts, _ in out]


# ---------------------------------------------------------------------------- the rule
def test_a_repeated_block_is_frozen() -> None:
    assert sh_rs.frozen(poll(NIGHT), poll(dict(NIGHT)))
    assert sh_rs.frozen(poll(MIDDAY), poll(dict(MIDDAY)))


def test_steady_figures_are_not_frozen_while_other_words_move() -> None:
    night, night_next = sh_rs.decode(poll(NIGHT)), sh_rs.decode(poll(NIGHT_NEXT))
    assert night == night_next and night["pv_power"] == 0  # nothing decoded moved at all
    assert not sh_rs.frozen(poll(NIGHT), poll(NIGHT_NEXT))

    midday, midday_next = sh_rs.decode(poll(MIDDAY)), sh_rs.decode(poll(MIDDAY_NEXT))
    for key in ("pv_power", "load_power", "battery_power", "battery_soc", "grid_power"):
        assert midday[key] == midday_next[key]
    assert midday["pv_power"] == 4665 and midday["battery_soc"] == 100.0
    assert not sh_rs.frozen(poll(MIDDAY), poll(MIDDAY_NEXT))


def test_info_registers_are_left_out_of_the_comparison() -> None:
    with_info = {"input": {**NIGHT, **INFO}, "holding": {"13059": 50}}
    assert sh_rs.frozen(with_info, poll(NIGHT)) and sh_rs.frozen(poll(NIGHT), with_info)
    assert not sh_rs.frozen(with_info, poll(NIGHT_NEXT))


def test_a_poll_missing_words_is_not_a_repeat() -> None:
    """A range that couldn't be read: what's left may well match, but that proves nothing."""
    partial = {a: w for a, w in NIGHT.items() if not 13000 <= int(a) <= 13042}
    assert not sh_rs.frozen(poll(NIGHT), poll(partial)) and not sh_rs.frozen(poll(partial), poll(NIGHT))
    assert not sh_rs.frozen(poll({}), poll({}))


# ---------------------------------------------------------------------------- decoding the feed
def test_a_freeze_is_left_out_until_readings_move_again() -> None:
    freeze = Freeze()
    frozen = [hybrid(T0 + 60 * i, dict(NIGHT)) for i in range(1, 7)]
    assert run([hybrid(T0, NIGHT), *frozen[:3]], freeze) == [T0]
    assert freeze.since == T0  # the reading the dongle keeps serving
    assert run(frozen[3:], freeze) == []  # the next batch carries on where the last left off
    assert freeze.since == T0 and freeze.repeats == 6
    assert run([hybrid(T0 + 420, NIGHT_NEXT), hybrid(T0 + 480, {**NIGHT_NEXT, "5035": 360})], freeze) == [
        T0 + 420,
        T0 + 480,
    ]
    assert freeze.since is None and freeze.repeats == 6


def test_the_first_poll_and_a_repeat_carrying_info_registers() -> None:
    """The collector reads the info registers on start, when the dongle is most likely to be frozen."""
    freeze = Freeze()
    assert run([hybrid(T0, MIDDAY), hybrid(T0 + 60, {**MIDDAY, **INFO}, holding={"13059": 50})], freeze) == [T0]
    assert run([hybrid(T0 + 120, MIDDAY_NEXT)], freeze) == [T0 + 120]


def test_the_second_inverter_carries_on_through_a_freeze() -> None:
    """Its readings during the hybrid's freeze still count: after it, its latest output is carried
    for a missed read, rather than zero as after a long gap (it asleep)."""
    carry, freeze = Pv2Carry(), Freeze()
    feed = [hybrid(T0, MIDDAY), pv2(T0, 1800)]
    for i in range(1, 6):
        feed += [hybrid(T0 + 60 * i, dict(MIDDAY)), pv2(T0 + 60 * i, 1800 + 100 * i)]
    feed.append(hybrid(T0 + 360, MIDDAY_NEXT))  # the second inverter missed this one
    out = snapshots(feed, has_pv2=True, behind_meter=True, poll_interval=60, carry=carry, freeze=freeze)
    assert [ts for ts, _ in out] == [T0, T0 + 360]
    assert out[0][1]["pv2_power"] == 1800 and out[1][1]["pv2_power"] == 2300
    assert out[1][1]["pv_power"] == 4665 + 2300 and carry.info["model"] == "SG5K-D"


# ---------------------------------------------------------------------------- live status and history
def frozen_feed() -> list[dict[str, Any]]:
    """12:25 fresh, 12:26-12:31 the same words, 12:32 fresh again (as on 2026-10-01)."""
    return [hybrid(T0, NIGHT), *(hybrid(T0 + 60 * i, dict(NIGHT)) for i in range(1, 7)), hybrid(T0 + 420, NIGHT_NEXT)]


def test_the_live_status_says_when_readings_are_frozen(db: Database, config: Config) -> None:
    readings, live = _services(db, config)
    fake = FakeCollector(frozen_feed())
    ingest = CollectorIngest(config, db, readings, live, fake)
    ingest.apply_status(fake.status())
    conn = db.connect()
    try:
        ingest._ingest(conn, frozen_feed()[:4])
        status = live.status()
        assert status["frozen_since"] == T0 and status["snapshot"]["ts"] == T0  # not the stale repeats
        assert status["last_success"] == 123.0  # the collector still reads the dongle fine

        ingest._ingest(conn, frozen_feed()[4:])
        status = live.status()
        assert status["frozen_since"] is None and status["snapshot"]["ts"] == T0 + 420
        assert [r[0] for r in conn.execute("SELECT ts FROM samples ORDER BY ts")] == [T0, T0 + 420]
    finally:
        conn.close()


def test_connecting_another_inverter_forgets_a_freeze(db: Database, config: Config) -> None:
    readings, live = _services(db, config)
    fake = FakeCollector(frozen_feed())
    ingest = CollectorIngest(config, db, readings, live, fake)
    ingest.apply_status(fake.status())
    conn = db.connect()
    try:
        ingest._ingest(conn, frozen_feed()[:3])
    finally:
        conn.close()
    assert live.frozen_since == T0
    status = fake.status()
    status["devices"]["hybrid"]["host"] = "another-inverter"
    ingest.apply_status(status)
    assert live.frozen_since is None and ingest.freeze.last is None


def test_reprocess_leaves_out_frozen_polls(db: Database, config: Config) -> None:
    readings, _ = _services(db, config)
    conn = db.connect()
    readings.insert_many(conn, [(r["ts"], {"pv_power": 0, "load_power": 354}) for r in frozen_feed()])  # the old way
    conn.close()
    done = reprocess(config, db, FakeCollector(frozen_feed()))
    assert done["polls"] == 2 and done["frozen"] == 6
    conn = db.connect()
    try:
        assert [r[0] for r in conn.execute("SELECT ts FROM samples ORDER BY ts")] == [T0, T0 + 420]
    finally:
        conn.close()
