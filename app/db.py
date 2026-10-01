"""
SQLite storage.

Two tables with identical columns, both keyed on unix-seconds `ts`
(INTEGER PRIMARY KEY, so rows are physically ordered by time and range scans
are cheap):

    samples      one row per poll (raw snapshots)
    samples_5m   5-minute rollups, kept up to date on every insert; used for
                 long time ranges so a 1-year chart never touches raw rows
"""

from __future__ import annotations

import math
import os
import sqlite3
import time
from contextlib import closing

from . import config

# column -> how it rolls up into 5-minute buckets
COLUMNS = {
    "pv_power": "AVG", "load_power": "AVG", "grid_power": "AVG", "battery_power": "AVG",
    "battery_soc": "AVG", "battery_soh": "AVG", "battery_temp": "AVG",
    "battery_voltage": "AVG", "battery_current": "AVG",
    "inverter_temp": "AVG", "grid_freq": "AVG",
    "mppt1_v": "AVG", "mppt1_a": "AVG", "mppt2_v": "AVG", "mppt2_a": "AVG",
    # second inverter, and the hybrid's own figures before it's added in (see poller.merge_pv2)
    "pv1_power": "AVG", "pv2_power": "AVG", "load_hybrid": "AVG", "grid_hybrid": "AVG", "pv2_temp": "AVG",
    "running_state": "MAX", "power_flow": "MAX",
    # counters: monotonic within their period, so MAX == latest
    "daily_pv": "MAX", "daily_import": "MAX", "daily_export": "MAX",
    "daily_charge": "MAX", "daily_discharge": "MAX", "daily_direct": "MAX",
    "total_pv": "MAX", "total_import": "MAX", "total_export": "MAX",
    "total_charge": "MAX", "total_discharge": "MAX",
    "daily_pv1": "MAX", "daily_pv2": "MAX", "daily_export1": "MAX", "total_pv1": "MAX", "total_pv2": "MAX",
}
COLS = list(COLUMNS)
ROLLUP = 300
DAILY_COLS = ["daily_pv", "daily_import", "daily_export", "daily_charge", "daily_discharge", "daily_direct", "daily_pv2"]

_SCHEMA = "ts INTEGER PRIMARY KEY, " + ", ".join(f"{c} REAL" for c in COLS)
_INSERT = f"INSERT OR REPLACE INTO samples (ts, {', '.join(COLS)}) VALUES (?{', ?' * len(COLS)})"
_ROLLUP_SQL = (
    f"INSERT OR REPLACE INTO samples_5m (ts, {', '.join(COLS)}) "
    f"SELECT (ts / {ROLLUP}) * {ROLLUP} AS b, "
    + ", ".join(f"{agg}({c})" for c, agg in COLUMNS.items())
    + " FROM samples WHERE ts >= ? AND ts < ? GROUP BY b"
)


