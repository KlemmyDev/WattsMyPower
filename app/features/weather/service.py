"""
The weather: fetching the forecast, keeping every hour of it, and filling in the weather for days
the dashboard has readings for but no weather (before it was set up, imported from iSolarCloud, or
while it was off).

A background loop runs every half hour:
  1. refreshes the forecast (also re-fetched on demand when the forecast is asked for and it's stale,
     or right away when the location, the weather model or the panels change);
  2. backfills older days with readings, a few requests a run, each up to three months;
  3. runs whatever else wants the fresh weather (the forecast's learning, see ForecastService.tick).

If a fetch fails, what's stored keeps serving, so the forecast survives an outage and a restart.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import statistics
import threading
import time
from collections import Counter
from collections.abc import Callable
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.features.settings.store import SettingsStore
from app.features.weather import openmeteo
from app.features.weather.openmeteo import Fetch
from app.features.weather.repository import WeatherRepository, local_date
from app.features.weather.sun import Panels

log = logging.getLogger(__name__)

REFRESH = 1800  # seconds between forecast fetches
RETRY = 300  # after a failed fetch, wait this long before trying again
CHUNK_DAYS = 90  # days of history per request
REQUESTS_PER_RUN = 4  # history requests per run of the loop
MAX_DAYS = 5 * 365  # how far back to fill in
RECENT_DAYS = 7  # the forecast itself covers this many days back
# Weather codes, worst first within a day: storms, snow, rain, drizzle, fog, cloud, clear.
SEVERITY = [range(95, 100), range(71, 87), range(61, 68), range(80, 83), range(51, 58), range(45, 49)]


def _local_midnight(date: dt.date) -> int:
    return int(time.mktime((date.year, date.month, date.day, 0, 0, 0, 0, 0, -1)))


def _main_code(codes: list[int]) -> int | None:
    """The weather code that sums up a day's daylight hours: the worst that lasted, or the usual one."""
    if not codes:
        return None
    for band in SEVERITY:
        hits = [c for c in codes if c in band]
        if len(hits) >= 2:
            return Counter(hits).most_common(1)[0][0]
    return round(statistics.fmean(codes))  # clear (0) to overcast (3)


