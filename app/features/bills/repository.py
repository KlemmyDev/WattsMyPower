"""The Bills page's own query over the 5-minute rollups."""

from __future__ import annotations

from app.core.database import Database


class BillsRepository:
    def __init__(self, db: Database):
        self.db = db

    def complete_days(self, start: int, end: int, min_readings: int) -> set[str]:
        """Local dates (YYYY-MM-DD) in [start, end) with at least `min_readings` grid readings."""
        sql = (
            "SELECT date(ts, 'unixepoch', 'localtime') AS d, COUNT(*) FROM samples_5m "
            "WHERE ts >= ? AND ts < ? AND grid_power IS NOT NULL GROUP BY d"
        )
        with self.db.reading() as conn:
            return {d for d, n in conn.execute(sql, (start, end)) if n >= min_readings}

    def first_reading(self) -> int | None:
        with self.db.reading() as conn:
            return conn.execute("SELECT MIN(ts) FROM samples_5m WHERE grid_power IS NOT NULL").fetchone()[0]
