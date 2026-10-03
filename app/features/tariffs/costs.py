"""
What each day cost and saved, priced at the rate in force for every 5 minutes.

Costs are worked out per 5-minute reading (so each import is priced at the rate in
force at that time), then each day's totals are scaled to match the inverter's own
daily import/export counters, which are more accurate than integrating averages.

On Amber, each 5-minute reading is priced at Amber's import and feed-in prices for
the interval it falls in (see amber_costs).
"""

from __future__ import annotations

import time
from typing import Any

from app.features.amber.repository import PriceRepository
from app.features.readings.repository import ReadingsRepository
from app.features.tariffs.model import AMBER_FALLBACK, AMBER_PRICED, RateTables, Tariff

KWH_PER_W_5MIN = 300 / 3.6e6  # one 5-minute rollup of 1 W, in kWh


def daily_costs(
    readings: ReadingsRepository,
    t: Tariff,
    tables: RateTables,
    start: int,
    end: int,
    prices: PriceRepository | None = None,
) -> dict[str, Any]:
    """Per-day energy and money between start and end (unix seconds, local days).
    `prices` are the stored Amber prices, used only by an Amber tariff."""
    if t["type"] == "amber":
        return amber_costs(readings, t, prices, start, end)
    bands = tables.bands
    rows = readings.rollups(start, end, ["pv_power", "load_power", "grid_power", "battery_power"])
    counters = {d["date"]: d for d in readings.daily(start, end)}

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
    for date in sorted(set(days) | set(counters)):
        d = days.get(date) or empty()
        c = counters.get(date)
        imp, home, exp = list(d["imp"]), list(d["home"]), d["exp"]
        if c and c.get("daily_import") is not None:
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


def _scale(parts: list[float], total: float, fallback: int) -> list[float]:
    s = sum(parts)
    if s > 0:
        return [p * total / s for p in parts]
    out = [0.0] * len(parts)
    if total > 0:
        out[fallback] = total  # counters say energy moved but we have no readings to split it by
    return out


AMBER_BANDS = ("Amber prices", "No Amber price")


