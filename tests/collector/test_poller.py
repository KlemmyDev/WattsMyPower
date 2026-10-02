"""The poll loop with fake devices: no inverter, no network."""

from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from collector.config import Config
from collector.poller import INFO_EVERY, Poller
from collector.store import Store
from tests.collector.conftest import Clock, FakeDevice


def make(cfg: Config, store: Store, pv2: bool = True) -> tuple[Poller, FakeDevice, FakeDevice, Clock]:
    hybrid, second, clock = FakeDevice("hybrid"), FakeDevice("pv2", "10.0.0.2", {5000: 294, 5031: 1200}), Clock()
    second.info, second.info_holding = {}, {}
    return Poller(cfg, store, hybrid, second if pv2 else None, clock=clock), hybrid, second, clock


def test_one_poll_shares_one_ts(cfg: Config, store: Store) -> None:
    poller, _, _, clock = make(cfg, store)
    clock.t = 1_790_852_400.7
    assert asyncio.run(poller.poll_once())
    rows, _ = store.since(0, 10)
    assert [(r.ts, r.device) for r in rows] == [(1_790_852_400, "hybrid"), (1_790_852_400, "pv2")]


def test_info_registers_are_stored_on_the_polls_that_read_them(cfg: Config, store: Store) -> None:
    poller, _, _, clock = make(cfg, store, pv2=False)
    asyncio.run(poller.poll_once())
    clock.t += 60
    asyncio.run(poller.poll_once())
    first, second = store.since(0, 10)[0]
    assert "4990" in first.input and first.holding == '{"13059":50}'
    assert "4990" not in second.input and second.holding is None


def test_a_pv2_failure_never_stops_the_hybrid(cfg: Config, store: Store) -> None:
    poller, _, pv2, _ = make(cfg, store)
    pv2.fail = True
    assert asyncio.run(poller.poll_once())
    assert [r.device for r in store.since(0, 10)[0]] == ["hybrid"]
    assert poller.status["pv2"].error == "ConnectionError: pv2 down"
    assert poller.status["hybrid"].error is None


def test_a_hybrid_failure_still_stores_pv2(cfg: Config, store: Store) -> None:
    poller, hybrid, _, _ = make(cfg, store)
    hybrid.fail = True
    assert not asyncio.run(poller.poll_once())
    assert [r.device for r in store.since(0, 10)[0]] == ["pv2"]
    assert poller.status["hybrid"].error == "ConnectionError: hybrid down"


def test_nothing_is_written_when_nothing_answers(cfg: Config, store: Store) -> None:
    poller, hybrid, pv2, _ = make(cfg, store)
    hybrid.fail = pv2.fail = True
    event = poller.landed()
    assert not asyncio.run(poller.poll_once())
    assert store.is_empty() and not event.is_set()


def test_info_is_read_first_and_every_six_hours(cfg: Config, store: Store) -> None:
    poller, hybrid, _, clock = make(cfg, store, pv2=False)
    hybrid.fail = True  # a failed first poll doesn't count: the next one still reads info
    asyncio.run(poller.poll_once())
    hybrid.fail = False
    for _ in range(3):
        asyncio.run(poller.poll_once())
        clock.t += 60
    clock.t += INFO_EVERY
    asyncio.run(poller.poll_once())
    assert hybrid.calls == [True, True, False, False, True]


def test_status_keeps_the_latest_info(cfg: Config, store: Store) -> None:
    poller, hybrid, _, clock = make(cfg, store)
    asyncio.run(poller.poll_once())
    hybrid.info = {4990: 1}  # later polls without info don't clear it; a new info read updates it
    clock.t += 60
    asyncio.run(poller.poll_once())
    st = poller.status["hybrid"].as_json()
    assert st == {
        "host": "10.0.0.1",
        "driver": "sungrow.sh_rs",
        "last_success": clock.t,
        "error": None,
        "info": {"input": {"4990": 16691, "5000": 3597}, "holding": {"13059": 50}},
    }
    clock.t += INFO_EVERY
    asyncio.run(poller.poll_once())
    assert poller.status["hybrid"].as_json()["info"]["input"] == {"4990": 1, "5000": 3597}
    assert poller.status["pv2"].as_json()["info"] == {"input": {}}


def test_waiters_are_woken_after_each_write(cfg: Config, store: Store) -> None:
    poller, *_ = make(cfg, store)
    first = poller.landed()
    asyncio.run(poller.poll_once())
    assert first.is_set() and not poller.landed().is_set()


def test_hybrid_fresh(cfg: Config, store: Store) -> None:
    poller, _, _, clock = make(cfg, store)
    assert not poller.hybrid_fresh()
    asyncio.run(poller.poll_once())
    assert poller.hybrid_fresh()
    clock.t += 361  # max(120, 60 * 6)
    assert not poller.hybrid_fresh()


class Stop(Exception):
    pass


def run_loop(poller: Poller, sleeps: list[float], n: int) -> None:
    """Run the loop until it has slept n times."""

    async def sleep(s: float) -> None:
        sleeps.append(s)
        if len(sleeps) >= n:
            raise Stop

    poller._sleep = sleep
    with pytest.raises(Stop):
        asyncio.run(poller._run())


def test_hybrid_failures_back_off_exponentially(cfg: Config, store: Store) -> None:
    poller, hybrid, _, _ = make(cfg, store)
    hybrid.fail = True
    sleeps: list[float] = []
    run_loop(poller, sleeps, 5)
    assert sleeps == [60, 120, 240, 300, 300]


def test_backoff_resets_once_the_hybrid_answers(cfg: Config, store: Store) -> None:
    poller, hybrid, _, _ = make(cfg, store)
    hybrid.fail = True
    sleeps: list[float] = []

    async def sleep(s: float) -> None:
        sleeps.append(s)
        hybrid.fail = len(sleeps) < 2
        if len(sleeps) >= 4:
            raise Stop

    poller._sleep = sleep
    with pytest.raises(Stop):
        asyncio.run(poller._run())
    assert sleeps[:2] == [60, 120]
    assert all(59 < s <= 60 for s in sleeps[2:])  # back to the interval, less the time the poll took


def test_pv2_failures_dont_back_off(cfg: Config, store: Store) -> None:
    poller, _, pv2, _ = make(cfg, store)
    pv2.fail = True
    sleeps: list[float] = []
    run_loop(poller, sleeps, 3)
    assert all(59 < s <= 60 for s in sleeps)


def test_the_loop_prunes_old_rows(cfg: Config) -> None:
    store = Store(cfg.db_path, retention_days=1)
    store.migrate()
    poller, _, _, clock = make(replace(cfg, retention_days=1), store)
    store.write_poll(int(clock.t) - 2 * 86400, [("hybrid", "sungrow.sh_rs", {1: 1}, {})])
    run_loop(poller, [], 1)
    assert store.bounds() == (int(clock.t), int(clock.t))
