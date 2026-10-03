"""
Solar performance over the longer run, and what's likely holding it back.

  - The monthly performance ratio: what the panels made per unit of sunshine on them (from the stored
    weather, on the panels' plane when their tilt and direction are set), as a share of the array's
    size. The industry's standard measure: a steady fall over a year is wear or dirt, while seasons
    move it a few per cent. Hours the battery was full (solar may have been held back) and hours at
    the inverter's limit don't count, as neither says anything about the panels.
  - Likely causes for the last 30 days: the inverter capping output on sunny hours, dust (output
    jumping after rain), and new shade (afternoons or mornings falling behind the rest of the day).
"""

from __future__ import annotations

import statistics
import time
from collections.abc import Iterable
from typing import Any

from app.features.forecast.learning import Sample

MIN_POA = 0.3  # kWh/m² on the panels in an hour: bright enough to judge by
MIN_MONTH_HOURS = 20  # bright hours a month needs for its ratio
MIN_TREND_MONTHS = 6
CAP_NEAR = 0.97  # an hour making this share of the system's most is at its limit
MIN_CAPPED_HOURS = 10  # hours at the limit (over the stretch) before output counts as capped
RAIN_MM = 5.0  # a day's rain that can wash the panels
DUST_JUMP = 0.05  # output up by this share of expected after rain: dust was costing that much
SHADE_DROP = 0.12  # a half of the day falling this much behind the other, against the weeks before
RECENT_DAYS = 14


def _month(ts: int) -> str:
    return time.strftime("%Y-%m", time.localtime(ts))


def monthly(samples: Iterable[Sample], pv_kw: float, cap_kwh: float | None) -> list[dict[str, Any]]:
    """Each month's performance ratio from bright hours: kWh made / (kWh/m² on the panels × array kW)."""
    by: dict[str, list[float]] = {}
    for s in samples:
        if s.actual is None or s.full or s.poa < MIN_POA:
            continue
        if cap_kwh and s.actual >= CAP_NEAR * cap_kwh:
            continue
        m = by.setdefault(_month(s.ts), [0.0, 0.0, 0])
        m[0] += s.actual
        m[1] += s.poa
        m[2] += 1
    return [
        {"month": k, "ratio": round(made / (sun * pv_kw), 3), "hours": int(n)}
        for k, (made, sun, n) in sorted(by.items())
        if n >= MIN_MONTH_HOURS and sun > 0 and pv_kw > 0
    ]


def trend(months: list[dict[str, Any]]) -> float | None:
    """The change in performance ratio per year, as a share of its average (least squares over the
    months), once there are enough months to say. Negative is a fall."""
    if len(months) < MIN_TREND_MONTHS:
        return None
    xs = [int(m["month"][:4]) * 12 + int(m["month"][5:]) for m in months]
    ys = [m["ratio"] for m in months]
    if xs[-1] - xs[0] + 1 < MIN_TREND_MONTHS:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if not den or not my:
        return None
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / den  # per month
    return round(slope * 12 / my, 4)


def capped(hours: list[tuple[int, float, float | None]], clip: float, since: int) -> dict[str, Any] | None:
    """Output held at the system's limit: (hour start, modelled kWh without a limit, kWh made) for each
    hour. None unless output sits at the limit often enough for it to be a real cap."""
    at_cap = [(t, model, made) for t, model, made in hours if made is not None and made >= CAP_NEAR * clip]
    if len(at_cap) < MIN_CAPPED_HOURS:
        return None
    recent = [(t, model, made) for t, model, made in at_cap if t >= since and model > clip]
    lost = sum(model - clip for _, model, _ in recent)
    days = {time.strftime("%Y-%m-%d", time.localtime(t)) for t, _, _ in recent}
    return {"limit_kw": round(clip, 2), "days": len(days), "kwh": round(lost, 1)}


def dust(days: list[dict[str, Any]], rain: dict[str, float], since: str) -> dict[str, Any] | None:
    """The latest rain since `since` after which clear-day output jumped: dust it washed off.

    `days` are the daily performance rows (date, ratio, clear), oldest first; `rain` is mm by date."""
    clear = [(d["date"], d["ratio"]) for d in days if d.get("clear") and d.get("ratio") is not None]
    found = None
    for date, mm in sorted(rain.items()):
        if date < since or mm < RAIN_MM:
            continue
        before = [r for d, r in clear if d < date][-7:]
        after = [r for d, r in clear if d > date][:5]
        if len(before) < 3 or len(after) < 2:
            continue
        b, a = statistics.median(before), statistics.median(after)
        if a - b >= DUST_JUMP:
            found = {"date": date, "rain_mm": round(mm, 1), "before": round(b, 3), "after": round(a, 3)}
    return found


def shade(hours: list[tuple[int, float, float | None]], since: int) -> dict[str, Any] | None:
    """Afternoons (or mornings) falling behind the rest of the day lately, against the weeks before:
    (hour start, expected kWh, kWh made) for each bright hour. Something new may be shading the panels
    for that part of the day."""

    def halves(rows: list[tuple[int, float, float | None]]) -> tuple[float, float] | None:
        made = [0.0, 0.0]
        exp = [0.0, 0.0]
        for t, e, a in rows:
            if a is None or e <= 0:
                continue
            pm = int(time.localtime(t + 1800).tm_hour >= 12)
            made[pm] += a
            exp[pm] += e
        if min(exp) < 2:  # too little to go on in either half
            return None
        return made[0] / exp[0], made[1] / exp[1]

    recent = halves([h for h in hours if h[0] >= since])
    before = halves([h for h in hours if h[0] < since])
    if not recent or not before:
        return None
    # How each half compares with the other, now and before: the day's overall level cancels out.
    now_pm, then_pm = recent[1] / recent[0], before[1] / before[0]
    change = now_pm / then_pm - 1
    if abs(change) < SHADE_DROP:
        return None
    return {"part": "afternoon" if change < 0 else "morning", "drop": round(abs(change) / (1 + max(change, 0)), 3)}
