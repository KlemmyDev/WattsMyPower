"""
What each day cost and saved, priced at the rate in force for every 5 minutes.

Costs are worked out per 5-minute reading (so each import is priced at the rate in
force at that time), then each day's totals are scaled to match the inverter's own
daily import/export counters, which are more accurate than integrating averages.

Where imported smart-meter data (app.features.meter) covers a whole day, its import and
export are used instead: it's what the retailer bills from. Its intervals are priced at the
rate in force for each one, and the day says where its figures came from (`source`).

On Amber, each 5-minute reading or meter interval is priced at Amber's import and
feed-in prices for its time (see amber_costs).
"""

from __future__ import annotations

import time
from typing import Any

from app.features.amber.prices import PriceLookup
from app.features.amber.repository import PriceRepository
from app.features.meter.service import MeterService
from app.features.readings.repository import ReadingsRepository
from app.features.tariffs.model import AMBER_FALLBACK, AMBER_PRICED, RateTables, Tariff

KWH_PER_W_5MIN = 300 / 3.6e6  # one 5-minute rollup of 1 W, in kWh


def daily_costs(
    readings: ReadingsRepository,
    t: Tariff,
    tables: RateTables,
    start: int,
    end: int,
    meter: MeterService | None = None,
    prices: PriceRepository | None = None,
) -> dict[str, Any]:
    """Per-day energy and money between start and end (unix seconds, local days).
    `prices` are the stored Amber prices, used only by an Amber tariff."""
    if t["type"] == "amber":
        return amber_costs(readings, t, prices, start, end, meter)
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


AMBER_BANDS = ("Amber prices", "No Amber price")


def amber_costs(
    readings: ReadingsRepository,
    t: Tariff,
    prices: PriceRepository | None,
    start: int,
    end: int,
    meter: MeterService | None = None,
) -> dict[str, Any]:
    """
    Per-day energy and money on Amber: grid power and feed-in at Amber's prices for the time.

    Days from the inverter: each 5-minute reading is priced at Amber's import and feed-in prices for
    the interval it falls in (5 or 30 minutes long), then the day is scaled to the meter's counters as
    on the other tariffs, keeping each part's average price.

    Days the imported smart-meter data covers (as on the other tariffs, its import and export stand in
    for the inverter's): each meter interval (5, 15 or 30 minutes) is priced at the time-weighted
    average of the Amber prices covering it. A 5-minute interval gets its own 5-minute price; a 15- or
    30-minute one gets the average of the 5-minute prices inside it, which is how Amber prices a site
    whose meter reads every 30 minutes (and an interval inside one 30-minute price gets that price).
    Home use still comes from the inverter's readings, split by the prices of their time.

    Times with no stored price (older than the backfill reached, or while Amber couldn't be reached)
    aren't priced at 0: they're priced at the tariff's single and feed-in rates, kept in their own
    "No Amber price" band, and counted in `unpriced_kwh` so the page can say so. A meter interval
    only partly covered by Amber's prices is split the same way, by time.

    The same fields as daily_costs, plus per band `home_cost` (what home use would have cost from
    the grid at the prices of the time), and per day `unpriced_kwh` and `feed_in_rate` (the average
    feed-in price earned, which can be negative).
    """
    rows = readings.rollups(start, end, ["pv_power", "load_power", "grid_power", "battery_power"])
    counters = {d["date"]: d for d in readings.daily(start, end)}
    metered = {k: m for k, m in (meter.days(start, end) if meter else {}).items() if m.complete}
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
    for date in sorted(set(days) | set(counters) | set(metered)):
        d = days.get(date) or empty()
        c = counters.get(date)
        m = metered.get(date)
        imp, home = list(d["imp"]), list(d["home"])
        exp, credit, unpriced_exp = d["exp"], d["credit"], d["exp_unpriced"]
        meter_cost: list[float] | None = None  # on a meter day, its imports' cost per band
        if m:
            # Grid import and export from the meter's intervals; home use from the inverter's counters
            # with the meter's grid figures, as on the other tariffs.
            c = c or {}
            ch = max(
                0.0,
                (c.get("daily_pv") or 0)
                + m.import_kwh
                - m.export_kwh
                + (c.get("daily_discharge") or 0)
                - (c.get("daily_charge") or 0),
            )
            imp, meter_cost = _priced(m.imports, general, flat)
            exported, earned = _priced(m.exports, feed_in, fit)
            exp, credit, unpriced_exp = m.export_kwh, sum(earned), exported[AMBER_FALLBACK]
            home = _scale(home, ch, AMBER_FALLBACK)
        elif c and c.get("daily_import") is not None:
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
            if meter_cost is None:
                imp_rate = _per_kwh(d, "imp", i, base)
            else:
                imp_rate = meter_cost[i] / imp[i] if imp[i] > 0 else base
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
                # Where import and export came from: the household's smart meter, or the inverter.
                "source": "meter" if m else "inverter",
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


def _priced(
    intervals: list[tuple[int, int, float]], prices: PriceLookup | None, fallback: float
) -> tuple[list[float], list[float]]:
    """kWh and money per Amber band from meter intervals (start, minutes, kWh). Each interval is priced
    at the time-weighted average of the Amber prices over it; any part of it Amber has no price for
    goes to the fallback band at `fallback`, by its share of the interval's time."""
    kwh, money = [0.0] * len(AMBER_BANDS), [0.0] * len(AMBER_BANDS)
    for ts, minutes, energy in intervals:
        span = minutes * 60
        covered, total = prices.over(ts, ts + span) if prices else (0, 0.0)
        share = min(1.0, covered / span) if span > 0 else 0.0
        if covered:
            kwh[AMBER_PRICED] += energy * share
            money[AMBER_PRICED] += energy * share * total / covered
        kwh[AMBER_FALLBACK] += energy * (1 - share)
        money[AMBER_FALLBACK] += energy * (1 - share) * fallback
    return kwh, money


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


class Pricer:
    """The price to buy grid power and the feed-in earned ($/kWh) at any moment from start to end: the
    time-of-use band or single rate in force, or on Amber its price for the time (the fallback rates
    where it has none)."""

    def __init__(self, t: Tariff, tables: RateTables, prices: PriceRepository | None, start: int, end: int):
        self.t = t
        self.tables = tables
        amber = t["type"] == "amber" and prices is not None
        self._general = prices.lookup("general", start, end) if amber and prices else None
        self._feed_in = prices.lookup("feedIn", start, end) if amber and prices else None

    def buy(self, ts: int) -> float:
        if self._general is not None and (p := self._general.at(ts)) is not None:
            return p
        if self.t["type"] == "amber":
            return float(self.t["flat_rate"])
        lt = time.localtime(ts)
        return float(self.tables.bands[self.tables.at(lt.tm_wday >= 5, lt.tm_hour * 60 + lt.tm_min)]["rate"])

    def sell(self, ts: int) -> float:
        if self._feed_in is not None and (p := self._feed_in.at(ts)) is not None:
            return p
        return float(self.t["feed_in_rate"])

    def band(self, ts: int) -> str | None:
        """The time-of-use band in force (None on a single rate or Amber)."""
        if self.t["type"] != "tou":
            return None
        lt = time.localtime(ts)
        return str(self.tables.bands[self.tables.at(lt.tm_wday >= 5, lt.tm_hour * 60 + lt.tm_min)]["name"])
