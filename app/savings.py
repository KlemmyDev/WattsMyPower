"""
Figures for the Savings page: this quarter's bill, system payback, and what a
year of your actual usage would cost on other retailers' published plans.

Bills are priced exactly like /api/costs (each 5 minutes at the rate in force,
scaled to the inverter's daily counters). The rest of the quarter is estimated
from your average full day over the last 30 days.

Plan comparison builds a usage profile once - grid import and export for every
5-minute slot of a weekday and a weekend day, from complete days in the last
year - so pricing each plan is a few hundred multiplications.
"""

from __future__ import annotations

import concurrent.futures as cf
import logging
import time
from contextlib import closing

from . import db, plans, settings, tariffs

log = logging.getLogger(__name__)

COMPLETE = 230          # 5-minute readings (of 288) for a day to count as complete
MIN_PROFILE_DAYS = 3    # complete days needed before plan costs are estimated
MAX_COMPARE = 80        # plans priced per comparison
SHOW = 6                # cheapest alternatives returned

_profile: dict = {"at": 0.0, "data": None}


def _ts(y: int, m: int, d: int = 1) -> int:
    return int(time.mktime((y, m, d, 0, 0, 0, 0, 0, -1)))


def _date(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def _complete_days(start: int, end: int) -> set[str]:
    sql = ("SELECT date(ts, 'unixepoch', 'localtime') AS d, COUNT(*) FROM samples_5m "
           "WHERE ts >= ? AND ts < ? AND grid_power IS NOT NULL GROUP BY d")
    with closing(db.connect(readonly=True)) as conn:
        return {d for d, n in conn.execute(sql, (start, end)) if n >= COMPLETE}


def _without_solar(day: dict) -> float:
    """What the day's home use would have cost from the grid alone (usage plus supply)."""
    return sum(b["home_kwh"] * b["rate"] for b in day["bands"]) + day["supply"]


# ---------------------------------------------------------------------------
# This quarter's bill
# ---------------------------------------------------------------------------

def bill(now: int) -> dict:
    lt = time.localtime(now)
    q0 = (lt.tm_mon - 1) // 3 * 3 + 1
    qstart, qend = _ts(lt.tm_year, q0), _ts(lt.tm_year, q0 + 3)  # mktime rolls month 13 into January
    today = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday)
    total_days = round((qend - qstart) / 86400)
    day_index = round((today - qstart) / 86400) + 1
    start30 = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - 30)

    days = tariffs.costs(min(qstart, start30), now + 1)["days"]
    complete = _complete_days(start30, today)
    tdate, qdate = _date(today), _date(qstart)
    keys = ("import_kwh", "import_cost", "export_kwh", "feed_in_credit", "supply", "net_cost", "saved")

    def total(rows):
        out = {k: round(sum(r[k] for r in rows), 2) for k in keys}
        out["without_solar"] = round(sum(_without_solar(r) for r in rows), 2)
        out["days"] = len(rows)
        return out

    in_q = [d for d in days if d["date"] >= qdate]
    so_far = total(in_q)
    basis = [d for d in days if d["date"] in complete and d["date"] != tdate]
    estimate = None
    if basis:
        avg = {k: v / len(basis) for k, v in total(basis).items() if k != "days"}
        done = total([d for d in in_q if d["date"] != tdate])  # whole days so far; today onwards is estimated
        left = total_days - day_index + 1
        estimate = {k: round(done[k] + avg[k] * left, 2) for k in avg}
        # Supply is known exactly.
        estimate["supply"] = round(tariffs.get()["supply_charge"] * total_days, 2)
        estimate["net_cost"] = round(estimate["import_cost"] + estimate["supply"] - estimate["feed_in_credit"], 2)
    return {
        "start": qstart, "end": qend - 86400, "day": day_index, "days": total_days,
        "so_far": so_far, "estimate": estimate, "basis_days": len(basis),
    }


# ---------------------------------------------------------------------------
# Payback
# ---------------------------------------------------------------------------

