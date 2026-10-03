"""
The Bills page: the current billing period so far and its expected total, the next few bills,
past bills, and where this period's money went.

Billing periods follow Settings > Billing: every 1, 2 or 3 months from a day of the month (1-28),
in step with a month a bill starts in. Days are priced like /api/costs, at today's rates (on Amber,
at the prices of the time). Days
still to come are estimated from the same week last year where there are complete days to go on,
otherwise from the average complete day over the last 30 days.

Days covered by imported smart-meter data use the meter's import and export (see
app.features.tariffs.costs), and each day and bill says how many of its days did.
"""

from __future__ import annotations

import datetime as dt
import time
from typing import Any

from app.core.database import Database
from app.features.amber.repository import PriceRepository
from app.features.bills.repository import BillsRepository
from app.features.meter.service import MeterService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.costs import daily_costs
from app.features.tariffs.store import TariffStore

COMPLETE = 230  # 5-minute readings (of 288) for a day to count as complete
LAST_YEAR = 364  # days back to the same weekday last year
NEAR = 3  # days either side of that to average over
MIN_NEAR = 3  # complete days needed there to go on last year
RECENT = 30  # days of recent use to fall back on
UPCOMING = 3  # bills estimated ahead

Day = dict[str, Any]
# Per-day figures that add up over a period. without_solar includes the day's supply charge.
FIELDS = ("import_kwh", "export_kwh", "home_kwh", "import_cost", "feed_in_credit", "without_solar")


