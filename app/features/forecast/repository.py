"""History queries the forecast needs that aren't general reading queries."""

from __future__ import annotations

from app.core.database import Database


class ForecastRepository:
    def __init__(self, db: Database):
        self.db = db

    def hourly_load(self, since: int) -> list[tuple[int, float | None, int]]:
        """(local hour of day, average load W, rollup count) over the 5-minute rollups since `since`."""
        with self.db.reading() as conn:
            return conn.execute(
                "SELECT CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER), AVG(load_power), COUNT(*) "
                "FROM samples_5m WHERE ts >= ? GROUP BY 1",
                (since,),
            ).fetchall()
