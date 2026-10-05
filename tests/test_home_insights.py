from __future__ import annotations

import time

import pytest

from app.core.database import Database
from app.core.schema import ROLLUP
from app.features.home import insights, usage
from app.features.home.repository import HomeRepository
from app.features.readings.repository import ReadingsRepository
from app.features.tariffs.model import default_bands, rate_tables

FLAT = {"type": "flat", "flat_rate": 0.30, "feed_in_rate": 0.05, "supply_charge": 1.0, "bands": []}
TOU = {**FLAT, "type": "tou", "bands": default_bands(0.30)}  # peak 0.42 16–21, off-peak 0.21 21–07, else 0.30
DAY = usage.bucket_start(int(time.mktime((2026, 9, 21, 12, 0, 0, 0, 0, -1))), "day")  # a Monday


def pricing(t: dict = FLAT) -> insights.Pricing:  # type: ignore[type-arg]
    return insights.Pricing(t, rate_tables(t))


def rollups(db: Database, rows: list[tuple[int, float, float]]) -> None:
    """(ts, solar W, grid W) for 5-minute rollups, the home using the two together."""
    with db.writing() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO samples_5m (ts, pv_power, grid_power, battery_power) VALUES (?, ?, ?, 0)", rows
        )


def devices(db: Database, *names: str, kind: str = "plug") -> list[int]:
    repo = HomeRepository(db)
    with db.writing() as conn:
        account = repo.add_account(conn, "fake", {}, 0)
        return [repo.add_device(conn, account, n.lower(), n, kind, None, 0).id for n in names]


def test_a_device_costs_its_share_of_what_came_from_the_grid_at_the_rate_of_the_time(
    db: Database, readings: ReadingsRepository
) -> None:
    """Noon to 1: the home used 2 kW, half from the panels. Peak (4 to 5 pm): 1 kW, all from the grid. A plug used
    0.5 kWh in each hour: half its noon energy came from the grid at 30c, and all its peak energy at 42c."""
    repo = HomeRepository(db)
    noon, four = DAY + 12 * 3600, DAY + 16 * 3600
    rollups(
        db,
        [(noon + i * ROLLUP, 1000.0, 1000.0) for i in range(12)]
        + [(four + i * ROLLUP, 0.0, 1000.0) for i in range(12)],
    )
    (plug,) = devices(db, "Plug")
    with db.writing() as conn:
        repo.add_energy(conn, plug, [(noon, 0.5), (four, 0.5)])
    out = usage.breakdown(repo, readings, DAY, DAY + 86400, "hour")
    raw = 1.0 * 0.30 + 1.0 * 0.42  # what the readings' import came to, priced: Bills says 10% more
    days = [{"date": "2026-09-21", "import_cost": raw * 1.1, "supply": 1.0, "feed_in_credit": 0.0}]
    insights.priced(out, repo, readings, pricing(TOU), days)
    (d,) = out["devices"]
    assert d["cost"] == pytest.approx((0.25 * 0.30 + 0.5 * 0.42) * 1.1, abs=1e-4)
    assert d["solar_share"] == pytest.approx(0.25)
    cost = out["total"]["cost"]
    assert cost["import"] == pytest.approx(raw * 1.1, abs=0.01) and cost["supply"] == 1.0
    assert cost["devices"] + cost["other"] == pytest.approx(cost["import"], abs=0.01)


def test_whats_always_on_is_the_least_drawn_on_a_typical_night(db: Database, readings: ReadingsRepository) -> None:
    repo = HomeRepository(db)
    (tv,) = devices(db, "TV")
    now = DAY + 7 * 86400 + 12 * 3600
    rows = []
    for n, low in enumerate([300.0, 320.0, 900.0, 310.0, 305.0, 315.0, 330.0]):  # one night something was left on
        night = DAY + (n + 1) * 86400 + 3600
        rows += [(night + i * ROLLUP, 0.0, low + (i % 3) * 50) for i in range(48)]
        with db.writing() as conn:
            repo.add_energy(conn, tv, [(night + i * ROLLUP, 8 * insights.KWH_PER_W_ROLLUP) for i in range(48)])
    rollups(db, rows)
    s = insights.standby(repo, readings, pricing(), now)
    assert s["nights"] == 7 and s["home_w"] == 315
    assert s["yearly_cost"] == pytest.approx(0.315 * 24 * 365 * 0.30, abs=0.01)
    assert s["devices"] == [{"id": tv, "w": 8.0, "yearly_cost": pytest.approx(0.008 * 24 * 365 * 0.30, abs=0.01)}]


def test_a_block_no_device_measured_that_comes_back_each_morning_is_a_habit(
    db: Database, readings: ReadingsRepository
) -> None:
    """Six days of 300 W, with 2.4 kW more for 45 minutes from about 6 am (a few minutes either way) on five."""
    repo = HomeRepository(db)
    rows = []
    for n in range(6):
        day = DAY + n * 86400
        start = day + 6 * 3600 + (n % 3) * ROLLUP
        for i in range(288):
            ts = day + i * ROLLUP
            heating = n != 2 and start <= ts < start + 45 * 60
            rows.append((ts, 0.0, 300.0 + (2400.0 if heating else 0.0)))
    rollups(db, rows)
    found = insights.unexplained(repo, readings, DAY + 6 * 86400)
    assert found["days"] == 6
    (habit,) = found["habits"]
    assert habit["days"] == 5 and habit["minutes"] == 45 and habit["kw"] == pytest.approx(2.4, abs=0.01)
    assert 360 <= habit["at"] <= 370 and habit["guess"] == "hot_water"
    assert habit["kwh_per_day"] == pytest.approx(1.8 * 5 / 6, abs=0.01)


def test_guesses_go_by_when_how_long_and_how_much() -> None:
    assert insights.guess(23 * 60, 180, 7.0) == "car"
    assert insights.guess(17.5 * 60, 50, 2.2) == "cooking"
    assert insights.guess(14 * 60, 240, 1.2) == "air_conditioning"
    assert insights.guess(3 * 60, 20, 0.9) is None


def test_the_best_time_to_run_is_the_first_covered_by_spare_solar_else_the_cheapest(db: Database) -> None:
    (washer,) = devices(db, "Washer", kind="washer")
    repo = HomeRepository(db)
    pattern = {"id": washer, "run_kwh": 1.0, "run_minutes": 60}
    now = DAY + 19 * 3600 + 600  # Monday 7:10 pm
    tomorrow = DAY + 86400
    steps = [{"ts": tomorrow + h * 3600, "pv_kw": 4.0 if 10 <= h < 14 else 0.0, "load_kw": 1.0} for h in range(24)]
    (best,) = insights.best_times(repo.devices(), [pattern], steps, pricing(TOU), now)
    assert (best["start"], best["why"], best["solar_share"], best["cost"]) == (tomorrow + 10 * 3600, "solar", 1.0, 0)
    # No forecast: the cheapest time to start, off-peak from 9 pm.
    (cheap,) = insights.best_times(repo.devices(), [pattern], None, pricing(TOU), now)
    assert (cheap["start"], cheap["why"], cheap["cost"]) == (DAY + 21 * 3600, "cheapest", pytest.approx(0.21))
    # An appliance that hasn't run yet has no typical run to go by.
    assert insights.best_times(repo.devices(), [{**pattern, "run_kwh": None}], steps, pricing(TOU), now) == []