def payback(latest: dict | None, recent: list[dict]) -> dict:
    """
    Savings since install, estimated from the inverter's lifetime counters at
    today's rates: home use covered by solar or the battery at the average rate
    you'd otherwise have paid, plus feed-in credit.
    """
    t = tariffs.get()
    p = latest or {}
    # The hybrid's own solar only: a second system's lifetime counter can predate the hybrid's
    # meter, so its early output was never seen as exported and would all count as saved.
    pv, exp = p.get("total_pv1", p.get("total_pv")), p.get("total_export")
    chg, dis = p.get("total_charge") or 0, p.get("total_discharge") or 0
    selfu = sum(sum(b["self_kwh"] for b in d["bands"]) for d in recent)
    worth = sum(sum(b["saved"] for b in d["bands"]) for d in recent)
    if selfu > 1:
        rate = worth / selfu  # what self-supplied energy has actually been worth per kWh lately
    else:  # no full days yet: the import rate averaged over the week's minutes
        tab = tariffs._build_tables(t)
        rates = [b["rate"] for b in tab["bands"]]
        rate = (5 * sum(rates[i] for i in tab["weekday"]) + 2 * sum(rates[i] for i in tab["weekend"])) / (7 * 1440)
    lifetime = None
    if pv is not None and exp is not None:
        self_kwh = max(0.0, pv - exp + dis - chg)
        lifetime = round(self_kwh * rate + exp * t["feed_in_rate"], 2)
    per_day = sum(d["saved"] for d in recent) / len(recent) if recent else None
    return {
        "system_cost": settings.get("system_cost") or None,
        "saved_lifetime": lifetime,
        "rate": round(rate, 4),
        "per_month": round(per_day * 365.25 / 12, 2) if per_day is not None else None,
        "basis_days": len(recent),
    }


def build(latest: dict | None) -> dict:
    now = int(time.time())
    lt = time.localtime(now)
    today = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday)
    start30 = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - 30)
    complete = _complete_days(start30, today)
    recent = [d for d in tariffs.costs(start30, today)["days"] if d["date"] in complete]
    return {"generated_at": now, "bill": bill(now), "payback": payback(latest, recent),
            "profile_days": _usage_profile(now)["days"], "min_profile_days": MIN_PROFILE_DAYS}


# ---------------------------------------------------------------------------
# Plan comparison
# ---------------------------------------------------------------------------

