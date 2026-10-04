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

    def daily_solar(self, start: int, end: int) -> list[tuple[str, float | None, float, int]]:
        """(local date, kWh the inverters counted, kWh the solar power readings add up to, rollups with solar power)
        for each day in [start, end).

        The count is the day's highest daily solar counter, leaving out the first 10 minutes after midnight (when a
        lagging inverter clock may not have reset yesterday's yet), as the daily totals do.
        """
        with self.db.reading() as conn:
            return conn.execute(
                "SELECT date(ts, 'unixepoch', 'localtime') AS d,"
                " MAX(CASE WHEN strftime('%H%M', ts, 'unixepoch', 'localtime') >= '0010' THEN daily_pv END),"
                " SUM(MAX(pv_power, 0)) * 300 / 3.6e6, COUNT(pv_power)"
                " FROM samples_5m WHERE ts >= ? AND ts < ? GROUP BY d",
                (start, end),
            ).fetchall()
