"""
Longer-term figures for the Insights page.

Everything comes from our own history (5-minute rollups and the inverter's
daily counters) plus the inverter's lifetime counters in the latest snapshot.
Solar performance compares each day's output with what the weather allowed,
using past hourly radiation from Open-Meteo and a model of this system fitted
on the last ~90 days (so "100%" means "as well as this system usually does").
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from contextlib import closing

from . import db, settings

log = logging.getLogger(__name__)

# Average Australian grid emissions, kg CO2-e per kWh (National Greenhouse Accounts, scope 2).
CO2_KG_PER_KWH = 0.68
CACHE_SECONDS = 600
RAD_CACHE_SECONDS = 6 * 3600
RAD_URL = ("https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           "&hourly=shortwave_radiation&past_days=92&forecast_days=1&timezone=auto&timeformat=unixtime")

_cache: dict = {"at": 0.0, "data": None}
_rad: dict = {"at": 0.0, "where": None, "hours": None}


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


def _energy(rows: list[dict]) -> dict:
    """Totals over some days of daily counters. home = what the house used, from any source."""
    t = {"days": 0, "pv": 0.0, "imp": 0.0, "exp": 0.0, "chg": 0.0, "dis": 0.0, "home": 0.0, "pv_home": 0.0}
    for r in rows:
        pv, imp, exp = r["daily_pv"], r["daily_import"], r["daily_export"]
        if pv is None or imp is None or exp is None:
            continue
        chg, dis = r["daily_charge"] or 0, r["daily_discharge"] or 0
        t["days"] += 1
        t["pv"] += pv; t["imp"] += imp; t["exp"] += exp; t["chg"] += chg; t["dis"] += dis
        t["home"] += max(0.0, pv + imp - exp + dis - chg)
        t["pv_home"] += max(0.0, pv - exp)
    t["self_pct"] = round(max(0.0, min(100.0, (t["home"] - t["imp"]) / t["home"] * 100)), 1) if t["home"] >= 0.5 else None
    t["pv_home_pct"] = round(t["pv_home"] / t["pv"] * 100, 1) if t["pv"] >= 0.5 else None
    return t


def _battery_days(start: int, end: int) -> list[dict]:
    """Per local day: SoC swing and time spent full, for days with at least 80% of readings."""
    sql = ("SELECT date(ts, 'unixepoch', 'localtime') AS d, MAX(battery_soc) - MIN(battery_soc), "
           "SUM(battery_soc >= 99), COUNT(*) FROM samples_5m "
           "WHERE ts >= ? AND ts < ? AND battery_soc IS NOT NULL GROUP BY d")
    with closing(db.connect(readonly=True)) as conn:
        rows = conn.execute(sql, (start, end)).fetchall()
    return [{"date": d, "swing": swing, "full_min": full * 5} for d, swing, full, n in rows if n >= 230]


def _heatmap(start: int, end: int) -> dict:
    """Average grid import (kWh in the hour) and battery level for each month x hour of day."""
    sql = ("SELECT strftime('%Y-%m', ts, 'unixepoch', 'localtime') AS m, "
           "CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) AS h, "
           "AVG(MAX(grid_power, 0)), AVG(battery_soc), COUNT(*) FROM samples_5m "
           "WHERE ts >= ? AND ts < ? AND grid_power IS NOT NULL GROUP BY m, h")
    with closing(db.connect(readonly=True)) as conn:
        rows = conn.execute(sql, (start, end)).fetchall()
    out: dict = {}
    for m, h, imp, soc, n in rows:
        if n >= 6:  # at least half an hour of readings for that cell
            out.setdefault(m, [None] * 24)[h] = {"kwh": round(imp / 1000, 3), "soc": round(soc, 1) if soc is not None else None}
    return out


# ---------------------------------------------------------------------------
# Solar performance
# ---------------------------------------------------------------------------

def _radiation(now: int) -> list[tuple[int, float]] | None:
    """Past hourly radiation as (hour start, kWh/m²). Open-Meteo stamps each hour's mean at its end."""
    where = (settings.get("latitude"), settings.get("longitude"))
    if _rad["hours"] is not None and _rad["where"] == where and now - _rad["at"] < RAD_CACHE_SECONDS:
        return _rad["hours"]
    try:
        with urllib.request.urlopen(RAD_URL.format(lat=where[0], lon=where[1]), timeout=10) as r:
            h = json.load(r)["hourly"]
        t, rad = h["time"], h["shortwave_radiation"]
        _rad.update(at=now, where=where, hours=[(t[i - 1], (rad[i] or 0) / 1000) for i in range(1, len(t))])
    except Exception as e:
        log.warning("Open-Meteo radiation fetch failed: %s", e)
        if _rad["hours"] is None or _rad["where"] != where:
            return None
        _rad["at"] = now - RAD_CACHE_SECONDS + 600  # retry in 10 min
    return _rad["hours"]