def _usage_profile(now: int) -> dict:
    """Grid import/export (kWh) per 5-minute slot for weekdays and weekends, over complete days in the last year."""
    if _profile["data"] is not None and now - _profile["at"] < 600:
        return _profile["data"]
    lt = time.localtime(now)
    today = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday)
    start = _ts(lt.tm_year - 1, lt.tm_mon, lt.tm_mday)
    kwh = 300 / 3.6e6
    with closing(db.connect(readonly=True)) as conn:
        rows = conn.execute("SELECT ts, grid_power FROM samples_5m WHERE ts >= ? AND ts < ? AND grid_power IS NOT NULL",
                            (start, today)).fetchall()
    counters = {d["date"]: d for d in db.daily(start, today)}
    per_day: dict[str, list] = {}
    for ts, g in rows:
        lt2 = time.localtime(ts + 150)
        per_day.setdefault(time.strftime("%Y-%m-%d", lt2), []).append(
            (lt2.tm_wday >= 5, (lt2.tm_hour * 60 + lt2.tm_min) // 5, max(g, 0) * kwh, max(-g, 0) * kwh))
    imp = {False: [0.0] * 288, True: [0.0] * 288}
    exp_total, n = 0.0, {False: 0, True: 0}
    for date, slots in per_day.items():
        if len(slots) < COMPLETE:
            continue
        raw_i, raw_e = sum(s[2] for s in slots), sum(s[3] for s in slots)
        c = counters.get(date) or {}
        # Scale to the inverter's own counters, like the bill does.
        fi = (c.get("daily_import") or 0) / raw_i if raw_i > 0 and c.get("daily_import") is not None else 1.0
        exp_total += c.get("daily_export") if c.get("daily_export") is not None else raw_e
        weekend = slots[0][0]
        n[weekend] += 1
        for _, slot, i, _e in slots:
            imp[weekend][slot] += i * fi
    data = {"days": n[False] + n[True], "weekdays": n[False], "weekends": n[True], "imp": imp, "exp": exp_total}
    _profile.update(at=now, data=data)
    return data


def yearly_cost(t: dict, prof: dict) -> dict:
    """A year on this tariff, from the usage profile (weekdays and weekends weighted 5:2)."""
    tab = tariffs._build_tables(t)
    rates = [b["rate"] for b in tab["bands"]]
    usage = 0.0
    for weekend, share in ((False, 5 / 7), (True, 2 / 7)):
        # No days of this kind yet: price the other kind's usage on this kind's rates.
        src = weekend if prof["weekends" if weekend else "weekdays"] else not weekend
        table = tab["weekend" if weekend else "weekday"]
        per_day = sum(kwh * rates[table[s * 5 + 2]] for s, kwh in enumerate(prof["imp"][src])) / prof["weekends" if src else "weekdays"]
        usage += per_day * 365 * share
    exported = prof["exp"] / prof["days"] * 365
    imported = sum(map(sum, prof["imp"].values())) / prof["days"] * 365
    supply = t["supply_charge"] * 365
    credit = exported * t["feed_in_rate"]
    return {"total": round(usage + supply - credit, 2), "usage": round(usage, 2), "supply": round(supply, 2),
            "credit": round(credit, 2), "import_kwh": round(imported), "export_kwh": round(exported)}


def compare(brand_id: str, postcode: str) -> dict:
    now = int(time.time())
    prof = _usage_profile(now)
    current = tariffs.get()
    out = {"profile_days": prof["days"], "min_days": MIN_PROFILE_DAYS, "current": {"tariff": current}, "plans": [], "skipped": 0}
    if prof["days"] < MIN_PROFILE_DAYS:
        return out
    out["current"]["cost"] = yearly_cost(current, prof)
    found = plans.search(brand_id, postcode)
    out["brand"], out["postcode"] = found["brand"], found["postcode"]
    # Controlled load and demand charges can't be measured or priced here, so leave those plans out.
    candidates = [p for p in found["plans"] if not p["controlled_load"] and not p["demand"]][:MAX_COMPARE]
    out["excluded"] = len(found["plans"]) - len(candidates)

    def price(p):
        try:
            conv = plans.to_tariff(brand_id, p["id"])
        except Exception as e:  # plans that can't be converted are skipped, not fatal
            log.info("compare: plan %s skipped: %s", p["id"], e)
            return None
        return {"id": p["id"], "name": p["name"], "type": p["type"], "tariff": conv["tariff"],
                # Anything simplified in the conversion (time-varying feed-in, stepped or seasonal rates) makes the cost approximate.
                "notes": conv["notes"], "cost": yearly_cost(conv["tariff"], prof)}

    with cf.ThreadPoolExecutor(8) as ex:
        priced = list(ex.map(price, candidates))
    ok = [p for p in priced if p]
    out["skipped"] = len(priced) - len(ok)
    out["checked"] = len(ok)
    ok.sort(key=lambda p: p["cost"]["total"])
    # Retailers often publish the same plan once per network area; show each name and price once.
    seen, unique = set(), []
    for p in ok:
        key = (p["name"].lower(), round(p["cost"]["total"]))
        if key not in seen:
            seen.add(key)
            unique.append(p)
    ok = unique
    # The current plan, if it came from this retailer, is shown as "your plan" rather than as an alternative.
    src = current.get("source") or {}
    out["plans"] = [p for p in ok if not (src.get("brand_id") == brand_id and src.get("plan_id") == p["id"])][:SHOW]
    return out
