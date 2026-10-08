"""
A room's or a device's use, looked at closely, for their pages: today against its usual day, when in the week it uses
power, its power spikes, and what it's likely to use in the days ahead and by the end of the month.

- **The usual day** is the average of the same weekday over the last PATTERN_DAYS (any day, with fewer than
  SAME_DAYS of them read), in W through each SLOT. What's left of today, as usual, plus what's been used so far is
  where today's likely to end up.
- **When it uses power:** what it uses on average in each hour of each weekday.
- **Spikes,** from the most each device was read drawing in each 5 minutes (home_peaks): its usual peak is the median
  of each day's highest, on the days it did something (drew more than ACTIVE, and ACTIVE_X times what it idles at: a
  washer's peak is its wash, not the watt it draws on the days it isn't used). A day's highest SPIKE times its usual
  peak, and SPIKE_W over it, is a spike. Each device's usual peak and highest of the last PEAK_DAYS are given, with
  every spike, newest first.
- **The days ahead:** each day's usual use, from the same weekday's (any day's, with fewer than SAME_DAYS); its likely
  range is what 8 in 10 of those days came within. The month adds what's been used so far, the rest of today as
  usual, and the usual for each day left.
"""

from __future__ import annotations

import time
from collections import defaultdict
from statistics import mean, median
from typing import Any

from app.core.schema import ROLLUP
from app.features.home.repository import HomeRepository
from app.features.home.usage import PATTERN_DAYS, bucket_start, buckets
from app.features.readings.repository import KWH_PER_W_ROLLUP

DAY = 86400
SLOT = 900  # the usual day is in quarter hours
SAME_DAYS = 3  # the usual day (and a day ahead) is the same weekday's, once there are this many of them
PEAK_DAYS = 30
SPIKE = 1.5
SPIKE_W = 200
ACTIVE = 10  # W
ACTIVE_X = 3
AHEAD = 7
MOST_SPIKES = 8


def _quantile(values: list[float], q: float) -> float:
    s = sorted(values)
    i = q * (len(s) - 1)
    lo = int(i)
    return s[lo] + (s[min(lo + 1, len(s) - 1)] - s[lo]) * (i - lo)


def _weekday(ts: int) -> int:
    return time.localtime(ts).tm_wday


def _month_start(ts: int) -> int:
    lt = time.localtime(ts)
    return int(time.mktime((lt.tm_year, lt.tm_mon, 1, 0, 0, 0, 0, 0, -1)))


def _next_month(ts: int) -> int:
    lt = time.localtime(ts)
    y, m = (lt.tm_year + 1, 1) if lt.tm_mon == 12 else (lt.tm_year, lt.tm_mon + 1)
    return int(time.mktime((y, m, 1, 0, 0, 0, 0, 0, -1)))


