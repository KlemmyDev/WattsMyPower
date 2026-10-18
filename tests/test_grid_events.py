"""Following the inverter off the grid and back: one row for each stretch, and the live status that says so."""

from __future__ import annotations

import time
from dataclasses import replace

from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.grid.events import OffGridTracker, off_grid, recent, supply_healthy
from app.features.live.service import LiveService
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore
from app.main import create_app

NORMAL, OFF = 0x0000, 0x1000


def tracker(db: Database, config: Config) -> tuple[OffGridTracker, LiveService]:
    settings = SettingsStore(db, config)
    live = LiveService(config, settings, TariffStore(db, config))
    return OffGridTracker(live), live


def test_a_reading_says_off_grid_only_when_its_running_state_does() -> None:
    assert off_grid({"running_state": 0x1000}) is True and off_grid({"running_state": 0x0041}) is True
    assert off_grid({"running_state": 0}) is False and off_grid({"running_state": 0x0800}) is False
    assert off_grid({}) is None and off_grid({"running_state": None}) is None


def test_the_supply_is_healthy_when_what_it_reports_is_in_range() -> None:
    assert supply_healthy({"grid_voltage": 240.0, "grid_freq": 50.0}) is True
    assert supply_healthy({"grid_voltage": 240.0}) is True  # one figure is enough
    assert supply_healthy({"grid_voltage": 217.0, "grid_freq": 49.9}) is True
    assert supply_healthy({"grid_voltage": 254.0, "grid_freq": 50.0}) is False
    assert supply_healthy({"grid_voltage": 240.0, "grid_freq": 50.3}) is False
    assert supply_healthy({"grid_voltage": 0.0, "grid_freq": 0.0}) is None  # not measuring the grid
    assert supply_healthy({}) is None and supply_healthy(None) is None


def test_each_stretch_off_grid_is_one_row_with_when_it_began_and_ended(db: Database, config: Config) -> None:
    t, live = tracker(db, config)
    with db.writing() as conn:
        t.load(conn)
        t.observe(
            conn, [(100, {"running_state": NORMAL}), (160, {"running_state": OFF}), (220, {"running_state": OFF})]
        )
        assert live.off_grid_since == 160  # under way: the first reading that said so
        t.observe(conn, [(280, {"running_state": NORMAL}), (340, {"running_state": NORMAL})])
        assert live.off_grid_since is None
        t.observe(conn, [(400, {"running_state": OFF})])
    with db.reading() as conn:
        assert recent(conn) == [{"id": 2, "start": 400, "end": None}, {"id": 1, "start": 160, "end": 280}]
    assert live.off_grid_known


def test_a_stretch_left_open_by_a_restart_carries_on_and_a_reading_without_a_state_changes_nothing(
    db: Database, config: Config
) -> None:
    first, _ = tracker(db, config)
    with db.writing() as conn:
        first.observe(conn, [(100, {"running_state": OFF})])
    again, live = tracker(db, config)
    with db.writing() as conn:
        again.load(conn)
        assert live.off_grid_since == 100
        again.observe(conn, [(160, {"pv_power": 0.0})])  # no state: still off-grid
        assert live.off_grid_since == 100
        again.observe(conn, [(220, {"running_state": NORMAL})])
    with db.reading() as conn:
        assert recent(conn) == [{"id": 1, "start": 100, "end": 220}]


def test_the_status_says_nothing_until_the_inverter_has_reported_a_state_and_is_fresh(
    db: Database, config: Config
) -> None:
    _, live = tracker(db, config)
    assert live.grid_connection() == {"off_grid": None, "off_grid_since": None, "grid_healthy": None}
    live.off_grid_known = True
    assert live.grid_connection()["off_grid"] is None  # never heard from
    live.last_success = time.time()
    assert live.grid_connection() == {"off_grid": False, "off_grid_since": None, "grid_healthy": None}  # no figures
    live.latest = {"grid_voltage": 241.0, "grid_freq": 50.01}
    assert live.grid_connection()["grid_healthy"] is True
    live.latest = {"grid_voltage": 262.0, "grid_freq": 50.0}  # too high
    assert live.grid_connection()["grid_healthy"] is False
    live.off_grid_since = 160
    assert live.grid_connection() == {"off_grid": True, "off_grid_since": 160, "grid_healthy": None}
    live.last_success = time.time() - 3600  # stale: not what's happening now
    assert live.grid_connection() == {"off_grid": None, "off_grid_since": None, "grid_healthy": None}


def test_the_events_are_listed_for_the_grid_page(config: Config) -> None:
    with TestClient(create_app(replace(config, auth=False), poll=False, serve_dashboard=False)) as c:
        assert c.get("/api/grid/events").json() == {"events": [], "known": False}
        assert c.get("/api/live").json()["off_grid"] is None
