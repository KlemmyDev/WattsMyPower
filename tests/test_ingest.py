"""The API's side of the collector feed: decoding raw registers, merging, ingesting and reprocessing."""

from __future__ import annotations

import time
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.features.inverters import drivers
from app.features.inverters.sungrow import sg_d, sh_rs
from app.features.live.ingest import CollectorIngest, load_cursor
from app.features.live.reprocess import reprocess
from app.features.live.service import LiveService
from app.features.live.transform import Freeze, Pv2Carry, snapshots
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore

DAY = int(time.mktime(time.strptime("2026-10-01 12:00", "%Y-%m-%d %H:%M")))


def hybrid_words(exported: float = 14421.0) -> dict[str, int]:
    """
    A daytime poll: 4.12 kW solar, battery charging at 1.5 kW, exporting 2 kW, `exported` kWh fed
    in over the meter's lifetime. Like the real SH5.0RS, the meter's daily export counter stays at 0.
    """
    total = round(exported * 10)
    w = {
        5017: 4120, 5018: 0,  # pv power (U32, low word first)
        5036: 500,  # grid frequency in 0.1 Hz on this firmware
        13001: sh_rs.FLOW_BATTERY_CHARGING,  # power flow bits
        13002: 663,  # daily pv, 0.1 kWh
        13005: 251,  # daily export from the hybrid's own pv
        13006: 27549, 13007: 1,  # lifetime export from the hybrid's own pv (U32, 0.1 kWh)
        13008: 620, 13009: 0,  # load power
        13010: 2000, 13011: 0,  # export power (positive = exporting)
        13022: 1500,  # battery power, unsigned
        13023: 556,  # soc, 0.1 %
        13036: 12,  # daily import
        13037: 28626, 13038: 0,  # lifetime import through the meter
        13045: 0,  # daily export through the meter: never counts on this unit
        13046: total & 0xFFFF, 13047: total >> 16,  # lifetime export through the meter
    }  # fmt: skip
    return {str(k): v for k, v in w.items()}


def pv2_words() -> dict[str, int]:
    return {"5000": 0x0126, "5001": 50, "5003": 241, "5004": 51000, "5005": 0, "5006": 100, "5007": 1,
            "5008": 312, "5017": 1900, "5018": 0, "5031": 1800, "5032": 0}  # fmt: skip


def test_decode_applies_scales_signs_and_the_meter_export() -> None:
    snap = sh_rs.decode({"input": hybrid_words()})
    assert snap["pv_power"] == 4120
    assert snap["battery_power"] == -1500  # charging is negative
    assert snap["grid_power"] == -2000  # exporting is negative
    assert snap["daily_export"] == 0.0 and snap["daily_pv_export"] == 25.1
    assert snap["total_export"] == 14421.0 and snap["total_pv_export"] == 9308.5
    assert snap["battery_soc"] == 55.6 and snap["grid_freq"] == 50.0
    assert snap["daily_charge"] is None  # not read this poll


def test_decode_info() -> None:
    serial = "A23A0903744".ljust(20, "\x00").encode()
    words = {4990 + i: int.from_bytes(serial[2 * i : 2 * i + 2], "big") for i in range(10)}
    words.update({5000: 0x0D0F, 5001: 50, 5002: 0, 5639: 1600})
    info = sh_rs.decode_info({"input": words, "holding": {13059: 50}})
    assert info == {"brand": "Sungrow", "serial": "A23A0903744", "model": "SH5.0RS", "nominal_kw": 5.0, "phases": "Single phase",
                    "battery_kwh": 16.0, "reserve": 5.0}  # fmt: skip


def test_decode_second_inverter() -> None:
    raw = {"input": pv2_words()}
    assert sg_d.decode(raw) == {"pv2_power": 1800, "pv2_dc_power": 1900, "daily_pv2": 24.1, "total_pv2": 51000,
                                "pv2_temp": 31.2}  # fmt: skip
    assert sg_d.decode_info(raw) == {"brand": "Sungrow", "model": "SG5K-D", "nominal_kw": 5.0, "running_hours": 65636}


