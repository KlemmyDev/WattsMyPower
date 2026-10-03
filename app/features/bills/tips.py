"""
Ways to lower the bill, from the household's own recent days: each says what to change and roughly
what it's worth over a bill, so the page can rank them. The page writes the words; this works out
the figures.

- peak: on time of use, move some grid use out of the dearest rate, into the middle of the day (on
  solar that would otherwise be exported) or the cheapest rate.
- solar: run more of the home on solar that's being exported for a few cents.
- baseload: what's always on, overnight, and what using less of it is worth: the night rate for what
  came from the grid, and the feed-in rate for what the battery covered (it's solar that would
  otherwise have been exported).
- supply: the daily supply charge is a big share of the bill, which only a different plan changes.

Savings are estimates at today's rates: a quarter of the peak use or exported solar moved, 100 W
less always on. They overlap (shifting use onto solar is the same move as using it at peak), so
peak is offered instead of solar when the two would be the same change.
"""

from __future__ import annotations

import statistics
import time
from typing import Any, NamedTuple

from app.features.tariffs.model import RateTables, Tariff

SHIFT = 0.25  # share of peak use, or of exported solar, a household could reasonably move
MIN_SAVING = 1.0  # $ a bill: anything less isn't worth a tip
MIN_GAP = 0.02  # $/kWh between two rates for moving use between them to matter
MIN_EXPORT = 1.0  # kWh a day exported before solar counts as going spare
BASELOAD_MIN = 150  # W always on before it's worth a mention
BASELOAD_CUT = 100  # W less, at most
SUPPLY_SHARE = 0.4  # of the bill (before feed-in) before the supply charge gets its own tip
NIGHT = range(1, 5)  # hours (local) when little but the always-on load runs
MIN_NIGHTS = 3

Day = dict[str, Any]


class Baseload(NamedTuple):
    watts: float
    grid_share: float  # of overnight home use, the share that came from the grid (the rest, the battery)


def baseload(rows: list[tuple[Any, ...]]) -> Baseload | None:
    """The home's always-on draw in W: each night's low (20th percentile, 1am to 5am) and the median of
    those. `rows` are (ts, pv_power, grid_power, battery_power) 5-minute rollups."""
    nights: dict[str, list[float]] = {}
    home = grid_in = 0.0
    for ts, pv, grid, bat in rows:
        lt = time.localtime(ts)
        if lt.tm_hour in NIGHT and grid is not None:
            w = max(0.0, (pv or 0) + grid + (bat or 0))
            nights.setdefault(time.strftime("%Y-%m-%d", lt), []).append(w)
            home += w
            grid_in += min(max(grid, 0.0), w)
    lows = [sorted(v)[len(v) // 5] for v in nights.values() if len(v) >= 24]  # at least 2 of the 4 hours
    if len(lows) < MIN_NIGHTS:
        return None
    return Baseload(round(statistics.median(lows)), round(grid_in / home, 3) if home else 1.0)


def tips(
    t: Tariff, tables: RateTables, days: list[Day], period_days: int, base: Baseload | None
) -> list[dict[str, Any]]:
    """Ways to lower a bill of `period_days` days, from recent whole days, most valuable first."""
    if not days:
        return []
    n = len(days)
    per_day = {f: sum(d[f] for d in days) / n for f in ("import_kwh", "export_kwh", "import_cost", "feed_in_credit")}
    imp, exp = per_day["import_kwh"], per_day["export_kwh"]
    import_price = per_day["import_cost"] / imp if imp > 0 else None
    feed_in = per_day["feed_in_credit"] / exp if exp > 0 else float(t["feed_in_rate"])
    spare = exp >= MIN_EXPORT
    out: list[dict[str, Any]] = []

    def bill(v: float) -> float:
        return round(v * period_days, 2)

    peak = None
    if t["type"] == "tou":
        use = [sum(d["bands"][i]["import_kwh"] for d in days) / n for i in range(len(tables.bands))]
        rates = [float(b["rate"]) for b in tables.bands]
        used = [i for i in range(len(rates)) if use[i] > 0.1]
        if used:
            p = max(used, key=lambda i: rates[i])
            cheap = min(range(len(rates)), key=lambda i: rates[i])
            # Onto solar that's going spare, or failing that into the cheapest rate.
            to, to_rate = ("solar", feed_in) if spare else (tables.bands[cheap]["name"], rates[cheap])
            gap = rates[p] - to_rate
            moved = use[p] * SHIFT
            if gap >= MIN_GAP and bill(moved * gap) >= MIN_SAVING:
                peak = {
                    "kind": "peak",
                    "saving": bill(moved * gap),
                    "band": p,
                    "kwh_day": round(use[p], 2),
                    "rate": rates[p],
                    "to": to,  # "solar", or the name of the rate to move it to
                    "to_rate": round(to_rate, 4),
                    "moved_kwh_day": round(moved, 2),
                }
                out.append(peak)

    if spare and import_price is not None and not (peak and peak["to"] == "solar"):
        moved = min(exp, imp) * SHIFT
        gap = import_price - feed_in
        if gap >= MIN_GAP and bill(moved * gap) >= MIN_SAVING:
            out.append(
                {
                    "kind": "solar",
                    "saving": bill(moved * gap),
                    "export_kwh_day": round(exp, 2),
                    "feed_in": round(feed_in, 4),
                    "import_price": round(import_price, 4),
                    "moved_kwh_day": round(moved, 2),
                }
            )

    if base is not None and base.watts >= BASELOAD_MIN:
        # From the grid it's the rate in force at 3am (on Amber, the average paid); from the battery, the
        # feed-in it would have earned.
        night = float(tables.bands[tables.at(False, 180)]["rate"]) if t["type"] == "tou" else None
        night = night if night is not None else (import_price if import_price is not None else float(t["flat_rate"]))
        price = base.grid_share * night + (1 - base.grid_share) * feed_in
        cut = min(BASELOAD_CUT, round(base.watts * 0.3 / 10) * 10)
        if bill(cut / 1000 * 24 * price) >= MIN_SAVING:
            out.append(
                {
                    "kind": "baseload",
                    "saving": bill(cut / 1000 * 24 * price),
                    "watts": base.watts,
                    "kwh_day": round(base.watts / 1000 * 24, 2),
                    "cost": bill(base.watts / 1000 * 24 * price),  # what it costs over a bill
                    "cut_watts": cut,
                    "price": round(price, 4),  # what each kWh of it costs, $/kWh
                    "grid_share": base.grid_share,
                    "night_rate": round(night, 4),
                }
            )

    supply = float(t["supply_charge"])
    gross = per_day["import_cost"] + supply
    if gross > 0 and supply / gross >= SUPPLY_SHARE:
        out.append(
            {
                "kind": "supply",
                "saving": None,
                "share": round(supply / gross, 3),
                "cost": bill(supply),
                "per_day": supply,
            }
        )

    return sorted(out, key=lambda x: -(x["saving"] or 0))
