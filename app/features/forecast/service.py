"""
Solar and battery forecast for the next ~24 hours.

Weather comes from Open-Meteo (free, no API key). Solar per hour is modelled as
    pv_kwh = k * radiation_kwh_per_m2
where k starts at the array size (Settings → System) * 0.8 and is then calibrated against what the inverter
actually produced over the last week (so orientation, shading and clipping are
absorbed without needing to be configured). Home use per hour comes from what
the house used in that hour of day over the last two weeks. The battery is then
stepped forward hour by hour from its current charge.

Both are fitted per day and then combined robustly (a median for solar, a trimmed
mean for home use), so one odd day, or a garbled reading that slipped through,
can't drag the forecast far from what the system really does.
"""

from __future__ import annotations

import logging
import statistics
import time
from collections import defaultdict
from itertools import pairwise
from typing import Any

from app.core.cache import TTLCache
from app.core.config import Config
from app.core.http import get_json
from app.features.forecast.repository import ForecastRepository
from app.features.readings.repository import ReadingsRepository, Snapshot
from app.features.settings.store import SettingsStore

log = logging.getLogger(__name__)

CACHE_SECONDS = 1800
RETRY_SECONDS = 300  # after a failed fetch, keep serving the last forecast this long before trying again
URL = (
    "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
    "&hourly=shortwave_radiation,temperature_2m,weather_code,is_day,precipitation_probability"
    "&past_days=7&forecast_days=3&timezone=auto&timeformat=unixtime"
)

# Rough typical home use (kW) by hour, used until we have our own history for that hour.
DEFAULT_LOAD = [0.4, 0.35, 0.35, 0.35, 0.35, 0.4, 0.8, 1.5, 1.2, 0.7, 0.6, 0.6,
                0.7, 0.8, 0.7, 0.7, 0.9, 1.4, 2.2, 2.4, 2.0, 1.4, 0.8, 0.5]  # fmt: skip

RAIN_CODES = set(range(51, 68)) | set(range(80, 83)) | set(range(95, 100))

Hour = dict[str, Any]
Where = tuple[float, float]

# Cache keys. The weather is one slot holding (where, data) for the last good fetch,
# so a change of location refetches, and a failed fetch can fall back to it.
_WEATHER = "weather"


def hours_from(weather: dict[str, Any]) -> list[Hour]:
    """
    One entry per hour, keyed by the hour's *start*. Open-Meteo radiation is the
    mean over the preceding hour, so the value stamped 07:00 belongs to 06:00-07:00.
    """
    h = weather["hourly"]
    t = h["time"]
    out = []
    for i in range(1, len(t)):
        out.append(
            {
                "ts": t[i - 1],
                "rad": (h["shortwave_radiation"][i] or 0) / 1000,  # kWh/m² over the hour
                "temp": h["temperature_2m"][i - 1],
                "code": h["weather_code"][i - 1],
                "is_day": h["is_day"][i - 1],
                "precip": h["precipitation_probability"][i - 1],
            }
        )
    return out


def trimmed_mean(values: list[float], cut: float = 0.2) -> float:
    """The mean after dropping the highest and lowest `cut` share of values (none when there are few)."""
    v = sorted(values)
    n = int(len(v) * cut)
    return statistics.fmean(v[n : len(v) - n] if len(v) - 2 * n > 0 else v)


def simulate(steps: list[Hour], soc: float, cap: float, reserve: float, max_kw: float) -> None:
    """Step the battery forward; writes soc_end (and grid) into each step. reserve is a fraction."""
    for s in steps:
        dt = s["dur"] / 3600
        net = (s["pv_kw"] - s["load_kw"]) * dt  # kWh
        if net >= 0:
            room = max(0.0, (1 - soc) * cap)
            rate_limited = min(net, max_kw * dt)
            charge = min(rate_limited, room)
            soc += charge / cap
            s["grid_kwh"] = -(net - charge)
            # share of the step it took to fill up, if it filled up in this step
            s["full_frac"] = charge / rate_limited if soc >= 0.999 and rate_limited > 0 else None
        else:
            avail = max(0.0, (soc - reserve) * cap)
            dis = min(-net, avail, max_kw * dt)
            soc -= dis / cap
            s["grid_kwh"] = -net - dis
            s["full_frac"] = None
        s["soc_end"] = min(1.0, max(0.0, soc))


