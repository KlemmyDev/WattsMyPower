"""
Where the home's power went: everything the home used (from the inverter, as Bills counts it), what each device
measured of it, and the rest ("everything else": what no device measures). And each device's habits: when it
usually runs, and what it uses through the day and the week.

The home's use for a day is the inverter's counters (solar + imported − exported + from the battery − into it),
as in app.features.tariffs.costs, or, for a day without them, its 5-minute readings added up. By the hour, it's
the readings, scaled to the day's counters. A device's energy is its own (app.features.home.energy), and is part of
the home's, never added to it: "everything else" is the home's less what the devices measured. Hidden devices are
left out.
"""

from __future__ import annotations

import time
from collections import defaultdict
from statistics import mean
from typing import Any, Literal

from app.features.home.repository import HomeRepository
from app.features.readings.repository import KWH_PER_W_ROLLUP, ReadingsRepository

Bucket = Literal["hour", "day"]
PATTERN_DAYS = 56  # how far back a device's habits are judged from (eight weeks)


def bucket_start(ts: int, by: Bucket) -> int:
    """The start of the local hour or day `ts` is in (an hour starts at :30 UTC where the offset has a half hour)."""
    lt = time.localtime(ts)
    if by == "hour":
        return ts - lt.tm_min * 60 - lt.tm_sec
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))


def buckets(start: int, end: int, by: Bucket) -> list[int]:
    """The start of every local hour or day overlapping [start, end) (days by the calendar: a daylight-saving day is
    one, of 23 or 25 hours)."""
    out, b = [], bucket_start(start, by)
    while b < end:
        out.append(b)
        b = bucket_start(b + (3600 if by == "hour" else 26 * 3600), by)
    return out


def counted_home(c: dict[str, Any]) -> float | None:
    """What the home used in a day by the inverter's daily counters (as History, the Overview and Bills count it):
    solar + imported − exported + from the battery − into it. None without them."""
    if c.get("daily_pv") is None or c.get("daily_import") is None or c.get("daily_export") is None:
        return None
    return max(
        0.0,
        c["daily_pv"]
        + c["daily_import"]
        - c["daily_export"]
        + (c.get("daily_discharge") or 0)
        - (c.get("daily_charge") or 0),
    )


def home_use(readings: ReadingsRepository, start: int, end: int, by: Bucket) -> dict[int, float]:
    """What the home used in each local hour or day of [start, end), kWh. Only buckets with readings.

    A day is the inverter's counters. By the hour, the readings give the shape through the day, scaled so a day's
    hours add up to what its counters say (as Bills splits a day between rates), so the Home page's total is the
    Overview's and History's. A day without counters is its readings as they are."""
    readings_kwh: dict[int, float] = defaultdict(float)
    for ts, pv, grid, bat in readings.rollups(start, end, ["pv_power", "grid_power", "battery_power"]):
        readings_kwh[bucket_start(ts, by)] += max(0.0, (pv or 0) + (grid or 0) + (bat or 0)) * KWH_PER_W_ROLLUP
    counted: dict[int, float] = {}
    for c in readings.daily(start, end):
        if (kwh := counted_home(c)) is not None:
            counted[int(time.mktime(time.strptime(c["date"], "%Y-%m-%d")))] = kwh
    if by == "day":
        return {**readings_kwh, **counted}
    out = dict(readings_kwh)
    for day, kwh in counted.items():
        hours = [b for b in readings_kwh if bucket_start(b, "day") == day]
        read = sum(readings_kwh[b] for b in hours)
        if read > 0:
            for b in hours:
                out[b] = readings_kwh[b] * kwh / read
    return out


