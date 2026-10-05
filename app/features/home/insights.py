"""
What the Home page says beyond where the power went (app.features.home.usage): what it cost, what's always on, what
no device measures, and when to run an appliance.

- **What each device cost** (`priced`). Each 5 minutes, the share of the home's use that came from the grid (what it
  imported over what it used) is taken as the share of each device's energy that did, and priced at the rate in force
  then (the tariff's, or Amber's price). The rest came from the panels or the battery, and costs nothing here. Each
  day is then scaled to the day's import cost as Bills works it out (app.features.tariffs.costs), so the devices and
  everything else add up to what Bills says the day cost.
- **Always on** (`standby`). The least the home draws through the night (NIGHT), on a typical night of the last
  STANDBY_DAYS, and each device's, with what that comes to over a year.
- **In everything else** (`unexplained`). Blocks of use no device measured, well above the day's floor, that come back
  at about the same time on several days (water heating early, cooking at dinner), with a guess at what they are.
- **The best time to run** an appliance that runs in cycles (`best_times`). From the solar forecast and the home's usual
  use by the hour, the first time today or tomorrow a typical run would be covered by spare solar; failing that, when
  it would cost least from the grid.

Hidden devices are left out of all of these, as they are of the breakdown.
"""

from __future__ import annotations

import time
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from statistics import median
from typing import Any

from app.features.amber.prices import PriceLookup
from app.features.home.repository import Device, HomeRepository
from app.features.home.types import KINDS
from app.features.home.usage import bucket_start
from app.features.readings.repository import KWH_PER_W_ROLLUP, ReadingsRepository
from app.features.tariffs.model import RateTables, Tariff

ROLLUP = 300
STANDBY_DAYS = 14
NIGHT = (1, 5)  # 01:00 to 05:00: little runs then but what's always on
UNEXPLAINED_DAYS = 14
STEP_W = 800  # above the day's floor by this much, use is a block worth explaining
BLOCK_MIN = 15  # the shortest block worth explaining, minutes
NEAR_MIN = 45  # blocks starting this close together (minutes into the day) are the same habit
RUN_FROM, RUN_UNTIL = 6, 22  # hours an appliance would be started in
SLOT = 900  # the best time is looked for every quarter hour
SOLAR_ENOUGH = 0.9  # a run this much covered by spare solar is as good as free
SOLAR_WORTH = 0.5  # below this, the cheapest time from the grid is suggested instead


@dataclass(frozen=True)
class Pricing:
    """The rate in force at any moment: the tariff's band, or Amber's import price (the single rate where Amber has
    none)."""

    tariff: Tariff
    tables: RateTables
    general: PriceLookup | None = None

    def rate(self, ts: float) -> float:
        if self.tariff["type"] == "amber":
            price = self.general.at(int(ts)) if self.general else None
            return price if price is not None else float(self.tariff["flat_rate"])
        lt = time.localtime(ts)
        return float(self.tables.bands[self.tables.at(lt.tm_wday >= 5, lt.tm_hour * 60 + lt.tm_min)]["rate"])

    def average(self, start: int, end: int) -> float:
        """The rate on average over [start, end), every half hour: what something on all the time pays."""
        times = range(start, end, 1800)
        return sum(self.rate(t) for t in times) / len(times) if times else float(self.tariff.get("flat_rate", 0))


def _date(ts: int) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def _home_w(pv: float | None, grid: float | None, bat: float | None) -> float:
    return max(0.0, (pv or 0) + (grid or 0) + (bat or 0))


