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
from dataclasses import dataclass
from typing import Any

from app.core.cache import TTLCache
from app.core.database import Database
from app.features.plans.service import PlansService
from app.features.readings.repository import ReadingsRepository, Snapshot
from app.features.savings.repository import SavingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.costs import KWH_PER_W_5MIN, daily_costs
from app.features.tariffs.model import RateTables, Tariff, rate_tables
from app.features.tariffs.store import TariffStore

log = logging.getLogger(__name__)

COMPLETE = 230  # 5-minute readings (of 288) for a day to count as complete
MIN_PROFILE_DAYS = 3  # complete days needed before plan costs are estimated
MAX_COMPARE = 80  # plans priced per comparison
SHOW = 6  # cheapest alternatives returned
PROFILE_SECONDS = 600  # how long a usage profile is reused

Day = dict[str, Any]  # one day from daily_costs


@dataclass(frozen=True)
class UsageProfile:
    """Grid import (kWh) per 5-minute slot, summed over complete weekdays and weekend days, plus total export."""

    weekdays: int
    weekends: int
    imp: dict[bool, list[float]]  # weekend? -> 288 slots
    exp: float

    @property
    def days(self) -> int:
        return self.weekdays + self.weekends

    def count(self, weekend: bool) -> int:
        return self.weekends if weekend else self.weekdays


def _ts(y: int, m: int, d: int = 1) -> int:
    return int(time.mktime((y, m, d, 0, 0, 0, 0, 0, -1)))


