"""
What the car drew from the home's power, so it's a line of its own on the Home page rather than the biggest part of
"everything else".

The car isn't read directly (there's no connection to it, app.features.car), so its charging is found in what no
device measured: the home's use (from the inverter) less what the devices measured, above the day's floor (the
lowest fifth of its 5-minute rollups, what the house draws anyway). Two ways:

- **A planned charge** (app.features.car): through its time, what's above the floor, up to the charge's power, is the
  car's, for each 5 minutes it's at least half the charge's power (a charge planned but not plugged in draws
  nothing, and leaves the house's use alone).
- **Charging that wasn't planned**: a block of at least CHARGING_MIN minutes, each 5 minutes at least 85% of the
  slowest any connected car charges (its lowest current, on its phases), and no more than the fastest. A car on a
  three-phase charger draws more than anything else in a home for that long; on a single phase (1.4 kW at 6 A) it
  can't be told from other loads, so only planned charges count.

Only with a car connected (Manage → Integrations → Electric vehicle).
"""

from __future__ import annotations

from collections import defaultdict

from app.features.car.service import CarService
from app.features.home.repository import HomeRepository
from app.features.home.usage import bucket_start
from app.features.readings.repository import KWH_PER_W_ROLLUP, ReadingsRepository

ROLLUP = 300
CHARGING_MIN = 45  # the shortest unplanned block taken for the car, minutes
DETECT_FROM_W = 3000  # below this, a car's lowest charging power can't be told from a kettle and an oven together


def unmeasured(
    repo: HomeRepository, readings: ReadingsRepository, start: int, end: int
) -> dict[int, list[tuple[int, float]]]:
    """Each local day touching [start, end): (rollup, W the home used that no visible device measured), oldest first.
    Whole days, so each has its floor."""
    first = bucket_start(start, "day")
    visible = {d.id for d in repo.devices() if not d.hidden}
    measured: dict[int, float] = defaultdict(float)
    for ts, device, kwh in repo.energy(first, end):
        if device in visible:
            measured[ts] += kwh / KWH_PER_W_ROLLUP
    days: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for ts, pv, grid, bat in readings.rollups(first, end, ["pv_power", "grid_power", "battery_power"]):
        home = max(0.0, (pv or 0) + (grid or 0) + (bat or 0))
        days[bucket_start(ts, "day")].append((ts, max(0.0, home - measured.get(ts, 0.0))))
    return days


def car_use(
    repo: HomeRepository, readings: ReadingsRepository, cars: CarService | None, start: int, end: int
) -> dict[int, float]:
    """W the car drew in each 5-minute rollup of [start, end) it charged in (see the module's docstring)."""
    if cars is None or not (ids := cars.ids()):
        return {}
    specs = [cars.spec(i) for i in ids]
    slowest = min(s.power_kw(s.min_amps) for s in specs) * 1000
    fastest = max(s.power_kw(s.max_amps) for s in specs) * 1000
    charges = cars.charges(start, end)
    out: dict[int, float] = {}
    for rows in unmeasured(repo, readings, start, end).values():
        floor = sorted(w for _, w in rows)[len(rows) // 5] if rows else 0.0
        planned: set[int] = set()
        for ts, w in rows:
            for c in charges:
                if c.start - ROLLUP < ts < c.end and ts >= start:
                    planned.add(ts)
                    above = min(c.power_w * 1.05, w - floor)
                    if above >= c.power_w / 2:
                        out[ts] = above
        if slowest * 0.85 < DETECT_FROM_W:
            continue
        block: list[tuple[int, float]] = []
        prev = None
        for ts, w in [*rows, (2**62, 0.0)]:  # a sentinel closes the last block
            above = w - floor
            charging = ts not in planned and slowest * 0.85 <= above <= fastest * 1.1
            if block and (not charging or (prev is not None and ts - prev > ROLLUP)):
                if len(block) * ROLLUP >= CHARGING_MIN * 60:
                    out.update({t: a for t, a in block if t >= start})
                block = []
            if charging:
                block.append((ts, above))
            prev = ts
    return {ts: w for ts, w in out.items() if start <= ts < end}
