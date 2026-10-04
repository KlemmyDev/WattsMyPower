"""
Suggested car charges: when to charge the car, and how fast, so it reaches its level by the time it's needed,
aiming for one of four things (the car's charging preference, or asked for):

    cheapest  the least on the power bill
    solar     as much as it can from solar the house isn't using, topped up from the grid at the cheapest times
    battery   sparing the home battery: the car never draws on it, and takes only solar the battery doesn't need
    fastest   start now at full speed

A plan is one or more steps: a start, an end and a current between the car's lowest and the charger's highest.
Plans that follow the sun change the current as the spare solar changes, quarter hour by quarter hour (then merged
into steps); what solar can't give comes from the cheapest quarter hours before it's needed, spread across them at
the lowest current that gets there rather than full speed. The cheapest plan is also weighed against every single
charge (one start, one current) on half-hourly starts.

Each plan is run through the forecast as the forecast runs a planned charge (solar to the house, then the car; the
home battery helping where it's allowed to; the rest from the grid), and costed at the hour's prices: what's bought,
less the feed-in no longer earned. What it leaves the home battery short at the end of the forecast counts too, at
what refilling it would cost. Between plans within a few cents of each other, the one with more solar in it wins,
then the one that uses less of the home battery, then the simpler, then the one that's done first.
"""

from __future__ import annotations

import statistics
import time
from dataclasses import dataclass, replace
from typing import Any

from app.features.amber.repository import PriceRepository
from app.features.car.service import CarService, CarSpec, Charge
from app.features.forecast.service import ForecastService, add_car, day_start, simulate
from app.features.settings.store import SettingsStore
from app.features.tariffs.costs import Pricer
from app.features.tariffs.store import TariffStore

QUARTER = 900
COARSE = 1800  # the first pass tries starts every half hour, then the best one's neighbours every quarter
SAME_COST = 0.05  # dollars: candidates this close cost the same, and the one with more solar wins
PRICE_SAMPLE = 300  # prices are averaged over each step at this spacing (time-of-use bands change on the half hour)
LOW_SUN = 0.8  # following the sun, charge at the lowest current once spare solar covers this share of it
MODES = ("cheapest", "solar", "battery", "fastest")
PLAN_DAYS = 7  # the furthest ahead a charge is planned: as far as the weather forecast is fetched