def priced(
    out: dict[str, Any],
    repo: HomeRepository,
    readings: ReadingsRepository,
    pricing: Pricing,
    days: list[dict[str, Any]],
) -> dict[str, Any]:
    """The breakdown `out` (usage.breakdown) with what each device cost (`cost`, $) and the share of its energy that
    came from the panels or the battery (`solar_share`), and what the period cost (`total.cost`): what was imported
    (as Bills prices it, from `days`, daily_costs' days), the daily supply charges, the feed-in credit, and the import
    split between the devices and everything else."""
    start, end = out["start"], out["end"]
    share: dict[int, float] = {}  # rollup -> the share of the home's use the grid supplied
    imported: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])  # date -> [import $, import, home]
    for ts, pv, grid, bat in readings.rollups(start, end, ["pv_power", "grid_power", "battery_power"]):
        home, imp = _home_w(pv, grid, bat), max(grid or 0.0, 0.0)
        share[ts] = min(1.0, imp / home) if home > 0 else float(imp > 0)
        d = imported[_date(ts)]
        d[0] += imp * KWH_PER_W_ROLLUP * pricing.rate(ts)
        d[1] += imp
        d[2] += home
    bills = {d["date"]: d for d in days if start <= time.mktime(time.strptime(d["date"], "%Y-%m-%d")) < end}
    scale = {
        date: bills[date]["import_cost"] / d[0] if d[0] > 0 and date in bills else 1.0 for date, d in imported.items()
    }

    visible = {d["id"] for d in out["devices"]}
    cost: dict[int, float] = defaultdict(float)
    grid_kwh: dict[int, float] = defaultdict(float)
    for ts, device, kwh in repo.energy(start, end):
        if device not in visible:
            continue
        date = _date(ts)
        s = share.get(ts)
        if s is None:  # no reading then: as the day went on average (all from the grid, with no readings at all)
            day = imported.get(date)
            s = min(1.0, day[1] / day[2]) if day and day[2] > 0 else 1.0
        grid_kwh[device] += kwh * s
        cost[device] += kwh * s * pricing.rate(ts) * scale.get(date, 1.0)

    for d in out["devices"]:
        d["cost"] = round(cost[d["id"]], 4)
        d["solar_share"] = round(1 - grid_kwh[d["id"]] / d["total"], 3) if d["total"] > 0 else None
    import_cost = sum(b["import_cost"] for b in bills.values())
    devices = sum(cost.values())
    out["total"]["cost"] = {
        "import": round(import_cost, 2),
        "supply": round(sum(b["supply"] for b in bills.values()), 2),
        "credit": round(sum(b["feed_in_credit"] for b in bills.values()), 2),
        "devices": round(devices, 2),
        "other": round(max(0.0, import_cost - devices), 2),
    }
    return out


def _night(ts: int) -> int | None:
    """The night `ts` is in (as the day it's the early hours of), if it's in NIGHT."""
    lt = time.localtime(ts)
    return bucket_start(ts, "day") if NIGHT[0] <= lt.tm_hour < NIGHT[1] else None


def standby(repo: HomeRepository, readings: ReadingsRepository, pricing: Pricing, now: int) -> dict[str, Any]:
    """What the home draws all the time (W): the least it drew through each night of the last STANDBY_DAYS (the
    lowest 5-minute average), on a typical night. And each visible device's the same way (a device not using
    anything for 5 minutes has drawn 0 then), with what each comes to over a year at the average rate."""
    start = bucket_start(now - STANDBY_DAYS * 86400, "day")
    homes: dict[int, list[float]] = defaultdict(list)
    for ts, pv, grid, bat in readings.rollups(start, now, ["pv_power", "grid_power", "battery_power"]):
        if (night := _night(ts)) is not None:
            homes[night].append(_home_w(pv, grid, bat))
    full = (NIGHT[1] - NIGHT[0]) * 3600 // ROLLUP
    nights = {n: v for n, v in homes.items() if len(v) >= full // 2}  # read for at least half of it
    rate = pricing.average(start, now)
    yearly = lambda w: round(w / 1000 * 24 * 365 * rate, 2)  # noqa: E731
    if not nights:
        return {"nights": 0, "home_w": None, "yearly_cost": None, "devices": [], "measured_w": 0.0, "rate": rate}

    visible = {d.id for d in repo.devices() if not d.hidden}
    used: dict[int, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))  # device -> night -> W
    seen: dict[int, set[int]] = defaultdict(set)  # device -> nights it was being read
    for ts, device, kwh in repo.energy(start, now):
        if device in visible:
            seen[device].add(bucket_start(ts, "day"))
            if (night := _night(ts)) in nights:
                used[device][night].append(kwh / KWH_PER_W_ROLLUP)
    devices = []
    for device in visible:
        lows = [
            min(used[device][n]) if len(used[device][n]) >= len(nights[n]) else 0.0 for n in nights if n in seen[device]
        ]
        if lows and (w := median(lows)) >= 0.5:
            devices.append({"id": device, "w": round(w, 1), "yearly_cost": yearly(w)})
    home_w = median(min(v) for v in nights.values())
    devices.sort(key=lambda d: -d["w"])
    return {
        "nights": len(nights),
        "home_w": round(home_w),
        "yearly_cost": yearly(home_w),
        "devices": devices,
        "measured_w": round(sum(d["w"] for d in devices), 1),
        "rate": round(rate, 4),
    }


