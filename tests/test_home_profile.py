from __future__ import annotations

import time

import pytest

from app.core.config import Config
from app.core.database import Database
from app.core.schema import ROLLUP
from app.features.home import profile, usage
from app.features.home.repository import HomeRepository
from app.features.home.service import HomeService
from app.features.home.types import Reading

DAY = usage.bucket_start(int(time.mktime((2026, 9, 21, 12, 0, 0, 0, 0, -1))), "day")  # a Monday


def at(days: int, hour: float = 0) -> int:
    """`hour` o'clock, `days` after DAY (a day's length kept right across daylight saving)."""
    return usage.bucket_start(DAY + days * 86400 + 3600, "day") + int(hour * 3600)


def devices(db: Database, *names: str) -> list[int]:
    repo = HomeRepository(db)
    with db.writing() as conn:
        account = repo.add_account(conn, "fake", {}, 0)
        return [repo.add_device(conn, account, n.lower(), n, "plug", None, 0).id for n in names]


def test_today_is_set_against_the_same_weekday_and_where_it_ends_up_is_what_s_left_of_that(db: Database) -> None:
    """Four weeks: every Monday at 6 pm the washer uses 1 kWh; every other day 0.1 kWh at 8 am. On the fifth Monday at
    noon it's used 0.2 kWh: the usual Monday is 1 kWh, all of it still to come, so it should end up at 1.2."""
    repo = HomeRepository(db)
    (washer,) = devices(db, "Washer")
    with db.writing() as conn:
        for d in range(28):
            repo.add_energy(conn, washer, [(at(d, 18), 1.0)] if d % 7 == 0 else [(at(d, 8), 0.1)])
        repo.add_energy(conn, washer, [(at(28, 9), 0.2)])
    p = profile.profile(repo, [washer], at(28, 12))
    assert p["days"] == 28
    usual = p["today"]["usual"]
    assert usual["same_weekday"] and usual["days"] == 4
    assert usual["kwh"] == pytest.approx(1.0) and usual["by_now"] == pytest.approx(0.0)
    assert max(usual["w"]) == pytest.approx(4000)  # 1 kWh in a quarter hour
    assert p["today"]["kwh"] == pytest.approx(0.2)
    assert p["today"]["by_midnight"] == pytest.approx(1.2)
    assert p["today"]["w"] == [pytest.approx(0.2 / (ROLLUP / 3600) * 1000)]
    # Mondays at 6 pm, the other days at 8 am.
    assert p["week"][0][18] == pytest.approx(1.0) and p["week"][0][8] == 0
    assert p["week"][3][8] == pytest.approx(0.1)