@dataclass(frozen=True)
class Step:
    """One step of a plan: from `start` to `end` at `amps`."""

    start: int
    end: int
    amps: int


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
    """Plans for one need, against one forecast: what each costs over and above not charging at all."""

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
        # Each step's spare solar (kW): beyond what the house (and charges already planned) use; and what's left
        # of that once the home battery has taken its share, which would otherwise go to the grid.
        self.beyond_house = [max(0.0, s["pv_kw"] - s["load_kw"] - s.get("car_kw", 0.0)) for s in self.base]
        self.to_grid = [max(0.0, -s["grid_kwh"]) / (s["dur"] / 3600) for s in self.base]

    def _cost(self, ss: list[dict[str, Any]]) -> float:
        grid = sum(
            max(0.0, s["grid_kwh"]) * b - max(0.0, -s["grid_kwh"]) * x
            for s, b, x in zip(ss, self.buy, self.sell, strict=True)
        )
        return grid + (1 - ss[-1]["soc_end"]) * self.home.cap * self.battery_value

    def step_at(self, ts: int) -> int:
        """The index of the forecast step `ts` falls in."""
        for i, s in enumerate(self.steps):
            if ts < s["start"] + s["dur"]:
                return i
        return len(self.steps) - 1

    def spare_kwh(self, until: int) -> float:
        """Solar forecast to go to the grid before `until`, with the charges already planned."""
        return sum(max(0.0, -s["grid_kwh"]) for s in self.base if s["start"] < until)

    def evaluate(self, charges: list[Charge]) -> tuple[float, float, float]:
        """What these charges add to the bill ($); the energy (kWh) they take straight from solar the house
        doesn't use; and how much more the home battery gives (kWh) than it would without them."""
        ss = _run(self.steps, [*self.others, *charges], self.home)
        solar = battery = 0.0
        was, was_base = self.home.soc, self.home.soc
        for s, b, spare in zip(ss, self.base, self.beyond_house, strict=True):
            mine = sum(_drawn(c, s) for c in charges)
            if mine:
                solar += min(mine, spare) * s["dur"] / 3600
            battery += max(0.0, (was - s["soc_end"]) - max(0.0, was_base - b["soc_end"])) * self.home.cap
            was, was_base = s["soc_end"], b["soc_end"]
        return self._cost(ss) - self.base_cost, solar, battery

    def cost(self, c: Charge) -> tuple[float, float]:
        """What a charge adds to the bill ($), and the energy (kWh) it takes straight from solar."""
        cost, solar, _ = self.evaluate([c])
        return cost, solar


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
        cost, solar, battery = p.evaluate([Charge(start, end, power * 1000, car.battery_helps)])
        tried[(start, amps)] = {
            "steps": [Step(start, end, amps)],
            "phases": phases,
            "helps": car.battery_helps,
            "cost": cost,
            "solar_kwh": solar,
            "battery_kwh": battery,
        }

    coarse = COARSE if ready_by - now <= 24 * 3600 else 2 * COARSE  # hourly over a longer wait
    first = -(-now // coarse) * coarse
    for amps in _amps_to_try(lo, hi):
        attempt(now, amps)
        for start in range(first, ready_by, coarse):
            attempt(start, amps)
    if tried:
        (one,) = pick(list(tried.values()))["steps"]
        base = one.start - one.start % QUARTER
        for start in range(base - 2 * QUARTER, base + 3 * QUARTER, QUARTER):
            for amps in range(one.amps - 2, one.amps + 3):
                attempt(start, amps)
    return list(tried.values())


def pick(options: list[dict[str, Any]]) -> dict[str, Any]:
    """The cheapest; among those within a few cents of it, the most solar, then the least from the home battery,
    then the fewest steps, then the soonest done."""
    cheapest = min(o["cost"] for o in options)
    near = [o for o in options if o["cost"] <= cheapest + SAME_COST]
    return max(
        near,
        key=lambda o: (round(o["solar_kwh"], 1), -round(o["battery_kwh"], 1), -len(o["steps"]), -o["steps"][-1].end),
    )


def _slots(p: Planner, now: int, ready_by: int) -> list[tuple[int, int, int]]:
    """Quarter hours from now until it's needed (the first from now to the next quarter), as (start, end, the
    forecast step it's in), leaving out any a charge already planned is using."""
    out = []
    t = now
    while t < ready_by:
        e = min(ready_by, (t // QUARTER + 1) * QUARTER)
        if not any(o.start < e and t < o.end for o in p.others):
            out.append((t, e, p.step_at(t)))
        t = e
    return out


MAX_STEPS = 5  # following the sun, the most steps (changes of current) a plan is smoothed to


def _smooth(amps: list[int], lo: int, hi: int) -> list[int]:
    """Runs of quarter hours whose currents are within a few amps of each other, at the lowest of them (so never
    more than the sun gives), widening "a few" until there are at most MAX_STEPS steps."""
    out = list(amps)
    for spread in range(2, hi - lo + 2, 2):
        out = list(amps)
        k = 0
        while k < len(out):
            if not out[k]:
                k += 1
                continue
            j, low, high = k, out[k], out[k]
            while j + 1 < len(out) and out[j + 1] and max(high, out[j + 1]) - min(low, out[j + 1]) <= spread:
                j += 1
                low, high = min(low, out[j]), max(high, out[j])
            out[k : j + 1] = [low] * (j + 1 - k)
            k = j + 1
        steps = sum(1 for k, x in enumerate(out) if x and (k == 0 or out[k - 1] != x))
        if steps <= MAX_STEPS:
            break
    return out


def follow(
    p: Planner,
    car: CarSpec,
    *,
    now: int,
    ready_by: int,
    wall_kwh: float,
    spare: list[float],
) -> list[Step] | None:
    """A plan that follows `spare` (kW of solar per forecast step that's the car's to take), then tops up what
    that doesn't give from the grid at the cheapest quarter hours, at the lowest current that gets there. None if
    even full speed throughout can't deliver `wall_kwh` in time."""
    lo, hi = round(min(car.min_amps, car.max_amps)), round(car.max_amps)
    per_amp = car.power_kw(1)  # kW for each amp
    slots = _slots(p, now, ready_by)

    def kwh(k: int, amps: int) -> float:
        a, b, _ = slots[k]
        return amps * per_amp * (b - a) / 3600

    # The sun: as many amps as the spare solar covers; the lowest current when it nearly covers that. Then
    # smoothed into a few steps you can set by hand: runs within a few amps of each other take the lowest of them.
    amps = []
    for _, _, i in slots:
        x = min(hi, int(spare[i] / per_amp + 1e-9))
        amps.append(x if x >= lo else lo if spare[i] >= LOW_SUN * lo * per_amp else 0)
    amps = _smooth(amps, lo, hi)
    short = wall_kwh - sum(kwh(k, x) for k, x in enumerate(amps))

    # The grid: the cheapest quarter hours first. Within a price, first the quarter hours already charging (so a
    # day following the sun just charges faster, rather than gaining a night's charging too), then the rest; each
    # raised together to the lowest current that's enough, rather than a few to full speed.
    raised: list[int] = []
    before = list(amps)
    for price in sorted({round(p.buy[i], 4) for _, _, i in slots}):
        same = [k for k, (_, _, i) in enumerate(slots) if round(p.buy[i], 4) == price]
        for group in ([k for k in same if amps[k]], [k for k in same if not amps[k]]):
            group = [k for k in group if amps[k] < hi]
            if short <= 1e-6 or not group:
                continue
            raised, before = group, list(amps)
            for level in range(lo, hi + 1):
                more = sum(kwh(k, max(amps[k], level)) - kwh(k, amps[k]) for k in group)
                if more >= short or level == hi:
                    break
            for k in group:
                amps[k] = max(amps[k], level)
            short -= more
    if short > 1e-6:
        return None
    # A whole amp across many quarter hours can give a good deal more than needed: drop quarter hours the grid
    # alone was charging in, latest first, while that still leaves enough. What's left over just ends the last
    # step a little early (below), rather than leaving stray steps of an amp or two less.
    for k in reversed(raised):
        if not before[k] and kwh(k, amps[k]) <= -short + 1e-9:
            short += kwh(k, amps[k])
            amps[k] = 0

    # In time order, stopping once it's delivered (the rounding above can give a little more than needed).
    out: list[Step] = []
    got = 0.0
    for k, x in enumerate(amps):
        if not x:
            continue
        a, b, _ = slots[k]
        e = kwh(k, x)
        if got + e >= wall_kwh - 1e-9:
            b = a + max(60, int((wall_kwh - got) / (x * per_amp) * 3600))
        if out and out[-1].end == a and out[-1].amps == x:
            out[-1] = Step(out[-1].start, b, x)
        else:
            out.append(Step(a, b, x))
        got += e
        if got >= wall_kwh - 1e-9:
            break
    return out


def _plan(p: Planner, car: CarSpec, steps: list[Step], helps: bool, phases: int | None = None) -> dict[str, Any]:
    phases = phases or car.phases
    charges = [Charge(s.start, s.end, car.power_kw(s.amps, phases) * 1000, helps) for s in steps]
    cost, solar, battery = p.evaluate(charges)
    return {"steps": steps, "phases": phases, "helps": helps, "cost": cost, "solar_kwh": solar, "battery_kwh": battery}


def describe(o: dict[str, Any], car: CarSpec, soc_now: float, wall_kwh: float) -> dict[str, Any]:
    """A plan as the dashboard shows it: its steps, the energy, the car's level after, the cost, and where the
    power comes from."""
    into = wall_kwh * car.efficiency / 100
    steps: list[Step] = o["steps"]
    top = max(s.amps for s in steps)
    return {
        "start": steps[0].start,
        "end": steps[-1].end,
        "amps": top,
        "phases": o["phases"],
        "power_kw": round(car.power_kw(top, o["phases"]), 2),
        "steps": [
            {"start": s.start, "end": s.end, "amps": s.amps, "power_kw": round(car.power_kw(s.amps, o["phases"]), 2)}
            for s in steps
        ],
        "battery_helps": o["helps"],
        "wall_kwh": round(wall_kwh, 2),
        "car_kwh": round(into, 2),
        "soc_from": soc_now,
        "soc_to": round(min(100.0, soc_now + into / car.capacity_kwh * 100), 1),
        "km": round(into * 1000 / car.wh_per_km),
        "cost": round(o["cost"], 2),
        "solar_kwh": round(o["solar_kwh"], 2),
        "solar_share": round(min(1.0, o["solar_kwh"] / wall_kwh), 2) if wall_kwh else 0.0,
        "battery_kwh": round(o["battery_kwh"], 2),
    }


def plans(p: Planner, car: CarSpec, *, now: int, ready_by: int, wall_kwh: float) -> dict[str, dict[str, Any]]:
    """The plan for each aim (see the module's doc), or none at all when even full speed from now is too slow."""
    start = max([now, *(o.end for o in p.others if o.start <= now < o.end)])
    full = start + int(wall_kwh / car.power_kw(car.max_amps) * 3600)
    if full > ready_by:
        return {}
    out = {"fastest": _plan(p, car, [Step(start, full, round(car.max_amps))], car.battery_helps)}
    kw = dict(now=now, ready_by=ready_by, wall_kwh=wall_kwh)
    sunny = follow(p, car, spare=p.beyond_house, **kw)  # type: ignore[arg-type]
    spared = follow(p, car, spare=p.to_grid, **kw)  # type: ignore[arg-type]
    if sunny:
        out["solar"] = _plan(p, car, sunny, car.battery_helps)
    if spared:
        out["battery"] = _plan(p, car, spared, False)
    singles = search(p, car, now=now, ready_by=ready_by, wall_kwh=wall_kwh)
    out["cheapest"] = pick([*out.values(), *singles])
    return out


def suggest(
    p: Planner,
    car: CarSpec,
    *,
    now: int,
    ready_by: int,
    soc_now: float,
    soc_to: float,
    mode: str = "cheapest",
) -> dict[str, Any]:
    """A plan for each aim to reach `soc_to` by `ready_by` (`options`, the one for `mode` first), and the spare
    solar (kW beyond the house's use) each forecast step before then, to show them against.

    When the car can't get there in time even at full speed from now, `reachable` is false and the only option
    is that, with the level it reaches. `single_phase` is the cheapest plan on one phase, for a car charged on three
    (whose lowest power is three times as high), when it would cost noticeably less: it follows the sun more closely.
    """
    need = (soc_to - soc_now) / 100 * car.capacity_kwh  # into the car
    wall = need / (car.efficiency / 100)
    out: dict[str, Any] = {
        "mode": mode,
        "soc_now": soc_now,
        "soc_to": soc_to,
        "ready_by": ready_by,
        "wall_kwh": round(wall, 2),
        "car_kwh": round(need, 2),
        "km": round(need * 1000 / car.wh_per_km),
        "spare_kwh": round(p.spare_kwh(ready_by), 1),
        "spare": [
            {"start": s["start"], "end": s["start"] + s["dur"], "kw": round(kw, 2)}
            for s, kw in zip(p.steps, p.beyond_house, strict=True)
            if s["start"] < ready_by
        ],
        "reachable": True,
        "options": [],
        "single_phase": None,
    }
    found = plans(p, car, now=now, ready_by=ready_by, wall_kwh=wall)
    if not found:
        # Too much for the time: the most it can take, at full speed from now (or from the end of a charge
        # already planned, if one is under way).
        start = max([now, *(o.end for o in p.others if o.start <= now < o.end)])
        power = car.power_kw(car.max_amps)
        most = max(0.0, min(wall, power * (ready_by - start) / 3600))
        out["reachable"] = False
        if most > 0.1:
            end = start + int(most / power * 3600)
            o = _plan(p, car, [Step(start, end, round(car.max_amps))], car.battery_helps)
            out["options"] = [{"kind": "fastest", **describe(o, car, soc_now, most)}]
        return out

    order = [mode, *(m for m in MODES if m != mode)]
    out["options"] = [{"kind": m, **describe(found[m], car, soc_now, wall)} for m in order if m in found]

    if car.phases == 3 and wall > 0:
        one = replace(car, phases=1, max_amps=min(16, car.max_amps * 3))
        single = plans(p, one, now=now, ready_by=ready_by, wall_kwh=wall).get("cheapest")
        if single and single["cost"] <= found["cheapest"]["cost"] - 0.3:
            out["single_phase"] = describe(single, one, soc_now, wall)
    return out


def step_prices(pricer: Pricer, steps: list[dict[str, Any]]) -> tuple[list[float], list[float]]:
    """Each step's average buy and feed-in prices ($/kWh)."""
    buy, sell = [], []
    for s in steps:
        ts = range(s["start"], s["start"] + s["dur"], PRICE_SAMPLE)
        buy.append(statistics.fmean(pricer.buy(t) for t in ts))
        sell.append(statistics.fmean(pricer.sell(t) for t in ts))
    return buy, sell


WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def next_ready_by(now: int, minutes: int, days: list[str] | None = None, at_least: int = 3600) -> int:
    """The next time the car's needed: `minutes` after local midnight on one of `days` (every day when none),
    at least `at_least` seconds away."""
    lt = time.localtime(now)
    for ahead in range(9):
        t = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + ahead, minutes // 60, minutes % 60, 0, 0, 0, -1)))
        if t - now >= at_least and (not days or WEEKDAYS[time.localtime(t).tm_wday] in days):
            return t
    raise AssertionError("unreachable")


class ChargePlanner:
    """Suggested charges for a car, from the forecast, the planned charges, the tariff and the car's details."""

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
        car_id: int,
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
        d = self.car.details(car_id)
        given = body.get("ready_by")
        ready_by = (
            int(_number(body, "ready_by", 0, 4_102_444_800))
            if given not in (None, "")
            else next_ready_by(now, int(d["car_ready_by"]), d["car_days"])
        )
        if ready_by <= now + QUARTER:
            raise ValueError("Give a time at least 15 minutes from now.")
        # The forecast to a day past when it's needed (so what a charge leaves the home battery short shows), at
        # least to the end of the day after tomorrow, at most as far as the weather forecast goes.
        days = min(PLAN_DAYS, max(3, (ready_by - day_start(now)) // 86400 + 2))
        steps = self.forecast.steps(now, days)
        if not steps:
            raise ValueError("There's no forecast to plan with yet.")
        horizon = steps[-1]["start"] + steps[-1]["dur"]
        ready_by = min(ready_by, horizon)

        level = self.car.level(car_id, now)
        soc_now = _number(body, "soc_now", 0, 100) if body.get("soc_now") not in (None, "") else None
        if soc_now is None:
            if level is None:
                raise ValueError("Say what the car's charge is now.")
            soc_now = level["soc"]
        soc_to = _number(body, "soc_to", 1, 100) if body.get("soc_to") not in (None, "") else None
        soc_to = soc_to if soc_to is not None else d["car_target_soc"]

        mode = body.get("mode") or d["car_charge_mode"]
        if mode not in MODES:
            raise ValueError(f"Aim for one of: {', '.join(MODES)}.")

        spec = self.car.spec(car_id)
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
        planned = self.car.planned_soc(car_id, soc_now, now, ready_by)
        result: dict[str, Any] = {"planned_soc": planned if planned > soc_now else None}
        if planned >= soc_to - 0.5:
            return result | {
                "mode": mode, "soc_now": soc_now, "soc_to": soc_to, "ready_by": ready_by, "wall_kwh": 0, "car_kwh": 0,
                "km": 0, "spare_kwh": None, "spare": [], "reachable": True, "options": [], "single_phase": None,
                "covered": True,
            }  # fmt: skip
        p = Planner(steps, others, home, buy, sell)
        found = suggest(p, spec, now=now, ready_by=ready_by, soc_now=planned, soc_to=soc_to, mode=mode)
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
