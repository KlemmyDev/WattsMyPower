"""The site's time zone, which the dashboard draws its days and times in (app.core.timezone)."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import timezone
from app.core.config import Config
from app.core.timezone import site_zone
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