def describe_morning(hours: list[Hour], lt: time.struct_time) -> str:
    start = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + 1, 6, 0, 0, 0, 0, -1)))
    morning = [h for h in hours if start <= h["ts"] < start + 6 * 3600]
    if not morning:
        return "No forecast"
    wet = [h for h in morning if h["code"] in RAIN_CODES or (h["precip"] or 0) >= 50]
    if wet:

        def fmt(ts: float) -> str:
            return time.strftime("%H:%M", time.localtime(ts))

        return f"Showers {fmt(wet[0]['ts'])} to {fmt(wet[-1]['ts'] + 3600)}"
    codes = [h["code"] for h in morning]
    avg = sum(codes) / len(codes)
    return "Sunny" if avg < 1.5 else "Partly cloudy" if avg < 2.5 else "Cloudy"


class ForecastService:
    def __init__(self, config: Config, readings: ReadingsRepository, settings: SettingsStore):
        self.config = config
        self.readings = readings
        self.settings = settings
        self.repo = ForecastRepository(readings.db)
        self._cache = TTLCache()

    # ------------------------------------------------------------------ weather
    def _fetch_weather(self) -> dict[str, Any] | None:
        where: Where = (self.settings.get("latitude"), self.settings.get("longitude"))
        _, hit = self._cache.get(_WEATHER, CACHE_SECONDS)
        if hit and hit[0] == where:
            return hit[1]
        try:
            data = get_json(URL.format(lat=where[0], lon=where[1]), timeout=10)
        except Exception as e:  # keep serving the last good forecast
            log.warning("Open-Meteo fetch failed: %s", e)
            _, last = self._cache.get(_WEATHER, float("inf"))
            if last is None:
                return None
            self._cache.set(_WEATHER, last, age=CACHE_SECONDS - RETRY_SECONDS)  # retry in 5 min
            return last[1]
        self._cache.set(_WEATHER, (where, data))
        return data

    # ------------------------------------------------------------------ model
    def _calibrate(self, hours: list[Hour], now: int) -> tuple[float, float]:
        """
        kWh of PV per kWh/m² of radiation, fitted on the past week's actual output.
        Works on 5-minute rollups against radiation interpolated between hourly means,
        so it starts adapting after ~30 minutes of daylight data instead of whole hours.
        Returns (k, hours of data it was fitted on).
        """
        pv_kw = self.settings.get("pv_kw")
        default = pv_kw * 0.8
        past = [h for h in hours if h["ts"] < now]
        if len(past) < 2:
            return default, 0.0
        # hourly mean radiation (kW/m²), treated as the value at the middle of its hour
        mids: list[tuple[float, float]] = [(h["ts"] + 1800, h["rad"]) for h in past]

        def rad_at(t: float) -> float:
            if t <= mids[0][0]:
                return mids[0][1]
            for (t0, r0), (t1, r1) in pairwise(mids):
                if t <= t1:
                    return r0 + (r1 - r0) * (t - t0) / (t1 - t0)
            return mids[-1][1]

        rows = self.readings.rollups(past[0]["ts"], now - 300, ["pv_power"], not_null="pv_power")
        # Output beyond what the array could ever make is a bad reading, not sunshine.
        ceiling = 1.5 * pv_kw * 1000
        by_day: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for ts, pv in rows:
            if 0 <= pv <= ceiling and (r := rad_at(ts + 150)) >= 0.1:
                by_day[time.strftime("%Y-%m-%d", time.localtime(ts))].append((pv / 1000, r))
        pairs = sum(len(p) for p in by_day.values())
        if pairs < 6:
            return default, 0.0
        # One fit per day with at least an hour of daylight data, then the median day: a day of
        # bad readings (or panels covered in hail) moves it far less than it would a single fit.
        days = [sum(a for a, _ in p) / sum(r for _, r in p) for p in by_day.values() if len(p) >= 12]
        if days:
            k = statistics.median(days)
        else:  # under an hour of data on any one day: fit it all at once
            every = [x for p in by_day.values() for x in p]
            k = sum(a for a, _ in every) / sum(r for _, r in every)
        return min(max(k, 0.05 * pv_kw), 1.2 * pv_kw), round(pairs / 12, 1)

    def _load_profile(self, now: int) -> list[float]:
        """Typical home use (kW) for each local hour of day over the last 14 days.

        Each hour's figure is the mean across days after dropping the highest and lowest fifth, so
        a one-off (guests, a long car charge) or a bad reading doesn't set what every day expects,
        while loads that happen most days still count in full.
        """
        by_hour: dict[int, list[float]] = defaultdict(list)
        for _, hr, avg, n in self.repo.hourly_load(now - 14 * 86400):
            if n >= 6:  # at least half an hour of data for that hour
                by_hour[hr].append(avg / 1000)
        prof = list(DEFAULT_LOAD)
        for hr, days in by_hour.items():
            prof[hr] = trimmed_mean(days)
        return prof

    def build(self, latest: Snapshot | None, battery_kwh: float, reserve_pct: float) -> dict[str, Any] | None:
        if not self.config.forecast:
            return None
        weather = self._fetch_weather()
        if weather is None:
            return None
        now = int(time.time())
        hours = hours_from(weather)
        k, fitted = self._calibrate(hours, now)
        prof = self._load_profile(now)

        # Steps: the rest of the current hour, then whole hours for ~36 h.
        steps = []
        for h in hours:
            end = h["ts"] + 3600
            if end <= now or h["ts"] > now + 36 * 3600:
                continue
            start = max(h["ts"], now)
            hr = time.localtime(h["ts"]).tm_hour
            steps.append({**h, "start": start, "dur": end - start, "pv_kw": k * h["rad"], "load_kw": prof[hr]})

        cap = battery_kwh or 10.0
        soc_pct = (latest or {}).get("battery_soc")
        soc0 = (soc_pct if soc_pct is not None else 50) / 100
        simulate(steps, soc0, cap, reserve_pct / 100, self.settings.get("battery_max_kw"))

        # When does it reach full? Interpolate inside the hour it tops out.
        full_at = None
        if soc0 < 0.995:
            for s in steps:
                if s["soc_end"] >= 0.995:
                    frac = s["full_frac"] if s["full_frac"] is not None else 1
                    full_at = int(s["start"] + s["dur"] * min(1, frac))
                    break

        # "Tonight": lowest charge between now and 09:00 tomorrow.
        lt = time.localtime(now)
        nine_tomorrow = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + 1, 9, 0, 0, 0, 0, -1)))
        night = [s["soc_end"] for s in steps if s["start"] < nine_tomorrow]
        tomorrow_morning = describe_morning(hours, lt)

        next24 = [s for s in steps if s["start"] < now + 24 * 3600]
        return {
            "generated_at": now,
            "calibration": {"kwh_per_kwh_m2": round(k, 2), "fitted_hours": fitted},
            "hours": [
                {
                    "ts": s["ts"],
                    "start": s["start"],
                    "pv_kwh": round(s["pv_kw"] * s["dur"] / 3600, 2),
                    "pv_kw": round(s["pv_kw"], 2),
                    "load_kw": round(s["load_kw"], 2),
                    "soc": round(s["soc_end"] * 100, 1),
                    "grid_kwh": round(s["grid_kwh"], 2),
                    "temp": s["temp"],
                    "code": s["code"],
                    "is_day": s["is_day"],
                    "precip": s["precip"],
                }
                for s in steps
            ],
            "summary": {
                "pv_kwh_24h": round(sum(s["pv_kw"] * s["dur"] / 3600 for s in next24), 1),
                "full_at": full_at,
                "min_soc_tonight": round(min(night) * 100) if night else None,
                "tomorrow_morning": tomorrow_morning,
            },
        }