def rows(ts: int, pv2: bool = True, exported: float = 14421.0) -> list[dict[str, Any]]:
    """One poll. Like a live inverter's, its power factor (5035) differs from the last poll's: a
    poll identical to the last is a frozen repeat and left out (see test_frozen.py)."""
    words = {**hybrid_words(exported), "5035": 900 + ts // 60 % 90}
    out = [{"ts": ts, "device": "hybrid", "driver": "sungrow.sh_rs", "input": words}]
    if pv2:
        out.append({"ts": ts, "device": "pv2", "driver": "sungrow.sg_d", "input": pv2_words()})
    return out


def test_snapshots_merge_the_second_inverter_and_carry_missed_reads() -> None:
    carry = Pv2Carry()
    feed = rows(DAY) + rows(DAY + 60, pv2=False) + [{"ts": DAY + 120, "device": "pv2", "input": pv2_words()}]
    out = snapshots(feed, has_pv2=True, behind_meter=True, poll_interval=60, carry=carry, freeze=Freeze())
    assert [ts for ts, _ in out] == [DAY, DAY + 60]  # the poll the hybrid missed isn't recorded
    first, carried = out[0][1], out[1][1]
    assert first["pv_power"] == 4120 + 1800 and first["pv1_power"] == 4120
    assert first["daily_pv"] == round(66.3 + 24.1, 3)
    assert carried["pv2_power"] == 1800  # one missed read: last values carried
    assert carry.info["model"] == "SG5K-D"


def test_every_driver_implements_its_role() -> None:
    for d in drivers.HYBRIDS.values():
        assert d.brand and callable(d.decode) and callable(d.decode_info) and callable(d.frozen)
    for s in drivers.SOLAR.values():
        assert s.brand and callable(s.decode) and callable(s.decode_info)


def test_rows_without_a_driver_use_the_default_and_unknown_drivers_are_skipped() -> None:
    untagged = [{k: v for k, v in r.items() if k != "driver"} for r in rows(DAY)]
    assert decoded(untagged, has_pv2=True)[0][1]["pv2_power"] == 1800
    unknown = [{**r, "driver": "acme.x1"} for r in rows(DAY, pv2=False)]
    assert decoded(unknown, has_pv2=False) == []


def decoded(feed: list[dict[str, Any]], has_pv2: bool) -> list[tuple[int, dict[str, Any]]]:
    return snapshots(feed, has_pv2=has_pv2, behind_meter=True, poll_interval=60, carry=Pv2Carry(), freeze=Freeze())


def test_without_a_second_inverter_nothing_is_merged() -> None:
    ((_, snap),) = decoded(rows(DAY, pv2=False), has_pv2=False)
    assert snap["pv_power"] == 4120 and "pv1_power" not in snap


class FakeCollector:
    def __init__(self, feed: list[dict[str, Any]]):
        self.feed = feed

    def status(self) -> dict[str, Any]:
        return {
            "oldest_ts": min(r["ts"] for r in self.feed),
            "devices": {
                "hybrid": {"host": "inverter", "driver": "sungrow.sh_rs", "last_success": 123.0, "error": None,
                           "info": {"input": {"5000": 0x0D0F, "5001": 50, "5002": 0}, "holding": {"13059": 50}}},
                "pv2": {"host": "dongle", "driver": "sungrow.sg_d", "last_success": 120.0, "error": None, "info": {}},
            },
        }  # fmt: skip

    def readings(self, since: int, limit: int = 1000, wait: int = 0) -> tuple[list[dict[str, Any]], bool]:
        out = [r for r in self.feed if r["ts"] > since]
        return out, False


def _services(db: Database, config: Config) -> tuple[ReadingsRepository, LiveService]:
    settings, tariffs = SettingsStore(db, config), TariffStore(db, config)
    settings.load()
    tariffs.load()
    return ReadingsRepository(db, config.poll_interval, config.raw_retention_days), LiveService(
        config, settings, tariffs
    )


def test_ingest_writes_readings_and_status(db: Database, config: Config) -> None:
    readings, live = _services(db, config)
    fake = FakeCollector(rows(DAY) + rows(DAY + 300, exported=14421.1))
    ingest = CollectorIngest(config, db, readings, live, fake)
    ingest.apply_status(fake.status())
    conn = db.connect()
    newest = ingest._ingest(conn, fake.readings(0)[0])
    assert newest == DAY + 300 and load_cursor(conn) == DAY + 300
    conn.close()

    status = live.status()
    assert status["model"] == "SH5.0RS" and status["system"]["battery_reserve"] == 5.0
    assert status["system"]["pv2"]["host"] == "dongle" and status["system"]["pv2"]["behind_meter"] is True
    assert status["snapshot"]["ts"] == DAY + 300
    # The first rollup has nothing before it, so 2 kW of export for 5 minutes stands in; the
    # second is what the meter's lifetime counter moved. The Today card and the day agree.
    assert status["snapshot"]["daily_export"] == round(2000 * 300 / 3.6e6 + 0.1, 2)
    assert readings.daily(DAY - 3600, DAY + 3600)[0]["daily_export"] == status["snapshot"]["daily_export"]


def test_reprocess_rebuilds_from_raw(db: Database, config: Config) -> None:
    readings, _ = _services(db, config)
    conn = db.connect()
    readings.insert_many(conn, [(DAY, {"daily_export": 25.1, "daily_pv": 66.3})])  # decoded the old way
    conn.close()
    done = reprocess(config, db, FakeCollector(rows(DAY) + rows(DAY + 300, exported=14421.1)))
    assert done["polls"] == 2
    assert readings.daily(DAY - 3600, DAY + 3600)[0]["daily_export"] == round(2000 * 300 / 3.6e6 + 0.1, 2)


def test_a_torn_32_bit_read_is_dropped() -> None:
    """-600 W is 0xFFFF_FDA8; read across an update with a fresh high word it comes out as +64,936 W."""
    torn = {"input": {**hybrid_words(), "13008": 0xFDA8, "13009": 0}}
    out = snapshots([{"ts": DAY, "device": "hybrid", **torn}], has_pv2=False, behind_meter=True,
                    poll_interval=60, carry=Pv2Carry(), freeze=Freeze())  # fmt: skip
    [(_, snap)] = out
    assert snap["load_power"] is None and snap["pv_power"] == 4120  # only the bad value goes


def test_a_garbled_second_inverter_reading_counts_as_missed() -> None:
    """A frame decrypted with a stale key: random words that still parse."""
    garbled = {"5000": 0x9C41, "5001": 0x7A2E, "5003": 0x1F00, "5017": 0x33AA, "5018": 0x0B12,
               "5031": 0xE001, "5032": 0x4D1C, "5008": 0x0101}  # fmt: skip
    assert sg_d.decode({"input": garbled}) is None
    assert sg_d.decode({"input": {**pv2_words(), "5031": 0x2000, "5032": 0x0001}}) is None  # 73 kW from 5 kW
    carry = Pv2Carry()
    feed = [*rows(DAY), *rows(DAY + 60, pv2=False), {"ts": DAY + 60, "device": "pv2", "input": garbled}]
    out = snapshots(feed, has_pv2=True, behind_meter=True, poll_interval=60, carry=carry, freeze=Freeze())
    assert out[1][1]["pv2_power"] == 1800  # the last good values carried, as for a missed read
