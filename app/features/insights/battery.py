"""
The battery over the longer run: its health and efficiency month by month, how much of its
warranty is used, and whether a bigger one would pay.

Sizing replays the last 90 days of 5-minute readings with some extra storage beside the battery:
it soaks up what was sent to the grid (which happens once the battery is full or charging as fast
as it can) and gives it back when the house would otherwise draw from the grid (once the battery is
down to its reserve or flat out). Each kWh it moves is worth the grid price at the time it's used,
less the feed-in it would have earned when it was stored.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from typing import Any

from app.features.tariffs.costs import Pricer

SIZING_DAYS = 90
MIN_SIZING_DAYS = 14
EXTRA_KWH = (5.0, 10.0)  # the extra storage tried
ONE_WAY = 0.95  # charge or discharge efficiency each way (about 90% round trip)
STEP = 300  # seconds per rollup
FULL = 99.0  # % counted as full
NOON = 12
COMPLETE = 230  # 5-minute readings (of 288) for a day to count


def month_row(month: str, daily: list[dict[str, Any]], soh: float | None, cap: float) -> dict[str, Any]:
    """A month of the battery: its reported health, what went in and came out, efficiency and cycles."""
    chg = sum(r["daily_charge"] or 0 for r in daily)
    dis = sum(r["daily_discharge"] or 0 for r in daily)
    return {
        "month": month,
        "soh": soh,
        "charge_kwh": round(chg, 1),
        "discharge_kwh": round(dis, 1),
        # Only once enough has been through it that where its charge started and ended the month hardly
        # matters (three full charges); over 100% means it still mattered.
        "efficiency": round(dis / chg * 100, 1) if cap and chg >= 3 * cap and dis <= chg else None,
        "cycles": round(dis / cap, 1) if cap and dis else None,
    }


def warranty(
    installed: float | None, years: float | None, mwh: float | None, discharged_kwh: float | None, now: float
) -> dict[str, Any] | None:
    """How much of the warranty is used, by time since the battery went in and by energy it has delivered
    (the inverter's lifetime discharge counter). None when no warranty is set."""
    if not years and not mwh:
        return None
    out: dict[str, Any] = {"installed": int(installed) if installed else None, "years": years, "mwh": mwh}
    if years and installed:
        ends = time.localtime(installed)
        end = int(time.mktime((ends.tm_year + int(years), ends.tm_mon, ends.tm_mday, 0, 0, 0, 0, 0, -1)))
        out["ends"] = end
        out["time_pct"] = round(max(0.0, min(100.0, (now - installed) / (end - installed) * 100)), 1)
    if mwh and discharged_kwh is not None:
        out["used_mwh"] = round(discharged_kwh / 1000, 2)
        out["energy_pct"] = round(min(100.0, discharged_kwh / 1000 / mwh * 100), 1)
    return out


def sizing(
    rows: Sequence[tuple[int, float | None, float | None]],
    cap: float,
    max_kw: float,
    reserve: float,
    pricer: Pricer | None,
) -> dict[str, Any] | None:
    """How the battery's size suits the house, from 5-minute (ts, grid W, battery %) readings: days it
    was full by midday, days it ran down to its reserve, the solar sent away while it was full, and
    what extra storage would have saved. None with too few days to judge."""
    per_day: dict[str, dict[str, Any]] = {}
    for ts, _, soc in rows:
        lt = time.localtime(ts)
        d = per_day.setdefault(time.strftime("%Y-%m-%d", lt), {"n": 0, "full_noon": False, "low": False})
        d["n"] += 1
        if soc is None:
            continue
        d["full_noon"] |= soc >= FULL and lt.tm_hour < NOON
        d["low"] |= soc <= reserve + 2
    days = [d for d in per_day.values() if d["n"] >= COMPLETE]
    if len(days) < MIN_SIZING_DAYS:
        return None

    kwh = STEP / 3.6e6  # kWh in one rollup per W
    sent_full = sum(-g * kwh for _, g, soc in rows if g is not None and g < 0 and soc is not None and soc >= FULL)
    bought_low = sum(
        g * kwh for _, g, soc in rows if g is not None and g > 0 and soc is not None and soc <= reserve + 2
    )

    options = []
    limit = max_kw * STEP / 3600  # kWh the extra storage can move in a rollup
    for extra in EXTRA_KWH:
        stored = moved = 0.0
        saved = 0.0
        for ts, g, _ in rows:
            if g is None:
                continue
            if g < 0:  # spare solar going to the grid: keep what fits
                take = min(-g * kwh, limit, (extra - stored) / ONE_WAY)
                stored += take * ONE_WAY
                if pricer:
                    saved -= take * pricer.sell(ts)
            elif g > 0 and stored > 0:  # drawing from the grid: give it back
                give = min(g * kwh, limit, stored * ONE_WAY)
                stored -= give / ONE_WAY
                moved += give
                if pricer:
                    saved += give * pricer.buy(ts)
        options.append(
            {
                "extra_kwh": extra,
                "kwh": round(moved, 1),
                "saved": round(saved, 2) if pricer else None,
                "per_year": round(saved * 365 / len(per_day), 0) if pricer else None,
            }
        )
    return {
        "days": len(days),
        "capacity_kwh": cap,
        "full_by_noon": sum(d["full_noon"] for d in days),
        "reserve_days": sum(d["low"] for d in days),
        "sent_while_full_kwh": round(sent_full, 1),
        "bought_while_low_kwh": round(bought_low, 1),
        "options": options,
    }
