"""Stored Amber prices (the `prices` table), and the Amber connection's settings in the kv table."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from typing import Any

from app.core.database import Database
from app.features.amber.prices import Price, PriceLookup

LONGEST = 1800  # seconds: the longest interval, so a range query catches the one already under way

# A final price is never replaced by a forecast for the same interval.
_UPSERT = (
    "INSERT INTO prices (channel, ts, duration, rate, actual, fetched) VALUES (?, ?, ?, ?, ?, ?) "
    "ON CONFLICT (channel, ts) DO UPDATE SET duration = excluded.duration, rate = excluded.rate, "
    "actual = excluded.actual, fetched = excluded.fetched WHERE excluded.actual OR NOT prices.actual"
)


class PriceRepository:
    def __init__(self, db: Database):
        self.db = db

    def save(self, conn: sqlite3.Connection, prices: Iterable[Price], fetched: int) -> None:
        conn.executemany(_UPSERT, [(p.channel, p.ts, p.duration, p.rate, int(p.actual), fetched) for p in prices])

    def clear(self, conn: sqlite3.Connection) -> None:
        conn.execute("DELETE FROM prices")

    def intervals(self, channel: str, start: int, end: int) -> list[tuple[int, int, float, bool]]:
        """(ts, duration, rate, actual) for the channel's intervals overlapping [start, end), oldest first."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT ts, duration, rate, actual FROM prices WHERE channel = ? AND ts >= ? AND ts < ? ORDER BY ts",
                (channel, start - LONGEST, end),
            ).fetchall()
        return [(ts, d, r, bool(a)) for ts, d, r, a in rows if ts + d > start]

    def lookup(self, channel: str, start: int, end: int) -> PriceLookup:
        """The channel's price at any moment in [start, end)."""
        return PriceLookup((ts, d, r) for ts, d, r, _ in self.intervals(channel, start, end))

    def coverage(self) -> dict[str, int | None]:
        """The first and last interval with a final import price, and the end of the furthest forecast."""
        with self.db.reading() as conn:
            first, last = conn.execute(
                "SELECT MIN(ts), MAX(ts + duration) FROM prices WHERE channel = 'general' AND actual = 1"
            ).fetchone()
            ahead = conn.execute("SELECT MAX(ts + duration) FROM prices WHERE channel = 'general'").fetchone()[0]
        return {"first": first, "last_actual": last, "until": ahead}


class AmberSettings:
    """The connection (API key, sites, chosen site) and the sync's progress, as JSON in the kv table."""

    KEYS = ("amber", "amber_sync")

    def __init__(self, db: Database):
        self.db = db

    def read(self, key: str) -> dict[str, Any]:
        with self.db.reading() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        try:
            value = json.loads(row[0]) if row else {}
        except ValueError:
            value = {}
        return value if isinstance(value, dict) else {}

    def write(self, conn: sqlite3.Connection, key: str, value: dict[str, Any]) -> None:
        conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (key, json.dumps(value)))

    def delete_all(self, conn: sqlite3.Connection) -> None:
        conn.executemany("DELETE FROM kv WHERE key = ?", [(k,) for k in self.KEYS])
