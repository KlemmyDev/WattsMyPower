"""
Look up retail electricity plans from the Consumer Data Right "energy product
reference data" APIs (the same data Energy Made Easy shows), and turn one into
our tariff format.

- The AER hosts every retailer's plan data at https://cdr.energymadeeasy.gov.au/<brand>,
  with GET .../cds-au/v1/energy/plans and .../plans/{planId}. No login needed.
  (Retailers' own CDR hosts in the CDR Register don't serve plan data, and unknown
  brands just return an empty list, so the brand slugs come from the AER's published
  "Energy Retailer Base URIs" list, bundled as retailers.json - January 2026 edition,
  filtered to brands that currently publish electricity plans.)
- CDR prices exclude GST; we add 10% to usage and supply charges so they match a
  household bill. Feed-in tariffs aren't subject to GST for households.

Only brand ids from the register are ever turned into URLs, and plan ids are
checked against a strict pattern, so requests can only go to registered retailers.
"""

from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import re
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

from . import tariffs

log = logging.getLogger(__name__)

AER_HOST = "https://cdr.energymadeeasy.gov.au"
RETAILERS = Path(__file__).with_name("retailers.json")
GST = 1.10
PLAN_ID = re.compile(r"^[A-Za-z0-9@._\-]{3,80}$")
MAX_DETAILS = 400  # plan details fetched per search (then cached for a day)
ALL_DAYS = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}
WEEKDAYS = {"MON", "TUE", "WED", "THU", "FRI"}
WEEKENDS = {"SAT", "SUN"}
BAND_NAMES = {"PEAK": "Peak", "OFF_PEAK": "Off-peak", "SHOULDER": "Shoulder", "SHOULDER1": "Shoulder 1", "SHOULDER2": "Shoulder 2"}

_lock = threading.Lock()
_cache: dict[str, tuple[float, object]] = {}


def _cached(key: str, ttl: float, fn):
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (time.time(), value)
    return value