def _date(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def _without_solar(day: Day) -> float:
    """What the day's home use would have cost from the grid alone (usage plus supply)."""
    return float(sum(b["home_kwh"] * b["rate"] for b in day["bands"]) + day["supply"])


def yearly_cost(t: Tariff, prof: UsageProfile) -> dict[str, Any]:
    """A year on this tariff, from the usage profile (weekdays and weekends weighted 5:2)."""
    tab = rate_tables(t)
    rates = [b["rate"] for b in tab.bands]
    usage = 0.0
    for weekend, share in ((False, 5 / 7), (True, 2 / 7)):
        # No days of this kind yet: price the other kind's usage on this kind's rates.
        src = weekend if prof.count(weekend) else not weekend
        per_day = sum(kwh * rates[tab.at(weekend, s * 5 + 2)] for s, kwh in enumerate(prof.imp[src])) / prof.count(src)
        usage += per_day * 365 * share
    exported = prof.exp / prof.days * 365
    imported = sum(map(sum, prof.imp.values())) / prof.days * 365
    supply = t["supply_charge"] * 365
    credit = exported * t["feed_in_rate"]
    return {
        "total": round(usage + supply - credit, 2),
        "usage": round(usage, 2),
        "supply": round(supply, 2),
        "credit": round(credit, 2),
        "import_kwh": round(imported),
        "export_kwh": round(exported),
    }


class SavingsService:
    def __init__(
        self,
        db: Database,
        readings: ReadingsRepository,
        settings: SettingsStore,
        tariffs: TariffStore,
        plans: PlansService,
    ):
        self.repo = SavingsRepository(db)
        self.readings = readings
        self.settings = settings
        self.tariffs = tariffs
        self.plans = plans
        self._profile = TTLCache()

    # -----------------------------------------------------------------------
    # This quarter's bill
    # -----------------------------------------------------------------------

    def bill(self, now: int, t: Tariff, tables: RateTables) -> dict[str, Any]:
        lt = time.localtime(now)
        q0 = (lt.tm_mon - 1) // 3 * 3 + 1
        qstart, qend = _ts(lt.tm_year, q0), _ts(lt.tm_year, q0 + 3)  # mktime rolls month 13 into January
        today = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday)
        total_days = round((qend - qstart) / 86400)
        day_index = round((today - qstart) / 86400) + 1
        start30 = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - 30)

        days = daily_costs(self.readings, t, tables, min(qstart, start30), now + 1)["days"]
        complete = self.repo.complete_days(start30, today, COMPLETE)
        tdate, qdate = _date(today), _date(qstart)
        keys = ("import_kwh", "import_cost", "export_kwh", "feed_in_credit", "supply", "net_cost", "saved")

        def total(rows: list[Day]) -> dict[str, Any]:
            out: dict[str, Any] = {k: round(sum(r[k] for r in rows), 2) for k in keys}
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
            estimate["supply"] = round(t["supply_charge"] * total_days, 2)
            estimate["net_cost"] = round(estimate["import_cost"] + estimate["supply"] - estimate["feed_in_credit"], 2)
        return {
            "start": qstart,
            "end": qend - 86400,
            "day": day_index,
            "days": total_days,
            "so_far": so_far,
            "estimate": estimate,
            "basis_days": len(basis),
        }

    # -----------------------------------------------------------------------
    # Payback
    # -----------------------------------------------------------------------

    def payback(self, latest: Snapshot | None, recent: list[Day], t: Tariff, tables: RateTables) -> dict[str, Any]:
        """
        Savings since install, estimated from the inverter's lifetime counters at
        today's rates: home use covered by solar or the battery at the average rate
        you'd otherwise have paid, plus feed-in credit.
        """
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
            rates = [b["rate"] for b in tables.bands]
            rate = (5 * sum(rates[i] for i in tables.weekday) + 2 * sum(rates[i] for i in tables.weekend)) / (7 * 1440)
        lifetime = None
        if pv is not None and exp is not None:
            self_kwh = max(0.0, pv - exp + dis - chg)
            lifetime = round(self_kwh * rate + exp * t["feed_in_rate"], 2)
        per_day = sum(d["saved"] for d in recent) / len(recent) if recent else None
        return {
            "system_cost": self.settings.get("system_cost") or None,
            "saved_lifetime": lifetime,
            "rate": round(rate, 4),
            "per_month": round(per_day * 365.25 / 12, 2) if per_day is not None else None,
            "basis_days": len(recent),
        }

    def build(self, latest: Snapshot | None) -> dict[str, Any]:
        """Everything on the Savings page except the plan comparison."""
        now = int(time.time())
        lt = time.localtime(now)
        today = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday)
        start30 = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday - 30)
        t, tables = self.tariffs.current()
        complete = self.repo.complete_days(start30, today, COMPLETE)
        recent = [d for d in daily_costs(self.readings, t, tables, start30, today)["days"] if d["date"] in complete]
        return {
            "generated_at": now,
            "bill": self.bill(now, t, tables),
            "payback": self.payback(latest, recent, t, tables),
            "profile_days": self.usage_profile(now).days,
            "min_profile_days": MIN_PROFILE_DAYS,
        }

    # -----------------------------------------------------------------------
    # Plan comparison
    # -----------------------------------------------------------------------

    def usage_profile(self, now: int) -> UsageProfile:
        """Grid import/export (kWh) per 5-minute slot for weekdays and weekends, over complete days in the last year."""
        profile: UsageProfile = self._profile.get_or_load("profile", PROFILE_SECONDS, lambda: self._load_profile(now))
        return profile

    def _load_profile(self, now: int) -> UsageProfile:
        lt = time.localtime(now)
        today = _ts(lt.tm_year, lt.tm_mon, lt.tm_mday)
        start = _ts(lt.tm_year - 1, lt.tm_mon, lt.tm_mday)
        rows = self.readings.rollups(start, today, ["grid_power"], not_null="grid_power")
        counters = {d["date"]: d for d in self.readings.daily(start, today)}
        per_day: dict[str, list[tuple[bool, int, float, float]]] = {}
        for ts, g in rows:
            lt2 = time.localtime(ts + 150)
            per_day.setdefault(time.strftime("%Y-%m-%d", lt2), []).append(
                (
                    lt2.tm_wday >= 5,
                    (lt2.tm_hour * 60 + lt2.tm_min) // 5,
                    max(g, 0) * KWH_PER_W_5MIN,
                    max(-g, 0) * KWH_PER_W_5MIN,
                )
            )
        imp: dict[bool, list[float]] = {False: [0.0] * 288, True: [0.0] * 288}
        exp_total = 0.0
        n = {False: 0, True: 0}
        for date, slots in per_day.items():
            if len(slots) < COMPLETE:
                continue
            raw_i, raw_e = sum(s[2] for s in slots), sum(s[3] for s in slots)
            c = counters.get(date) or {}
            # Scale to the inverter's own counters, like the bill does.
            fi = (c.get("daily_import") or 0) / raw_i if raw_i > 0 and c.get("daily_import") is not None else 1.0
            exp_total += c["daily_export"] if c.get("daily_export") is not None else raw_e
            weekend = slots[0][0]
            n[weekend] += 1
            for _, slot, i, _e in slots:
                imp[weekend][slot] += i * fi
        return UsageProfile(weekdays=n[False], weekends=n[True], imp=imp, exp=exp_total)

    def compare(self, brand_id: str, postcode: str) -> dict[str, Any]:
        """A year of your usage priced on each of a retailer's plans at a postcode, cheapest first."""
        now = int(time.time())
        prof = self.usage_profile(now)
        current = self.tariffs.get()
        out: dict[str, Any] = {
            "profile_days": prof.days,
            "min_days": MIN_PROFILE_DAYS,
            "current": {"tariff": current},
            "plans": [],
            "skipped": 0,
        }
        if prof.days < MIN_PROFILE_DAYS:
            return out
        out["current"]["cost"] = yearly_cost(current, prof)
        found = self.plans.search(brand_id, postcode)
        out["brand"], out["postcode"] = found["brand"], found["postcode"]
        # Controlled load and demand charges can't be measured or priced here, so leave those plans out.
        candidates = [p for p in found["plans"] if not p["controlled_load"] and not p["demand"]][:MAX_COMPARE]
        out["excluded"] = len(found["plans"]) - len(candidates)

        def price(p: dict[str, Any]) -> dict[str, Any] | None:
            try:
                conv = self.plans.to_tariff(brand_id, p["id"])
            except Exception as e:  # plans that can't be converted are skipped, not fatal
                log.info("compare: plan %s skipped: %s", p["id"], e)
                return None
            return {
                "id": p["id"],
                "name": p["name"],
                "type": p["type"],
                "tariff": conv["tariff"],
                # Anything simplified in the conversion (time-varying feed-in, stepped or seasonal rates) makes the cost approximate.
                "notes": conv["notes"],
                "cost": yearly_cost(conv["tariff"], prof),
            }

        with cf.ThreadPoolExecutor(8) as ex:
            priced = list(ex.map(price, candidates))
        ok = [p for p in priced if p]
        out["skipped"] = len(priced) - len(ok)
        out["checked"] = len(ok)
        ok.sort(key=lambda p: p["cost"]["total"])
        # Retailers often publish the same plan once per network area; show each name and price once.
        seen: set[tuple[str, int]] = set()
        unique = []
        for p in ok:
            key = (p["name"].lower(), round(p["cost"]["total"]))
            if key not in seen:
                seen.add(key)
                unique.append(p)
        # The current plan, if it came from this retailer, is shown as "your plan" rather than as an alternative.
        src = current.get("source") or {}
        out["plans"] = [p for p in unique if not (src.get("brand_id") == brand_id and src.get("plan_id") == p["id"])][
            :SHOW
        ]
        return out