def profile(repo: HomeRepository, devices: list[int], now: int) -> dict[str, Any]:
    """`devices`' use (together) looked at closely: see the module's description."""
    today = bucket_start(now, "day")
    start = min(bucket_start(now - PATTERN_DAYS * DAY, "day"), _month_start(now))
    ids = set(devices)
    by_day: dict[int, float] = defaultdict(float)  # day -> kWh
    slots: dict[int, list[float]] = defaultdict(lambda: [0.0] * (DAY // SLOT))  # day -> kWh in each slot
    hours: dict[int, list[float]] = defaultdict(lambda: [0.0] * 24)  # day -> kWh in each hour
    now_w: dict[int, float] = defaultdict(float)  # today's 5-minute buckets -> W
    for ts, device, kwh in repo.energy(start, now):
        if device not in ids:
            continue
        day = bucket_start(ts, "day")
        by_day[day] += kwh
        slots[day][(ts - day) // SLOT] += kwh
        hours[day][time.localtime(ts).tm_hour] += kwh
        if day == today:
            now_w[ts] += kwh / KWH_PER_W_ROLLUP

    # Every day from the first one read up to yesterday counts, a day it used nothing included.
    first = min(by_day, default=None)
    past = [d for d in buckets(first, today, "day") if d >= today - PATTERN_DAYS * DAY] if first is not None else []

    def like(day: int) -> list[int]:
        """The past days a day is judged by: the same weekday, or every day while there are too few of those."""
        same = [d for d in past if _weekday(d) == _weekday(day)]
        return same if len(same) >= SAME_DAYS else past

    # -- today against its usual day ----------------------------------------------------------------
    usual_days = like(today)
    usual = [mean(slots[d][i] for d in usual_days) if usual_days else 0.0 for i in range(DAY // SLOT)]
    into = (now - today) / SLOT
    done = int(into)
    so_far = by_day.get(today, 0.0)
    rest = (sum(usual[done + 1 :]) + usual[done] * (1 - (into - done))) if done < len(usual) else 0.0
    usual_by_now = sum(usual[:done]) + (usual[done] * (into - done) if done < len(usual) else 0.0)

    # -- when in the week -----------------------------------------------------------------------------
    week: list[list[float | None]] = []
    for wd in range(7):
        days = [d for d in past if _weekday(d) == wd]
        week.append([round(mean(hours[d][h] for d in days), 4) if days else None for h in range(24)])

    # -- the days ahead and the month ----------------------------------------------------------------
    def expected(day: int) -> dict[str, Any]:
        totals = [by_day.get(d, 0.0) for d in like(day)]
        if not totals:
            return {"date": time.strftime("%Y-%m-%d", time.localtime(day)), "kwh": None, "low": None, "high": None}
        return {
            "date": time.strftime("%Y-%m-%d", time.localtime(day)),
            "kwh": round(mean(totals), 3),
            "low": round(_quantile(totals, 0.1), 3),
            "high": round(_quantile(totals, 0.9), 3),
        }

    tomorrow = bucket_start(today + DAY + 3600, "day")  # an hour in: a daylight saving day is 23 or 25 hours
    ahead = [expected(d) for d in buckets(tomorrow, tomorrow + AHEAD * DAY - 3600, "day")]
    month_end = _next_month(now)
    month_used = sum(kwh for d, kwh in by_day.items() if d >= _month_start(now))
    month_left = [expected(d)["kwh"] or 0.0 for d in buckets(tomorrow, month_end, "day")] if past else []

    return {
        "days": len(past),
        "today": {
            "t": sorted(now_w),
            "w": [round(now_w[t], 1) for t in sorted(now_w)],
            "kwh": round(so_far, 3),
            "usual": {
                "same_weekday": len(usual_days) >= SAME_DAYS and len(usual_days) < len(past),
                "days": len(usual_days),
                "slot": SLOT,
                "w": [round(kwh / (SLOT / 3600) * 1000, 1) for kwh in usual],
                "by_now": round(usual_by_now, 3),
                "kwh": round(sum(usual), 3),
            },
            "by_midnight": round(so_far + rest, 3) if past else None,
        },
        "week": week,
        "ahead": ahead,
        "month": {
            "used": round(month_used, 3),
            "likely": round(month_used + rest + sum(month_left), 3) if past else None,
            "days_left": len(month_left),
        },
        **spikes(repo, ids, now),
    }


def spikes(repo: HomeRepository, devices: set[int], now: int) -> dict[str, Any]:
    """Each device's usual peak and highest over the last PEAK_DAYS, its spikes (newest first), and today's highest
    draw."""
    today = bucket_start(now, "day")
    read: dict[int, list[float]] = defaultdict(list)  # device -> every 5 minutes' most
    first: dict[int, int] = {}  # device -> its first reading
    days: dict[int, dict[int, tuple[int, float]]] = defaultdict(dict)  # device -> day -> (ts, W) at its highest
    for ts, device, w in repo.peaks(bucket_start(now - PEAK_DAYS * DAY, "day"), now, devices):
        read[device].append(w)
        first.setdefault(device, ts)
        day = bucket_start(ts, "day")
        if w > days[device].get(day, (0, 0.0))[1]:
            days[device][day] = (ts, w)

    def idles_at(device: int) -> float:
        """What it draws most of the time: the median of every 5 minutes since its first reading, one with none (a
        plug drawing nothing isn't kept) at 0."""
        n = (now - first[device]) // ROLLUP + 1
        missing = max(0, n - len(read[device]))
        mid = n // 2
        return 0.0 if mid < missing else sorted(read[device])[min(mid - missing, len(read[device]) - 1)]

    # The days each did something: drew more than it idles at.
    active = {
        device: {d: x for d, x in by.items() if x[1] > max(ACTIVE, ACTIVE_X * idles_at(device))}
        for device, by in days.items()
    }
    usual = {device: median(w for _, w in by.values()) for device, by in active.items() if by}
    drawn = [(ts, device, w) for device, by in active.items() for ts, w in by.values()]
    today_highest = max((x for x in drawn if bucket_start(x[0], "day") == today), key=lambda x: x[2], default=None)

    def peak(ts: int, device: int, w: float) -> dict[str, Any]:
        u = usual.get(device)
        return {
            "ts": ts,
            "device": device,
            "w": round(w),
            "usual_w": round(u) if u is not None else None,
            "spike": u is not None and len(active[device]) >= SAME_DAYS and w >= u * SPIKE and w - u >= SPIKE_W,
        }

    found = [peak(*x) for x in sorted(drawn, key=lambda x: -x[0])]
    return {
        "spikes": [x for x in found if x["spike"]][:MOST_SPIKES],
        "peak_today": peak(*today_highest) if today_highest else None,
        "peaks": [
            {
                "device": device,
                "usual_w": round(usual[device]),
                "days": len(by),
                "max": peak(*max(((ts, device, w) for ts, w in by.values()), key=lambda x: x[2])),
            }
            for device, by in sorted(active.items(), key=lambda x: -usual.get(x[0], 0))
            if by
        ],
    }
