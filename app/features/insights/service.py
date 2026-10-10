"""
Longer-term figures for the Solar and Battery pages (the insights feature).

Everything comes from our own history (5-minute rollups and the inverter's
daily counters) plus the inverter's lifetime counters in the latest snapshot.
Solar performance compares each day's output with what the weather allowed,
using past hourly radiation from Open-Meteo and a model of this system fitted
on the last ~90 days (so "100%" means "as well as this system usually does"),
with the likely causes of a shortfall and a monthly trend (see performance.py).
The battery's health and efficiency month by month, its warranty, and whether a
bigger one would pay are in battery.py.
"""

from __future__ import annotations

import datetime as dt
import logging
import time
from typing import Any

from app.core.cache import TTLCache
from app.core.database import Database
from app.core.http import get_json
from app.features.amber.repository import PriceRepository
from app.features.forecast.service import ForecastService
from app.features.insights import battery, performance
from app.features.insights.repository import InsightsRepository
from app.features.readings.repository import ReadingsRepository, Snapshot
from app.features.settings.store import SettingsStore
from app.features.tariffs.costs import Pricer
from app.features.tariffs.store import TariffStore
from app.features.weather.service import WeatherService

log = logging.getLogger(__name__)

CACHE_SECONDS = 600
RAD_CACHE_SECONDS = 6 * 3600
RAD_RETRY_SECONDS = 600  # after a failed fetch, keep serving the last radiation this long before trying again
RAD_URL = (
    "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
    "&hourly=shortwave_radiation&past_days=92&forecast_days=1&timezone=auto&timeformat=unixtime"
)

Radiation = list[tuple[int, float]]
Where = tuple[float, float]

# Cache keys. Radiation is one slot holding (where, hours) for the last good fetch, so a
# change of location refetches; a failed fetch falls back to it only for the same location.
_RESULT = "insights"
_RAD = "radiation"


def _ts(y: int, m: int, d: int = 1) -> int:
    return int(time.mktime((y, m, d, 0, 0, 0, 0, 0, -1)))


