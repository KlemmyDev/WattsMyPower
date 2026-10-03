"""The weather_hours and forecast_hours tables (see app.core.schema)."""

from __future__ import annotations

import time
from collections.abc import Iterable
from typing import Any

from app.core.database import Database

COLUMNS = ["ghi", "dni", "dhi", "temp", "cloud", "code", "precip", "precip_prob", "wind", "is_day"]
_INSERT = (
    f"INSERT {{verb}} INTO weather_hours (ts, latitude, longitude, {', '.join(COLUMNS)}, source, fetched_at)"
    f" VALUES (?, ?, ?{', ?' * len(COLUMNS)}, ?, ?)"
)
# A day-ahead forecast is kept as it stood at least this long before its hour began; an hour first
# forecast later than that (the dashboard was off) keeps its first forecast.
DAY_AHEAD = 12 * 3600


class WeatherRepository:
    def __init__(self, db: Database):
        self.db = db

    # ------------------------------------------------------------------ weather
    def write(
        self,
        rows: Iterable[dict[str, Any]],
        latitude: float,
        longitude: float,
        now: int,
        *,
        history: bool = False,
        replace: bool = False,
    ) -> int:
        """
        Store fetched hours. From the forecast (`history=False`) every hour is replaced, as "recent" once it
        has begun and "forecast" before. From a history service, only hours not already stored are added,
        as "archive": what the forecast service last estimated for an hour is the closer match. With
        `replace`, earlier "archive" hours in the same stretch go first, so it's fetched afresh.
        """
        values = []
        for r in rows:
            if all(r.get(c) is None for c in ("ghi", "temp", "code")):
                continue  # the model has nothing for this hour
            source = "archive" if history else ("recent" if r["ts"] < now else "forecast")
            values.append((r["ts"], latitude, longitude, *(r.get(c) for c in COLUMNS), source, now))
        with self.db.writing() as conn:
            if history and replace and values:
                conn.execute(
                    "DELETE FROM weather_hours WHERE source = 'archive' AND ts >= ? AND ts <= ?",
                    (min(v[0] for v in values), max(v[0] for v in values)),
                )
            conn.executemany(_INSERT.format(verb="OR IGNORE" if history else "OR REPLACE"), values)
        return len(values)

    def hours(self, start: int, end: int) -> list[dict[str, Any]]:
        """Stored hours starting in [start, end), oldest first."""
        with self.db.reading() as conn:
            cur = conn.execute(
                f"SELECT ts, {', '.join(COLUMNS)}, source FROM weather_hours WHERE ts >= ? AND ts < ? ORDER BY ts",
                (start, end),
            )
            names = [d[0] for d in cur.description]
            return [dict(zip(names, row, strict=True)) for row in cur]

    def days_covered(self, start: int, end: int) -> set[str]:
        """Local dates in [start, end) with weather for (nearly) every hour."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT date(ts, 'unixepoch', 'localtime') AS d FROM weather_hours WHERE ts >= ? AND ts < ?"
                " GROUP BY d HAVING COUNT(*) >= 22",
                (start, end),
            )
            return {d for (d,) in rows}

    def coverage(self) -> dict[str, Any]:
        with self.db.reading() as conn:
            first, last, n = conn.execute(
                "SELECT MIN(ts), MAX(ts), COUNT(*) FROM weather_hours WHERE source != 'forecast'"
            ).fetchone()
        return {"first_ts": first, "last_ts": last, "hours": n}

    # ------------------------------------------------------------------ readings it's compared with
    def first_reading(self) -> int | None:
        with self.db.reading() as conn:
            first: int | None = conn.execute("SELECT MIN(ts) FROM samples_5m").fetchone()[0]
            return first

    def reading_days(self, start: int, end: int) -> set[str]:
        """Local dates in [start, end) with readings."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT DISTINCT date(ts, 'unixepoch', 'localtime') FROM samples_5m WHERE ts >= ? AND ts < ?",
                (start, end),
            )
            return {d for (d,) in rows}

    def solar_rollups(self, start: int, end: int) -> list[tuple[int, float, float | None]]:
        """(ts, solar W, battery %) for each 5-minute rollup with solar in [start, end)."""
        with self.db.reading() as conn:
            return conn.execute(
                "SELECT ts, pv_power, battery_soc FROM samples_5m WHERE ts >= ? AND ts < ? AND pv_power IS NOT NULL",
                (start, end),
            ).fetchall()

    # ------------------------------------------------------------------ the day-ahead forecast
    def log_forecast(self, hours: Iterable[tuple[int, float]], issued_at: int, model: str) -> None:
        """Keep each hour's solar forecast as it stood about a day ahead (see DAY_AHEAD)."""
        with self.db.writing() as conn:
            conn.executemany(
                "INSERT INTO forecast_hours (ts, pv_kwh, issued_at, model) VALUES (?, ?, ?, ?)"
                " ON CONFLICT (ts) DO UPDATE SET pv_kwh = excluded.pv_kwh, issued_at = excluded.issued_at,"
                f" model = excluded.model WHERE excluded.issued_at <= forecast_hours.ts - {DAY_AHEAD}",
                [(ts, round(kwh, 3), issued_at, model) for ts, kwh in hours if ts > issued_at],
            )

    def forecasts(self, start: int, end: int) -> dict[int, float]:
        with self.db.reading() as conn:
            rows = conn.execute("SELECT ts, pv_kwh FROM forecast_hours WHERE ts >= ? AND ts < ?", (start, end))
            return dict(rows.fetchall())


def local_date(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))
