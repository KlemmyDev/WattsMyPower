"""
Solar and battery forecast for the next ~24 hours.

Weather comes from Open-Meteo (free, no API key). Solar per hour is modelled as
    pv_kwh = k * radiation_kwh_per_m2
where k starts at PV_KW * 0.8 and is then calibrated against what the inverter
actually produced over the last week (so orientation, shading and clipping are
absorbed without needing to be configured). Home use per hour comes from the
average load for that hour of day over the last two weeks. The battery is then
stepped forward hour by hour from its current charge.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from contextlib import closing

from . import config, db, settings

log = logging.getLogger(__name__)

CACHE_SECONDS = 1800
URL = ("https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
       "&hourly=shortwave_radiation,temperature_2m,weather_code,is_day,precipitation_probability"
       "&past_days=7&forecast_days=3&timezone=auto&timeformat=unixtime")

# Rough typical home use (kW) by hour, used until we have our own history for that hour.
DEFAULT_LOAD = [0.4, 0.35, 0.35, 0.35, 0.35, 0.4, 0.8, 1.5, 1.2, 0.7, 0.6, 0.6,
                0.7, 0.8, 0.7, 0.7, 0.9, 1.4, 2.2, 2.4, 2.0, 1.4, 0.8, 0.5]

_cache: dict = {"at": 0.0, "data": None, "where": None}


def _fetch_weather() -> dict | None:
    now = time.time()
    where = (settings.get("latitude"), settings.get("longitude"))
    if _cache["data"] is not None and _cache["where"] == where and now - _cache["at"] < CACHE_SECONDS:
        return _cache["data"]
    try:
        url = URL.format(lat=where[0], lon=where[1])
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.load(r)
        _cache.update(at=now, data=data, where=where)
    except Exception as e:  # keep serving the last good forecast
        log.warning("Open-Meteo fetch failed: %s", e)
        if _cache["data"] is None:
            return None
        _cache["at"] = now - CACHE_SECONDS + 300  # retry in 5 min
    return _cache["data"]


def _hours(weather: dict) -> list[dict]:
    """
    One entry per hour, keyed by the hour's *start*. Open-Meteo radiation is the
    mean over the preceding hour, so the value stamped 07:00 belongs to 06:00-07:00.
    """
    h = weather["hourly"]
    t = h["time"]
    out = []
    for i in range(1, len(t)):
        out.append({
            "ts": t[i - 1],
            "rad": (h["shortwave_radiation"][i] or 0) / 1000,  # kWh/m² over the hour
            "temp": h["temperature_2m"][i - 1],
            "code": h["weather_code"][i - 1],
            "is_day": h["is_day"][i - 1],
            "precip": h["precipitation_probability"][i - 1],
        })
    return out


def _calibrate(hours: list[dict], now: int) -> tuple[float, float]:
    """
    kWh of PV per kWh/m² of radiation, fitted on the past week's actual output.
    Works on 5-minute rollups against radiation interpolated between hourly means,
    so it starts adapting after ~30 minutes of daylight data instead of whole hours.
    Returns (k, hours of data it was fitted on).
    """
    default = config.PV_KW * 0.8
    past = [h for h in hours if h["ts"] < now]
    if len(past) < 2:
        return default, 0.0
    # hourly mean radiation (kW/m²), treated as the value at the middle of its hour
    mids = [(h["ts"] + 1800, h["rad"]) for h in past]

    def rad_at(t: float) -> float:
        if t <= mids[0][0]:
            return mids[0][1]
        for (t0, r0), (t1, r1) in zip(mids, mids[1:]):
            if t <= t1:
                return r0 + (r1 - r0) * (t - t0) / (t1 - t0)
        return mids[-1][1]

    with closing(db.connect(readonly=True)) as conn:
        rows = conn.execute("SELECT ts, pv_power FROM samples_5m WHERE ts >= ? AND ts < ? AND pv_power IS NOT NULL",
                            (past[0]["ts"], now - 300)).fetchall()
    pairs = [(pv / 1000, r) for ts, pv in rows if (r := rad_at(ts + 150)) >= 0.1]
    if len(pairs) < 6:
        return default, 0.0
    k = sum(a for a, _ in pairs) / sum(r for _, r in pairs)
    return min(max(k, 0.05 * config.PV_KW), 1.2 * config.PV_KW), round(len(pairs) / 12, 1)


def _load_profile(now: int) -> list[float]:
    """Average home use (kW) for each local hour of day over the last 14 days."""
    with closing(db.connect(readonly=True)) as conn:
        rows = conn.execute(
            "SELECT CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER), AVG(load_power), COUNT(*) "
            "FROM samples_5m WHERE ts >= ? GROUP BY 1", (now - 14 * 86400,)).fetchall()
    prof = list(DEFAULT_LOAD)
    for hr, avg, n in rows:
        if n >= 6 and avg is not None:  # at least half an hour of data for that hour
            prof[hr] = avg / 1000
    return prof


def _simulate(steps: list[dict], soc: float, cap: float, reserve: float) -> None:
    """Step the battery forward; writes soc_end (and grid) into each step. reserve is a fraction."""
    for s in steps:
        dt = s["dur"] / 3600
        net = (s["pv_kw"] - s["load_kw"]) * dt  # kWh
        if net >= 0:
            room = max(0.0, (1 - soc) * cap)
            rate_limited = min(net, config.BATTERY_MAX_KW * dt)
            charge = min(rate_limited, room)
            soc += charge / cap
            s["grid_kwh"] = -(net - charge)
            # share of the step it took to fill up, if it filled up in this step
            s["full_frac"] = charge / rate_limited if soc >= 0.999 and rate_limited > 0 else None
        else:
            avail = max(0.0, (soc - reserve) * cap)
            dis = min(-net, avail, config.BATTERY_MAX_KW * dt)
            soc -= dis / cap
            s["grid_kwh"] = -net - dis
            s["full_frac"] = None
        s["soc_end"] = min(1.0, max(0.0, soc))


def build(latest: dict | None, battery_kwh: float, reserve_pct: float) -> dict | None:
    if not config.FORECAST:
        return None
    weather = _fetch_weather()
    if weather is None:
        return None
    now = int(time.time())
    hours = _hours(weather)
    k, fitted = _calibrate(hours, now)
    prof = _load_profile(now)

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
    soc0 = (latest or {}).get("battery_soc")
    soc0 = (soc0 if soc0 is not None else 50) / 100
    _simulate(steps, soc0, cap, reserve_pct / 100)

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
    tomorrow_morning = _describe_morning(hours, lt)

    next24 = [s for s in steps if s["start"] < now + 24 * 3600]
    return {
        "generated_at": now,
        "calibration": {"kwh_per_kwh_m2": round(k, 2), "fitted_hours": fitted},
        "hours": [{
            "ts": s["ts"], "start": s["start"], "pv_kwh": round(s["pv_kw"] * s["dur"] / 3600, 2),
            "pv_kw": round(s["pv_kw"], 2), "load_kw": round(s["load_kw"], 2), "soc": round(s["soc_end"] * 100, 1),
            "grid_kwh": round(s["grid_kwh"], 2), "temp": s["temp"], "code": s["code"],
            "is_day": s["is_day"], "precip": s["precip"],
        } for s in steps],
        "summary": {
            "pv_kwh_24h": round(sum(s["pv_kw"] * s["dur"] / 3600 for s in next24), 1),
            "full_at": full_at,
            "min_soc_tonight": round(min(night) * 100) if night else None,
            "tomorrow_morning": tomorrow_morning,
        },
    }


RAIN_CODES = set(range(51, 68)) | set(range(80, 83)) | set(range(95, 100))


def _describe_morning(hours: list[dict], lt: time.struct_time) -> str:
    start = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + 1, 6, 0, 0, 0, 0, -1)))
    morning = [h for h in hours if start <= h["ts"] < start + 6 * 3600]
    if not morning:
        return "No forecast"
    wet = [h for h in morning if h["code"] in RAIN_CODES or (h["precip"] or 0) >= 50]
    if wet:
        fmt = lambda ts: time.strftime("%H:%M", time.localtime(ts))
        return f"Showers {fmt(wet[0]['ts'])} to {fmt(wet[-1]['ts'] + 3600)}"
    codes = [h["code"] for h in morning]
    avg = sum(codes) / len(codes)
    return "Sunny" if avg < 1.5 else "Partly cloudy" if avg < 2.5 else "Cloudy"
