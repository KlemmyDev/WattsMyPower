"""
Suggested car charges: when to charge the car, and how fast, so it reaches its level by the time it's needed
for the least on the power bill, from spare solar where it can.

Until the car or charger can be controlled from here, a suggestion is something you set in the car's app: a
start time and a current, for one charge. So each candidate is one charge (a start, on the quarter hour, and a
current between the car's lowest and the charger's highest) that delivers what the car needs before it's needed.
Each is run through the forecast as the forecast runs a planned charge (solar to the house, then the car; the home
battery helping where it's allowed to; the rest from the grid), and costed at the hour's prices: what's bought,
less the feed-in no longer earned. What a candidate leaves the home battery short at the end of the forecast
counts too, at what refilling it would cost. The cheapest wins; within a few cents, the one with more solar in it,
then the one that finishes first.
"""

from __future__ import annotations

import statistics
import time
from dataclasses import dataclass
from typing import Any

from app.features.amber.repository import PriceRepository
from app.features.car.service import CarService, CarSpec, Charge
from app.features.forecast.service import ForecastService, add_car, simulate
from app.features.settings.store import SettingsStore
from app.features.tariffs.costs import Pricer
from app.features.tariffs.store import TariffStore

QUARTER = 900
COARSE = 1800  # the first pass tries starts every half hour, then the best one's neighbours every quarter
SAME_COST = 0.05  # dollars: candidates this close cost the same, and the one with more solar wins
PRICE_SAMPLE = 300  # prices are averaged over each step at this spacing (time-of-use bands change on the half hour)


@dataclass(frozen=True)
class Home:
    """The home battery as the forecast runs it: its charge now (0-1), size, reserve (0-1) and rate limit."""

    soc: float
    cap: float
    reserve: float
    max_kw: float


def _run(steps: list[dict[str, Any]], charges: list[Charge], home: Home) -> list[dict[str, Any]]:
    """The forecast's steps with these charges in them, the battery stepped through."""
    ss = [{"start": s["start"], "dur": s["dur"], "pv_kw": s["pv_kw"], "load_kw": s["load_kw"]} for s in steps]
    add_car(ss, charges)
    simulate(ss, home.soc, home.cap, home.reserve, home.max_kw)
    return ss


def _drawn(c: Charge, s: dict[str, Any]) -> float:
    """A charge's average draw (kW) over a step."""
    overlap = min(s["start"] + s["dur"], c.end) - max(s["start"], c.start)
    return c.power_w / 1000 * overlap / s["dur"] if overlap > 0 else 0.0


class Planner:
    """Candidates for one need, against one forecast: what each costs over and above not charging at all."""

    def __init__(
        self,
        steps: list[dict[str, Any]],
        others: list[Charge],
        home: Home,
        buy: list[float],
        sell: list[float],
    ):
        self.steps, self.others, self.home, self.buy, self.sell = steps, others, home, buy, sell
        self.base = _run(steps, others, home)
        # What the home battery is worth at the end of the forecast: refilled from spare solar (at the feed-in it
        # would otherwise earn) if it's filling by then anyway, else from the grid.
        last_day = [s for s in self.base if s["start"] >= self.base[-1]["start"] - 20 * 3600]
        fills = any(s["soc_end"] >= 0.99 for s in last_day)
        self.battery_value = statistics.median(sell) if fills else statistics.median(buy)
        self.base_cost = self._cost(self.base)

    def _cost(self, ss: list[dict[str, Any]]) -> float:
        grid = sum(
            max(0.0, s["grid_kwh"]) * b - max(0.0, -s["grid_kwh"]) * x
            for s, b, x in zip(ss, self.buy, self.sell, strict=True)
        )
        return grid + (1 - ss[-1]["soc_end"]) * self.home.cap * self.battery_value

    def spare_kwh(self, until: int) -> float:
        """Solar forecast to go to the grid before `until`, with the charges already planned."""
        return sum(max(0.0, -s["grid_kwh"]) for s in self.base if s["start"] < until)

    def cost(self, c: Charge) -> tuple[float, float]:
        """What a charge adds to the bill ($), and the energy (kWh) it takes straight from solar the house
        doesn't use."""
        ss = _run(self.steps, [*self.others, c], self.home)
        solar = 0.0
        for s, b in zip(ss, self.base, strict=True):
            mine = _drawn(c, s)
            if mine:
                spare = max(0.0, s["pv_kw"] - s["load_kw"] - b.get("car_kw", 0.0))
                solar += min(mine, spare) * s["dur"] / 3600
        return self._cost(ss) - self.base_cost, solar


