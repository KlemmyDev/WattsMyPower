"""Aggregates over the 5-minute rollups for the Solar and Battery pages (the insights feature)."""

from __future__ import annotations

from typing import Any

from app.core.database import Database


class InsightsRepository:
    def __init__(self, db: Database):
        self.db = db

    def battery_days(self, start: int, end: int) -> list[dict[str, Any]]:
        """Per local day: SoC swing and time spent full, for days with at least 80% of readings."""
        sql = (
            "SELECT date(ts, 'unixepoch', 'localtime') AS d, MAX(battery_soc) - MIN(battery_soc), "
            "SUM(battery_soc >= 99), COUNT(*) FROM samples_5m "
            "WHERE ts >= ? AND ts < ? AND battery_soc IS NOT NULL GROUP BY d"
        )
        with self.db.reading() as conn:
            rows = conn.execute(sql, (start, end)).fetchall()
        return [{"date": d, "swing": swing, "full_min": full * 5} for d, swing, full, n in rows if n >= 230]

    def hourly_pv(self, offset: int, start: int, end: int) -> dict[int, float]:
        """
        Average PV output (kW) per hour, keyed by hour start, for hours with at least
        10 rollups. Hours start `offset` seconds past the hour (radiation hours can sit
        on the half hour in some time zones).
        """
        off = int(offset)
        sql = (
            f"SELECT ((ts - {off}) / 3600) * 3600 + {off} AS h, AVG(pv_power), COUNT(*) FROM samples_5m "
            f"WHERE ts >= ? AND ts < ? AND pv_power IS NOT NULL GROUP BY h"
        )
        with self.db.reading() as conn:
            return {h: pv / 1000 for h, pv, n in conn.execute(sql, (start, end)) if n >= 10}

    def monthly_soh(self, start: int, end: int) -> dict[str, float]:
        """The battery's average reported state of health for each month."""
        sql = (
            "SELECT strftime('%Y-%m', ts, 'unixepoch', 'localtime') AS m, AVG(battery_soh) FROM samples_5m "
            "WHERE ts >= ? AND ts < ? AND battery_soh IS NOT NULL GROUP BY m"
        )
        with self.db.reading() as conn:
            return {m: round(v, 1) for m, v in conn.execute(sql, (start, end)) if v is not None}