def _day(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def _last_months(now: int, n: int = 12) -> list[tuple[int, int]]:
    lt = time.localtime(now)
    out = []
    for k in range(n - 1, -1, -1):
        y, m = lt.tm_year, lt.tm_mon - k
        while m <= 0:
            y, m = y - 1, m + 12
        out.append((y, m))
    return out


def energy(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Totals over some days of daily counters. home = what the house used, from any source."""
    t: dict[str, Any] = {
        "days": 0,
        "pv": 0.0,
        "imp": 0.0,
        "exp": 0.0,
        "chg": 0.0,
        "dis": 0.0,
        "home": 0.0,
        "pv_home": 0.0,
    }
    for r in rows:
        pv, imp, exp = r["daily_pv"], r["daily_import"], r["daily_export"]
        if pv is None or imp is None or exp is None:
            continue
        chg, dis = r["daily_charge"] or 0, r["daily_discharge"] or 0
        t["days"] += 1
        t["pv"] += pv
        t["imp"] += imp
        t["exp"] += exp
        t["chg"] += chg
        t["dis"] += dis
        t["home"] += max(0.0, pv + imp - exp + dis - chg)
        t["pv_home"] += max(0.0, pv - exp)
    t["self_pct"] = (
        round(max(0.0, min(100.0, (t["home"] - t["imp"]) / t["home"] * 100)), 1) if t["home"] >= 0.5 else None
    )
    t["pv_home_pct"] = round(t["pv_home"] / t["pv"] * 100, 1) if t["pv"] >= 0.5 else None
    return t


def lifetime(latest: Snapshot | None, cap: float) -> dict[str, Any]:
    """From the inverter's own lifetime counters, so these are right from the first reading."""
    p = latest or {}
    chg, dis, pv = p.get("total_charge"), p.get("total_discharge"), p.get("total_pv")
    return {
        "battery_kwh": cap or None,
        "soh": p.get("battery_soh"),
        "pv_kwh": pv,
        "charge_kwh": chg,
        "discharge_kwh": dis,
        "cycles": round(dis / cap) if dis and cap else None,
        "round_trip_pct": round(dis / chg * 100, 1) if dis and chg else None,
    }


class InsightsService:
    def __init__(
        self,
        db: Database,
        readings: ReadingsRepository,
        settings: SettingsStore,
        weather: WeatherService | None = None,
        forecast: ForecastService | None = None,
        tariffs: TariffStore | None = None,
        prices: PriceRepository | None = None,
    ):
        self.repo = InsightsRepository(db)
        self.readings = readings
        self.settings = settings
        self.weather = weather  # stored weather: rain for the dust check
        self.forecast = forecast  # stored weather hours with what the panels made: the monthly trend
        self.tariffs = tariffs  # rates, for what a bigger battery would save
        self.prices = prices  # Amber's stored prices, for an Amber tariff
        self._cache = TTLCache()
        self._battery_kwh = 0.0  # the capacity and backup reserve in use, as last asked for
        self._reserve: float | None = None

    def build(self, latest: Snapshot | None, battery_kwh: float, reserve: float | None = None) -> dict[str, Any]:
        # The history figures are cached; lifetime counters come from the latest snapshot every time.
        if battery_kwh:
            self._battery_kwh = battery_kwh
        if reserve is not None:
            self._reserve = reserve
        data = self._cache.get_or_load(_RESULT, CACHE_SECONDS, self._history)
        life = lifetime(latest, battery_kwh)
        return {**data, "lifetime": life, "warranty": self._warranty(life, int(time.time()))}

    def forget_history(self) -> None:
        """Recompute the history figures on the next request (after history was imported or removed)."""
        self._cache.forget(_RESULT)

    def _history(self) -> dict[str, Any]:
        now = int(time.time())
        months = _last_months(now)
        start12 = _ts(*months[0])
        lt = time.localtime(now)
        start30 = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - 29)
        start60 = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - 59)
        daily = self.readings.daily(min(start12, start60), now + 1)
        d30, dprev = _day(start30), _day(start60)
        last30 = [r for r in daily if r["date"] >= d30]
        prev30 = [r for r in daily if dprev <= r["date"] < d30]

        month_rows = []
        for y, m in months:
            key = f"{y}-{m:02d}"
            e = energy([r for r in daily if r["date"].startswith(key)])
            month_rows.append({"month": key, "days": e["days"], "self_pct": e["self_pct"]})

        bat = self.repo.battery_days(start30, _ts(lt.tm_year, lt.tm_mon, lt.tm_mday))  # whole days only
        try:
            perf = self._performance(now)
        except Exception as e:  # never let the performance model take the page down
            log.warning("Solar performance failed: %s", e)
            perf = None
        try:
            trend = self._trend(now, perf)
        except Exception as e:
            log.warning("Solar trend failed: %s", e)
            trend = None
        cap = self._battery_kwh or self.settings.get("battery_kwh_override")
        soh = {m: v for m, v in self.repo.monthly_soh(start12, now + 1).items()}
        battery_months = [
            battery.month_row(key, [r for r in daily if r["date"].startswith(key)], soh.get(key), cap)
            for key in (f"{y}-{m:02d}" for y, m in months)
        ]
        try:
            sizing = self._sizing(now, cap)
        except Exception as e:
            log.warning("Battery sizing failed: %s", e)
            sizing = None

        return {
            "generated_at": now,
            "last30": energy(last30),
            "prev30": energy(prev30),
            "months": month_rows,
            "battery": {
                "days": len(bat),
                "avg_swing": round(sum(b["swing"] for b in bat) / len(bat), 1) if bat else None,
                "avg_full_min": round(sum(b["full_min"] for b in bat) / len(bat)) if bat else None,
                "months": battery_months,
            },
            "performance": perf,
            "trend": trend,
            "sizing": sizing,
        }

    # ------------------------------------------------------------------ solar performance
    def _radiation(self) -> Radiation | None:
        """Past hourly radiation as (hour start, kWh/m²), None without a location. Open-Meteo stamps each hour's
        mean at its end."""
        where: Where | None = self.settings.location()
        if where is None:
            return None
        _, hit = self._cache.get(_RAD, RAD_CACHE_SECONDS)
        if hit and hit[0] == where:
            return hit[1]
        try:
            h = get_json(RAD_URL.format(lat=where[0], lon=where[1]), timeout=10)["hourly"]
            t, rad = h["time"], h["shortwave_radiation"]
            hours: Radiation = [(t[i - 1], (rad[i] or 0) / 1000) for i in range(1, len(t))]
        except Exception as e:
            log.warning("Open-Meteo radiation fetch failed: %s", e)
            _, last = self._cache.get(_RAD, float("inf"))
            if last is None or last[0] != where:
                return None
            self._cache.set(_RAD, last, age=RAD_CACHE_SECONDS - RAD_RETRY_SECONDS)  # retry in 10 min
            return last[1]
        self._cache.set(_RAD, (where, hours))
        return hours

    def _performance(self, now: int, days: int = 30) -> dict[str, Any] | None:
        hours = self._radiation()
        if not hours:
            return None
        hours = [(t, r) for t, r in hours if t + 3600 <= now]
        if not hours:
            return None
        # Hourly actual output, bucketed on the same hour boundaries as the radiation
        # (these can sit on the half hour in some time zones).
        actual = self.repo.hourly_pv(hours[0][0] % 3600, hours[0][0], hours[-1][0] + 3600)

        pairs = [(actual[t], r) for t, r in hours if t in actual and r >= 0.1]
        if len(pairs) < 12:
            return {"fitted_hours": len(pairs), "days": []}
        # Fit kWh per kWh/m² on hours the inverter wasn't limiting, chosen by radiation
        # (not by output, which would bias the fit low).
        clip = max(a for a, _ in pairs)
        k = sum(a for a, _ in pairs) / sum(r for _, r in pairs)
        for _ in range(2):
            free = [(a, r) for a, r in pairs if k * r < 0.85 * clip]
            if len(free) >= 12:
                k = sum(a for a, _ in free) / sum(r for _, r in free)

        by_day: dict[str, dict[str, Any]] = {}
        modelled: list[tuple[int, float, float | None]] = []  # (hour, kWh without the limit, kWh made)
        for t, r in hours:
            day = by_day.setdefault(_day(t), {"actual": 0.0, "expected": 0.0, "rad": 0.0, "sun_hours": 0, "covered": 0})
            day["rad"] += r
            if r >= 0.05:
                day["sun_hours"] += 1
                modelled.append((t, k * r, actual.get(t)))
                if t in actual:
                    day["covered"] += 1
                    day["actual"] += actual[t]
                    day["expected"] += min(k * r, clip)

        lt = time.localtime(now)  # the last `days` days, today included (judged on the hours so far)
        since = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - days + 1)
        window = [_day(_ts(lt.tm_year, lt.tm_mon, lt.tm_mday - days + 1 + i)) for i in range(days)]
        brightest = max((by_day[d]["rad"] for d in window if d in by_day), default=0)

        def row(d: str) -> dict[str, Any]:
            v = by_day.get(d)
            ok = v and v["sun_hours"] and v["covered"] >= 0.8 * v["sun_hours"] and v["expected"] >= 0.5
            return {
                "date": d,
                "actual_kwh": round(v["actual"], 2) if ok and v else None,
                "expected_kwh": round(v["expected"], 2) if ok and v else None,
                "ratio": round(v["actual"] / v["expected"], 3) if ok and v else None,
                # Overcast days are too noisy to judge against modelled radiation.
                "clear": bool(ok and v and brightest and v["rad"] >= 0.6 * brightest),
            }

        # Shade shows in hours the inverter wasn't limiting, bright enough to judge.
        unlimited = [(t, m, a) for t, m, a in modelled if m >= 0.2 * clip and m < 0.9 * clip]
        causes = {
            "capped": performance.capped(modelled, clip, since),
            "dust": performance.dust([row(d) for d in sorted(by_day)], self._rain(hours[0][0], now), window[0]),
            "shade": performance.shade(unlimited, now - performance.RECENT_DAYS * 86400),
        }
        return {
            "fitted_hours": len(pairs),
            "kwh_per_kwh_m2": round(k, 2),
            "limit_kw": round(clip, 2),
            "days": [row(d) for d in window],
            "causes": causes,
        }

    def _rain(self, start: int, end: int) -> dict[str, float]:
        """Each day's rain (mm) from the stored weather."""
        if self.weather is None:
            return {}
        days = self.weather.days(dt.date.fromtimestamp(start), dt.date.fromtimestamp(end) + dt.timedelta(1))
        return {d["date"]: d["rain_mm"] for d in days if d.get("rain_mm") is not None}

    # ------------------------------------------------------------------ the longer run
    def _trend(self, now: int, perf: dict[str, Any] | None) -> dict[str, Any] | None:
        """The performance ratio month by month over the last year, and its change per year."""
        if self.forecast is None:
            return None
        lt = time.localtime(now)
        start = _ts(lt.tm_year - 1, lt.tm_mon + 1)
        pv_kw = self.settings.get("pv_kw")
        cap = perf.get("limit_kw") if perf else None
        months = performance.monthly(self.forecast.samples(start, now), pv_kw, cap)
        return {"months": months, "per_year": performance.trend(months), "pv_kw": pv_kw}

    def _sizing(self, now: int, cap: float) -> dict[str, Any] | None:
        """How the battery's size suits the house over the last 90 days, and what a bigger one would save."""
        if not cap:
            return None
        start = now - battery.SIZING_DAYS * 86400
        rows = self.readings.rollups(start, now, ["grid_power", "battery_soc"])
        if not rows:
            return None
        pricer = None
        if self.tariffs is not None:
            t, tables = self.tariffs.current()
            pricer = Pricer(t, tables, self.prices, start, now)
        reserve = self._reserve if self._reserve is not None else self.settings.get("battery_reserve_fallback")
        return battery.sizing(rows, cap, self.settings.get("battery_max_kw"), reserve, pricer)

    def _warranty(self, life: dict[str, Any], now: int) -> dict[str, Any] | None:
        """How much of the battery's warranty is used: by years since it went in, and by energy delivered."""
        installed = self.settings.get("battery_installed") or self.settings.get("system_installed")
        return battery.warranty(
            installed or None,
            self.settings.get("battery_warranty_years") or None,
            self.settings.get("battery_warranty_mwh") or None,
            life.get("discharge_kwh"),
            now,
        )