def _get(url: str, version: str) -> dict:
    req = urllib.request.Request(url, headers={"x-v": version, "x-min-v": "1", "Accept": "application/json", "User-Agent": "WattsMyPower"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


# ---------------------------------------------------------------------------
# Retailers and plans
# ---------------------------------------------------------------------------

def brands() -> list[dict]:
    def load():
        rows = json.loads(RETAILERS.read_text())
        return sorted(({"id": r["slug"], "name": r["name"], "base": f"{AER_HOST}/{r['slug']}"} for r in rows), key=lambda b: b["name"].lower())
    return _cached("brands", 24 * 3600, load)


def _brand(brand_id: str) -> dict:
    for b in brands():
        if b["id"] == brand_id:
            return b
    raise ValueError("Unknown retailer.")


def _plan_list(brand: dict) -> list[dict]:
    def load():
        plans, page = [], 1
        while True:
            q = urllib.parse.urlencode({"fuelType": "ELECTRICITY", "effective": "CURRENT", "type": "ALL", "page": page, "page-size": 1000})
            d = _get(f"{brand['base']}/cds-au/v1/energy/plans?{q}", "1")
            plans += d["data"]["plans"]
            if page >= int(d.get("meta", {}).get("totalPages") or 1) or page >= 10:
                return plans
            page += 1
    return _cached(f"list:{brand['id']}", 6 * 3600, load)


def _detail(brand: dict, plan_id: str) -> dict:
    if not PLAN_ID.match(plan_id):
        raise ValueError("Invalid plan id.")
    url = f"{brand['base']}/cds-au/v1/energy/plans/{urllib.parse.quote(plan_id, safe='@')}"
    return _cached(f"plan:{brand['id']}:{plan_id}", 24 * 3600, lambda: _get(url, "3")["data"])


def _serves(plan: dict, postcode: str) -> bool:
    g = plan.get("geography") or {}
    if postcode in (g.get("excludedPostcodes") or []):
        return False
    inc = g.get("includedPostcodes")
    return not inc or postcode in inc


def search(brand_id: str, postcode: str, query: str = "") -> dict:
    if not re.fullmatch(r"\d{4}", postcode or ""):
        raise ValueError("Enter a four-digit postcode.")
    brand = _brand(brand_id)
    q = (query or "").strip().lower()
    matches = [p for p in _plan_list(brand)
               if p.get("customerType", "RESIDENTIAL") == "RESIDENTIAL" and _serves(p, postcode)
               and (not q or q in p.get("displayName", "").lower())]
    truncated = len(matches) > MAX_DETAILS
    matches = matches[:MAX_DETAILS]

    def summarise(p):
        try:
            return _summary(p, _detail(brand, p["planId"]))
        except Exception as e:  # one bad plan shouldn't sink the search
            log.info("plan %s detail failed: %s", p.get("planId"), e)
            return None

    with cf.ThreadPoolExecutor(12) as ex:
        out = [s for s in ex.map(summarise, matches) if s]
    # Market offers first, then by name; identical names stay distinguishable by their prices.
    out.sort(key=lambda s: (s["type"] != "MARKET", s["name"].lower(), s["pricing"]))
    return {"brand": brand["name"], "postcode": postcode, "plans": out, "truncated": truncated, "limit": MAX_DETAILS}


def _summary(p: dict, d: dict) -> dict:
    ec = d.get("electricityContract") or {}
    period = _current_period(ec.get("tariffPeriod") or [])
    model = ec.get("pricingModel", "")
    rates = []
    if period and period.get("rateBlockUType") == "timeOfUseRates":
        for r in period.get("timeOfUseRates") or []:
            price = _price(r.get("rates"))
            if price is not None:
                rates.append({"name": BAND_NAMES.get(r.get("type"), r.get("displayName", "Rate")), "price": round(price * GST, 4)})
    elif period and period.get("singleRate"):
        price = _price(period["singleRate"].get("rates"))
        if price is not None:
            rates.append({"name": "All times", "price": round(price * GST, 4)})
    supply = _supply(period)
    return {
        "id": p["planId"], "name": d.get("displayName") or p.get("displayName", ""), "type": d.get("type") or p.get("type", ""),
        "pricing": "tou" if model.startswith("TIME_OF_USE") else "flat" if model.startswith("SINGLE_RATE") else model.lower(),
        "controlled_load": "CONT_LOAD" in model or bool(ec.get("controlledLoad")),
        "demand": any(tp.get("demandCharges") for tp in ec.get("tariffPeriod") or []),
        "rates": rates, "supply": round(supply * GST, 4) if supply is not None else None,
        "feed_in": _feed_in(ec)[0], "updated": (d.get("lastUpdated") or "")[:10],
    }


# ---------------------------------------------------------------------------
# Plan -> tariff
# ---------------------------------------------------------------------------

def _price(rates) -> float | None:
    try:
        return float(rates[0]["unitPrice"])
    except (TypeError, KeyError, IndexError, ValueError):
        return None


def _supply(period: dict | None) -> float | None:
    if not period:
        return None
    try:
        if period.get("dailySupplyCharge") is not None:
            return float(period["dailySupplyCharge"])
        bands = period.get("bandedDailySupplyCharges") or []
        return float(bands[0]["unitPrice"]) if bands else None
    except (TypeError, ValueError, KeyError):
        return None


def _current_period(periods: list[dict]) -> dict | None:
    """The tariff period (season) covering today; periods use mm-dd and can wrap the new year."""
    today = time.strftime("%m-%d")
    for p in periods:
        s, e = p.get("startDate", "01-01"), p.get("endDate", "12-31")
        if (s <= today <= e) if s <= e else (today >= s or today <= e):
            return p
    return periods[0] if periods else None


def _feed_in(ec: dict) -> tuple[float | None, list[str]]:
    """Retailer feed-in rate, plus notes about anything simplified."""
    notes, best = [], None
    for f in ec.get("solarFeedInTariff") or []:
        if f.get("payerType") == "GOVERNMENT":
            price = _price((f.get("singleTariff") or {}).get("rates"))
            notes.append(f"Also lists {f.get('displayName', 'a government feed-in scheme')}"
                         + (f" ({price * 100:.0f}c per kWh)" if price else "")
                         + ". That rate only applies to customers already on the scheme, so it isn't used.")
            continue
        if f.get("tariffUType") == "singleTariff":
            price = _price((f.get("singleTariff") or {}).get("rates"))
        else:
            vary = f.get("timeVaryingTariffs") or []
            prices = [p for p in (_price(v.get("rates")) for v in vary) if p is not None]
            price = max(prices) if prices else None
            if prices:
                notes.append("The feed-in rate varies by time of day. The highest rate is used, because the dashboard supports one feed-in rate.")
        if price is not None and best is None:
            best = round(price, 4)
    return best, notes


def _hm(t: str) -> int | None:
    m = re.match(r"^(\d{1,2}):?(\d{2})", t or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _window_times(start: str, end: str) -> tuple[str, str] | None:
    s, e = _hm(start), _hm(end)
    if s is None or e is None:
        return None
    if e % 5 == 4:  # CDR end times are usually inclusive ("20:59" means up to 21:00)
        e += 1
    e %= 1440
    fmt = lambda m: f"{m // 60:02d}:{m % 60:02d}"
    return fmt(s % 1440), fmt(e)  # equal times mean the whole day ("00:00" to "23:59" in CDR terms)


def _days(days: list[str], notes: list[str], name: str) -> list[str]:
    ds = {d.upper() for d in days or []}
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
            notes.append(f"{name} applies on some weekdays only ({', '.join(sorted(wd))}); it has been set to every weekday.")
    if we:
        out.append("weekends")
        if we != WEEKENDS:
            notes.append(f"{name} applies on one weekend day only; it has been set to both weekend days.")
    return out


def to_tariff(brand_id: str, plan_id: str) -> dict:
    brand = _brand(brand_id)
    d = _detail(brand, plan_id)
    ec = d.get("electricityContract") or {}
    periods = ec.get("tariffPeriod") or []
    period = _current_period(periods)
    if not period:
        raise ValueError("This plan doesn't publish usage rates, so it can't be imported. Enter the rates by hand.")
    notes: list[str] = []
    if len(periods) > 1:
        notes.append(f"This plan has seasonal rates. The rates for the current season ({period.get('displayName', 'this period')}, "
                     f"{period.get('startDate')} to {period.get('endDate')}) are used; update them when the season changes.")
    if any(p.get("demandCharges") for p in periods):
        notes.append("This plan also has demand charges (based on your peak kW), which the dashboard doesn't include.")
    if "CONT_LOAD" in ec.get("pricingModel", "") or ec.get("controlledLoad"):
        notes.append("This plan includes a controlled load tariff (for example, hot water on a separate circuit). "
                     "That circuit isn't measured by the inverter, so it isn't included.")
    if ec.get("discounts"):
        notes.append("Conditional discounts (for example, pay on time) aren't included in the rates.")

    supply = _supply(period)
    fit, fit_notes = _feed_in(ec)
    notes += fit_notes
    cur = tariffs.get()
    t = {
        "type": "flat", "flat_rate": cur["flat_rate"], "bands": [],
        "feed_in_rate": fit if fit is not None else 0.0,
        "supply_charge": round(supply * GST, 4) if supply is not None else cur["supply_charge"],
        "source": {"brand": brand["name"], "brand_id": brand["id"], "plan_id": plan_id,
                   "plan_name": d.get("displayName", ""), "updated": (d.get("lastUpdated") or "")[:10],
                   "imported": time.strftime("%Y-%m-%d")},
    }
    if fit is None:
        notes.append("No retailer feed-in rate is listed for this plan, so feed-in is set to $0.00.")
    if supply is None:
        notes.append("No daily supply charge is listed, so your current one is kept.")

    kind = period.get("rateBlockUType")
    if kind == "singleRate":
        rates = (period.get("singleRate") or {}).get("rates") or []
        if len(rates) > 1:
            notes.append("This plan has stepped usage rates (a different price after a set amount each period). The first step's price is used.")
        price = _price(rates)
        if price is None:
            raise ValueError("This plan's usage rate couldn't be read. Enter it by hand.")
        t["flat_rate"] = round(price * GST, 4)
    elif kind == "timeOfUseRates":
        bands, seen = [], {}
        for r in period.get("timeOfUseRates") or []:
            name = BAND_NAMES.get(r.get("type"), (r.get("displayName") or "Rate")[:24])
            seen[name] = seen.get(name, 0) + 1
            if seen[name] > 1:
                name = f"{name} {seen[name]}"
            price = _price(r.get("rates"))
            if price is None:
                continue
            if len(r.get("rates") or []) > 1:
                notes.append(f"{name} has stepped rates. The first step's price is used.")
            wins = []
            for w in r.get("timeOfUse") or []:
                times = _window_times(w.get("startTime"), w.get("endTime"))
                if not times:
                    continue
                for days in _days(w.get("days"), notes, name):
                    wins.append({"days": days, "start": times[0], "end": times[1]})
            bands.append({"name": name, "rate": round(price * GST, 4), "windows": wins[: tariffs.MAX_WINDOWS]})
        if len(bands) < 2:
            raise ValueError("This plan's time-of-use rates couldn't be read. Enter them by hand.")
        # The rate covering the most of the week becomes "all other times", so gaps fall into it.
        def minutes(b):
            total = 0
            for w in b["windows"]:
                s, e = _hm(w["start"]), _hm(w["end"])
                span = (e - s) % 1440 or 1440
                total += span * (7 if w["days"] == "all" else 5 if w["days"] == "weekdays" else 2)
            return total
        other = max(range(len(bands)), key=lambda i: minutes(bands[i]))
        bands[other]["other"] = True
        bands[other]["windows"] = []
        t["type"], t["bands"] = "tou", bands[: tariffs.MAX_BANDS]
    else:
        raise ValueError("This plan only has demand-based rates, which the dashboard doesn't support.")

    try:
        clean = tariffs.validate(t)
    except ValueError as e:
        raise ValueError(f"This plan's rates couldn't be converted automatically ({e}) Enter them by hand.") from None
    return {"tariff": clean, "notes": notes, "plan": {"name": d.get("displayName", ""), "brand": brand["name"], "id": plan_id,
                                                      "type": d.get("type", ""), "updated": (d.get("lastUpdated") or "")[:10]}}