def test_the_days_ahead_are_each_weekdays_usual_with_the_range_most_of_them_land_in(db: Database) -> None:
    repo = HomeRepository(db)
    (tv,) = devices(db, "TV")
    with db.writing() as conn:
        for d in range(28):
            repo.add_energy(conn, tv, [(at(d, 20), 2.0 if d % 7 == 5 else 0.5 + 0.1 * (d // 7))])
    p = profile.profile(repo, [tv], at(28, 12))  # a Monday
    ahead = p["ahead"]
    assert len(ahead) == 7 and ahead[0]["date"] == time.strftime("%Y-%m-%d", time.localtime(at(29)))
    tue, sat = ahead[0], ahead[4]
    assert tue["kwh"] == pytest.approx(0.65) and tue["low"] < tue["kwh"] < tue["high"]
    assert sat["kwh"] == pytest.approx(2.0) and sat["low"] == sat["high"] == pytest.approx(2.0)


def test_with_too_few_of_a_weekday_the_usual_day_is_every_day_s(db: Database) -> None:
    repo = HomeRepository(db)
    (fridge,) = devices(db, "Fridge")
    with db.writing() as conn:
        for d in range(5):
            repo.add_energy(conn, fridge, [(at(d, 3), 0.4)])
    p = profile.profile(repo, [fridge], at(5, 1))
    assert p["days"] == 5 and not p["today"]["usual"]["same_weekday"] and p["today"]["usual"]["days"] == 5
    assert p["today"]["by_midnight"] == pytest.approx(0.4)


def test_nothing_read_yet_gives_no_usual_and_no_forecast(db: Database) -> None:
    repo = HomeRepository(db)
    (plug,) = devices(db, "Plug")
    p = profile.profile(repo, [plug], at(3, 12))
    assert p["days"] == 0 and p["today"]["by_midnight"] is None and p["month"]["likely"] is None
    assert all(d["kwh"] is None for d in p["ahead"]) and p["peaks"] == [] and p["spikes"] == []
    assert p["peak_today"] is None


def test_a_draw_well_over_the_device_s_usual_daily_peak_is_a_spike(db: Database) -> None:
    """A kettle tops out at 2 kW every morning; one day something on the same plug drew 3.5 kW. A day at 2.1 kW isn't
    a spike: it's not half as much again."""
    repo = HomeRepository(db)
    kettle, lamp = devices(db, "Kettle", "Lamp")
    with db.writing() as conn:
        for d in range(10):
            repo.add_peak(conn, kettle, at(d, 7) + 60, 3500 if d == 4 else 2100 if d == 6 else 2000)
            repo.add_peak(conn, kettle, at(d, 7) + 120, 1500)  # the same 5 minutes: the most is kept
            repo.add_peak(conn, lamp, at(d, 19), 40)
    s = profile.spikes(repo, {kettle, lamp}, at(9, 12))
    assert s["spikes"] == [{"ts": at(4, 7), "device": kettle, "w": 3500, "usual_w": 2000, "spike": True}]
    assert s["peak_today"]["device"] == kettle and s["peak_today"]["w"] == 2000
    kettle_peak, lamp_peak = s["peaks"]
    assert kettle_peak["device"] == kettle and kettle_peak["usual_w"] == 2000 and kettle_peak["days"] == 10
    assert kettle_peak["max"]["w"] == 3500 and lamp_peak["usual_w"] == 40


def test_polls_keep_each_device_s_highest_power_in_each_5_minutes(db: Database, config: Config) -> None:
    svc = HomeService(config, db, {})
    repo = svc.repo
    with db.writing() as conn:
        account = repo.add_account(conn, "fake", {}, 0)
        svc._apply(
            conn,
            account,
            [
                (at(1, 7), [Reading("k", "Kettle", "plug", power_w=1800)]),
                (at(1, 7) + 60, [Reading("k", "Kettle", "plug", power_w=2400)]),
                (at(1, 7) + 120, [Reading("k", "Kettle", "plug", power_w=300)]),
                (at(1, 7) + 300, [Reading("k", "Kettle", "plug", power_w=0)]),  # nothing drawn: no peak
                (at(1, 7) + 360, [Reading("k", "Kettle", "plug", power_w=900, online=False)]),
            ],
            live=False,
        )
    (device,) = repo.devices()
    assert repo.peaks(at(1), at(2), [device.id]) == [(at(1, 7), device.id, 2400)]


def test_an_appliance_s_usual_peak_is_from_the_days_it_ran_not_the_days_it_sat_idle(db: Database) -> None:
    """A washer idles at 1 W, and runs at 1.9 kW two days in seven: its usual peak is 1.9 kW, so its washes aren't
    spikes, and the days it only idled aren't among the biggest draws."""
    repo = HomeRepository(db)
    (washer,) = devices(db, "Washer")
    with db.writing() as conn:
        for d in range(14):
            for i in range(288):
                repo.add_peak(conn, washer, at(d) + i * ROLLUP, 1.0)
            if d % 7 in (2, 5):
                repo.add_peak(conn, washer, at(d, 18), 1900)
    s = profile.spikes(repo, {washer}, at(13, 23))
    (washes,) = s["peaks"]
    assert washes["usual_w"] == 1900 and washes["days"] == 4 and s["spikes"] == []
    assert s["peak_today"] is None  # the 13th only idled
