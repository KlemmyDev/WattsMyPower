"""
Solar and battery forecast for the next ~24 hours.

Weather comes from Open-Meteo (free, no API key), through the stored weather (app.features.weather).
Solar per hour is modelled one of two ways:

  - plainly, as pv_kwh = k * radiation_kwh_per_m2, where k starts at the array size (Settings →
    System) * 0.8 and is then calibrated against what the inverter actually produced over the
    last week (so orientation, shading and clipping are roughly absorbed without being configured);
  - or by the model learned from weather history (app.features.forecast.learning), once it has
    shown in a back-test that it's the more accurate, and while Settings leaves learning on.

Home use per hour comes from what the house used in that hour of day over the last two weeks. The
battery is then stepped forward hour by hour from its current charge.

Both are fitted per day and then combined robustly (a median for solar, a trimmed
mean for home use), so one odd day, or a garbled reading that slipped through,
can't drag the forecast far from what the system really does.
"""

from __future__ import annotations

import json
import logging
import statistics
import threading
import time
from collections import defaultdict
from itertools import pairwise
from typing import Any

from app.core.config import Config
from app.features.forecast import learning
from app.features.forecast.learning import Backtest, Sample, SolarModel
from app.features.forecast.repository import ForecastRepository
from app.features.readings.repository import ReadingsRepository, Snapshot
from app.features.settings.store import SettingsStore
from app.features.weather.repository import local_date
from app.features.weather.service import WeatherService

log = logging.getLogger(__name__)

MODEL_KEY = "forecast_model"  # kv: the learned model, its back-test and what it was trained on
RETRAIN_SECONDS = 20 * 3600
TRAIN_DAYS = 730  # weather history the model learns from, at most
RETRAIN_ON_NEW = 7 * 24  # hours of weather history added since training (filled in) that retrain it early

# Rough typical home use (kW) by hour, used until we have our own history for that hour.
DEFAULT_LOAD = [0.4, 0.35, 0.35, 0.35, 0.35, 0.4, 0.8, 1.5, 1.2, 0.7, 0.6, 0.6,
                0.7, 0.8, 0.7, 0.7, 0.9, 1.4, 2.2, 2.4, 2.0, 1.4, 0.8, 0.5]  # fmt: skip

RAIN_CODES = set(range(51, 68)) | set(range(80, 83)) | set(range(95, 100))

Hour = dict[str, Any]


def hour_of(row: dict[str, Any]) -> Hour:
    """A stored weather hour (keyed by its start) in the forecast's terms."""
    return {
        "ts": row["ts"],
        "rad": (row.get("ghi") or 0) / 1000,  # kWh/m² over the hour
        "temp": row.get("temp"),
        "code": row.get("code"),
        "is_day": row.get("is_day"),
        "precip": row.get("precip_prob"),
        "weather": row,
    }


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
    codes = [h["code"] for h in morning if h["code"] is not None]
    if not codes:
        return "No forecast"
    avg = sum(codes) / len(codes)
    return "Sunny" if avg < 1.5 else "Partly cloudy" if avg < 2.5 else "Cloudy"