def connect(readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        conn = sqlite3.connect(f"file:{config.DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    else:
        conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(config.DB_PATH) or ".", exist_ok=True)
    conn = connect()
    conn.execute(f"CREATE TABLE IF NOT EXISTS samples ({_SCHEMA})")
    conn.execute(f"CREATE TABLE IF NOT EXISTS samples_5m ({_SCHEMA})")
    # Add columns introduced after the database was created.
    for table in ("samples", "samples_5m"):
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for c in COLS:
            if c not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {c} REAL")
    # Heal rollups after a crash/restart: rebuild from the last rollup bucket onward.
    last = conn.execute("SELECT MAX(ts) FROM samples_5m").fetchone()[0] or 0
    conn.execute(_ROLLUP_SQL, (last, 2**62))
    conn.commit()
    return conn


def insert(conn: sqlite3.Connection, ts: int, snap: dict) -> None:
    conn.execute(_INSERT, (ts, *(snap.get(c) for c in COLS)))
    bucket = ts // ROLLUP * ROLLUP
    conn.execute(_ROLLUP_SQL, (bucket, bucket + ROLLUP))
    conn.commit()


def insert_many(conn: sqlite3.Connection, rows: list[tuple[int, dict]]) -> None:
    if not rows:
        return
    conn.executemany(_INSERT, [(ts, *(s.get(c) for c in COLS)) for ts, s in rows])
    conn.execute(_ROLLUP_SQL, (rows[0][0] // ROLLUP * ROLLUP, 2**62))
    conn.commit()


def raw_cutoff() -> int:
    """Oldest timestamp raw rows are kept for (bucket-aligned); 0 = everything is kept."""
    if config.RAW_RETENTION_DAYS <= 0:
        return 0
    return (int(time.time()) - config.RAW_RETENTION_DAYS * 86400) // ROLLUP * ROLLUP


def prune(conn: sqlite3.Connection) -> int:
    cutoff = raw_cutoff()
    if not cutoff:
        return 0
    n = conn.execute("DELETE FROM samples WHERE ts < ?", (cutoff,)).rowcount
    conn.commit()
    return n


def is_empty(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM samples LIMIT 1").fetchone() is None


# ---------------------------------------------------------------------------
# Queries (each opens its own read-only connection; cheap with WAL)
# ---------------------------------------------------------------------------

def latest() -> dict | None:
    with closing(connect(readonly=True)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM samples ORDER BY ts DESC LIMIT 1").fetchone()
        return dict(row) if row else None


def history(start: int, end: int, points: int, fields: list[str]) -> dict:
    """
    Columnar, time-bucketed series between start and end (unix seconds).
    Picks raw rows for short ranges and 5-minute rollups for long ones, and
    inserts a null row wherever data is missing so charts show gaps honestly.
    """
    fields = [f for f in fields if f in COLUMNS] or ["pv_power", "load_power", "grid_power", "battery_power", "battery_soc"]
    span = max(1, end - start)
    bucket = max(config.POLL_INTERVAL, math.ceil(span / max(10, points)))
    table = "samples"
    # Long ranges, or anything reaching back past raw retention, read the rollups.
    if bucket >= ROLLUP or start < raw_cutoff():
        bucket = max(bucket, ROLLUP)
        table = "samples_5m"
        nice = (300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400)
        bucket = next((n for n in nice if n >= bucket), math.ceil(bucket / 86400) * 86400)

    select = ", ".join(f"{COLUMNS[f]}({f})" for f in fields)
    sql = (f"SELECT (ts / {bucket}) * {bucket} AS b, {select} FROM {table} "
           f"WHERE ts >= ? AND ts < ? GROUP BY b ORDER BY b")
    with closing(connect(readonly=True)) as conn:
        rows = conn.execute(sql, (start, end)).fetchall()

    out: dict[str, list] = {"t": []}
    for f in fields:
        out[f] = []
    # Missing more than a few polls (or a few buckets) -> break the line.
    gap = max(bucket * 3, config.POLL_INTERVAL * 6, 120)
    prev = None
    for row in rows:
        if prev is not None and row[0] - prev > gap:
            out["t"].append(prev + bucket)
            for f in fields:
                out[f].append(None)
        out["t"].append(row[0])
        for i, f in enumerate(fields, 1):
            v = row[i]
            out[f].append(round(v, 2) if v is not None else None)
        prev = row[0]
    return {"bucket": bucket, "source": table, "series": out}


def daily(start: int, end: int) -> list[dict]:
    """Per-local-day energy totals (kWh) from the inverter's daily counters."""
    # Skip the first 10 minutes after midnight: if the inverter's clock lags
    # ours, yesterday's un-reset counter would otherwise count as today's max.
    select = ", ".join(f"MAX({c})" for c in DAILY_COLS)
    sql = (f"SELECT date(ts, 'unixepoch', 'localtime') AS d, {select} FROM samples_5m "
           f"WHERE ts >= ? AND ts < ? AND strftime('%H%M', ts, 'unixepoch', 'localtime') >= '0010' "
           f"GROUP BY d ORDER BY d")
    with closing(connect(readonly=True)) as conn:
        rows = conn.execute(sql, (start, end)).fetchall()
    return [{"date": r[0], **{c: (round(v, 2) if v is not None else None) for c, v in zip(DAILY_COLS, r[1:])}} for r in rows]


def export_rows(start: int, end: int, rollup: bool):
    # Raw rows before the retention cutoff are gone, so fall back to rollups there.
    table = "samples_5m" if rollup or start < raw_cutoff() else "samples"
    conn = connect(readonly=True)
    try:
        yield ["ts", "time", *COLS]
        for row in conn.execute(
            f"SELECT ts, datetime(ts, 'unixepoch', 'localtime'), {', '.join(COLS)} FROM {table} "
            f"WHERE ts >= ? AND ts < ? ORDER BY ts", (start, end)
        ):
            yield row
    finally:
        conn.close()


def stats() -> dict:
    with closing(connect(readonly=True)) as conn:
        raw = conn.execute("SELECT COUNT(*), MIN(ts), MAX(ts) FROM samples").fetchone()
        r5 = conn.execute("SELECT COUNT(*) FROM samples_5m").fetchone()[0]
    size = sum(os.path.getsize(p) for p in (config.DB_PATH, config.DB_PATH + "-wal") if os.path.exists(p))
    return {"raw_rows": raw[0], "first_ts": raw[1], "last_ts": raw[2], "rollup_rows": r5, "db_bytes": size}
