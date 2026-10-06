"""
The weather: fetching the forecast, keeping every hour of it, and filling in the weather for days
the dashboard has readings for but no weather (before it was set up, imported from iSolarCloud, or
while it was off).

A background loop runs every half hour:
  1. refreshes the forecast (also re-fetched on demand when the forecast is asked for and it's stale,
     or right away when the location, the weather model or the panels change);
  2. backfills older days with readings (any day back to 1940, once the location has been chosen), a few
     requests a run, each up to three months; or, when
     asked for (after an import, or from Settings), all of them at once, reporting its progress. It
     can also fetch every day again ("refetch"), say after changing the weather model;
  3. runs whatever else wants the fresh weather (the forecast's learning, see ForecastService.tick).

If a fetch fails, what's stored keeps serving, so the forecast survives an outage and a restart.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import functools
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
REQUESTS_WHEN_ASKED = 30  # per run when a fill is asked for: about seven years, so it's done in one go
ARCHIVE_FROM = dt.date(1940, 1, 1)  # the ERA5 archive's first day: as far back as weather can be filled in
RECENT_DAYS = 7  # the forecast itself covers this many days back
COMPLETE = 0.9  # share of hours a model must give sunlight and temperature for (and codes, for history)
# Weather codes, worst first within a day: storms, snow, rain, drizzle, fog, cloud, clear.
SEVERITY = [range(95, 100), range(71, 87), range(61, 68), range(80, 83), range(51, 58), range(45, 49)]


def _complete(rows: list[dict[str, Any]], fields: tuple[str, ...]) -> bool:
    return bool(rows) and all(sum(r.get(f) is not None for r in rows) >= COMPLETE * len(rows) for f in fields)


def _local_midnight(date: dt.date) -> int:
    return int(time.mktime((date.year, date.month, date.day, 0, 0, 0, 0, 0, -1)))


def main_code(codes: list[int]) -> int | None:
    """The weather code that sums up a day's daylight hours: the worst that lasted, or the usual one."""
    if not codes:
        return None
    for band in SEVERITY:
        hits = [c for c in codes if c in band]
        if len(hits) >= 2:
            return Counter(hits).most_common(1)[0][0]
    # Clear (0) to overcast (3). A lone shower or foggy hour doesn't sum up the day, nor join the average.
    sky = [c for c in codes if c <= 3]
    return round(statistics.fmean(sky)) if sky else max(codes)