GUESSES = {
    "car": "a car charging",
    "hot_water": "water heating",
    "cooking": "cooking (an oven or cooktop)",
    "air_conditioning": "air conditioning or a heater",
    "pool_pump": "a pool pump",
}


def guess(start_min: float, minutes: float, kw: float) -> str | None:
    """What a block of use might be, from when it usually starts (minutes into the day), how long it lasts, and how
    much it draws (kW above the day's floor). None if nothing fits."""
    hour = start_min / 60
    if kw >= 3.2 and minutes >= 90:
        return "car"
    if kw >= 1.8 and minutes <= 150 and (hour < 8 or hour >= 21 or 9 <= hour < 15):
        return "hot_water"  # often on an off-peak or solar-soak timer
    if kw >= 1.0 and minutes <= 120 and 16 <= hour < 20:
        return "cooking"
    if kw >= 0.5 and minutes >= 90 and (hour >= 11 or hour < 2):
        return "air_conditioning"
    if 0.5 <= kw <= 1.6 and minutes >= 120 and 7 <= hour < 17:
        return "pool_pump"
    return None


def _blocks(rows: list[tuple[int, float]]) -> list[tuple[int, int, float]]:
    """(start, minutes, kWh above the floor) of each block of 5-minute rollups at least STEP_W above it, allowing a
    single rollup's dip, from (ts, W above the floor) oldest first."""
    out: list[tuple[int, int, float]] = []
    block: list[tuple[int, float]] = []
    dip = 0

    def close() -> None:
        while block and block[-1][1] < STEP_W:  # a block ends at its last rollup above the step
            block.pop()
        if len(block) * ROLLUP >= BLOCK_MIN * 60:
            out.append((block[0][0], len(block) * ROLLUP // 60, sum(w for _, w in block) * KWH_PER_W_ROLLUP))
        block.clear()

    prev = None
    for ts, w in rows:
        if block and prev is not None and ts - prev > 2 * ROLLUP:  # a gap in the readings ends it
            close()
        prev = ts
        if w >= STEP_W:
            block.append((ts, w))
            dip = 0
        elif block and dip == 0:
            block.append((ts, w))
            dip = 1
        elif block:
            close()
            dip = 0
    close()
    return out


def unexplained(repo: HomeRepository, readings: ReadingsRepository, now: int) -> dict[str, Any]:
    """Habits in what no device measured: blocks of use (above the day's floor, the lowest fifth of its 5-minute
    rollups) that start within NEAR_MIN of each other, at about the same power, on at least a third of the days read
    (and three). Each with when it usually starts, how long and how much it draws, how many days it was seen on, what
    it uses a day on average over the days read, and a guess at what it is. The biggest first."""
    start = bucket_start(now - UNEXPLAINED_DAYS * 86400, "day")
    visible = {d.id for d in repo.devices() if not d.hidden}
    measured: dict[int, float] = defaultdict(float)
    for ts, device, kwh in repo.energy(start, now):
        if device in visible:
            measured[ts] += kwh / KWH_PER_W_ROLLUP
    by_day: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for ts, pv, grid, bat in readings.rollups(start, now, ["pv_power", "grid_power", "battery_power"]):
        by_day[bucket_start(ts, "day")].append((ts, max(0.0, _home_w(pv, grid, bat) - measured.get(ts, 0.0))))
    days = {d: rows for d, rows in by_day.items() if len(rows) >= 144}  # read for at least half the day

    blocks: list[tuple[int, float, int, float]] = []  # (day, start minute, minutes, kWh)
    for day, rows in days.items():
        floor = sorted(w for _, w in rows)[len(rows) // 5]
        for ts, minutes, kwh in _blocks([(t, w - floor) for t, w in rows]):
            blocks.append((day, (ts - day) / 60, minutes, kwh))

    habits: list[list[tuple[int, float, int, float]]] = []
    for b in sorted(blocks, key=lambda b: b[1]):
        kw = b[3] / (b[2] / 60)
        for h in habits:
            at = median(x[1] for x in h)
            hkw = median(x[3] / (x[2] / 60) for x in h)
            if abs(b[1] - at) <= NEAR_MIN and 0.6 <= kw / hkw <= 1.6:
                h.append(b)
                break
        else:
            habits.append([b])

    out: list[dict[str, Any]] = []
    for h in habits:
        seen = len({x[0] for x in h})
        if seen < max(3, len(days) / 3):
            continue
        at, lasts = median(x[1] for x in h), median(x[2] for x in h)
        kw = median(x[3] / (x[2] / 60) for x in h)
        kind = guess(at, lasts, kw)
        out.append(
            {
                "at": round(at),
                "minutes": round(lasts),
                "kw": round(kw, 2),
                "days": seen,
                "of_days": len(days),
                "kwh_per_day": round(sum(x[3] for x in h) / len(days), 2),
                "guess": kind,
                "guess_label": GUESSES.get(kind or ""),
            }
        )
    out.sort(key=lambda x: -x["kwh_per_day"])
    return {"days": len(days), "habits": out[:5]}


def best_times(
    devices: Iterable[Device],
    patterns: Iterable[dict[str, Any]],
    steps: list[dict[str, Any]] | None,
    pricing: Pricing,
    now: int,
) -> list[dict[str, Any]]:
    """When to start each visible appliance that runs in cycles, and has run (so a typical run is known), from now to
    the end of tomorrow, starting between RUN_FROM and RUN_UNTIL: the first quarter hour a typical run would be at
    least SOLAR_ENOUGH covered by spare solar (the forecast's solar over the home's usual use for the hour), else the
    best covered if that's at least SOLAR_WORTH, else the one costing least from the grid. With what share of it solar
    would cover, and what the rest would cost. `steps` are the forecast's (ForecastService.steps); without them, only
    the grid's prices count."""
    by_id = {p["id"]: p for p in patterns}
    horizon = bucket_start(bucket_start(now, "day") + 36 * 3600, "day") + 86400  # the end of tomorrow
    spare: dict[int, float] = {}  # slot -> kW of solar beyond the home's usual use
    for s in steps or []:
        for slot in range(s["ts"], s["ts"] + 3600, SLOT):
            spare[slot] = max(0.0, s["pv_kw"] - s["load_kw"])
    first = -(-now // SLOT) * SLOT
    out = []
    for d in devices:
        p = by_id.get(d.id)
        if (
            d.hidden
            or not KINDS.get(d.kind, KINDS["other"]).cycles
            or not p
            or not p["run_kwh"]
            or not p["run_minutes"]
        ):
            continue
        kw = p["run_kwh"] / (p["run_minutes"] / 60)
        length = p["run_minutes"] * 60
        options = []
        for start in range(first, horizon - length, SLOT):
            if not RUN_FROM <= time.localtime(start).tm_hour < RUN_UNTIL:
                continue
            solar = cost = 0.0
            for slot in range(start, start + length, SLOT):
                hours = min(SLOT, start + length - slot) / 3600
                covered = min(kw, spare.get(slot, 0.0))
                solar += covered * hours
                cost += (kw - covered) * hours * pricing.rate(slot)
            options.append((start, solar / p["run_kwh"], cost))
        if not options:
            continue
        enough = next((o for o in options if o[1] >= SOLAR_ENOUGH), None)
        most = max(options, key=lambda o: o[1])
        cheapest = min(options, key=lambda o: o[2])
        pick, why = (
            (enough, "solar") if enough else (most, "solar") if most[1] >= SOLAR_WORTH else (cheapest, "cheapest")
        )
        out.append(
            {
                "id": d.id,
                "start": pick[0],
                "end": pick[0] + length,
                "solar_share": round(pick[1], 2),
                "cost": round(pick[2], 2),
                "why": why,
                "run_kwh": p["run_kwh"],
            }
        )
    return out
