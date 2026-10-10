from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path

import pytest

from app.core import database
from app.core.database import Database
from app.core.schema import MIGRATIONS, ROLLUP_SQL, SAMPLE_COLUMNS, add_missing_sample_columns


def test_migrate_creates_every_table(db: Database) -> None:
    with db.reading() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        version = conn.execute("PRAGMA user_version").fetchone()[0]
    assert {"samples", "samples_5m", "settings", "kv", "users", "sessions", "prices"} <= tables
    assert not {t for t in tables if t.startswith("alert_") or t == "push_subscriptions"}
    assert version == len(MIGRATIONS)


def test_migrate_is_idempotent(db: Database) -> None:
    assert db.migrate() == db.migrate() == len(MIGRATIONS)


def test_a_step_that_fails_part_way_is_undone_and_runs_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Python's sqlite3 runs CREATE and ALTER outside any transaction unless one is opened: without one, a step that
    failed after its ALTER would fail on "duplicate column" on every start after."""
    db = Database(str(tmp_path / "half.db"))
    db.migrate()
    disk_full = True

    def _add_a_column(conn: sqlite3.Connection) -> None:
        conn.execute("ALTER TABLE kv ADD COLUMN note TEXT")
        conn.execute("INSERT INTO kv (key, value) VALUES ('x', 'y')")
        if disk_full:
            raise sqlite3.OperationalError("database or disk is full")

    monkeypatch.setattr(database, "MIGRATIONS", [*MIGRATIONS, _add_a_column])
    with pytest.raises(sqlite3.OperationalError, match="disk is full"):
        db.migrate()
    assert f"Database migration {len(MIGRATIONS) + 1} of {len(MIGRATIONS) + 1} (add_a_column) failed" in caplog.text
    with db.reading() as c:
        assert "note" not in {r[1] for r in c.execute("PRAGMA table_info(kv)")}
        assert c.execute("SELECT COUNT(*) FROM kv WHERE key = 'x'").fetchone() == (0,)
        assert c.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)

    disk_full = False
    assert db.migrate() == len(MIGRATIONS) + 1
    with db.reading() as c:
        assert "note" in {r[1] for r in c.execute("PRAGMA table_info(kv)")}
        assert c.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS) + 1


def test_a_database_from_a_newer_version_is_used_with_a_warning(db: Database, caplog: pytest.LogCaptureFixture) -> None:
    """Going back to an older channel's version leaves the newer one's schema: it starts, but says so."""
    with db.writing() as conn:
        conn.execute(f"PRAGMA user_version = {len(MIGRATIONS) + 2}")
    with caplog.at_level(logging.WARNING):
        db.migrate()
    [warning] = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert "newer version of WattsMyPower" in warning.getMessage()
    with db.reading() as c:
        assert c.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS) + 2  # left as it was


def test_the_removed_alerts_tables_and_their_secrets_go(tmp_path: Path) -> None:
    path = str(tmp_path / "alerts.db")
    drop_at = next(i for i, m in enumerate(MIGRATIONS) if m.__name__ == "_drop_alerts")
    with sqlite3.connect(path) as conn:
        for m in MIGRATIONS[:drop_at]:
            m(conn)
        conn.execute(f"PRAGMA user_version = {drop_at}")
        conn.execute("INSERT INTO alert_channels VALUES ('pushover', 1, '{\"token\": \"secret\"}', 1)")
        conn.execute("INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, name, created_at)"
                     " VALUES ('a', 'https://push.example/x', 'k', 's', 'Phone', 1)")  # fmt: skip
        conn.executemany("INSERT INTO kv VALUES (?, ?)", [("webpush_vapid", '{"private": "k"}'), ("tariff", "{}")])
    Database(path).migrate()
    with sqlite3.connect(path) as c:
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master")}
        assert not {"alert_channels", "alert_rules", "alert_state", "alert_history", "alert_history_ts",
                    "push_subscriptions"} & tables  # fmt: skip
        assert c.execute("SELECT key FROM kv").fetchall() == [("tariff",)]


def test_upgrades_a_database_from_before_migrations(tmp_path: Path) -> None:
    """Installs before versioned migrations have tables already, fewer sample columns, and user_version 0."""
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE samples (ts INTEGER PRIMARY KEY, pv_power REAL, battery_soc REAL)")
    conn.execute("CREATE TABLE samples_5m (ts INTEGER PRIMARY KEY, pv_power REAL, battery_soc REAL)")
    conn.execute("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.execute("INSERT INTO samples VALUES (1000, 1234.0, 55.0)")
    conn.execute("INSERT INTO kv VALUES ('location_name', 'Paddington, QLD')")
    conn.commit()
    conn.close()

    db = Database(str(path))
    db.migrate()
    with db.reading() as c:
        cols = {r[1] for r in c.execute("PRAGMA table_info(samples)")}
        assert set(SAMPLE_COLUMNS) <= cols
        assert c.execute("SELECT pv_power, battery_soc FROM samples").fetchone() == (1234.0, 55.0)
        assert c.execute("SELECT value FROM kv WHERE key = 'location_name'").fetchone() == ("Paddington, QLD",)
        assert c.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)


def test_garbled_history_is_cleaned_and_its_rollups_rebuilt(tmp_path: Path) -> None:
    db = Database(str(tmp_path / "v1.db"))
    with db.writing() as conn:
        MIGRATIONS[0](conn)  # a database from before the clean-up
        add_missing_sample_columns(conn)
        conn.execute("PRAGMA user_version = 1")
        conn.executemany(
            "INSERT INTO samples (ts, load_power, pv_power, battery_soc) VALUES (?, ?, ?, ?)",
            [(600, 800.0, 3000.0, 50.0), (660, 64936.0, 3100.0, 50.0), (720, 820.0, 4.2e9, 51.0)],
        )
        conn.execute(ROLLUP_SQL, (0, 2**62))
    db.migrate()
    with db.reading() as c:
        assert c.execute("SELECT load_power, pv_power FROM samples ORDER BY ts").fetchall() == [
            (800.0, 3000.0), (None, 3100.0), (820.0, None)]  # fmt: skip
        # the bucket's averages, rebuilt without the bad values (untouched columns are unchanged)
        assert c.execute("SELECT load_power, pv_power, battery_soc FROM samples_5m").fetchone() == (
            810.0, 3050.0, (50.0 + 50.0 + 51.0) / 3)  # fmt: skip


def test_the_one_car_in_settings_becomes_the_first_of_the_cars(tmp_path: Path) -> None:
    """Before more than one car could be connected, the car lived in settings; its levels move with it."""
    path = str(tmp_path / "car.db")
    with sqlite3.connect(path) as conn:
        cars_at = next(i for i, m in enumerate(MIGRATIONS) if m.__name__ == "_cars")
        for m in MIGRATIONS[:cars_at]:
            m(conn)
        conn.execute(f"PRAGMA user_version = {cars_at}")
        conn.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            [("car_connected", 1), ("car_phases", 3), ("car_target_soc", 90), ("pv_kw", 6.6)],
        )
        conn.executemany(
            "INSERT INTO kv (key, value) VALUES (?, ?)",
            [("car_name", "The Y"), ("car_model", "tesla-model-y-lr"), ("car_days", "wed,fri")],
        )
        conn.execute(
            "INSERT INTO car_charges (start, end, power_w, kwh, amps, phases, battery_helps, created_at)"
            " VALUES (100, 200, 11040, 0.3, 16, 3, 1, 50)"
        )
        conn.execute("INSERT INTO car_levels (ts, soc, source) VALUES (50, 40, 'level')")

    db = Database(path)
    db.migrate()
    with db.reading() as c:
        (car_id, name, model, details) = c.execute("SELECT id, name, model, details FROM cars").fetchone()
        assert (name, model) == ("The Y", "tesla-model-y-lr")
        assert json.loads(details) == {"car_phases": 3, "car_target_soc": 90, "car_days": ["wed", "fri"]}
        # Planned charges went later, with their table.
        assert c.execute("SELECT COUNT(*) FROM sqlite_master WHERE name = 'car_charges'").fetchone() == (0,)
        assert c.execute("SELECT car, ts, soc FROM car_levels").fetchone() == (car_id, 50, 40)
        # The car's settings are gone; the others stay.
        assert c.execute("SELECT key FROM settings").fetchall() == [("pv_kw",)]
        assert c.execute("SELECT COUNT(*) FROM kv WHERE key LIKE 'car%'").fetchone() == (0,)


def test_no_car_is_made_when_none_was_used(db: Database) -> None:
    with db.reading() as c:
        assert c.execute("SELECT COUNT(*) FROM cars").fetchone() == (0,)
