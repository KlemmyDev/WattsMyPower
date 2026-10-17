"""The site's time zone, which the dashboard draws its days and times in (app.core.timezone)."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import timezone
from app.core.config import Config
from app.core.timezone import is_zone, site_zone, use_zone
from app.features.settings import router as settings_router
from app.features.weather import openmeteo
from app.main import create_app

JULY = 1_783_000_000  # 2026-07-02: winter, so Sydney is on AEST
JANUARY = 1_767_225_600  # 2026-01-01: Sydney is on daylight saving


@pytest.fixture
def zone(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[pytest.MonkeyPatch]:
    """Sets TZ for the test (no /etc files to fall back on), and puts the process's zone back afterwards."""
    monkeypatch.setattr(timezone, "LOCALTIME", tmp_path / "localtime")
    monkeypatch.setattr(timezone, "TIMEZONE_FILE", tmp_path / "timezone")
    yield monkeypatch
    monkeypatch.undo()
    time.tzset()


def _tz(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("TZ", value)
    time.tzset()


def test_named_by_tz(zone: pytest.MonkeyPatch) -> None:
    _tz(zone, "Australia/Brisbane")
    assert site_zone() == "Australia/Brisbane"
    _tz(zone, ":Australia/Perth")
    assert site_zone() == "Australia/Perth"


def test_daylight_saving_zones_are_named_all_year(zone: pytest.MonkeyPatch) -> None:
    _tz(zone, "Australia/Sydney")
    assert site_zone(JULY) == "Australia/Sydney"
    assert site_zone(JANUARY) == "Australia/Sydney"


def test_named_by_the_localtime_link(zone: pytest.MonkeyPatch, tmp_path: Path) -> None:
    target = tmp_path / "usr/share/zoneinfo/Australia/Adelaide"
    target.parent.mkdir(parents=True)
    target.write_bytes(Path("/usr/share/zoneinfo/Australia/Adelaide").read_bytes())
    (tmp_path / "localtime").symlink_to(target)
    zone.setenv("TZ", f":{target}")  # the process follows the same file /etc/localtime would point to
    time.tzset()
    assert site_zone() == "Australia/Adelaide"


def test_a_zone_the_server_isnt_in_is_not_claimed(zone: pytest.MonkeyPatch) -> None:
    # A POSIX TZ string isn't a zone name: the offset it gives is used instead.
    _tz(zone, "AEST-10")
    assert site_zone(JULY) == "Etc/GMT-10"
    _tz(zone, "UTC")
    (timezone.TIMEZONE_FILE).write_text("Australia/Brisbane\n")  # stale: the process is on UTC
    assert site_zone() == "UTC"
    _tz(zone, "IST-5:30")
    assert site_zone() is None  # no whole-hour Etc zone for it


def test_sent_with_the_live_status(zone: pytest.MonkeyPatch, config: Config) -> None:
    _tz(zone, "Australia/Darwin")
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        assert c.get("/api/live").json()["time_zone"] == "Australia/Darwin"


@pytest.fixture
def chosen(zone: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """Starts on Brisbane as the environment's TZ, and puts it back after a zone's been chosen."""
    _tz(zone, "Australia/Brisbane")
    yield zone
    use_zone(None)


def test_use_zone_switches_the_process_and_goes_back(chosen: pytest.MonkeyPatch) -> None:
    assert use_zone("Australia/Perth") and site_zone() == "Australia/Perth"
    assert time.localtime(JULY).tm_gmtoff == 8 * 3600
    assert not use_zone("Australia/Perth")  # no change
    assert use_zone("Australia/Adelaide") and site_zone() == "Australia/Adelaide"
    assert use_zone(None) and site_zone() == "Australia/Brisbane"  # the environment's again
    assert not use_zone(None)


def test_only_known_zones_are_zones() -> None:
    assert is_zone("Australia/Sydney") and is_zone("UTC")
    for bad in ("Sydney", "Australia/Narnia", "../etc/passwd", "", None, 10):
        assert not is_zone(bad)


def test_the_location_zone_is_looked_up_from_open_meteo() -> None:
    asked: list[str] = []

    def get(url: str) -> dict[str, str]:
        asked.append(url)
        return {"timezone": "Australia/Perth"}

    assert openmeteo.zone_at(-31.95, 115.86, get) == "Australia/Perth"
    assert "latitude=-31.9500" in asked[0] and "timezone=auto" in asked[0]
    assert openmeteo.zone_at(-31.95, 115.86, lambda u: {"timezone": "GMT"}) == "GMT"
    assert openmeteo.zone_at(0, 0, lambda u: {"timezone": "Nowhere/Land"}) is None


def test_days_follow_the_location_zone_then_the_one_chosen(chosen: pytest.MonkeyPatch, config: Config) -> None:
    chosen.setattr(settings_router, "zone_at", lambda lat, lon: "Australia/Perth" if lon < 130 else "Australia/Sydney")
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        assert c.get("/api/live").json()["time_zone"] == "Australia/Brisbane"  # nothing looked up yet: TZ's
        # Moving to Perth looks up its zone, and days roll over there.
        saved = c.put("/api/settings", json={"latitude": -31.95, "longitude": 115.86, "location_name": "Perth, WA"})
        assert saved.json()["location_zone"] == "Australia/Perth" and saved.json()["time_zone"] == "auto"
        assert c.get("/api/live").json()["time_zone"] == "Australia/Perth"
        # Another zone chosen wins over the location's, and "auto" goes back to it.
        assert c.put("/api/settings", json={"time_zone": "Australia/Darwin"}).json()["time_zone"] == "Australia/Darwin"
        assert c.get("/api/live").json()["time_zone"] == "Australia/Darwin"
        c.put("/api/settings", json={"latitude": -33.87, "longitude": 151.21, "location_name": "Sydney, NSW"})
        assert c.get("/api/live").json()["time_zone"] == "Australia/Darwin"  # still the chosen one
        assert c.put("/api/settings", json={"time_zone": "auto"}).json()["location_zone"] == "Australia/Sydney"
        assert c.get("/api/live").json()["time_zone"] == "Australia/Sydney"
        bad = c.put("/api/settings", json={"time_zone": "Sydney"})
        assert bad.status_code == 422 and "time zone" in bad.json()["detail"]
        assert c.put("/api/settings", json={"location_zone": "UTC"}).status_code == 422  # only ever looked up
    use_zone(None)
    # Started again, the zone kept in the database is used straight away, with no lookup.
    chosen.setattr(settings_router, "zone_at", lambda lat, lon: pytest.fail("looked up again"))
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        assert c.get("/api/live").json()["time_zone"] == "Australia/Sydney"


def test_a_failed_lookup_leaves_the_environments_zone(chosen: pytest.MonkeyPatch, config: Config) -> None:
    def down(lat: float, lon: float) -> str:
        raise OSError("no network")

    chosen.setattr(settings_router, "zone_at", down)
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        saved = c.put("/api/settings", json={"latitude": -31.95, "longitude": 115.86, "location_name": "Perth, WA"})
        assert saved.status_code == 200 and saved.json()["location_zone"] is None
        assert c.get("/api/live").json()["time_zone"] == "Australia/Brisbane"