class ForecastService:
    def __init__(self, config: Config, readings: ReadingsRepository, settings: SettingsStore, weather: WeatherService):
        self.config = config
        self.readings = readings
        self.settings = settings
        self.weather = weather
        self.repo = ForecastRepository(readings.db)
        self._model_lock = threading.Lock()
        self._learned: dict[str, Any] | None = None  # MODEL_KEY's value, once read

    # ------------------------------------------------------------------ weather
    def _hours(self, now: int) -> list[Hour]:
        """The last week and the next few days of hourly weather, refreshing the forecast if it's stale."""
        self.weather.ensure_fresh()
        rows = self.weather.hours(now - 7 * 86400 - 3600, now + 3 * 86400)
        return [hour_of(r) for r in rows]

    # ------------------------------------------------------------------ the learned model
    def _signature(self) -> list[Any]:
        """What the model's sunlight figures depend on: retrain when any of it changes."""
        p = self.weather.panels()
        return [round(p.latitude, 2), round(p.longitude, 2), p.tilt, p.bearing, self.settings.get("pv_kw")]

    def learned(self) -> dict[str, Any] | None:
        """The stored model and its back-test, as saved by train()."""
        with self._model_lock:
            if self._learned is None:
                with self.readings.db.reading() as conn:
                    row = conn.execute("SELECT value FROM kv WHERE key = ?", (MODEL_KEY,)).fetchone()
                self._learned = json.loads(row[0]) if row else {}
            return self._learned or None

    def samples(self, start: int, end: int) -> list[Sample]:
        """Stored weather hours in [start, end) as the model sees them, with what the panels made in each."""
        panels = self.weather.panels()
        rows = self.weather.hours(start, end)
        if not rows:
            return []
        made: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])  # hour -> [W sum, rollups, full]
        align = rows[0]["ts"] % 3600  # weather hours sit on the half hour in some time zones
        for ts, pv, soc in self.weather.repo.solar_rollups(start, end):
            h = ts - (ts - align) % 3600
            m = made[h]
            m[0] += pv
            m[1] += 1
            m[2] = max(m[2], 1.0 if soc is not None and soc >= 98 else 0.0)
        out = []
        for row in rows:
            s = learning.sample(row, panels, local_date(row["ts"]))
            hour = made.get(row["ts"])
            if hour and hour[1] >= 10:  # at least 50 minutes of readings in the hour
                s.actual = hour[0] / hour[1] / 1000  # mean kW over the hour = kWh
                s.full = bool(hour[2])
            out.append(s)
        return out

    def train(self, now: int | None = None) -> dict[str, Any]:
        """Fit the model on stored weather and readings, back-test it, and save both. Blocking."""
        now = int(now or time.time())
        pv_kw = self.settings.get("pv_kw")
        samples = [s for s in self.samples(now - TRAIN_DAYS * 86400, now) if s.ts + 3600 <= now]
        model = learning.fit(samples, pv_kw)
        test = learning.backtest(samples, pv_kw) if model else Backtest()
        days = {s.day for s in samples if s.actual is not None}
        saved = {
            "trained_at": now,
            "weather_hours": self.weather.repo.coverage()["hours"],
            "signature": self._signature(),
            "days": len(days),
            "first_day": min(days) if days else None,
            "model": model.to_json() if model else None,
            "backtest": test.to_json(),
            "better": test.better,
        }
        with self.readings.db.writing() as conn:
            conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (MODEL_KEY, json.dumps(saved)))
        with self._model_lock:
            self._learned = saved
        return saved

    def _active_model(self) -> SolarModel | None:
        """The learned model, if learning is on and it beat the plain forecast."""
        if not self.settings.get("forecast_learning"):
            return None
        saved = self.learned()
        if not saved or not saved.get("better") or not saved.get("model"):
            return None
        if saved.get("signature") != self._signature():
            return None  # the panels or location changed: wait for it to be retrained
        return SolarModel.from_json(saved["model"])

    def tick(self, now: int | None = None) -> None:
        """After each weather refresh: retrain if due, and keep the day-ahead forecast. Blocking."""
        now = int(now or time.time())
        saved = self.learned()
        if (
            not saved
            or now - saved.get("trained_at", 0) >= RETRAIN_SECONDS
            or saved.get("signature") != self._signature()
            # A week or more of history filled in since (say, after an import): learn from it now.
            or self.weather.repo.coverage()["hours"] - saved.get("weather_hours", 0) >= RETRAIN_ON_NEW
        ):
            self.train(now)
        hours = self._hours(now)
        ahead = [h for h in hours if h["ts"] > now]
        if ahead:
            k, _ = self._calibrate(hours, now)
            model = self._active_model()
            self.weather.repo.log_forecast(
                [(h["ts"], self._pv_kw(h, k, model)) for h in ahead], now, "learned" if model else "simple"
            )

    def _pv_kw(self, hour: Hour, k: float, model: SolarModel | None) -> float:
        """Forecast solar (mean kW, so kWh) for an hour."""
        if model is None:
            return k * hour["rad"]
        panels = self.weather.panels()
        return model.predict(learning.sample(hour["weather"], panels, local_date(hour["ts"])))

    def accuracy(self, now: int | None = None, days: int = 30) -> dict[str, Any]:
        """How close the day-ahead forecast came, day by day, over the last `days` full days."""
        now = int(now or time.time())
        lt = time.localtime(now)
        end = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))
        start = end - days * 86400 - 3600
        forecasts = self.weather.repo.forecasts(start, end)
        samples = {s.ts: s for s in self.samples(start, end)}
        by_day: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])  # forecast, actual, hours
        for ts, kwh in forecasts.items():
            s = samples.get(ts)
            if s is None or s.actual is None:
                continue
            d = by_day[s.day]
            d[0] += kwh
            d[1] += s.actual
            d[2] += 1
        out: list[dict[str, Any]] = [
            {"date": day, "forecast_kwh": round(f, 2), "actual_kwh": round(a, 2)}
            for day, (f, a, n) in sorted(by_day.items())
            if n >= 8 and a >= 0.5
        ]
        n = len(out)
        return {
            "days": out,
            "mae_kwh": round(sum(abs(d["forecast_kwh"] - d["actual_kwh"]) for d in out) / n, 2) if n else None,
            "bias_kwh": round(sum(d["forecast_kwh"] - d["actual_kwh"] for d in out) / n, 2) if n else None,
            "actual_mean": round(sum(d["actual_kwh"] for d in out) / n, 2) if n else None,
        }

    # ------------------------------------------------------------------ model
    def _model_view(self, model: SolarModel | None) -> dict[str, Any]:
        saved = self.learned() or {}
        return {
            "kind": "learned" if model else "simple",
            "days": saved.get("days", 0),
            "backtest": {k: v for k, v in (saved.get("backtest") or {}).items() if k != "per_day"},
        }

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
        now = int(time.time())
        hours = self._hours(now)
        if not any(h["ts"] + 3600 > now for h in hours):
            return None  # no forecast stored for the hours to come
        k, fitted = self._calibrate(hours, now)
        model = self._active_model()
        prof = self._load_profile(now)

        # Steps: the rest of the current hour, then whole hours for ~36 h.
        steps = []
        for h in hours:
            end = h["ts"] + 3600
            if end <= now or h["ts"] > now + 36 * 3600:
                continue
            start = max(h["ts"], now)
            hr = time.localtime(h["ts"]).tm_hour
            steps.append(
                {**h, "start": start, "dur": end - start, "pv_kw": self._pv_kw(h, k, model), "load_kw": prof[hr]}
            )

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
            "model": self._model_view(model),
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
