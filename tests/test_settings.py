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
        "system_cost": 0,
        "location_name": None,
    }


def test_saved_values_win_and_persist(db: Database, config: Config) -> None:
    store = SettingsStore(db, config)
    store.load()
    store.save({"latitude": -33.87, "location_name": "  Sydney, NSW  ", "system_cost": 18400})
    fresh = SettingsStore(db, config)
    fresh.load()
    assert fresh.get("latitude") == -33.87
    assert fresh.get("system_cost") == 18400
    assert fresh.get_text("location_name") == "Sydney, NSW"


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"latitude": 91}, "latitude must be between -90 and 90"),
        ({"system_cost": "a lot"}, "system_cost must be a number"),
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