class WeatherService:
    def __init__(
        self,
        config: Config,
        db: Database,
        settings: SettingsStore,
        get: Fetch | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.config = config
        self.settings = settings
        self.repo = WeatherRepository(db)
        self._get = get
        self.clock = clock
        self._lock = threading.Lock()
        self._fetched: tuple[tuple[Any, ...], float] | None = None  # (what was fetched, when)
        self._failed_at = 0.0
        self.error: str | None = None  # the last forecast fetch's failure, until one works
        self.model_unavailable: str | None = None  # a chosen weather model Open-Meteo couldn't serve
        self.backfill_state: dict[str, Any] = {"running": False, "error": None, "last_run": None, "added_days": 0}
        self.after_refresh: list[Callable[[], None]] = []
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    # ------------------------------------------------------------------ settings
    def where(self) -> tuple[float, float]:
        return self.settings.get("latitude"), self.settings.get("longitude")

    def panels(self) -> Panels:
        lat, lon = self.where()
        return Panels(lat, lon, self.settings.get("panel_tilt"), self.settings.get("panel_bearing"))

    def model(self) -> str:
        return self.settings.get_choice("weather_model")

    def _fetch(self, url: str) -> list[dict[str, Any]]:
        return openmeteo.fetch(url, self._get) if self._get else openmeteo.fetch(url)

    # ------------------------------------------------------------------ the forecast
    def ensure_fresh(self) -> None:
        """Refresh the forecast if it's older than REFRESH, or for another place or model (not within
        RETRY of a failure). Blocking."""
        if not self.config.forecast:
            return
        now = self.clock()
        what = (*self.where(), self.model())
        with self._lock:
            fresh = self._fetched and self._fetched[0] == what and now - self._fetched[1] < REFRESH
            if fresh or now - self._failed_at < RETRY:
                return
            self._refresh(what, now)

    def invalidate(self) -> None:
        """The location, weather model or panels changed: fetch again on the next look."""
        with self._lock:
            self._fetched = None
            self._failed_at = 0.0

    def _refresh(self, what: tuple[Any, ...], now: float) -> None:
        lat, lon, model = what
        try:
            try:
                fetched = self._fetch(openmeteo.forecast_url(lat, lon, model))
                self.model_unavailable = None
            except Exception as e:
                if model == "best_match":
                    raise
                # A model Open-Meteo can't serve here: fall back to its own pick, and say so.
                log.warning("Open-Meteo couldn't serve the %s model (%s); using its best match", model, e)
                self.model_unavailable = model
                fetched = self._fetch(openmeteo.forecast_url(lat, lon, "best_match"))
        except Exception as e:
            log.warning("Open-Meteo fetch failed: %s", e)
            self._failed_at = now
            self.error = f"Open-Meteo couldn't be reached ({type(e).__name__})"
            return
        self.repo.write(fetched, lat, lon, int(now))
        self._fetched = (what, now)
        self.error = None

    def hours(self, start: int, end: int) -> list[dict[str, Any]]:
        return self.repo.hours(start, end)

    # ------------------------------------------------------------------ filling in history
    def missing_days(self, today: dt.date) -> list[dt.date]:
        """Days with readings but no weather, oldest first, from MAX_DAYS ago to before RECENT_DAYS ago."""
        first = self.repo.first_reading()
        if first is None:
            return []
        start = max(dt.date.fromisoformat(local_date(first)), today - dt.timedelta(days=MAX_DAYS))
        end = today - dt.timedelta(days=RECENT_DAYS - 1)
        if start >= end:
            return []
        lo, hi = _local_midnight(start), _local_midnight(end)
        missing = self.repo.reading_days(lo, hi) - self.repo.days_covered(lo, hi)
        return sorted(dt.date.fromisoformat(d) for d in missing)

    def backfill(self, requests: int = REQUESTS_PER_RUN) -> int:
        """Fill in up to `requests` stretches of missing days. Returns how many days now have weather. Blocking."""
        if not self.config.forecast:
            return 0
        state = self.backfill_state
        today = dt.date.fromtimestamp(self.clock())
        missing = self.missing_days(today)
        if not missing:
            state.update(running=False, error=None, last_run=int(self.clock()), remaining=0)
            return 0
        lat, lon = self.where()
        model = self.model()
        state.update(running=True, remaining=len(missing))
        added = 0
        try:
            while missing and requests > 0:
                start = missing[0]
                # One request covers the first missing day up to CHUNK_DAYS on, and every missing day in it;
                # the historical forecast and the archive are asked separately (they hold different years).
                limit = start + dt.timedelta(days=CHUNK_DAYS - 1)
                if start < openmeteo.HISTORICAL_FROM:
                    limit = min(limit, openmeteo.HISTORICAL_FROM - dt.timedelta(days=1))
                end = max(d for d in missing if d <= limit)
                rows = self._fetch(openmeteo.history_url(lat, lon, model, start, end))
                self.repo.write(rows, lat, lon, int(self.clock()), history=True)
                done = [d for d in missing if d <= end]
                added += len(done)
                missing = missing[len(done) :]
                requests -= 1
            state.update(error=None)
        except Exception as e:
            log.warning("Filling in past weather failed: %s", e)
            state.update(error=f"Open-Meteo's weather history couldn't be reached ({type(e).__name__})")
        state.update(
            running=bool(missing) and state["error"] is None,
            last_run=int(self.clock()),
            added_days=state.get("added_days", 0) + added,
            remaining=len(missing),
        )
        return added

    # ------------------------------------------------------------------ views
    def day(self, date: dt.date) -> dict[str, Any]:
        """A day's weather hour by hour, summed up, and its day-ahead solar forecast."""
        start = _local_midnight(date)
        end = _local_midnight(date + dt.timedelta(days=1))
        hours = self.repo.hours(start, end)
        forecasts = self.repo.forecasts(start, end)
        temps = [h["temp"] for h in hours if h["temp"] is not None]
        daylight = [h for h in hours if h.get("is_day")]
        rain = [h["precip"] for h in hours if h["precip"] is not None]
        clouds = [h["cloud"] for h in daylight if h["cloud"] is not None]
        sun = [h["ghi"] for h in hours if h["ghi"] is not None]
        return {
            "date": date.isoformat(),
            "hours": [
                {k: h[k] for k in ("ts", "temp", "cloud", "code", "precip", "precip_prob", "wind", "is_day", "ghi")}
                | {"pv_forecast": forecasts.get(h["ts"])}
                for h in hours
            ],
            "summary": {
                "temp_min": min(temps) if temps else None,
                "temp_max": max(temps) if temps else None,
                "rain_mm": round(sum(rain), 1) if rain else None,
                "cloud": round(sum(clouds) / len(clouds)) if clouds else None,
                "sunlight_kwh_m2": round(sum(sun) / 1000, 2) if sun else None,
                "code": _main_code([h["code"] for h in daylight if h["code"] is not None]),
                "pv_forecast_kwh": round(sum(forecasts.values()), 1) if forecasts else None,
                "source": hours[0]["source"] if hours else None,
            },
        }

    def status(self) -> dict[str, Any]:
        today = dt.date.fromtimestamp(self.clock())
        missing = self.missing_days(today)
        return {
            "enabled": self.config.forecast,
            "model": self.model(),
            "model_unavailable": self.model_unavailable,
            "fetched_at": int(self._fetched[1]) if self._fetched else None,
            "error": self.error,
            "stored": self.repo.coverage(),
            "missing_days": len(missing),
            "backfill": {**self.backfill_state, "remaining": len(missing)},
        }

    # ------------------------------------------------------------------ the loop
    def run_once(self) -> None:
        self.ensure_fresh()
        self.backfill()
        for fn in self.after_refresh:
            try:
                fn()
            except Exception:
                log.exception("Updating after the weather refresh failed")

    async def start(self) -> None:
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    def wake(self) -> None:
        """Run the loop now (after a settings change, or to fill in history). Call from the event loop."""
        if self._wake:
            self._wake.set()

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.run_once)
            except Exception:
                log.exception("Weather refresh failed")
            assert self._wake is not None
            # Sooner while history is still being filled in, so a year of it is in within the hour.
            wait = 60 if self.backfill_state.get("running") else REFRESH
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=wait)
            self._wake.clear()
