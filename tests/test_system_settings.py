"""
The system details (array size, battery capacity, reserve, rate) live in the database and are
edited in Settings → System. An install from before that keeps exactly the values it ran with.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.forecast.service import ForecastService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SYSTEM_SEEDED, SettingsStore
from app.features.weather.service import WeatherService
from app.main import create_app

# What the SH5.0RS reports about itself.
SH5 = {"brand": "Sungrow", "model": "SH5.0RS", "serial": "A2231234567", "battery_kwh": 16.0, "reserve": 5.0}


def hosted_env(tmp_path: Path, **extra: str) -> dict[str, str]:
    """The hosted install's environment, as docker-compose passes it from its .env."""
    return {
        "DB_PATH": str(tmp_path / "wattsmypower.db"),
        "COLLECTOR_TOKEN": "secret",
        "TZ": "Australia/Brisbane",
        "PV_KW": "13.2",
        "BATTERY_KWH": "0",
        "LATITUDE": "-27.47",
        "LONGITUDE": "153.03",
        "AUTH": "false",  # signing in isn't what's being tested
        **extra,
    }


def before_upgrade(path: str) -> None:
    """A database the previous version has been running on: settings saved in the dashboard, no system details."""
    db = Database(path)
    db.migrate()
    with db.writing() as conn:
        conn.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            [("latitude", -27.38), ("longitude", 153.05), ("bill_months", 3), ("bill_day", 12), ("bill_anchor", 2)],
        )
        conn.execute("INSERT INTO kv (key, value) VALUES ('location_name', 'Nundah, QLD')")


def system_before(config: Config, info: dict[str, float | str]) -> dict[str, float]:
    """What the previous version showed, worked out the way it did: straight from the environment."""
    return {
        "pv_kw": config.pv_kw,
        "battery_kwh": config.battery_kwh or float(info.get("battery_kwh") or 0),
        "battery_reserve": float(info["reserve"]) if "reserve" in info else config.battery_reserve,
        "battery_max_kw": config.battery_max_kw,
    }


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


@contextmanager
def start(config: Config, info: dict[str, float | str] | None = None) -> Iterator[TestClient]:
    """The app starting up on this config, with the inverter having reported `info`."""
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        c.app.state.services.live.info = dict(info or {})  # type: ignore[attr-defined]
        yield c


def system_of(c: TestClient) -> dict[str, float]:
    s = c.get("/api/live").json()["system"]
    return {k: s[k] for k in ("pv_kw", "battery_kwh", "battery_reserve", "battery_max_kw")}


# ------------------------------------------------------------------ seeding
def test_seeds_the_environments_values_once(db: Database, config: Config) -> None:
    config = replace(config, pv_kw=13.2, battery_kwh=13.5, battery_reserve=15, battery_max_kw=6.5)
    store = SettingsStore(db, config)
    assert store.seed_system() is True
    store.load()
    assert {
        k: store.get(k) for k in ("pv_kw", "battery_kwh_override", "battery_reserve_fallback", "battery_max_kw")
    } == {
        "pv_kw": 13.2,
        "battery_kwh_override": 13.5,
        "battery_reserve_fallback": 15,
        "battery_max_kw": 6.5,
    }
    # A later start, with different values in the environment, leaves the database alone.
    later = SettingsStore(db, replace(config, pv_kw=6.6, battery_kwh=0))
    assert later.seed_system() is False
    later.load()
    assert later.get("pv_kw") == 13.2 and later.get("battery_kwh_override") == 13.5


def test_seeding_keeps_a_value_the_dashboard_would_refuse(db: Database, config: Config) -> None:
    store = SettingsStore(db, replace(config, pv_kw=250.0))  # bigger than the dashboard allows, but it's what ran
    store.seed_system()
    store.load()
    assert store.get("pv_kw") == 250.0


def test_hosted_install_upgrades_without_any_change(tmp_path: Path) -> None:
    env = hosted_env(tmp_path)
    config = Config.from_env(env)
    before_upgrade(config.db_path)
    expected = system_before(config, SH5)
    assert expected == {"pv_kw": 13.2, "battery_kwh": 16.0, "battery_reserve": 5.0, "battery_max_kw": 5.0}

    with start(config, SH5) as c:
        assert system_of(c) == expected
        settings = c.get("/api/settings").json()
        # What was saved in the dashboard before is untouched.
        assert settings["latitude"] == -27.38 and settings["longitude"] == 153.05
        assert (settings["bill_months"], settings["bill_day"], settings["bill_anchor"]) == (3, 12, 2)
        assert settings["location_name"] == "Nundah, QLD"
        # The system details now come from the database, with the values the install ran on.
        assert settings["pv_kw"] == 13.2 and settings["battery_kwh_override"] == 0
        assert settings["battery_reserve_fallback"] == 10 and settings["battery_max_kw"] == 5

    # Restarting, even after the .env changes, doesn't seed again: the database is the source now.
    with start(Config.from_env({**env, "PV_KW": "6.6", "BATTERY_KWH": "10"}), SH5) as c:
        assert system_of(c) == expected
    db = Database(config.db_path)
    with db.reading() as conn:
        assert conn.execute("SELECT COUNT(*) FROM kv WHERE key = ?", (SYSTEM_SEEDED,)).fetchone() == (1,)


