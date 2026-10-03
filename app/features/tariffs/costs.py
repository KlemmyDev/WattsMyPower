"""
What each day cost and saved, priced at the rate in force for every 5 minutes.

Costs are worked out per 5-minute reading (so each import is priced at the rate in
force at that time), then each day's totals are scaled to match the inverter's own
daily import/export counters, which are more accurate than integrating averages.

Where imported smart-meter data (app.features.meter) covers a whole day, its import and
export are used instead: it's what the retailer bills from. Its intervals are priced at the
rate in force for each one, and the day says where its figures came from (`source`).
"""

from __future__ import annotations

import time
from typing import Any

from app.features.meter.service import MeterService
from app.features.readings.repository import ReadingsRepository
from app.features.tariffs.model import RateTables, Tariff

KWH_PER_W_5MIN = 300 / 3.6e6  # one 5-minute rollup of 1 W, in kWh


def daily_costs(
    readings: ReadingsRepository,
    t: Tariff,
    tables: RateTables,
    start: int,
    end: int,
    meter: MeterService | None = None,
) -> dict[str, Any]:
    """Per-day energy and money between start and end (unix seconds, local days)."""
    bands = tables.bands
    rows = readings.rollups(start, end, ["pv_power", "load_power", "grid_power", "battery_power"])
    counters = {d["date"]: d for d in readings.daily(start, end)}
    metered = {k: m for k, m in (meter.days(start, end) if meter else {}).items() if m.complete}

    def empty() -> dict[str, Any]:
        return {"imp": [0.0] * len(bands), "home": [0.0] * len(bands), "exp": 0.0}

    days: dict[str, dict[str, Any]] = {}
    for ts, pv, _load, grid, bat in rows:
        lt = time.localtime(ts + 150)
        date = time.strftime("%Y-%m-%d", lt)
        band = tables.at(lt.tm_wday >= 5, lt.tm_hour * 60 + lt.tm_min)
        d = days.setdefault(date, empty())
        g = grid or 0.0
        d["imp"][band] += max(g, 0) * KWH_PER_W_5MIN
        d["exp"] += max(-g, 0) * KWH_PER_W_5MIN
        d["home"][band] += max(0.0, (pv or 0) + g + (bat or 0)) * KWH_PER_W_5MIN

    out = []
    for date in sorted(set(days) | set(counters) | set(metered)):
        d = days.get(date) or empty()
        c = counters.get(date)
        m = metered.get(date)
        imp, home, exp = list(d["imp"]), list(d["home"]), d["exp"]
        if m:
            # The meter's own intervals, each at its rate; home use from the inverter's counters with
            # the meter's grid figures (without inverter readings that day, it's only what came from the grid).
            c = c or {}
            ch = max(
                0.0,
                (c.get("daily_pv") or 0)
                + m.import_kwh
                - m.export_kwh
                + (c.get("daily_discharge") or 0)
                - (c.get("daily_charge") or 0),
            )
            imp = _by_band(m.imports, tables)
            home = _scale(home, ch, tables.other)
            exp = m.export_kwh
        elif c and c.get("daily_import") is not None:
            # Scale the per-rate split so totals match the inverter's counters.
            ci = c["daily_import"] or 0.0
            ce = c.get("daily_export") or 0.0
            ch = max(
                0.0, (c.get("daily_pv") or 0) + ci - ce + (c.get("daily_discharge") or 0) - (c.get("daily_charge") or 0)
            )
            imp = _scale(imp, ci, tables.other)
            home = _scale(home, ch, tables.other)
            exp = ce
        per = []
        for i, b in enumerate(bands):
            selfu = max(0.0, home[i] - imp[i])
            per.append(
                {
                    "name": b["name"],
                    "rate": b["rate"],
                    "import_kwh": round(imp[i], 3),
                    "home_kwh": round(home[i], 3),
                    "self_kwh": round(selfu, 3),  # home use covered by solar or the battery in this rate
                    "cost": round(imp[i] * b["rate"], 4),
                    "saved": round(selfu * b["rate"], 4),
                }
            )
        import_cost = sum(p["cost"] for p in per)
        credit = exp * t["feed_in_rate"]
        out.append(
            {
                "date": date,
                # Where import and export came from: the household's smart meter, or the inverter.
                "source": "meter" if m else "inverter",
                "import_kwh": round(sum(imp), 3),
                "export_kwh": round(exp, 3),
                "home_kwh": round(sum(home), 3),
                "import_cost": round(import_cost, 4),
                "supply": t["supply_charge"],
                "feed_in_credit": round(credit, 4),
                "grid_cost": round(import_cost + t["supply_charge"], 4),
                # What the day costs on the bill: usage + supply - feed-in. Negative = a credit.
                "net_cost": round(import_cost + t["supply_charge"] - credit, 4),
                "saved": round(sum(p["saved"] for p in per) + credit, 4),
                "bands": per,
            }
        )
    return {"type": t["type"], "days": out}


def _by_band(intervals: list[tuple[int, int, float]], tables: RateTables) -> list[float]:
    """kWh per rate from meter intervals (start, minutes, kWh). An interval spanning a change of
    rate is shared between them by the minute."""
    out = [0.0] * len(tables.bands)
    for ts, minutes, kwh in intervals:
        lt = time.localtime(ts)
        weekend, first = lt.tm_wday >= 5, lt.tm_hour * 60 + lt.tm_min
        for k in range(minutes):
            out[tables.at(weekend, (first + k) % 1440)] += kwh / minutes
    return out


def _scale(parts: list[float], total: float, fallback: int) -> list[float]:
    s = sum(parts)
    if s > 0:
        return [p * total / s for p in parts]
    out = [0.0] * len(parts)
    if total > 0:
        out[fallback] = total  # counters say energy moved but we have no readings to split it by
    return out
