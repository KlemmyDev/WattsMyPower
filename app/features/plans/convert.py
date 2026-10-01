"""
Turning a CDR plan into our formats: a headline summary for the search results, and
a tariff for the editor (with notes on anything that had to be simplified).

CDR prices exclude GST; we add 10% to usage and supply charges so they match a
household bill. Feed-in tariffs aren't subject to GST for households.

Everything here is pure: it works on plan JSON already fetched, so it can be tested
without the network.
"""

from __future__ import annotations

import re
import time
from typing import Any

from app.features.plans.cdr import Brand, Plan
from app.features.tariffs.model import MAX_BANDS, MAX_WINDOWS, Tariff, validate

GST = 1.10
ALL_DAYS = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}
WEEKDAYS = {"MON", "TUE", "WED", "THU", "FRI"}
WEEKENDS = {"SAT", "SUN"}
BAND_NAMES = {
    "PEAK": "Peak",
    "OFF_PEAK": "Off-peak",
    "SHOULDER": "Shoulder",
    "SHOULDER1": "Shoulder 1",
    "SHOULDER2": "Shoulder 2",
}


# ---------------------------------------------------------------------------
# Reading CDR fields
# ---------------------------------------------------------------------------


def price(rates: Any) -> float | None:
    try:
        return float(rates[0]["unitPrice"])
    except (TypeError, KeyError, IndexError, ValueError):
        return None


def supply(period: dict[str, Any] | None) -> float | None:
    if not period:
        return None
    try:
        if period.get("dailySupplyCharge") is not None:
            return float(period["dailySupplyCharge"])
        bands = period.get("bandedDailySupplyCharges") or []
        return float(bands[0]["unitPrice"]) if bands else None
    except (TypeError, ValueError, KeyError):
        return None


def current_period(periods: list[dict[str, Any]], today: str | None = None) -> dict[str, Any] | None:
    """The tariff period (season) covering today; periods use mm-dd and can wrap the new year."""
    today = today or time.strftime("%m-%d")
    for p in periods:
        s, e = p.get("startDate", "01-01"), p.get("endDate", "12-31")
        if (s <= today <= e) if s <= e else (today >= s or today <= e):
            return p
    return periods[0] if periods else None


def feed_in(ec: dict[str, Any]) -> tuple[float | None, list[str]]:
    """Retailer feed-in rate, plus notes about anything simplified."""
    notes: list[str] = []
    best: float | None = None
    for f in ec.get("solarFeedInTariff") or []:
        if f.get("payerType") == "GOVERNMENT":
            p = price((f.get("singleTariff") or {}).get("rates"))
            notes.append(
                f"Also lists {f.get('displayName', 'a government feed-in scheme')}"
                + (f" ({p * 100:.0f}c per kWh)" if p else "")
                + ". That rate only applies to customers already on the scheme, so it isn't used."
            )
            continue
        if f.get("tariffUType") == "singleTariff":
            p = price((f.get("singleTariff") or {}).get("rates"))
        else:
            vary = f.get("timeVaryingTariffs") or []
            prices = [x for x in (price(v.get("rates")) for v in vary) if x is not None]
            p = max(prices) if prices else None
            if prices:
                notes.append(
                    "The feed-in rate varies by time of day. The highest rate is used, because the dashboard supports one feed-in rate."
                )
        if p is not None and best is None:
            best = round(p, 4)
    return best, notes


