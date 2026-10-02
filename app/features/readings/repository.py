"""
Inverter readings: raw samples (one per poll) and their 5-minute rollups, and the
queries over them (history charts, daily totals, CSV export).
"""

from __future__ import annotations

import math
import sqlite3
import time
from collections.abc import Iterator
from typing import Any

from app.core.database import Database
from app.core.schema import SAMPLE_COLUMNS

Snapshot = dict[str, Any]

COLS = list(SAMPLE_COLUMNS)
ROLLUP = 300  # seconds per rollup bucket
DAILY_COLS = [
    "daily_pv",
    "daily_import",
    "daily_export",
    "daily_charge",
    "daily_discharge",
    "daily_direct",
    "daily_pv2",
]
DEFAULT_FIELDS = ["pv_power", "load_power", "grid_power", "battery_power", "battery_soc"]

_INSERT = f"INSERT OR REPLACE INTO samples (ts, {', '.join(COLS)}) VALUES (?{', ?' * len(COLS)})"
_ROLLUP_SQL = (
    f"INSERT OR REPLACE INTO samples_5m (ts, {', '.join(COLS)}) "
    f"SELECT (ts / {ROLLUP}) * {ROLLUP} AS b, "
    + ", ".join(f"{agg}({c})" for c, agg in SAMPLE_COLUMNS.items())
    + " FROM samples WHERE ts >= ? AND ts < ? GROUP BY b"
)


