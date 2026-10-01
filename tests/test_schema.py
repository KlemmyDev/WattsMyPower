from __future__ import annotations

import sqlite3
from pathlib import Path

from app.core.database import Database
from app.core.schema import MIGRATIONS, SAMPLE_COLUMNS


def test_migrate_creates_every_table(db: Database) -> None:
    with db.reading() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        version = conn.execute("PRAGMA user_version").fetchone()[0]
    assert {"samples", "samples_5m", "settings", "kv", "users", "sessions"} <= tables
    assert version == len(MIGRATIONS)


def test_migrate_is_idempotent(db: Database) -> None:
    assert db.migrate() == db.migrate() == len(MIGRATIONS)


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