def _month(y: int, m: int, d: int) -> dt.date:
    """date(y, m, d), with months past 12 or below 1 rolled into the next or previous year."""
    return dt.date(y + (m - 1) // 12, (m - 1) % 12 + 1, d)


def add_months(d: dt.date, n: int) -> dt.date:
    return _month(d.year, d.month + n, d.day)


def period_start(day: dt.date, months: int, start_day: int, anchor: int) -> dt.date:
    """The first day of the billing period `day` falls in."""
    m = day.month - (day.day < start_day)
    while (m - anchor) % months:
        m -= 1
    return _month(day.year, m, start_day)


def _ts(d: dt.date) -> int:
    return int(time.mktime((d.year, d.month, d.day, 0, 0, 0, 0, 0, -1)))


def _each_day(a: dt.date, b: dt.date) -> list[dt.date]:
    """Each day from a up to, not including, b."""
    return [a + dt.timedelta(k) for k in range((b - a).days)]


def _without_solar(day: Day) -> float:
    """What the day's home use would have cost from the grid alone (usage plus supply). On Amber, each band
    carries its own `home_cost`, priced interval by interval."""
    return float(sum(b.get("home_cost", b["home_kwh"] * b["rate"]) for b in day["bands"]) + day["supply"])


def _average(rows: list[Day]) -> Day:
    return {f: sum(r[f] for r in rows) / len(rows) for f in FIELDS}


class BillsService:
    def __init__(
        self,
        db: Database,
        readings: ReadingsRepository,
        settings: SettingsStore,
        tariffs: TariffStore,
        meter: MeterService | None = None,
        prices: PriceRepository | None = None,
    ):
        self.repo = BillsRepository(db)
        self.readings = readings
        self.settings = settings
        self.tariffs = tariffs
        self.meter = meter
        self.prices = prices

    def build(self, now: int) -> dict[str, Any]:
        t, tables = self.tariffs.current()
        supply = t["supply_charge"]
        months = int(self.settings.get("bill_months"))
        start_day = int(self.settings.get("bill_day"))
        anchor = int(self.settings.get("bill_anchor"))
        today = dt.date.fromtimestamp(now)
        cur_s = period_start(today, months, start_day, anchor)
        cur_e = add_months(cur_s, months)

        first = min(add_months(cur_s, -12), today - dt.timedelta(LAST_YEAR + NEAR))
        priced = daily_costs(self.readings, t, tables, _ts(first), now + 1, self.meter, self.prices)["days"]
        days = {d["date"]: {**d, "without_solar": _without_solar(d)} for d in priced}
        # Complete days: enough inverter readings, or covered by the meter's data.
        from_meter = {k for k, d in days.items() if d["source"] == "meter" and k < today.isoformat()}
        complete = (self.repo.complete_days(_ts(first), _ts(today), COMPLETE) | from_meter) & set(days)
        recent = [days[k] for k in complete if k >= (today - dt.timedelta(RECENT)).isoformat()]
        recent_avg = _average(recent) if recent else None

        def estimate(d: dt.date) -> tuple[Day | None, str | None]:
            src = d - dt.timedelta(LAST_YEAR)
            near = [(src + dt.timedelta(o)).isoformat() for o in range(-NEAR, NEAR + 1)]
            seen = [days[k] for k in near if k in complete]
            if len(seen) >= MIN_NEAR:
                return _average(seen), "last_year"
            return (recent_avg, "recent") if recent_avg else (None, None)

        def totals(parts: list[Day]) -> dict[str, float]:
            out = {f: round(sum(p[f] for p in parts), 2) for f in FIELDS}
            out["supply"] = round(supply * len(parts), 2)
            out["net_cost"] = round(out["import_cost"] + out["supply"] - out["feed_in_credit"], 2)
            return out

        def meter_days(parts: list[Day]) -> int:
            return sum(1 for p in parts if p.get("source") == "meter")

        def span(s: dt.date, e: dt.date) -> dict[str, Any]:
            return {"start": s.isoformat(), "end": (e - dt.timedelta(1)).isoformat(), "days": (e - s).days}

        def recorded(s: dt.date, e: dt.date, upto: dt.date) -> list[Day]:
            return [days[k] for d in _each_day(s, min(e, upto)) if (k := d.isoformat()) in days]

        def expected(s: dt.date, e: dt.date) -> dict[str, Any] | None:
            """A period's total: the days already recorded, and estimates for the rest (today included)."""
            parts, bases = [], set()
            for d in _each_day(s, e):
                k = d.isoformat()
                if d < today and k in days:
                    parts.append(days[k])
                    continue
                est, basis = estimate(d)
                if est is None:
                    return None
                parts.append(est)
                bases.add(basis)
            return {**totals(parts), "basis": bases.pop() if len(bases) == 1 else ("mixed" if bases else None)}

        # This period so far, day by day, with today's partial figures.
        so_far = recorded(cur_s, cur_e, today + dt.timedelta(1))
        pv = {d["date"]: d.get("daily_pv") for d in self.readings.daily(_ts(cur_s), now + 1)}
        bands = [
            {
                "name": b["name"],
                "import_kwh": round(sum(d["bands"][i]["import_kwh"] for d in so_far), 2),
                "cost": round(sum(d["bands"][i]["cost"] for d in so_far), 2),
            }
            for i, b in enumerate(tables.bands)
        ]

        past = []
        p = add_months(cur_s, -12)
        while p < cur_s:
            e = add_months(p, months)
            parts = recorded(p, e, cur_s)
            if parts:
                past.append({**span(p, e), "recorded": len(parts), "meter_days": meter_days(parts), **totals(parts)})
            p = e

        upcoming = []
        for k in range(1, UPCOMING + 1):
            s = add_months(cur_s, months * k)
            est = expected(s, add_months(s, months))
            upcoming.append({**span(s, add_months(s, months)), **est} if est else None)

        year = [
            expected(add_months(cur_e, months * k), add_months(cur_e, months * (k + 1))) for k in range(12 // months)
        ]
        next_year = (
            {
                "net_cost": round(sum(y["net_cost"] for y in year if y), 2),
                "without_solar": round(sum(y["without_solar"] for y in year if y), 2),
            }
            if all(year)
            else None
        )

        return {
            "generated_at": now,
            "months": months,
            "period": {**span(cur_s, cur_e), "day": (today - cur_s).days + 1},
            "current": {
                "so_far": {**totals(so_far), "days": len(so_far), "meter_days": meter_days(so_far)},
                "expected": expected(cur_s, cur_e),
            },
            "days": [
                {
                    "date": d["date"],
                    "net_cost": round(d["net_cost"], 2),
                    "import_kwh": round(d["import_kwh"], 2),
                    "export_kwh": round(d["export_kwh"], 2),
                    "pv_kwh": pv.get(d["date"]),
                    "source": d["source"],
                    "partial": d["date"] == today.isoformat(),
                }
                for d in so_far
            ],
            "bands": bands,
            "past": past,
            "upcoming": upcoming,
            "next_year": next_year,
        }
