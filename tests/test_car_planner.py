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
    assert best["kind"] == "cheapest" and out["mode"] == "cheapest" and out["reachable"]
    assert best["start"] >= T0 + 9 * HOUR and best["end"] <= T0 + 15 * HOUR
    assert best["solar_share"] > 0.9
    # It costs only the feed-in it forgoes: about 5c for each of the 16.7 kWh.
    assert best["cost"] == pytest.approx(16.67 * 0.05, abs=0.1)
    assert best["soc_to"] == 70 and best["km"] == round(15 * 1000 / 160)
    # Starting now at full speed is shown too, for comparison, and costs more.
    now = next(o for o in out["options"] if o["kind"] == "fastest")
    assert now["start"] == T0 and now["amps"] == 16 and now["cost"] > best["cost"] + 3
    assert [o["kind"] for o in out["options"]] == ["cheapest", "solar", "battery", "fastest"]
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
    assert only["kind"] == "fastest" and only["end"] == T0 + 2 * HOUR
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


# A car on single phase that takes 5 to 20 A (1.15 to 4.6 kW).
SINGLE = dataclasses.replace(CAR, phases=1, min_amps=5, max_amps=20)


def test_overnight_it_can_spare_the_home_battery_and_charge_gently() -> None:
    # 18:00 to 07:30 the next morning, no sun, a flat 30c, a full home battery that may help the car.
    ss = steps(14)
    p = planner(ss, [0.30] * 14, home_soc=1.0)
    out = suggest(p, SINGLE, now=T0, ready_by=T0 + 13 * HOUR + 1800, soc_now=50, soc_to=80, mode="battery")
    plans = {o["kind"]: o for o in out["options"]}
    assert out["options"][0]["kind"] == "battery"  # the aim asked for comes first
    # Full speed drains the home battery into the car; sparing it, the car takes none of it, at a gentle current
    # spread over the night instead of 20 A.
    assert plans["fastest"]["amps"] == 20 and plans["fastest"]["battery_kwh"] > 3
    spared = plans["battery"]
    assert spared["battery_kwh"] == pytest.approx(0, abs=0.05) and not spared["battery_helps"]
    assert spared["amps"] < 20 and spared["end"] - spared["start"] > 6 * HOUR
    assert sum(s["power_kw"] * (s["end"] - s["start"]) / 3600 for s in spared["steps"]) == pytest.approx(25, abs=0.05)


def test_following_the_sun_changes_the_current_as_the_sun_does() -> None:
    # Solar climbing from 1.5 kW at 06:00 to 6 kW by 10:00; the house uses 0.5 kW and the battery is full.
    pv = {6: 1.5, 7: 2.5, 8: 4.0, 9: 5.5, 10: 6.0, 11: 6.0, 12: 6.0}
    ss = steps(16, pv=pv)
    out = suggest(planner(ss, [0.30] * 16), SINGLE, now=T0, ready_by=T0 + 15 * HOUR, soc_now=60, soc_to=80)
    sunny = next(o for o in out["options"] if o["kind"] == "solar")
    amps = [s["amps"] for s in sunny["steps"]]
    # 4 A of the 1 kW spare at 06:00 is under the 5 A minimum, but 1 kW covers most of it; then up with the sun.
    assert amps[:4] == [5, 8, 15, 20] and sunny["steps"][0]["start"] == T0 + 6 * HOUR
    assert sunny["solar_share"] > 0.9 and sunny["cost"] < 1.0
    assert out["spare"][6] == {"start": T0 + 6 * HOUR, "end": T0 + 7 * HOUR, "kw": 1.0}


def test_a_car_not_needed_for_days_charges_from_each_days_sun() -> None:
    # 36% at 18:00 on a Sunday, needed 05:00 Wednesday: 59 hours. Two sunny days (Monday and Tuesday, 5 kW spare
    # from 09:00 to 15:00), a flat 30c, the home battery full.
    pv = {h: 5.5 for d in (24, 48) for h in range(d - 18 + 9, d - 18 + 15)}
    ss = steps(72, pv=pv)
    out = suggest(planner(ss, [0.30] * 72), SINGLE, now=T0, ready_by=T0 + 59 * HOUR, soc_now=36, soc_to=80)
    sunny = next(o for o in out["options"] if o["kind"] == "solar")
    days = {(st["start"] - T0 + 18 * HOUR) // (24 * HOUR) for st in sunny["steps"]}
    assert days == {1, 2}  # Monday and Tuesday, nothing overnight
    # It costs the feed-in forgone, and a little evening grid where the car took what would have refilled the battery.
    assert sunny["solar_share"] > 0.95 and sunny["cost"] < sunny["wall_kwh"] * 0.1
    fastest = next(o for o in out["options"] if o["kind"] == "fastest")
    assert fastest["cost"] > sunny["cost"] + 5


def test_the_ready_by_time_is_the_next_one_at_least_an_hour_away() -> None:
    lt = time.localtime(T0)
    six = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 6, 0, 0, 0, 0, -1)))
    seven_thirty = six + 90 * 60
    assert next_ready_by(six, 450) == seven_thirty
    assert next_ready_by(seven_thirty - 1800, 450) == int(
        time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + 1, 7, 30, 0, 0, 0, -1))
    )
    # Only on Wednesdays and Fridays: the next of those at 05:00.
    wed = next_ready_by(six, 300, ["wed", "fri"])
    assert time.localtime(wed).tm_wday in (2, 4) and time.localtime(wed).tm_hour == 5
    assert 0 < wed - six <= 7 * 86400


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


def test_a_plan_in_steps_is_kept_and_removed_as_one(car: CarService) -> None:
    steps_ = [
        {"start": T0 + HOUR, "end": T0 + 2 * HOUR, "amps": 10},
        {"start": T0 + 2 * HOUR, "end": T0 + 4 * HOUR, "amps": 16},
    ]
    kept = car.add_plan({"steps": steps_, "phases": 1, "soc_now": 40, "battery_helps": False}, now=T0)
    assert [(c["amps"], c["battery_helps"]) for c in kept] == [(10, False), (16, False)]
    assert kept[0]["plan"] == kept[1]["plan"] == kept[0]["id"]
    # Each step's level follows on from the last: 2.3 kWh, then 7.36 kWh, 90% of it into 75 kWh.
    assert kept[0]["soc_to"] == pytest.approx(40 + 2.3 * 0.9 / 75 * 100, abs=0.1)
    assert kept[1]["soc_from"] == kept[0]["soc_to"] and soc(car, T0 + 5 * HOUR) == kept[1]["soc_to"]
    with pytest.raises(ValueError, match="in order"):
        car.add_plan({"steps": [steps_[1], steps_[0]], "phases": 1}, now=T0)
    assert car.remove(kept[1]["id"]) and car.listed(T0) == []


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

    def steps(self, now: int | None = None, days: int = 3) -> list[dict[str, Any]]:
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