def hm(t: str | None) -> int | None:
    m = re.match(r"^(\d{1,2}):?(\d{2})", t or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def window_times(start: str | None, end: str | None) -> tuple[str, str] | None:
    s, e = hm(start), hm(end)
    if s is None or e is None:
        return None
    if e % 5 == 4:  # CDR end times are usually inclusive ("20:59" means up to 21:00)
        e += 1
    e %= 1440
    return _fmt(s % 1440), _fmt(e)  # equal times mean the whole day ("00:00" to "23:59" in CDR terms)


def days(cdr_days: list[str] | None, notes: list[str], name: str) -> list[str]:
    ds = {d.upper() for d in cdr_days or []}
    if "PUBLIC_HOLIDAYS" in ds:
        ds.discard("PUBLIC_HOLIDAYS")
        notes.append(f"{name} also applies on public holidays, which the dashboard treats as normal days.")
    if not ds or ds >= ALL_DAYS:
        return ["all"]
    out = []
    wd, we = ds & WEEKDAYS, ds & WEEKENDS
    if wd:
        out.append("weekdays")
        if wd != WEEKDAYS:
            notes.append(
                f"{name} applies on some weekdays only ({', '.join(sorted(wd))}); it has been set to every weekday."
            )
    if we:
        out.append("weekends")
        if we != WEEKENDS:
            notes.append(f"{name} applies on one weekend day only; it has been set to both weekend days.")
    return out


# ---------------------------------------------------------------------------
# Search result summary
# ---------------------------------------------------------------------------


def summary(p: Plan, d: Plan) -> dict[str, Any]:
    """Headline prices (incl. GST) for one plan: `p` as listed, `d` its detail."""
    ec = d.get("electricityContract") or {}
    period = current_period(ec.get("tariffPeriod") or [])
    model = ec.get("pricingModel", "")
    rates = []
    if period and period.get("rateBlockUType") == "timeOfUseRates":
        for r in period.get("timeOfUseRates") or []:
            x = price(r.get("rates"))
            if x is not None:
                rates.append(
                    {"name": BAND_NAMES.get(r.get("type"), r.get("displayName", "Rate")), "price": round(x * GST, 4)}
                )
    elif period and period.get("singleRate"):
        x = price(period["singleRate"].get("rates"))
        if x is not None:
            rates.append({"name": "All times", "price": round(x * GST, 4)})
    sup = supply(period)
    return {
        "id": p["planId"],
        "name": d.get("displayName") or p.get("displayName", ""),
        "type": d.get("type") or p.get("type", ""),
        "pricing": "tou"
        if model.startswith("TIME_OF_USE")
        else "flat"
        if model.startswith("SINGLE_RATE")
        else model.lower(),
        "controlled_load": "CONT_LOAD" in model or bool(ec.get("controlledLoad")),
        "demand": any(tp.get("demandCharges") for tp in ec.get("tariffPeriod") or []),
        "rates": rates,
        "supply": round(sup * GST, 4) if sup is not None else None,
        "feed_in": feed_in(ec)[0],
        "updated": (d.get("lastUpdated") or "")[:10],
    }


# ---------------------------------------------------------------------------
# Plan -> tariff
# ---------------------------------------------------------------------------


def _week_minutes(band: dict[str, Any]) -> int:
    """Minutes of the week a band's windows cover."""
    total = 0
    for w in band["windows"]:
        s, e = hm(w["start"]), hm(w["end"])
        assert s is not None and e is not None  # written by window_times, so always HH:MM
        span = (e - s) % 1440 or 1440
        total += span * (7 if w["days"] == "all" else 5 if w["days"] == "weekdays" else 2)
    return total


def to_tariff(brand: Brand, plan_id: str, d: Plan, current: Tariff) -> dict[str, Any]:
    """
    The plan `d` (detail) as a validated tariff, plus notes on anything simplified.
    `current` is the tariff in force: its flat rate and supply charge fill anything the plan leaves out.
    Raises ValueError with a message fit to show on the page.
    """
    ec = d.get("electricityContract") or {}
    periods = ec.get("tariffPeriod") or []
    period = current_period(periods)
    if not period:
        raise ValueError("This plan doesn't publish usage rates, so it can't be imported. Enter the rates by hand.")
    notes: list[str] = []
    if len(periods) > 1:
        notes.append(
            f"This plan has seasonal rates. The rates for the current season ({period.get('displayName', 'this period')}, "
            f"{period.get('startDate')} to {period.get('endDate')}) are used; update them when the season changes."
        )
    if any(p.get("demandCharges") for p in periods):
        notes.append("This plan also has demand charges (based on your peak kW), which the dashboard doesn't include.")
    if "CONT_LOAD" in ec.get("pricingModel", "") or ec.get("controlledLoad"):
        notes.append(
            "This plan includes a controlled load tariff (for example, hot water on a separate circuit). "
            "That circuit isn't measured by the inverter, so it isn't included."
        )
    if ec.get("discounts"):
        notes.append("Conditional discounts (for example, pay on time) aren't included in the rates.")

    sup = supply(period)
    fit, fit_notes = feed_in(ec)
    notes += fit_notes
    t: Tariff = {
        "type": "flat",
        "flat_rate": current["flat_rate"],
        "bands": [],
        "feed_in_rate": fit if fit is not None else 0.0,
        "supply_charge": round(sup * GST, 4) if sup is not None else current["supply_charge"],
        "source": {
            "brand": brand["name"],
            "brand_id": brand["id"],
            "plan_id": plan_id,
            "plan_name": d.get("displayName", ""),
            "updated": (d.get("lastUpdated") or "")[:10],
            "imported": time.strftime("%Y-%m-%d"),
        },
    }
    if fit is None:
        notes.append("No retailer feed-in rate is listed for this plan, so feed-in is set to $0.00.")
    if sup is None:
        notes.append("No daily supply charge is listed, so your current one is kept.")

    kind = period.get("rateBlockUType")
    if kind == "singleRate":
        rates = (period.get("singleRate") or {}).get("rates") or []
        if len(rates) > 1:
            notes.append(
                "This plan has stepped usage rates (a different price after a set amount each period). The first step's price is used."
            )
        x = price(rates)
        if x is None:
            raise ValueError("This plan's usage rate couldn't be read. Enter it by hand.")
        t["flat_rate"] = round(x * GST, 4)
    elif kind == "timeOfUseRates":
        bands: list[dict[str, Any]] = []
        seen: dict[str, int] = {}
        for r in period.get("timeOfUseRates") or []:
            name = BAND_NAMES.get(r.get("type"), (r.get("displayName") or "Rate")[:24])
            seen[name] = seen.get(name, 0) + 1
            if seen[name] > 1:
                name = f"{name} {seen[name]}"
            x = price(r.get("rates"))
            if x is None:
                continue
            if len(r.get("rates") or []) > 1:
                notes.append(f"{name} has stepped rates. The first step's price is used.")
            wins = []
            for w in r.get("timeOfUse") or []:
                times = window_times(w.get("startTime"), w.get("endTime"))
                if not times:
                    continue
                for dd in days(w.get("days"), notes, name):
                    wins.append({"days": dd, "start": times[0], "end": times[1]})
            bands.append({"name": name, "rate": round(x * GST, 4), "windows": wins[:MAX_WINDOWS]})
        if len(bands) < 2:
            raise ValueError("This plan's time-of-use rates couldn't be read. Enter them by hand.")
        # The rate covering the most of the week becomes "all other times", so gaps fall into it.
        other = max(range(len(bands)), key=lambda i: _week_minutes(bands[i]))
        bands[other]["other"] = True
        bands[other]["windows"] = []
        t["type"], t["bands"] = "tou", bands[:MAX_BANDS]
    else:
        raise ValueError("This plan only has demand-based rates, which the dashboard doesn't support.")

    try:
        clean = validate(t)
    except ValueError as e:
        raise ValueError(f"This plan's rates couldn't be converted automatically ({e}) Enter them by hand.") from None
    return {
        "tariff": clean,
        "notes": notes,
        "plan": {
            "name": d.get("displayName", ""),
            "brand": brand["name"],
            "id": plan_id,
            "type": d.get("type", ""),
            "updated": (d.get("lastUpdated") or "")[:10],
        },
    }
