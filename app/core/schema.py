"""
The SQLite schema: every table the app uses, and the migrations that create and change them.

    samples      one row per poll (raw snapshots), keyed on unix-seconds `ts`
    samples_5m   5-minute rollups of samples, kept up to date on every insert; used for
                 long ranges so a year's chart never touches raw rows
    settings     numeric settings saved from the dashboard (location, system cost)
    kv           text values: the tariff (JSON) and the location's place name
    users        the household account
    sessions     signed-in browsers (only a hash of each token is stored)

`ts INTEGER PRIMARY KEY` keeps rows physically ordered by time, so range scans are cheap.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable

# Sample column -> how it rolls up into 5-minute buckets.
SAMPLE_COLUMNS: dict[str, str] = {
    "pv_power": "AVG", "load_power": "AVG", "grid_power": "AVG", "battery_power": "AVG",
    "battery_soc": "AVG", "battery_soh": "AVG", "battery_temp": "AVG",
    "battery_voltage": "AVG", "battery_current": "AVG",
    "inverter_temp": "AVG", "grid_freq": "AVG",
    "mppt1_v": "AVG", "mppt1_a": "AVG", "mppt2_v": "AVG", "mppt2_a": "AVG",
    # second inverter, and the hybrid's own figures before it's added in (see inverters.merge)
    "pv1_power": "AVG", "pv2_power": "AVG", "load_hybrid": "AVG", "grid_hybrid": "AVG", "pv2_temp": "AVG",
    "running_state": "MAX", "power_flow": "MAX",
    # counters: monotonic within their period, so MAX == latest
    "daily_pv": "MAX", "daily_import": "MAX", "daily_export": "MAX",
    "daily_charge": "MAX", "daily_discharge": "MAX", "daily_direct": "MAX",
    "total_pv": "MAX", "total_import": "MAX", "total_export": "MAX",
    "total_charge": "MAX", "total_discharge": "MAX",
    "daily_pv1": "MAX", "daily_pv2": "MAX", "daily_export1": "MAX", "total_pv1": "MAX", "total_pv2": "MAX",
    # the hybrid's own panels' share of export (daily_export/total_export are the meter's)
    "daily_pv_export": "MAX", "total_pv_export": "MAX",
}  # fmt: skip
SAMPLE_TABLES = ("samples", "samples_5m")

_SAMPLES = "ts INTEGER PRIMARY KEY, " + ", ".join(f"{c} REAL" for c in SAMPLE_COLUMNS)


def _baseline(conn: sqlite3.Connection) -> None:
    """Every table as of the first versioned schema. IF NOT EXISTS: databases from before
    migrations existed already have some of these, and upgrade in place."""
    for table in SAMPLE_TABLES:
        conn.execute(f"CREATE TABLE IF NOT EXISTS {table} ({_SAMPLES})")
    conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL NOT NULL)")
    conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,"
        " password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,"
        " created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"
    )


# Applied in order; the database's PRAGMA user_version records how many have run.
# Never edit or reorder one that has shipped: add a new one.
MIGRATIONS: list[Callable[[sqlite3.Connection], None]] = [
    _baseline,
]


def add_missing_sample_columns(conn: sqlite3.Connection) -> None:
    """Sample columns are added as new readings are supported; add any the database lacks."""
    for table in SAMPLE_TABLES:
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for column in SAMPLE_COLUMNS:
            if column not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} REAL")