def breakdown(
    repo: HomeRepository,
    readings: ReadingsRepository,
    start: int,
    end: int,
    by: Bucket,
    car: dict[int, float] | None = None,
) -> dict[str, Any]:
    """The home's use in each hour or day of [start, end), each visible device's share of it, the car's (`car`: W it
    drew in each 5-minute rollup, app.features.home.car; None without a car), and the rest. What's measured is the
    devices' and the car's together: everything that isn't the rest."""
    t = buckets(start, end, by)
    index = {b: i for i, b in enumerate(t)}
    home = home_use(readings, start, end, by)
    visible = {d.id: d for d in repo.devices() if not d.hidden}
    per: dict[int, list[float]] = {d: [0.0] * len(t) for d in visible}
    for ts, device, kwh in repo.energy(start, end):
        i = index.get(bucket_start(ts, by))
        if device in per and i is not None:
            per[device][i] += kwh
    runs: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in repo.runs(start, end):
        if r["end"] is not None:
            runs[r["device"]].append(r)

    measured = [sum(p[i] for p in per.values()) for i in range(len(t))]
    home_kwh = [round(home[b], 3) if b in home else None for b in t]
    charged = [0.0] * len(t)
    for ts, w in (car or {}).items():
        if (i := index.get(bucket_start(ts, by))) is not None:
            charged[i] += w * KWH_PER_W_ROLLUP
    # The car's is what's left of the home's after the devices, at most: never more than the home used.
    charged = [
        min(c, max(0.0, (h or 0.0) - m)) if h is not None else c
        for c, h, m in zip(charged, home_kwh, measured, strict=True)
    ]
    other = [
        None if h is None else round(max(0.0, h - m - c), 3)
        for h, m, c in zip(home_kwh, measured, charged, strict=True)
    ]
    devices = []
    for d in visible.values():
        done = runs.get(d.id, [])
        devices.append(
            {
                "id": d.id,
                "name": d.name,
                "kind": d.kind,
                "kwh": [round(v, 3) for v in per[d.id]],
                "total": round(sum(per[d.id]), 3),
                "runs": len(done),
                "run_kwh": round(mean(r["kwh"] for r in done), 3) if done else None,
                "run_minutes": round(mean((r["end"] - r["start"]) / 60 for r in done)) if done else None,
            }
        )
    known = [h for h in home_kwh if h is not None]
    return {
        "start": start,
        "end": end,
        "bucket": by,
        "t": t,
        "home": home_kwh,
        "other": other,
        "devices": devices,
        "car": {"kwh": [round(c, 3) for c in charged], "total": round(sum(charged), 3)} if car is not None else None,
        "total": {
            "home": round(sum(known), 3) if known else None,
            "measured": round(sum(measured) + sum(charged), 3),
            "other": round(sum(o for o in other if o is not None), 3) if known else None,
        },
    }


def car_as_shown(car: dict[int, float] | None, out: dict[str, Any]) -> dict[int, float] | None:
    """`car` (W in each rollup) scaled in each of `out`'s hours or days to what `breakdown` shows for it there (never
    more than the home used after the devices), so what it's priced on is what's shown."""
    if not car or out.get("car") is None:
        return car
    index = {b: i for i, b in enumerate(out["t"])}
    drew = [0.0] * len(out["t"])
    for ts, w in car.items():
        if (i := index.get(bucket_start(ts, out["bucket"]))) is not None:
            drew[i] += w * KWH_PER_W_ROLLUP
    shown = out["car"]["kwh"]
    fit = [min(1.0, s / d) if d > 0 else 0.0 for s, d in zip(shown, drew, strict=True)]
    return {ts: w * fit[i] for ts, w in car.items() if (i := index.get(bucket_start(ts, out["bucket"]))) is not None}


def patterns(repo: HomeRepository, now: int) -> list[dict[str, Any]]:
    """Each visible device's habits over the last PATTERN_DAYS (or since it was first read): what it uses on an
    average day, by weekday and through the day, and for appliances that run in cycles, which days and hours its
    runs start, how often, and what a run takes."""
    start = bucket_start(now - PATTERN_DAYS * 86400, "day")
    visible = {d.id: d for d in repo.devices() if not d.hidden}
    days: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))  # device -> day -> kWh
    hours: dict[int, list[float]] = defaultdict(lambda: [0.0] * 24)
    for ts, device, kwh in repo.energy(start, now):
        if device in visible:
            days[device][bucket_start(ts, "day")] += kwh
            hours[device][time.localtime(ts).tm_hour] += kwh
    runs: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in repo.runs(start, now):
        if r["end"] is not None and r["device"] in visible:
            runs[r["device"]].append(r)

    out = []
    for d in visible.values():
        counted = days.get(d.id, {})
        # Days it was being read: from its first, to today (a day it used nothing still counts, if it was read).
        first = min(counted, default=None)
        read = buckets(first, now, "day") if first is not None else []
        span = len(read)
        by_weekday = [0.0] * 7
        weekdays_seen = [0] * 7
        for day in read:
            wd = time.localtime(day).tm_wday
            weekdays_seen[wd] += 1
            by_weekday[wd] += counted.get(day, 0.0)
        done = runs.get(d.id, [])
        run_days = [0] * 7
        run_hours = [0] * 24
        for r in done:
            lt = time.localtime(r["start"])
            run_days[lt.tm_wday] += 1
            run_hours[lt.tm_hour] += 1
        out.append(
            {
                "id": d.id,
                "days": span,
                "daily_kwh": round(sum(counted.values()) / span, 3) if span else None,
                "by_weekday": [round(v / n, 3) if n else None for v, n in zip(by_weekday, weekdays_seen, strict=True)],
                "by_hour": [round(v / span, 4) if span else None for v in hours.get(d.id, [0.0] * 24)],
                "weekdays_seen": weekdays_seen,
                "runs": len(done),
                "run_days": run_days,
                "run_hours": run_hours,
                "run_kwh": round(mean(r["kwh"] for r in done), 3) if done else None,
                "run_minutes": round(mean((r["end"] - r["start"]) / 60 for r in done)) if done else None,
            }
        )
    return out