def _amps_to_try(lo: float, hi: float, n: int = 6) -> list[int]:
    lo_i, hi_i = round(lo), round(hi)
    if hi_i <= lo_i:
        return [hi_i]
    return sorted({lo_i, hi_i, *(round(lo_i + (hi_i - lo_i) * k / (n - 1)) for k in range(1, n - 1))})


def search(
    p: Planner,
    car: CarSpec,
    *,
    now: int,
    ready_by: int,
    wall_kwh: float,
    phases: int | None = None,
    max_amps: float | None = None,
) -> list[dict[str, Any]]:
    """Every candidate tried for delivering `wall_kwh` between now and `ready_by`, without overlapping a charge
    already planned: half-hourly starts at a spread of currents, then the cheapest one's neighbours."""
    phases = phases or car.phases
    hi = max_amps if max_amps is not None else car.max_amps
    lo = min(car.min_amps, hi)
    tried: dict[tuple[int, int], dict[str, Any]] = {}

    def attempt(start: int, amps: int) -> None:
        if (start, amps) in tried or not lo <= amps <= hi or start < now:
            return
        power = car.power_kw(amps, phases)
        end = start + int(wall_kwh / power * 3600)
        if end > ready_by or any(o.start < end and start < o.end for o in p.others):
            return
        cost, solar = p.cost(Charge(start, end, power * 1000, car.battery_helps))
        tried[(start, amps)] = {
            "start": start,
            "end": end,
            "amps": amps,
            "phases": phases,
            "power_kw": round(power, 2),
            "cost": cost,
            "solar_kwh": solar,
        }

    first = -(-now // COARSE) * COARSE
    for amps in _amps_to_try(lo, hi):
        attempt(now, amps)
        for start in range(first, ready_by, COARSE):
            attempt(start, amps)
    if tried:
        best = pick(list(tried.values()))
        base = best["start"] - best["start"] % QUARTER
        for start in range(base - 2 * QUARTER, base + 3 * QUARTER, QUARTER):
            for amps in range(best["amps"] - 2, best["amps"] + 3):
                attempt(start, amps)
    return list(tried.values())


def pick(options: list[dict[str, Any]]) -> dict[str, Any]:
    """The cheapest; among those within a few cents of it, the most solar, then the soonest done."""
    cheapest = min(o["cost"] for o in options)
    near = [o for o in options if o["cost"] <= cheapest + SAME_COST]
    return max(near, key=lambda o: (round(o["solar_kwh"], 1), -o["end"]))


def describe(o: dict[str, Any], car: CarSpec, soc_now: float, wall_kwh: float) -> dict[str, Any]:
    """A candidate as the dashboard shows it: when, how fast, the energy, the car's level after, and the cost."""
    into = wall_kwh * car.efficiency / 100
    return {
        "start": o["start"],
        "end": o["end"],
        "amps": o["amps"],
        "phases": o["phases"],
        "power_kw": o["power_kw"],
        "wall_kwh": round(wall_kwh, 2),
        "car_kwh": round(into, 2),
        "soc_from": soc_now,
        "soc_to": round(min(100.0, soc_now + into / car.capacity_kwh * 100), 1),
        "km": round(into * 1000 / car.wh_per_km),
        "cost": round(o["cost"], 2),
        "solar_kwh": round(o["solar_kwh"], 2),
        "solar_share": round(min(1.0, o["solar_kwh"] / wall_kwh), 2) if wall_kwh else 0.0,
    }


def suggest(
    p: Planner,
    car: CarSpec,
    *,
    now: int,
    ready_by: int,
    soc_now: float,
    soc_to: float,
) -> dict[str, Any]:
    """The best charge to reach `soc_to` by `ready_by`, and some others worth knowing:

    - best: the cheapest (see pick);
    - solar: the one with the most solar in it, when that's a good deal more than the best's;
    - now: starting now at full speed, for comparison, when the best isn't that already.

    When the car can't get there in time even at full speed from now, `reachable` is false and the only option
    is that, with the level it reaches. `single_phase` is the best charge on one phase, for a car charged on three
    (whose lowest power is three times as high), when it would cost noticeably less: it follows the sun more closely.
    """
    need = (soc_to - soc_now) / 100 * car.capacity_kwh  # into the car
    wall = need / (car.efficiency / 100)
    out: dict[str, Any] = {
        "soc_now": soc_now,
        "soc_to": soc_to,
        "ready_by": ready_by,
        "wall_kwh": round(wall, 2),
        "car_kwh": round(need, 2),
        "km": round(need * 1000 / car.wh_per_km),
        "spare_kwh": round(p.spare_kwh(ready_by), 1),
        "reachable": True,
        "options": [],
        "single_phase": None,
    }
    tried = search(p, car, now=now, ready_by=ready_by, wall_kwh=wall)
    if not tried:
        # Too much for the time: the most it can take, at full speed from now (or from the end of a charge
        # already planned, if one is under way).
        start = max([now, *(o.end for o in p.others if o.start <= now < o.end)])
        power = car.power_kw(car.max_amps)
        most = max(0.0, min(wall, power * (ready_by - start) / 3600))
        out["reachable"] = False
        if most > 0.1:
            end = start + int(most / power * 3600)
            cost, solar = p.cost(Charge(start, end, power * 1000, car.battery_helps))
            o = {"start": start, "end": end, "amps": round(car.max_amps), "phases": car.phases,
                 "power_kw": round(power, 2), "cost": cost, "solar_kwh": solar}  # fmt: skip
            out["options"] = [{"kind": "now", **describe(o, car, soc_now, most)}]
        return out

    best = pick(tried)
    options = [{"kind": "best", **describe(best, car, soc_now, wall)}]
    sunniest = max(tried, key=lambda o: (round(o["solar_kwh"], 1), -o["cost"]))
    if sunniest["solar_kwh"] >= best["solar_kwh"] + max(1.0, 0.15 * wall):
        options.append({"kind": "solar", **describe(sunniest, car, soc_now, wall)})
    fastest = [o for o in tried if o["start"] == now and o["amps"] == round(car.max_amps)]
    if fastest and (best["start"] - now >= QUARTER or best["amps"] != fastest[0]["amps"]):
        options.append({"kind": "now", **describe(fastest[0], car, soc_now, wall)})
    out["options"] = options

    if car.phases == 3 and wall > 0:
        single = search(p, car, now=now, ready_by=ready_by, wall_kwh=wall, phases=1, max_amps=min(16, car.max_amps * 3))
        if single:
            one = pick(single)
            if one["cost"] <= best["cost"] - 0.3:
                out["single_phase"] = describe(one, car, soc_now, wall)
    return out


def step_prices(pricer: Pricer, steps: list[dict[str, Any]]) -> tuple[list[float], list[float]]:
    """Each step's average buy and feed-in prices ($/kWh)."""
    buy, sell = [], []
    for s in steps:
        ts = range(s["start"], s["start"] + s["dur"], PRICE_SAMPLE)
        buy.append(statistics.fmean(pricer.buy(t) for t in ts))
        sell.append(statistics.fmean(pricer.sell(t) for t in ts))
    return buy, sell


def next_ready_by(now: int, minutes: int, at_least: int = 3600) -> int:
    """The next time of day `minutes` after local midnight that's at least `at_least` seconds away."""
    lt = time.localtime(now)
    for days in range(3):
        t = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + days, minutes // 60, minutes % 60, 0, 0, 0, -1)))
        if t - now >= at_least:
            return t
    raise AssertionError("unreachable")


class ChargePlanner:
    """Suggested charges for the car, from the forecast, the planned charges, the tariff and the car's details."""

    def __init__(
        self,
        car: CarService,
        forecast: ForecastService,
        settings: SettingsStore,
        tariffs: TariffStore,
        prices: PriceRepository | None,
    ):
        self.car = car
        self.forecast = forecast
        self.settings = settings
        self.tariffs = tariffs
        self.prices = prices

    def suggest(
        self,
        body: dict[str, Any],
        *,
        home_soc: float | None,
        battery_kwh: float,
        reserve_pct: float,
        now: int | None = None,
    ) -> dict[str, Any]:
        """Suggestions for a charge from the car's level now (given, or as last known) to a level (given, or the
        car's usual one) by a time (given, or its usual time next). Raises ValueError, in words."""
        now = int(now or time.time())
        steps = self.forecast.steps(now)
        if not steps:
            raise ValueError("There's no forecast to plan with yet.")
        horizon = steps[-1]["start"] + steps[-1]["dur"]

        level = self.car.level(now)
        soc_now = _number(body, "soc_now", 0, 100) if body.get("soc_now") not in (None, "") else None
        if soc_now is None:
            if level is None:
                raise ValueError("Say what the car's charge is now.")
            soc_now = level["soc"]
        soc_to = _number(body, "soc_to", 1, 100) if body.get("soc_to") not in (None, "") else None
        soc_to = soc_to if soc_to is not None else self.settings.get("car_target_soc")
        given = body.get("ready_by")
        ready_by = (
            int(_number(body, "ready_by", 0, 4_102_444_800))
            if given not in (None, "")
            else next_ready_by(now, int(self.settings.get("car_ready_by")))
        )
        if ready_by <= now + QUARTER:
            raise ValueError("Give a time at least 15 minutes from now.")
        ready_by = min(ready_by, horizon)

        spec = self.car.spec()
        t, tables = self.tariffs.current()
        buy, sell = step_prices(Pricer(t, tables, self.prices, now, horizon), steps)
        others = self.car.charges(now, horizon)
        home = Home(
            soc=(home_soc if home_soc is not None else 50) / 100,
            cap=battery_kwh or 10.0,
            reserve=reserve_pct / 100,
            max_kw=self.settings.get("battery_max_kw"),
        )
        # Charges already planned before it's needed raise the car's level by then: plan for what's left.
        planned = self.car.planned_soc(soc_now, now, ready_by)
        result: dict[str, Any] = {"planned_soc": planned if planned > soc_now else None}
        if planned >= soc_to - 0.5:
            return result | {
                "soc_now": soc_now, "soc_to": soc_to, "ready_by": ready_by, "wall_kwh": 0, "car_kwh": 0, "km": 0,
                "spare_kwh": None, "reachable": True, "options": [], "single_phase": None, "covered": True,
            }  # fmt: skip
        p = Planner(steps, others, home, buy, sell)
        found = suggest(p, spec, now=now, ready_by=ready_by, soc_now=planned, soc_to=soc_to)
        return result | found | {"soc_now": soc_now, "covered": False}


def _number(body: dict[str, Any], key: str, lo: float, hi: float) -> float:
    names = {"soc_now": "The car's charge now", "soc_to": "The level to charge to", "ready_by": "The time it's needed"}
    try:
        x = float(body[key])
    except (TypeError, ValueError):
        raise ValueError(f"{names[key]} must be a number.") from None
    if not lo <= x <= hi:
        raise ValueError(f"{names[key]} must be between {lo:g} and {hi:g}.")
    return x