def amber_costs(
    readings: ReadingsRepository, t: Tariff, prices: PriceRepository | None, start: int, end: int
) -> dict[str, Any]:
    """
    Per-day energy and money on Amber: each 5-minute reading is priced at Amber's import and
    feed-in prices for the interval it falls in (5 or 30 minutes long).

    Readings at times with no stored price (older than the backfill reached, or while Amber couldn't
    be reached) aren't priced at 0: they're priced at the tariff's single and feed-in rates, kept in
    their own "No Amber price" band, and counted in `unpriced_kwh` so the page can say so.

    Days are then scaled to the meter's counters as on the other tariffs, keeping each part's
    average price. The same fields as daily_costs, plus per band `home_cost` (what home use would
    have cost from the grid at the prices of the time), and per day `unpriced_kwh` and
    `feed_in_rate` (the average feed-in price earned, which can be negative).
    """
    rows = readings.rollups(start, end, ["pv_power", "load_power", "grid_power", "battery_power"])
    counters = {d["date"]: d for d in readings.daily(start, end)}
    general = prices.lookup("general", start, end) if prices else None
    feed_in = prices.lookup("feedIn", start, end) if prices else None
    flat, fit = t["flat_rate"], t["feed_in_rate"]
    n = len(AMBER_BANDS)

    def empty() -> dict[str, Any]:
        parts: dict[str, Any] = {k: [0.0] * n for k in ("imp", "imp_cost", "home", "home_cost", "self", "self_cost")}
        return {**parts, "exp": 0.0, "exp_unpriced": 0.0, "credit": 0.0, "prices": []}

    days: dict[str, dict[str, Any]] = {}
    for ts, pv, _load, grid, bat in rows:
        date = time.strftime("%Y-%m-%d", time.localtime(ts + 150))
        d = days.setdefault(date, empty())
        g = grid or 0.0
        imp = max(g, 0) * KWH_PER_W_5MIN
        exp = max(-g, 0) * KWH_PER_W_5MIN
        home = max(0.0, (pv or 0) + g + (bat or 0)) * KWH_PER_W_5MIN
        covered = max(0.0, home - imp)  # home use covered by solar or the battery
        price = general.at(ts) if general else None
        band, rate = (AMBER_PRICED, price) if price is not None else (AMBER_FALLBACK, flat)
        if price is not None:
            d["prices"].append(price)
        for k, kwh in (("imp", imp), ("home", home), ("self", covered)):
            d[k][band] += kwh
            d[f"{k}_cost"][band] += kwh * rate
        paid = feed_in.at(ts) if feed_in else None
        d["exp"] += exp
        d["credit"] += exp * (paid if paid is not None else fit)
        if paid is None:
            d["exp_unpriced"] += exp

    out = []
    for date in sorted(set(days) | set(counters)):
        d = days.get(date) or empty()
        c = counters.get(date)
        imp, home = list(d["imp"]), list(d["home"])
        exp, credit, unpriced_exp = d["exp"], d["credit"], d["exp_unpriced"]
        if c and c.get("daily_import") is not None:
            ci, ce, ch = _metered(c)
            imp = _scale(imp, ci, AMBER_FALLBACK)
            home = _scale(home, ch, AMBER_FALLBACK)
            if exp > 0:  # keep the average feed-in price
                credit, unpriced_exp = credit * ce / exp, unpriced_exp * ce / exp
            else:  # exports with no readings to price them by
                credit, unpriced_exp = ce * fit, ce
            exp = ce
        average = sum(d["prices"]) / len(d["prices"]) if d["prices"] else flat
        per: list[dict[str, Any]] = []
        for i, name in enumerate(AMBER_BANDS):
            base = flat if i == AMBER_FALLBACK else average
            imp_rate = _per_kwh(d, "imp", i, base)
            home_rate = _per_kwh(d, "home", i, base)
            covered = max(0.0, home[i] - imp[i])
            per.append(
                {
                    "name": name,
                    # The average price paid for grid power, or failing that the day's average price.
                    "rate": round(imp_rate, 4),
                    "import_kwh": round(imp[i], 3),
                    "home_kwh": round(home[i], 3),
                    "self_kwh": round(covered, 3),
                    "cost": round(imp[i] * imp_rate, 4),
                    "saved": round(covered * _per_kwh(d, "self", i, home_rate), 4),
                    "home_cost": round(home[i] * home_rate, 4),
                }
            )
        import_cost = sum(p["cost"] for p in per)
        supply = t["supply_charge"]
        out.append(
            {
                "date": date,
                "import_kwh": round(sum(imp), 3),
                "export_kwh": round(exp, 3),
                "home_kwh": round(sum(home), 3),
                "import_cost": round(import_cost, 4),
                "supply": supply,
                "feed_in_credit": round(credit, 4),
                "feed_in_rate": round(credit / exp, 4) if exp > 0 else None,
                "grid_cost": round(import_cost + supply, 4),
                "net_cost": round(import_cost + supply - credit, 4),
                "saved": round(sum(p["saved"] for p in per) + credit, 4),
                # Energy priced at the fallback rates because Amber had no price for its time.
                "unpriced_kwh": round(imp[AMBER_FALLBACK] + unpriced_exp, 3),
                "bands": per,
            }
        )
    return {"type": t["type"], "days": out}


def _per_kwh(d: dict[str, Any], part: str, band: int, otherwise: float) -> float:
    """The average price behind one part of a band's energy, or `otherwise` if it has none to go on."""
    kwh = d[part][band]
    return float(d[f"{part}_cost"][band] / kwh) if kwh > 0 else otherwise


def _metered(c: dict[str, Any]) -> tuple[float, float, float]:
    """A day's grid import, export and home use (kWh) from the meter's and inverter's counters."""
    ci = c["daily_import"] or 0.0
    ce = c.get("daily_export") or 0.0
    ch = max(0.0, (c.get("daily_pv") or 0) + ci - ce + (c.get("daily_discharge") or 0) - (c.get("daily_charge") or 0))
    return ci, ce, ch