def _summary(hours: list[dict[str, Any]]) -> dict[str, Any]:
    """A day's weather from its hours: temperature range, rain, daylight cloud, sunlight, and a code for it."""
    temps = [h["temp"] for h in hours if h["temp"] is not None]
    daylight = [h for h in hours if h.get("is_day")]
    rain = [h["precip"] for h in hours if h["precip"] is not None]
    clouds = [h["cloud"] for h in daylight if h["cloud"] is not None]
    sun = [h["ghi"] for h in hours if h["ghi"] is not None]
    return {
        "temp_min": min(temps) if temps else None,
        "temp_max": max(temps) if temps else None,
        "rain_mm": round(sum(rain), 1) if rain else None,
        "cloud": round(sum(clouds) / len(clouds)) if clouds else None,
        "sunlight_kwh_m2": round(sum(sun) / 1000, 2) if sun else None,
        "code": main_code([h["code"] for h in daylight if h["code"] is not None]),
    }


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
        # Filling in past weather: whether it's going and was asked for, all days again or only missing ones
        # (and, then, how far it has got), its progress through this fill, and how the last one went.
        self.backfill_state: dict[str, Any] = {
            "running": False,
            "requested": False,
            "refetch": False,
            "cursor": None,
            "total": 0,
            "done": 0,
            "started_at": None,
            "finished_at": None,
            "error": None,
            "last_run": None,
            "added_days": 0,
        }
        self._fill_lock = threading.Lock()
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

    def _fetch_model(self, url: Callable[[str], str], model: str, fields: tuple[str, ...]) -> list[dict[str, Any]]:
        """Fetch with the chosen model, falling back to Open-Meteo's best match if that model can't serve the
        location (an error, or hours mostly missing: not every model covers everywhere, or every variable)."""
        if model != "best_match":
            try:
                rows = self._fetch(url(model))
                if _complete(rows, fields):
                    return rows
                reason: object = "most hours missing"
            except Exception as e:
                reason = e
            log.warning("Open-Meteo couldn't serve the %s model here (%s); using its best match", model, reason)
            self.model_unavailable = model
        return self._fetch(url("best_match"))

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
        self.model_unavailable = None
        try:
            fetched = self._fetch_model(lambda m: openmeteo.forecast_url(lat, lon, m), model, ("ghi", "temp"))
        except Exception as e:
            log.warning("Open-Meteo fetch failed: %s", e)
            self._failed_at = now
            self.error = f"Open-Meteo couldn't be reached ({type(e).__name__})"
            return
        self.repo.write(fetched, lat, lon, int(now))
        self._fetched = (what, now)
        self.error = None

    def timing(self) -> dict[str, Any]:
        """When the forecast was last fetched and when it's next due: REFRESH after that, or RETRY after a failure
        since (asking for the forecast once it's due fetches it, if the loop hasn't yet)."""
        fetched = self._fetched[1] if self._fetched else None
        due = fetched + REFRESH if fetched is not None else None
        if self._failed_at and (fetched is None or self._failed_at > fetched):
            due = self._failed_at + RETRY
        return {
            "fetched_at": int(fetched) if fetched is not None else None,
            "next_at": int(due) if due is not None else None,
            "every": REFRESH,
            "error": self.error,
        }

    def hours(self, start: int, end: int) -> list[dict[str, Any]]:
        return self.repo.hours(start, end)

    # ------------------------------------------------------------------ filling in history
    def missing_days(self, today: dt.date, *, every: bool = False, after: dt.date | None = None) -> list[dt.date]:
        """Days with readings but no weather (or `every` day with readings), oldest first, back to the archive's
        first day and to before RECENT_DAYS ago, and after `after`."""
        first = self.repo.first_reading()
        if first is None:
            return []
        start = max(dt.date.fromisoformat(local_date(first)), ARCHIVE_FROM)
        end = today - dt.timedelta(days=RECENT_DAYS - 1)
        if start >= end:
            return []
        lo, hi = _local_midnight(start), _local_midnight(end)
        days = self.repo.reading_days(lo, hi)
        if not every:
            days -= self.repo.days_covered(lo, hi)
        return sorted(d for d in (dt.date.fromisoformat(x) for x in days) if after is None or d > after)

    def request_backfill(self, refetch: bool = False) -> None:
        """Fill in past weather now, all of it, rather than a little each half hour; with `refetch`, every day with
        readings again, not only those without weather. Call from the event loop."""
        with self._fill_lock:
            state = self.backfill_state
            if not (state["requested"] and state["running"] and state["refetch"] == refetch):  # not already going
                state.update(
                    requested=True,
                    running=True,
                    refetch=refetch,
                    cursor=None,
                    total=None,
                    done=0,
                    error=None,
                    started_at=int(self.clock()),
                    finished_at=None,
                )
        self.wake()

    def backfill(self, requests: int | None = None) -> int:
        """Fill in up to `requests` stretches of missing days. Returns how many days now have weather. Blocking."""
        if not self.config.forecast:
            return 0
        state = self.backfill_state
        if not self.settings.location_set():
            # Not the default location's weather, stored as if it were this home's: wait until it's chosen.
            with self._fill_lock:
                was_asked = state["requested"]
                state.update(running=False, requested=False, refetch=False, cursor=None)
                state["error"] = (
                    "Choose your location first, so the weather is for the right place" if was_asked else None
                )
            return 0
        today = dt.date.fromtimestamp(self.clock())
        with self._fill_lock:
            refetch, cursor = state["refetch"], state["cursor"]
            requests = requests or (REQUESTS_WHEN_ASKED if state["requested"] else REQUESTS_PER_RUN)
        after = dt.date.fromisoformat(cursor) if cursor else None
        missing = self.missing_days(today, every=refetch, after=after)
        if not missing:
            with self._fill_lock:
                if state["running"]:
                    state.update(finished_at=int(self.clock()))
                state.update(
                    running=False, requested=False, refetch=False, cursor=None, error=None, last_run=int(self.clock())
                )
            return 0
        lat, lon = self.where()
        model = self.model()
        with self._fill_lock:
            if not state["running"] or state["total"] is None:  # a fill starting: count what it has to do
                state.update(total=len(missing), done=0, finished_at=None)
                state["started_at"] = state["started_at"] if state["running"] else int(self.clock())
            state.update(running=True)
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
                chunk = functools.partial(openmeteo.history_url, lat, lon, start=start, end=end)
                rows = self._fetch_model(chunk, model, ("ghi", "temp", "code"))
                # Only the days asked for: the day after (fetched for the last hour's sunshine) comes with its own.
                until = _local_midnight(end + dt.timedelta(days=1))
                rows = [r for r in rows if r["ts"] < until]
                self.repo.write(rows, lat, lon, int(self.clock()), history=True, replace=refetch)
                done = [d for d in missing if d <= end]
                added += len(done)
                missing = missing[len(done) :]
                requests -= 1
                with self._fill_lock:
                    state["done"] = (state["done"] or 0) + len(done)
                    if refetch:
                        state["cursor"] = end.isoformat()
            error = None
        except Exception as e:
            log.warning("Filling in past weather failed: %s", e)
            error = f"Open-Meteo's weather history couldn't be reached ({type(e).__name__})"
        with self._fill_lock:
            finished = not missing or error is not None
            state.update(
                running=not finished,
                error=error,
                last_run=int(self.clock()),
                added_days=state["added_days"] + added,
            )
            if finished:
                state.update(requested=False, refetch=False, cursor=None, finished_at=int(self.clock()))
        return added

    # ------------------------------------------------------------------ views
    def day(self, date: dt.date) -> dict[str, Any]:
        """A day's weather hour by hour, summed up, and its day-ahead solar forecast."""
        start = _local_midnight(date)
        end = _local_midnight(date + dt.timedelta(days=1))
        hours = self.repo.hours(start, end)
        forecasts = self.repo.forecasts(start, end)
        return {
            "date": date.isoformat(),
            "hours": [
                {k: h[k] for k in ("ts", "temp", "cloud", "code", "precip", "precip_prob", "wind", "is_day", "ghi")}
                | {"pv_forecast": forecasts.get(h["ts"])}
                for h in hours
            ],
            "summary": {
                **_summary(hours),
                "pv_forecast_kwh": round(sum(forecasts.values()), 1) if forecasts else None,
                "source": hours[0]["source"] if hours else None,
            },
        }

    def days(self, first: dt.date, end: dt.date) -> list[dict[str, Any]]:
        """Each day from `first` up to `end` that has weather, summed up (for a heatmap of the weather)."""
        by_date: dict[str, list[dict[str, Any]]] = {}
        for h in self.repo.hours(_local_midnight(first), _local_midnight(end)):
            by_date.setdefault(local_date(h["ts"]), []).append(h)
        return [{"date": d, **_summary(hours)} for d, hours in sorted(by_date.items())]

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
            "archive_from": ARCHIVE_FROM.isoformat(),
            "location_set": self.settings.location_set(),
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
