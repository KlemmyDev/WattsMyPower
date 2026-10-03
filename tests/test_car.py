"""Car charges planned ahead: what a charge comes to, keeping them, and the forecast counting them."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.car.service import CarService, Charge, estimate
from app.features.forecast.service import add_car, simulate
from app.features.settings.store import SettingsStore
from app.main import create_app

NOW = 1_790_000_000
HOUR = 3600
CAR = {"volts": 230.0, "efficiency": 90.0, "capacity_kwh": 75.0}


def test_a_charge_to_a_level_takes_what_the_battery_needs_plus_losses() -> None:
    # 16 A on three phases is 11.04 kW. 40% to 90% of 75 kWh is 37.5 kWh into the car, 41.7 from the wall.
    e = estimate(start=NOW, amps=16, phases=3, soc_now=40, soc_to=90, hours=None, **CAR)
    assert e["power_kw"] == 11.04 and e["car_kwh"] == 37.5 and e["wall_kwh"] == pytest.approx(41.67, abs=0.01)
    assert e["hours"] == pytest.approx(41.67 / 11.04, abs=0.01)
    assert e["end"] == pytest.approx(NOW + 37.5 / 0.9 / 11.04 * HOUR, abs=1)
    assert e["soc_to"] == 90


def test_a_charge_for_a_set_time_stops_when_the_car_is_full() -> None:
    # 10 A single phase (2.3 kW) for 3 hours: 6.9 kWh from the wall, 6.21 into the car.
    e = estimate(start=NOW, amps=10, phases=1, soc_now=50, soc_to=None, hours=3, **CAR)
    assert e["wall_kwh"] == pytest.approx(6.9) and e["soc_to"] == pytest.approx(50 + 6.21 / 75 * 100, abs=0.1)
    # Without the charge now, it simply runs its time.
    assert estimate(start=NOW, amps=10, phases=1, soc_now=None, soc_to=None, hours=3, **CAR)["soc_to"] is None
    # From 98%, 3 hours at 11 kW fills it in minutes, and stops there.
    full = estimate(start=NOW, amps=16, phases=3, soc_now=98, soc_to=None, hours=3, **CAR)
    assert full["soc_to"] == 100 and full["car_kwh"] == pytest.approx(1.5) and full["hours"] < 0.2


@pytest.mark.parametrize(
    ("kw", "message"),
    [
        ({"soc_now": 80, "soc_to": 60, "hours": None}, "above the car's charge now"),
        ({"soc_now": None, "soc_to": 90, "hours": None}, "charge now"),
        ({"soc_now": 0, "soc_to": 100, "hours": None, "amps": 1, "phases": 1}, "more than 48"),
    ],
)
def test_charges_that_cant_be_worked_out_say_why(kw: dict, message: str) -> None:
    args = {"start": NOW, "amps": 16, "phases": 3, **CAR, **kw}
    with pytest.raises(ValueError, match=message):
        estimate(**args)


def test_charges_are_kept_listed_and_removed(db: Database, config: Config) -> None:
    settings = SettingsStore(db, config)
    settings.load()
    settings.save({"car_phases": 3})
    car = CarService(db, settings)
    added = car.add({"start": NOW + HOUR, "soc_now": 40, "soc_to": 90, "battery_helps": False}, now=NOW)
    assert added["phases"] == 3 and added["amps"] == 16  # the car's usual way of charging
    (listed,) = car.listed(now=NOW)
    assert listed["id"] == added["id"] and listed["battery_helps"] is False and listed["wall_kwh"] == added["wall_kwh"]
    assert car.charges(NOW, NOW + HOUR) == []  # not started yet
    assert car.charges(NOW + HOUR, NOW + 2 * HOUR) == [Charge(NOW + HOUR, added["end"], 11040.0, False)]
    # Long over: no longer listed. Already over: not planned at all.
    assert car.listed(now=added["end"] + 13 * HOUR) == []
    with pytest.raises(ValueError, match="already be over"):
        car.add({"start": NOW - 5 * HOUR, "hours": 1}, now=NOW)
    assert car.remove(added["id"]) and car.listed(now=NOW) == []


def step(start: int, pv: float = 0.0, load: float = 1.0) -> dict:
    return {"start": start, "dur": HOUR, "pv_kw": pv, "load_kw": load}


def test_a_planned_charge_is_spread_over_the_hours_it_runs() -> None:
    steps = [step(NOW + k * HOUR) for k in range(4)]
    # 7 kW from half past the first hour to the end of the second; another 2 kW the battery mustn't help with.
    add_car(
        steps, [Charge(NOW + HOUR // 2, NOW + 2 * HOUR, 7000, True), Charge(NOW + HOUR, NOW + 2 * HOUR, 2000, False)]
    )
    assert [s.get("car_kw", 0) for s in steps] == [3.5, 9.0, 0, 0]
    assert steps[1]["car_own_kw"] == 2.0


def test_the_home_battery_helps_the_car_only_when_allowed() -> None:
    def run(helps: bool) -> dict:
        (s,) = [step(NOW, pv=0, load=1)]
        add_car([s], [Charge(NOW, NOW + HOUR, 4000, helps)])
        simulate([s], soc=0.8, cap=10, reserve=0.1, max_kw=5)
        return s

    # Allowed: the battery covers the house and the car (5 kWh, at its 5 kW limit).
    helped = run(True)
    assert helped["grid_kwh"] == pytest.approx(0) and helped["soc_end"] == pytest.approx(0.3)
    # Not allowed: it covers the house's 1 kWh; the car's 4 kWh comes from the grid.
    own = run(False)
    assert own["grid_kwh"] == pytest.approx(4) and own["soc_end"] == pytest.approx(0.7)


def test_solar_goes_to_the_house_then_the_car() -> None:
    # 3 kW of solar, 1 kW house, 4 kW car the battery mustn't help: 2 kW of solar reaches the car,
    # 2 kWh comes from the grid, and the battery stays put.
    (s,) = [step(NOW, pv=3, load=1)]
    add_car([s], [Charge(NOW, NOW + HOUR, 4000, False)])
    simulate([s], soc=0.8, cap=10, reserve=0.1, max_kw=5)
    assert s["grid_kwh"] == pytest.approx(2) and s["soc_end"] == pytest.approx(0.8)


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def test_the_api_estimates_plans_and_removes(client: TestClient) -> None:
    import time

    start = int(time.time()) + HOUR
    body = {"start": start, "amps": 16, "phases": 3, "soc_now": 40, "soc_to": 90}
    preview = client.post("/api/car/estimate", json=body).json()
    assert preview["power_kw"] == 11.04
    assert client.get("/api/car").json()["charges"] == []  # an estimate isn't saved
    bad = client.post("/api/car/estimate", json={**body, "soc_to": 20})
    assert bad.status_code == 422 and "above" in bad.json()["detail"]

    added = client.post("/api/car/charges", json=body).json()
    view = client.get("/api/car").json()
    assert view["car"]["car_battery_kwh"] == 75 and [c["id"] for c in view["charges"]] == [added["id"]]
    assert client.delete(f"/api/car/charges/{added['id']}").json() == {"ok": True}
    assert client.delete(f"/api/car/charges/{added['id']}").status_code == 404
