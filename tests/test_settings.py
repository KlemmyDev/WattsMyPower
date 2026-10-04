from __future__ import annotations

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.settings.store import SettingsStore


def test_defaults_come_from_the_config(db: Database, config: Config) -> None:
    store = SettingsStore(db, config)
    store.load()
    assert store.all_values() == {
        "latitude": config.latitude,
        "longitude": config.longitude,
        "bill_months": 3,
        "bill_day": 1,
        "bill_anchor": 1,
        "pv_kw": config.pv_kw,
        "battery_kwh_override": config.battery_kwh,
        "battery_reserve_fallback": config.battery_reserve,
        "battery_max_kw": config.battery_max_kw,
        "temp_unit_f": 0,
        "panel_tilt": 0,
        "panel_bearing": 0,
        "forecast_learning": 1,
        "house_storeys": 1,
        "garage_spaces": 0,
        "system_cost": 0,
        "system_installed": 0,
        "battery_installed": 0,
        "battery_warranty_years": 0,
        "battery_warranty_mwh": 0,
        "car_battery_kwh": 75,
        "car_efficiency": 90,
        "car_amps": 16,
        "car_min_amps": 6,
        "car_phases": 1,
        "car_voltage": 230,
        "car_connected": 0,
        "car_wh_per_km": 170,
        "car_target_soc": 80,
        "car_ready_by": 450,
        "car_battery_helps": 1,
        "location_name": None,
        "car_name": None,
        "car_model": None,
        "weather_model": "best_match",
        "house_style": "estate",
        "inverter_places": [],
        "battery_places": [],
    }


def test_where_each_inverter_and_battery_is_is_a_list_of_places(db: Database, config: Config) -> None:
    store = SettingsStore(db, config)
    store.load()
    store.save({"inverter_places": ["garage", "wall"], "battery_places": ["garage"]})
    fresh = SettingsStore(db, config)
    fresh.load()
    assert fresh.get_list("inverter_places") == ["garage", "wall"] and fresh.get_list("battery_places") == ["garage"]
    for bad in (["roof"], ["wall"] * 4, "wall"):
        with pytest.raises(ValueError, match="inverter_places must be a list"):
            store.save({"inverter_places": bad})


def test_a_choice_takes_only_its_values_and_its_default_isnt_stored(db: Database, config: Config) -> None:
    store = SettingsStore(db, config)
    store.load()
    store.save({"weather_model": "gfs_seamless"})
    fresh = SettingsStore(db, config)
    fresh.load()
    assert fresh.get_choice("weather_model") == "gfs_seamless"
    with pytest.raises(ValueError, match="weather_model must be one of"):
        store.save({"weather_model": "made_up"})
    store.save({"weather_model": "best_match"})
    with db.reading() as conn:
        assert conn.execute("SELECT 1 FROM kv WHERE key = 'weather_model'").fetchone() is None


def test_saved_values_win_and_persist(db: Database, config: Config) -> None:
    store = SettingsStore(db, config)
    store.load()
    store.save({"latitude": -33.87, "location_name": "  Sydney, NSW  ", "bill_months": 1, "bill_day": 15})
    fresh = SettingsStore(db, config)
    fresh.load()
    assert fresh.get("latitude") == -33.87
    assert fresh.get("bill_months") == 1 and fresh.get("bill_day") == 15
    assert fresh.get_text("location_name") == "Sydney, NSW"


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"latitude": 91}, "latitude must be between -90 and 90"),
        ({"bill_day": "the first"}, "bill_day must be a number"),
        ({"bill_day": 31}, "bill_day must be between 1 and 28"),
        ({"bill_months": 1.5}, "bill_months must be a whole number"),
        ({"colour": 1}, "Unknown setting: colour"),
    ],
)
def test_rejects_bad_values(db: Database, config: Config, changes: dict[str, object], message: str) -> None:
    store = SettingsStore(db, config)
    store.load()
    with pytest.raises(ValueError, match=message):
        store.save(changes)


def test_clearing_a_text_setting_removes_it(db: Database, config: Config) -> None:
    store = SettingsStore(db, config)
    store.load()
    store.save({"location_name": "Brisbane City, QLD"})
    store.save({"location_name": None})
    assert store.get_text("location_name") is None
