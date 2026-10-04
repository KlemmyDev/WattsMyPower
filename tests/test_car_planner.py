"""Suggested car charges, and the car's level between times it's given."""

from __future__ import annotations

import dataclasses
import time
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.car.planner import ChargePlanner, Home, Planner, next_ready_by, suggest
from app.features.car.service import CarService, CarSpec
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore

HOUR = 3600
T0 = 1_790_002_800 - 1_790_002_800 % HOUR  # a whole hour; step k starts k hours after it

# A Model Y on a three-phase charger: 5 to 16 A, so 3.45 to 11 kW.
CAR = CarSpec(
    capacity_kwh=75, efficiency=90, volts=230, phases=3, min_amps=5, max_amps=16, battery_helps=True, wh_per_km=160
)


def steps(n: int, pv: dict[int, float] | None = None, load: float = 0.5) -> list[dict[str, Any]]:
    return [{"start": T0 + k * HOUR, "dur": HOUR, "pv_kw": (pv or {}).get(k, 0.0), "load_kw": load} for k in range(n)]


def planner(ss: list[dict[str, Any]], buy: list[float], sell: float = 0.05, home_soc: float = 1.0) -> Planner:
    return Planner(ss, [], Home(soc=home_soc, cap=10, reserve=0.1, max_kw=5), buy, [sell] * len(ss))


def test_a_sunny_day_charges_the_car_from_spare_solar() -> None:
    # 8 kW of solar from 09:00 to 15:00, a full home battery, and grid power at 30c: charge in the sun.
    ss = steps(24, pv={h: 8.0 for h in range(9, 15)})
    out = suggest(planner(ss, [0.30] * 24), CAR, now=T0, ready_by=T0 + 24 * HOUR, soc_now=50, soc_to=70)
    best = out["options"][0]
    assert best["kind"] == "best" and out["reachable"]
    assert best["start"] >= T0 + 9 * HOUR and best["end"] <= T0 + 15 * HOUR
    assert best["solar_share"] > 0.9
    # It costs only the feed-in it forgoes: about 5c for each of the 16.7 kWh.
    assert best["cost"] == pytest.approx(16.67 * 0.05, abs=0.1)
    assert best["soc_to"] == 70 and best["km"] == round(15 * 1000 / 160)
    # Starting now at full speed is shown too, for comparison, and costs more.
    now = next(o for o in out["options"] if o["kind"] == "now")
    assert now["start"] == T0 and now["amps"] == 16 and now["cost"] > best["cost"] + 3
    # 7.5 kW spare for six hours, less the 4.5 kWh refilling the battery after it ran the house overnight.
    assert out["spare_kwh"] == pytest.approx(6 * 7.5 - 9 * 0.5)


def test_without_sun_it_charges_in_the_cheapest_hours_before_its_needed() -> None:
    # Evening at 45c until 21:00, off-peak at 20c from 22:00 to 07:00, 30c otherwise. Needed by 07:00, no sun,
    # and the home battery at its reserve so it can't help.
    buy = [0.45 if 16 <= k % 24 < 21 else 0.20 if k % 24 >= 22 or k % 24 < 7 else 0.30 for k in range(16, 40)]
    ss = steps(24)  # step 0 is 16:00
    p = planner(ss, buy, home_soc=0.1)
    out = suggest(p, CAR, now=T0, ready_by=T0 + 15 * HOUR, soc_now=30, soc_to=80)
    best = out["options"][0]
    assert best["start"] >= T0 + 6 * HOUR and best["end"] <= T0 + 15 * HOUR  # inside 22:00 to 07:00
    assert best["cost"] == pytest.approx(41.67 * 0.20, abs=0.05)
    assert best["solar_share"] == 0


def test_a_charge_that_cant_be_done_in_time_says_how_far_it_gets() -> None:
    # 40% to 100% of 75 kWh is 50 kWh from the wall: 4.5 hours at 11 kW. Two hours isn't enough.
    out = suggest(planner(steps(6), [0.3] * 6), CAR, now=T0, ready_by=T0 + 2 * HOUR, soc_now=40, soc_to=100)
    assert not out["reachable"]
    (only,) = out["options"]
    assert only["kind"] == "now" and only["end"] == T0 + 2 * HOUR
    assert only["soc_to"] == pytest.approx(40 + 11.04 * 2 * 0.9 / 75 * 100, abs=0.1)


