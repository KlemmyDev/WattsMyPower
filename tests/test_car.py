"""The cars: connecting, changing and disconnecting them, and their levels as read from the car."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.car.service import CarService
from app.main import create_app


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def test_cars_are_connected_changed_and_disconnected(client: TestClient) -> None:
    y = client.post("/api/cars", json={"model": "tesla-model-y-rwd", "car_colour": "red"}).json()
    atto = client.post("/api/cars", json={"model": "byd-atto-3-extended", "car_park": "outside"}).json()
    assert [c["id"] for c in client.get("/api/cars").json()] == [y["id"], atto["id"]]
    assert atto["car"]["car_body"] == "atto3" and atto["car"]["car_park"] == "outside"
    # A model's figures fill in what isn't given.
    assert (atto["car"]["car_battery_kwh"], atto["car"]["car_amps"], atto["car"]["car_phases"]) == (60.5, 32, 1)
    changed = client.put(f"/api/cars/{y['id']}", json={"name": "Daily", "car_phases": 3}).json()
    assert changed["name"] == "Daily" and changed["car"]["car_phases"] == 3
    assert changed["car"]["car_colour"] == "red"  # what wasn't given stays
    bad = client.put(f"/api/cars/{y['id']}", json={"car_min_amps": 40})
    assert bad.status_code == 422 and bad.json()["detail"] == "The lowest charging current must be between 1 and 32 A."
    assert client.put(f"/api/cars/{y['id']}", json={"car_colour": "pink"}).status_code == 422
    custom = client.put(f"/api/cars/{y['id']}", json={"car_colour": "#3A7BD5"}).json()
    assert custom["car"]["car_colour"] == "#3a7bd5"
    assert client.delete(f"/api/cars/{y['id']}").json() == {"ok": True}
    assert [c["id"] for c in client.get("/api/cars").json()] == [atto["id"]]
    assert client.delete(f"/api/cars/{y['id']}").status_code == 404


def test_details_from_before_charges_were_planned_are_left_out(db: Database) -> None:
    cars = CarService(db)
    car = cars.create({"model": "tesla-model-y-lr", "car_target_soc": 90, "car_charge_mode": "solar"})
    assert "car_target_soc" not in car["car"] and "car_charge_mode" not in car["car"]
    with db.writing() as conn:  # kept by an older version
        conn.execute("UPDATE cars SET details = ? WHERE id = ?", ('{"car_days": ["wed"], "car_phases": 3}', car["id"]))
    assert "car_days" not in cars.details(car["id"]) and cars.details(car["id"])["car_phases"] == 3


def test_a_level_is_the_last_one_recorded(db: Database) -> None:
    cars = CarService(db)
    car_id = cars.create({"model": "tesla-model-y-lr"})["id"]
    assert cars.level(car_id, 1000) is None
    cars.record_level(car_id, 1000, 50, "tessie")
    cars.record_level(car_id, 2000, 62, "tessie")
    level = cars.level(car_id, 2500)
    assert level is not None and (level["soc"], level["given_at"], level["km"]) == (62, 2000, 291)
    assert cars.level(car_id, 1500)["soc"] == 50  # type: ignore[index]