class ReadingsRepository:
    def __init__(self, db: Database, poll_interval: int, raw_retention_days: int):
        self.db = db
        self.poll_interval = poll_interval
        self.raw_retention_days = raw_retention_days

    # ------------------------------------------------------------------ writing (the ingest loop's connection)
    def heal_rollups(self, conn: sqlite3.Connection) -> None:
        """After a crash or restart, rebuild rollups from the last rollup bucket onward."""
        last = conn.execute("SELECT MAX(ts) FROM samples_5m").fetchone()[0] or 0
        conn.execute(_ROLLUP_SQL, (last, 2**62))
        conn.commit()

    def insert(self, conn: sqlite3.Connection, ts: int, snap: Snapshot) -> None:
        conn.execute(_INSERT, (ts, *(snap.get(c) for c in COLS)))
        bucket = ts // ROLLUP * ROLLUP
        conn.execute(_ROLLUP_SQL, (bucket, bucket + ROLLUP))
        conn.commit()

    def insert_many(self, conn: sqlite3.Connection, rows: list[tuple[int, Snapshot]]) -> None:
        if not rows:
            return
        conn.executemany(_INSERT, [(ts, *(s.get(c) for c in COLS)) for ts, s in rows])
        conn.execute(_ROLLUP_SQL, (rows[0][0] // ROLLUP * ROLLUP, 2**62))
        conn.commit()

    def raw_cutoff(self) -> int:
        """Oldest timestamp raw rows are kept for (bucket-aligned); 0 = everything is kept."""
        if self.raw_retention_days <= 0:
            return 0
        return (int(time.time()) - self.raw_retention_days * 86400) // ROLLUP * ROLLUP

    def prune(self, conn: sqlite3.Connection) -> int:
        """Delete raw rows past retention (their rollups stay). Returns how many went."""
        cutoff = self.raw_cutoff()
        if not cutoff:
            return 0
        n = conn.execute("DELETE FROM samples WHERE ts < ?", (cutoff,)).rowcount
        conn.commit()
        return n

    def is_empty(self, conn: sqlite3.Connection) -> bool:
        return conn.execute("SELECT 1 FROM samples LIMIT 1").fetchone() is None

    # ------------------------------------------------------------------ queries
    def latest(self) -> Snapshot | None:
        with self.db.reading() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM samples ORDER BY ts DESC LIMIT 1").fetchone()
            return dict(row) if row else None

    def history(self, start: int, end: int, points: int, fields: list[str]) -> dict[str, Any]:
        """
        Columnar, time-bucketed series between start and end (unix seconds).
        Picks raw rows for short ranges and 5-minute rollups for long ones, and
        inserts a null row wherever data is missing so charts show gaps honestly.
        """
        fields = [f for f in fields if f in SAMPLE_COLUMNS] or DEFAULT_FIELDS
        span = max(1, end - start)
        bucket = max(self.poll_interval, math.ceil(span / max(10, points)))
        table = "samples"
        # Long ranges, or anything reaching back past raw retention, read the rollups.
        if bucket >= ROLLUP or start < self.raw_cutoff():
            bucket = max(bucket, ROLLUP)
            table = "samples_5m"
            nice = (300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400)
            bucket = next((n for n in nice if n >= bucket), math.ceil(bucket / 86400) * 86400)

        select = ", ".join(f"{SAMPLE_COLUMNS[f]}({f})" for f in fields)
        sql = f"SELECT (ts / {bucket}) * {bucket} AS b, {select} FROM {table} WHERE ts >= ? AND ts < ? GROUP BY b ORDER BY b"
        with self.db.reading() as conn:
            rows = conn.execute(sql, (start, end)).fetchall()

        out: dict[str, list[Any]] = {"t": [], **{f: [] for f in fields}}
        # Missing more than a few polls (or a few buckets) -> break the line.
        gap = max(bucket * 3, self.poll_interval * 6, 120)
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

    def daily(self, start: int, end: int) -> list[dict[str, Any]]:
        """Per-local-day energy totals (kWh) from the inverter's daily counters."""
        # Skip the first 10 minutes after midnight: if the inverter's clock lags
        # ours, yesterday's un-reset counter would otherwise count as today's max.
        select = ", ".join(f"MAX({c})" for c in DAILY_COLS)
        sql = (
            f"SELECT date(ts, 'unixepoch', 'localtime') AS d, {select} FROM samples_5m "
            f"WHERE ts >= ? AND ts < ? AND strftime('%H%M', ts, 'unixepoch', 'localtime') >= '0010' "
            f"GROUP BY d ORDER BY d"
        )
        with self.db.reading() as conn:
            rows = conn.execute(sql, (start, end)).fetchall()
        return [
            {
                "date": r[0],
                **{c: (round(v, 2) if v is not None else None) for c, v in zip(DAILY_COLS, r[1:], strict=True)},
            }
            for r in rows
        ]

    def rollups(self, start: int, end: int, columns: list[str], not_null: str | None = None) -> list[tuple[Any, ...]]:
        """(ts, *columns) for each 5-minute rollup in the range, oldest first."""
        cols = [c for c in columns if c in SAMPLE_COLUMNS]
        where = f" AND {not_null} IS NOT NULL" if not_null in SAMPLE_COLUMNS else ""
        sql = f"SELECT ts, {', '.join(cols)} FROM samples_5m WHERE ts >= ? AND ts < ?{where} ORDER BY ts"
        with self.db.reading() as conn:
            return conn.execute(sql, (start, end)).fetchall()

    def export_rows(self, start: int, end: int, rollup: bool) -> Iterator[list[Any] | tuple[Any, ...]]:
        """CSV rows (header first) of raw samples, or 5-minute rollups."""
        # Raw rows before the retention cutoff are gone, so fall back to rollups there.
        table = "samples_5m" if rollup or start < self.raw_cutoff() else "samples"
        conn = self.db.connect(readonly=True)
        try:
            yield ["ts", "time", *COLS]
            yield from conn.execute(
                f"SELECT ts, datetime(ts, 'unixepoch', 'localtime'), {', '.join(COLS)} FROM {table} "
                f"WHERE ts >= ? AND ts < ? ORDER BY ts",
                (start, end),
            )
        finally:
            conn.close()

    def stats(self) -> dict[str, Any]:
        with self.db.reading() as conn:
            raw = conn.execute("SELECT COUNT(*), MIN(ts), MAX(ts) FROM samples").fetchone()
            r5 = conn.execute("SELECT COUNT(*) FROM samples_5m").fetchone()[0]
        return {
            "raw_rows": raw[0],
            "first_ts": raw[1],
            "last_ts": raw[2],
            "rollup_rows": r5,
            "db_bytes": self.db.size_bytes(),
        }
