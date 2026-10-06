"""
What a battery control will do, worked out ahead: the battery's level as it runs, when it ends, what comes from
the grid and what that costs. For the Battery page's preview (before a control is started) and its chart (the
control in effect, from now on). Pure: the forecast and prices come in.

Run in 5-minute steps over the forecast's solar and home use (app.features.forecast: `pv_kw` and `load_kw` per
step), with the battery doing what the control makes it:

    standby  neither charges nor discharges: the house runs on solar and the grid
    floor    self-consumption, but not below the floor: then the grid takes over
    charge   charges at a set power (solar first, the grid for the rest) until the level, then back to normal

`grid_kwh` is what the house buys from the grid while the control runs, and `cost` what that comes to at the
rates in force (a time-of-use band, or Amber's price for the time). For a charge, `charge_grid_kwh` and
`charge_cost` are just the charge's share: the energy for the battery that solar didn't cover. `normal_grid_kwh`
and `normal_cost` are the same stretch run as normal (self-consumption down to the usual reserve), so the
difference is what the control costs, or saves.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

STEP = 300  # seconds
MAX_HOURS = 48
OPEN_HOURS = 12  # how far ahead a control with no end is worked out
CHARGE_EFFICIENCY = 0.95  # of what goes into the battery, the share that stays there


@dataclass(frozen=True)
class Battery:
    soc: float  # % now
    capacity_kwh: float
    reserve: float  # % the battery normally keeps (min SOC)
    top: float = 100.0  # max SOC, %
    max_kw: float = 5.0  # the most it charges or discharges at


@dataclass(frozen=True)
class Control:
    kind: str  # "standby", "floor" or "charge"
    until: int | None = None  # unix seconds, or None until it's stopped (a charge: until it reaches its level)
    floor: float | None = None  # %
    target: float | None = None  # %
    power_w: float | None = None


Conditions = Callable[[int], tuple[float, float]]  # ts -> (solar kW, home use kW)


def conditions_from(steps: Sequence[dict[str, Any]] | None, fallback: tuple[float, float]) -> Conditions:
    """Solar and home use at a time, from the forecast's steps (each with start, dur, pv_kw, load_kw); `fallback`
    (as now) where it has none."""
    rows = sorted(steps or [], key=lambda s: s["start"])

    def at(ts: int) -> tuple[float, float]:
        for s in rows:
            if s["start"] <= ts < s["start"] + s["dur"]:
                return float(s.get("pv_kw") or 0), float(s.get("load_kw") or 0)
        return fallback

    return at


def _run(
    b: Battery, c: Control | None, now: int, end: int, cond: Conditions, buy: Callable[[int], float]
) -> dict[str, Any]:
    """Step from now to `end` with the battery under control `c` (None: as normal). The level at each step, when
    a charge reached its level (it's normal after), and the grid energy and cost, overall and the charge's share."""
    soc, cap = b.soc, b.capacity_kwh
    points: list[tuple[int, float]] = [(now, round(soc, 1))]
    grid = cost = charge_grid = charge_cost = 0.0
    reached: int | None = None
    t = now
    while t < end:
        dt = min(STEP, end - t) / 3600
        pv, load = cond(t)
        net = pv - load  # kW spare (+) or short (-)
        kind = c.kind if c and reached is None else "normal"
        batt = 0.0  # kW into the battery (+) or out of it (-)
        if kind == "charge" and c is not None:
            goal = min(c.target or b.top, b.top)
            room = max(0.0, (goal - soc) / 100 * cap) / CHARGE_EFFICIENCY
            batt = min((c.power_w or 0) / 1000, b.max_kw, room / dt) if dt else 0.0
            share = max(0.0, batt - max(net, 0.0)) * dt  # what solar couldn't cover
            charge_grid += share
            charge_cost += share * buy(t)
        elif kind != "standby":
            low = c.floor if kind == "floor" and c is not None and c.floor is not None else b.reserve
            if net >= 0:
                batt = min(net, b.max_kw, max(0.0, (b.top - soc) / 100 * cap) / CHARGE_EFFICIENCY / dt) if dt else 0
            else:
                batt = -min(-net, b.max_kw, max(0.0, (soc - low) / 100 * cap) / dt) if dt else 0
        soc += (batt * CHARGE_EFFICIENCY if batt > 0 else batt) * dt / cap * 100
        imported = max(0.0, load - pv + batt) * dt
        grid += imported
        cost += imported * buy(t)
        t += round(dt * 3600)
        points.append((t, round(soc, 1)))
        if kind == "charge" and c is not None and soc >= min(c.target or b.top, b.top) - 0.05:
            reached = t
    return {
        "points": points,
        "reached": reached,
        "grid_kwh": grid,
        "cost": cost,
        "charge_grid_kwh": charge_grid,
        "charge_cost": charge_cost,
    }


def _thin(points: list[tuple[int, float]], most: int = 300) -> list[tuple[int, float]]:
    """At most about `most` points, always keeping the last."""
    kept = points[:: max(1, len(points) // most)]
    return kept if kept[-1] == points[-1] else [*kept, points[-1]]


def project(b: Battery, c: Control, now: int, cond: Conditions, buy: Callable[[int], float]) -> dict[str, Any]:
    """What control `c`, starting now, will do; and the same stretch as normal, to compare."""
    horizon = now + (MAX_HOURS if c.until or c.kind == "charge" else OPEN_HOURS) * 3600
    end = min(c.until or horizon, horizon)
    run = _run(b, c, now, end, cond, buy)
    ends_at = c.until
    if c.kind == "charge" and run["reached"] is not None:
        ends_at = run["reached"]
        end = ends_at  # what it does after is normal running: not this control's
        run = _run(b, c, now, end, cond, buy)
    normal = _run(b, None, now, end, cond, buy)
    r2 = lambda v: round(v, 2)  # noqa: E731
    out: dict[str, Any] = {
        "kind": c.kind,
        "floor": c.floor,
        "target": c.target,
        "from": now,
        "to": end,
        "ends_at": ends_at,  # None: runs until it's stopped (`to` is as far as it was worked out)
        "points": _thin(run["points"]),
        "soc_end": run["points"][-1][1],
        "grid_kwh": r2(run["grid_kwh"]),
        "cost": r2(run["cost"]),
        "normal_grid_kwh": r2(normal["grid_kwh"]),
        "normal_cost": r2(normal["cost"]),
    }
    if c.kind == "charge":
        out.update(charge_grid_kwh=r2(run["charge_grid_kwh"]), charge_cost=r2(run["charge_cost"]))
        out["reaches"] = run["reached"] is not None
    return out
