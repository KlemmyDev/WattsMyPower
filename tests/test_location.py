"""The house's location: none until it's chosen, nothing that needs it is fetched until then, and installs from when it
defaulted to Brisbane keep it."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import DEMO_LOCATION, Config
from app.core.database import Database
from app.features.forecast.service import ForecastService
from app.features.grid.aemo import AemoClient
from app.features.grid.outages.service import OutageService
from app.features.grid.service import GridService
from app.features.grid.warnings.service import HazardService
from app.features.insights.service import InsightsService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import OLD_DEFAULT, SettingsStore
from app.features.weather.service import WeatherService
from app.main import create_app
from tests.test_hazards import Ftp

SYDNEY = (-33.87, 151.21)


def unset(config: Config) -> Config:
    """No LATITUDE or LONGITUDE, as a new install runs."""
    return replace(config, latitude=None, longitude=None)


def asking(asked: list[str], answer: Any = None) -> Callable[..., Any]:
    """A fetch that notes what it was asked for."""

    def get(url: str, *_: Any) -> Any:
        asked.append(url)
        if answer is None:
            raise OSError("not in this test")
        return answer

    return get


def test_the_environment_sets_it_or_leaves_it_unset() -> None:
    assert (Config.from_env({}).latitude, Config.from_env({}).longitude) == (None, None)
    assert Config.from_env({"LATITUDE": "", "LONGITUDE": " "}).latitude is None
    sydney = Config.from_env({"LATITUDE": "-33.87", "LONGITUDE": "151.21"})
    assert (sydney.latitude, sydney.longitude) == SYDNEY
    # The demo has one, so it looks full; set empty, it starts without one, as a new install does.
    demo = Config.from_env({"MOCK": "1"})
    assert (demo.latitude, demo.longitude) == DEMO_LOCATION
    assert Config.from_env({"MOCK": "1", "LATITUDE": "", "LONGITUDE": ""}).latitude is None


def test_a_new_install_has_none_and_says_so(config: Config) -> None:
    with TestClient(create_app(unset(config), poll=False, serve_dashboard=False)) as client:
        settings = client.get("/api/settings").json()
        assert settings["latitude"] is None and settings["longitude"] is None
        assert client.get("/api/live").json()["system"]["latitude"] is None
        assert client.get("/api/forecast").json() is None
        assert client.get("/api/weather").json()["location_set"] is False
        grid = client.get("/api/grid").json()
        assert grid["location_set"] is False and not grid["enabled"]
        assert grid["region"] is None and grid["region_auto"] is True
        assert grid["outages"]["location_set"] is False and grid["outages"]["network"] is None
        assert grid["hazards"]["location_set"] is False and grid["hazards"]["weather"] == []

        # A region chosen is followed without a location.
        client.put("/api/settings", json={"nem_region": "NSW1"})
        grid = client.get("/api/grid").json()
        assert grid["enabled"] and grid["region"] == "NSW1" and grid["location_set"] is False

        # Choosing the location: the region's worked out from it, and outages and warnings are followed.
        saved = client.put(
            "/api/settings",
            json={"nem_region": "auto", "latitude": -27.47, "longitude": 153.03, "location_name": "Brisbane City, QLD"},
        ).json()
        assert (saved["latitude"], saved["longitude"]) == (-27.47, 153.03)
        grid = client.get("/api/grid").json()
        assert grid["location_set"] and grid["region"] == "QLD1"
        assert grid["outages"]["location_set"] and grid["outages"]["network"]["id"] == "energex"
        assert grid["hazards"]["location_set"]


def test_nothing_that_needs_it_is_fetched_until_its_chosen(db: Database, config: Config) -> None:
    config = unset(config)
    settings = SettingsStore(db, config)
    settings.load()
    asked: list[str] = []

    weather = WeatherService(config, db, settings, get=asking(asked))
    weather.ensure_fresh()
    forecast = ForecastService(config, ReadingsRepository(db, 60, 90), settings, weather)
    assert forecast.build({"battery_soc": 50.0}, 10.0, 10.0) is None and forecast.steps() is None
    forecast.tick()  # nothing to learn from, and no crash

    outages = OutageService(settings, lambda: "QLD1", get=asking(asked))
    outages.refresh()
    assert outages.view()["network"] is None and outages.reasons() == []
    settings.save({"power_network": "energex"})  # even a network chosen: what's near the house needs the house
    outages.refresh()
    assert outages.view()["network"] is None

    ftp = Ftp()
    hazards = HazardService(settings, lambda: "QLD1", ftp=ftp, fires=lambda: asked.append("qfd") or [])  # type: ignore[arg-type, func-returns-value]
    assert not hazards.following()
    hazards.refresh()
    assert hazards.place() is None and hazards.reasons() == []

    grid = GridService(settings, weather, lambda: None, AemoClient(get=asking(asked), post=asking(asked)))
    assert grid.region() == (None, True) and not grid.enabled()

    insights = InsightsService(db, ReadingsRepository(db, 60, 90), settings, weather, forecast, None, None)  # type: ignore[arg-type]
    assert insights._radiation() is None

    assert asked == [] and ftp.asked == []

    # Once it's chosen, each starts.
    settings.save({"latitude": -27.47, "longitude": 153.03, "location_name": "Brisbane City, QLD"})
    weather.ensure_fresh()
    assert any("api.open-meteo.com" in u for u in asked)
    outages.refresh()
    assert outages.view()["network"]["id"] == "energex"
    hazards.refresh()
    assert ftp.asked and "qfd" in asked
    assert grid.region() == ("QLD1", True)


def _with_readings(db: Database) -> None:
    with db.writing() as conn:
        conn.execute("INSERT INTO samples_5m (ts, pv_power) VALUES (1791420000, 1000)")


def test_an_install_from_before_keeps_brisbane(db: Database, config: Config) -> None:
    _with_readings(db)
    store = SettingsStore(db, unset(config))
    assert store.seed_location() == OLD_DEFAULT
    store.load()
    assert store.location() == OLD_DEFAULT
    assert store.seed_location() is None  # once ever


def test_an_install_from_before_keeps_what_the_environment_set(db: Database, config: Config) -> None:
    _with_readings(db)
    store = SettingsStore(db, replace(config, latitude=SYDNEY[0], longitude=SYDNEY[1]))
    assert store.seed_location() == SYDNEY
    store = SettingsStore(db, unset(config))  # LATITUDE/LONGITUDE taken out later: it stays
    store.load()
    assert store.location() == SYDNEY


def test_a_location_saved_before_is_left_as_it_is(db: Database, config: Config) -> None:
    _with_readings(db)
    with db.writing() as conn:
        conn.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?)", [("latitude", -33.87), ("longitude", 151.21)]
        )
    store = SettingsStore(db, unset(config))
    assert store.seed_location() is None
    store.load()
    assert store.location() == SYDNEY

    # Only one saved: the other is the one it ran on (the old default, here).
    with db.writing() as conn:
        conn.execute("DELETE FROM settings WHERE key = 'longitude'")
        conn.execute("DELETE FROM kv WHERE key = 'location_seeded'")
    assert store.seed_location() == (SYDNEY[0], OLD_DEFAULT[1])


@pytest.mark.parametrize("later", [False, True])
def test_a_new_install_isnt_given_one(db: Database, config: Config, later: bool) -> None:
    store = SettingsStore(db, unset(config))
    assert store.seed_location() is None
    if later:  # readings come in once the inverter's connected: it was decided at the first start
        _with_readings(db)
        assert store.seed_location() is None
    store.load()
    assert store.location() is None and not store.location_set()
    values = store.all_values()
    assert values["latitude"] is None and values["longitude"] is None
    store.save({"latitude": SYDNEY[0]})  # half a location isn't one
    assert not store.location_set() and store.all_values()["latitude"] is None


def test_updating_an_install_from_before_changes_nothing(db: Database, config: Config) -> None:
    _with_readings(db)  # recorded while the location defaulted to Brisbane, with none saved
    with TestClient(create_app(unset(config), poll=False, serve_dashboard=False)) as client:
        settings = client.get("/api/settings").json()
        assert (settings["latitude"], settings["longitude"]) == OLD_DEFAULT
        assert client.get("/api/grid").json()["region"] == "QLD1"
