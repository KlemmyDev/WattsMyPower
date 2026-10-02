"""History queries the forecast needs that aren't general reading queries."""

from __future__ import annotations

from app.core.database import Database


class ForecastRepository:
    def __init__(self, db: Database):
        self.db = db

    def hourly_load(self, since: int) -> list[tuple[str, int, float, int]]:
        """(local date, local hour, average home use W, rollup count) for each hour since `since`.

        Home use can't be negative: the hybrid briefly reports it so after stale-register stretches,
        so those readings count as zero rather than pulling the average down.
        """
        with self.db.reading() as conn:
            return conn.execute(
                "SELECT date(ts, 'unixepoch', 'localtime') AS d,"
                " CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) AS h,"
                " AVG(MAX(load_power, 0)), COUNT(*)"
                " FROM samples_5m WHERE ts >= ? AND load_power IS NOT NULL GROUP BY d, h",
                (since,),
            ).fetchall()