def test_hosted_install_upgrades_before_the_inverter_has_reported(tmp_path: Path) -> None:
    """Straight after the restart, before the inverter is read, the fallbacks are the ones it used."""
    config = Config.from_env(hosted_env(tmp_path))
    before_upgrade(config.db_path)
    with start(config) as c:
        assert system_of(c) == system_before(config, {})


def test_a_new_install_seeds_an_array_size_passed_in(tmp_path: Path) -> None:
    """PV_KW=10 bash install.sh --yes, on a new install."""
    env = {"DB_PATH": str(tmp_path / "new.db"), "COLLECTOR_TOKEN": "secret", "AUTH": "false", "PV_KW": "10"}
    with start(Config.from_env(env)) as c:
        assert c.get("/api/settings").json()["pv_kw"] == 10
    with start(Config.from_env({**env, "PV_KW": "6.6"})) as c:
        assert c.get("/api/settings").json()["pv_kw"] == 10


# ------------------------------------------------------------------ editing
def test_editing_takes_effect_straight_away(tmp_path: Path) -> None:
    config = Config.from_env(hosted_env(tmp_path))
    with start(config, SH5) as c:
        live = c.app.state.services.live  # type: ignore[attr-defined]
        q = live.subscribe()
        saved = c.put("/api/settings", json={"pv_kw": 14.5, "battery_max_kw": 6}).json()
        assert saved["pv_kw"] == 14.5 and saved["battery_max_kw"] == 6
        assert system_of(c)["pv_kw"] == 14.5 and system_of(c)["battery_max_kw"] == 6
        # Every open dashboard hears about it, without waiting for the next reading.
        assert q.get_nowait()["system"]["pv_kw"] == 14.5

        # A capacity set here wins over the inverter's; 0 goes back to what the inverter reports.
        c.put("/api/settings", json={"battery_kwh_override": 13.5})
        assert system_of(c)["battery_kwh"] == 13.5
        c.put("/api/settings", json={"battery_kwh_override": 0})
        assert system_of(c)["battery_kwh"] == 16.0

        # The reserve set here only applies when the inverter doesn't report one.
        c.put("/api/settings", json={"battery_reserve_fallback": 20})
        assert system_of(c)["battery_reserve"] == 5.0
        live.info = {"model": "SH5.0RS"}
        assert system_of(c)["battery_reserve"] == 20

    # And it's kept across a restart.
    with start(config, SH5) as c:
        assert system_of(c)["pv_kw"] == 14.5


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"pv_kw": 0}, "Solar array size must be between 0.1 and 100 kW."),
        ({"pv_kw": "big"}, "Solar array size must be a number."),
        ({"pv_kw": None}, "Solar array size must be a number."),
        ({"battery_kwh_override": -1}, "Battery capacity must be between 0 and 200 kWh."),
        ({"battery_reserve_fallback": 101}, "Backup reserve must be between 0 and 100%."),
        ({"battery_max_kw": 80}, "Maximum charge and discharge rate must be between 0.1 and 50 kW."),
    ],
)
def test_rejects_bad_values_readably(client: TestClient, changes: dict[str, object], message: str) -> None:
    before = client.get("/api/settings").json()
    r = client.put("/api/settings", json=changes)
    assert r.status_code == 422 and r.json()["detail"] == message
    assert client.get("/api/settings").json() == before


# ------------------------------------------------------------------ consumers
def weather(now: int) -> dict[str, object]:
    """A day of Open-Meteo's hourly weather around now, at a steady 0.5 kW/m²."""
    t = [now - now % 3600 + h * 3600 for h in range(-2, 30)]
    n = len(t)
    return {
        "hourly": {
            "time": t,
            "shortwave_radiation": [500] * n,
            "temperature_2m": [22] * n,
            "weather_code": [0] * n,
            "is_day": [1] * n,
            "precipitation_probability": [0] * n,
        }
    }


def test_the_forecast_follows_a_changed_array_size(
    db: Database, config: Config, readings: ReadingsRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = SettingsStore(db, replace(config, pv_kw=13.2))
    settings.seed_system()
    settings.load()
    data = weather(int(time.time()))
    forecast = ForecastService(config, readings, settings, WeatherService(config, db, settings, get=lambda _: data))

    # No history yet, so solar comes from the array size alone: 80% of it per kW/m².
    first = forecast.build(None, 16.0, 5.0)
    assert first is not None and first["calibration"]["kwh_per_kwh_m2"] == pytest.approx(13.2 * 0.8, abs=0.01)
    settings.save({"pv_kw": 6.6})
    second = forecast.build(None, 16.0, 5.0)
    assert second is not None and second["calibration"]["kwh_per_kwh_m2"] == pytest.approx(6.6 * 0.8, abs=0.01)
    assert second["hours"][1]["pv_kw"] == pytest.approx(6.6 * 0.8 * 0.5, abs=0.01)


def test_the_forecast_charges_at_the_rate_set(
    db: Database, config: Config, readings: ReadingsRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = SettingsStore(db, replace(config, pv_kw=13.2))
    settings.load()
    data = weather(int(time.time()))
    forecast = ForecastService(config, readings, settings, WeatherService(config, db, settings, get=lambda _: data))

    def soc_after_an_hour() -> float:
        out = forecast.build({"battery_soc": 20.0}, 100.0, 5.0)  # a battery big enough not to fill
        assert out is not None
        return float(out["hours"][1]["soc"])

    settings.save({"battery_max_kw": 2})
    slow = soc_after_an_hour()
    settings.save({"battery_max_kw": 4})
    assert soc_after_an_hour() > slow