def test_one_phase_is_suggested_when_three_is_too_much_for_the_sun() -> None:
    # About 2.6 kW of spare solar for seven hours: three phases (3.45 kW at least) would need the grid too.
    ss = steps(24, pv={h: 3.1 for h in range(8, 15)})
    own = dataclasses.replace(CAR, battery_helps=False)
    out = suggest(planner(ss, [0.35] * 24), own, now=T0, ready_by=T0 + 24 * HOUR, soc_now=60, soc_to=80)
    one = out["single_phase"]
    assert one is not None and one["phases"] == 1 and one["amps"] <= 16
    assert one["cost"] < out["options"][0]["cost"] - 0.3 and one["solar_share"] > out["options"][0]["solar_share"]
    # When the home battery may help, it fills the gap between the sun and three phases, and costs no more.
    helped = suggest(planner(ss, [0.35] * 24), CAR, now=T0, ready_by=T0 + 24 * HOUR, soc_now=60, soc_to=80)
    assert helped["single_phase"] is None and helped["options"][0]["cost"] == pytest.approx(one["cost"], abs=0.05)


def test_the_ready_by_time_is_the_next_one_at_least_an_hour_away() -> None:
    lt = time.localtime(T0)
    six = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 6, 0, 0, 0, 0, -1)))
    seven_thirty = six + 90 * 60
    assert next_ready_by(six, 450) == seven_thirty
    assert next_ready_by(seven_thirty - 1800, 450) == int(
        time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + 1, 7, 30, 0, 0, 0, -1))
    )


@pytest.fixture
def car(db: Database, config: Config) -> CarService:
    settings = SettingsStore(db, config)
    settings.load()
    settings.save({"car_phases": 3})
    return CarService(db, settings)


def soc(car: CarService, at: int) -> float:
    level = car.level(at)
    assert level is not None
    return float(level["soc"])


def test_the_cars_level_counts_planned_charges_since_it_was_given(car: CarService) -> None:
    assert car.level(T0) is None
    car.set_level({"soc": 40}, now=T0)
    # 16 A three-phase (11.04 kW) from an hour on, to stop at 70%.
    car.add({"start": T0 + HOUR, "soc_to": 70, "soc_now": None, "hours": None, "amps": 16} | {"hours": 5}, now=T0)
    assert soc(car, T0 + HOUR) == 40  # not started
    two = car.level(T0 + 2 * HOUR)
    assert two is not None
    assert two["soc"] == pytest.approx(40 + 11.04 * 0.9 / 75 * 100, abs=0.1) and two["charged"] and two["given"] == 40
    assert two["km"] == round(two["soc"] / 100 * 75 * 1000 / 170)
    # A charge for a set time with no level to stop at runs to full; a level given later starts afresh.
    assert soc(car, T0 + 7 * HOUR) == 100
    car.set_level({"soc": 55}, now=T0 + 8 * HOUR)
    assert soc(car, T0 + 9 * HOUR) == 55
    with pytest.raises(ValueError, match="between 0 and 100"):
        car.set_level({"soc": 120})


def test_a_charge_planned_with_the_cars_level_records_it(car: CarService) -> None:
    car.add({"start": T0 + HOUR, "soc_now": 35, "soc_to": 80}, now=T0)
    level = car.level(T0)
    assert level is not None and level["given"] == 35 and level["given_at"] == T0
    # The level it's planned to reach caps what it adds.
    assert car.planned_soc(35, T0, T0 + 10 * HOUR) == 80
    # A charge after that one starts where it leaves the car, which isn't the car's level now.
    car.add({"start": T0 + 6 * HOUR, "soc_now": 80, "soc_to": 90, "level_now": False}, now=T0 + 60)
    assert soc(car, T0 + 60) == 35


class FakeForecast:
    def __init__(self, ss: list[dict[str, Any]]):
        self.ss = ss

    def steps(self, now: int | None = None) -> list[dict[str, Any]]:
        return self.ss


def test_suggestions_start_from_the_cars_last_level_and_usual_limit(
    car: CarService, db: Database, config: Config
) -> None:
    tariffs = TariffStore(db, config)
    tariffs.load()
    ss = steps(30, pv={h: 8.0 for h in range(9, 15)})
    plan = ChargePlanner(car, FakeForecast(ss), car.settings, tariffs, None)  # type: ignore[arg-type]
    ask: dict[str, Any] = {"home_soc": 100.0, "battery_kwh": 10.0, "reserve_pct": 10.0, "now": T0}
    with pytest.raises(ValueError, match="charge is now"):
        plan.suggest({"ready_by": T0 + 20 * HOUR}, **ask)
    car.set_level({"soc": 50}, now=T0)
    out = plan.suggest({"ready_by": T0 + 20 * HOUR}, **ask)
    assert out["soc_now"] == 50 and out["soc_to"] == 80 and not out["covered"] and out["options"]
    # A charge already planned to 80% before then covers it.
    car.add({"start": T0 + 2 * HOUR, "soc_now": 50, "soc_to": 80}, now=T0)
    covered = plan.suggest({"ready_by": T0 + 20 * HOUR}, **ask)
    assert covered["covered"] and covered["planned_soc"] == 80 and covered["options"] == []
    with pytest.raises(ValueError, match="15 minutes"):
        plan.suggest({"ready_by": T0 + 60}, **ask)