def _performance(now: int, days: int = 30) -> dict | None:
    hours = _radiation(now)
    if not hours:
        return None
    hours = [(t, r) for t, r in hours if t + 3600 <= now]
    if not hours:
        return None
    # Hourly actual output, bucketed on the same hour boundaries as the radiation
    # (these can sit on the half hour in some time zones).
    off = hours[0][0] % 3600
    sql = (f"SELECT ((ts - {off}) / 3600) * 3600 + {off} AS h, AVG(pv_power), COUNT(*) FROM samples_5m "
           f"WHERE ts >= ? AND ts < ? AND pv_power IS NOT NULL GROUP BY h")
    with closing(db.connect(readonly=True)) as conn:
        actual = {h: pv / 1000 for h, pv, n in conn.execute(sql, (hours[0][0], hours[-1][0] + 3600)) if n >= 10}

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

    by_day: dict[str, dict] = {}
    for t, r in hours:
        d = by_day.setdefault(_day(t), {"actual": 0.0, "expected": 0.0, "rad": 0.0, "sun_hours": 0, "covered": 0})
        d["rad"] += r
        if r >= 0.05:
            d["sun_hours"] += 1
            if t in actual:
                d["covered"] += 1
                d["actual"] += actual[t]
                d["expected"] += min(k * r, clip)

    lt = time.localtime(now)  # the last `days` days, today included (judged on the hours so far)
    window = [_day(_ts(lt.tm_year, lt.tm_mon, lt.tm_mday - days + 1 + i)) for i in range(days)]
    brightest = max((by_day[d]["rad"] for d in window if d in by_day), default=0)
    out = []
    for d in window:
        v = by_day.get(d)
        ok = v and v["sun_hours"] and v["covered"] >= 0.8 * v["sun_hours"] and v["expected"] >= 0.5
        out.append({
            "date": d,
            "actual_kwh": round(v["actual"], 2) if ok else None,
            "expected_kwh": round(v["expected"], 2) if ok else None,
            "ratio": round(v["actual"] / v["expected"], 3) if ok else None,
            # Overcast days are too noisy to judge against modelled radiation.
            "clear": bool(ok and brightest and v["rad"] >= 0.6 * brightest),
        })
    return {"fitted_hours": len(pairs), "kwh_per_kwh_m2": round(k, 2), "limit_kw": round(clip, 2), "days": out}


# ---------------------------------------------------------------------------

def build(latest: dict | None, battery_kwh: float) -> dict:
    now = int(time.time())
    if _cache["data"] is not None and now - _cache["at"] < CACHE_SECONDS:
        return {**_cache["data"], "lifetime": _lifetime(latest, battery_kwh)}

    months = _last_months(now)
    start12 = _ts(*months[0])
    lt = time.localtime(now)
    start30 = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - 29)
    start60 = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - 59)
    daily = db.daily(min(start12, start60), now + 1)
    d30, dprev = _day(start30), _day(start60)
    last30 = [r for r in daily if r["date"] >= d30]
    prev30 = [r for r in daily if dprev <= r["date"] < d30]

    heat = _heatmap(start12, now + 1)
    month_rows = []
    for y, m in months:
        key = f"{y}-{m:02d}"
        e = _energy([r for r in daily if r["date"].startswith(key)])
        month_rows.append({"month": key, "days": e["days"], "self_pct": e["self_pct"], "heat": heat.get(key)})

    bat = _battery_days(start30, _ts(lt.tm_year, lt.tm_mon, lt.tm_mday))  # whole days only
    try:
        perf = _performance(now)
    except Exception as e:  # never let the performance model take the page down
        log.warning("Solar performance failed: %s", e)
        perf = None

    data = {
        "generated_at": now,
        "co2_kg_per_kwh": CO2_KG_PER_KWH,
        "last30": _energy(last30),
        "prev30": _energy(prev30),
        "months": month_rows,
        "battery": {
            "days": len(bat),
            "avg_swing": round(sum(b["swing"] for b in bat) / len(bat), 1) if bat else None,
            "avg_full_min": round(sum(b["full_min"] for b in bat) / len(bat)) if bat else None,
        },
        "performance": perf,
    }
    _cache.update(at=now, data=data)
    return {**data, "lifetime": _lifetime(latest, battery_kwh)}


def _lifetime(latest: dict | None, cap: float) -> dict:
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
        "co2_t": round(pv * CO2_KG_PER_KWH / 1000, 1) if pv else None,
    }
