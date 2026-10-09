"""
Charging a Tesla from spare solar: what the car is doing (from its state, read through Tessie or over Bluetooth), how
much power is spare for it, and what to tell it next. Pure: the service (app.features.tesla.service) gives it what's
happening and sends commands, the same whichever way the car is reached.

Each car is set to one of two modes (EV page):

    off     the dashboard shows the car and never commands it (the default)
    solar   charge only from spare solar: start once there's been enough for the car's lowest current for a few
            minutes, follow it up and down an amp at a time, and stop once it's been short for a while

Spare power is worked out from the grid meter and the home battery, not from the solar forecast: what the car is
drawing now, plus what's going to the grid, less anything the home battery is giving. Who gets the sun first
(`first`): with the home battery (the default), the car only gets what's left once the battery is charging at its
full rate (or is full); with the car, what the battery is charging with counts as spare too; shared, the battery
keeps just the share of the sun it needs to be full by the end of the day's sun, as the forecast has it (battery_share,
worked out again as the day goes, so a cloudier afternoon gives it more), and the car gets the rest. `grid_w` is how far short the car may run, drawing
from the grid or the home battery, before it's stopped: with three phases its lowest current is a lot of power
(5 A × 230 V × 3 ≈ 3.5 kW), so a passing cloud would otherwise stop it.

How closely each car is followed (readiness) depends on whether it could charge soon. A car that can't (night, Off,
unplugged, full, on hold) is left to sleep: over Bluetooth only its sleep and charge-port status are checked, which
never wakes it. A car plugged in at home in solar mode is made ready LEAD seconds before the forecast expects spare
solar for it (with the home battery first, once the forecast's battery has taken its share), or as soon as there's
spare solar now: read each minute and, over Bluetooth, woken and kept awake, so it starts and follows the sun quickly.

The dashboard never fights the household. Charging started, stopped or set to another current in the Tesla app
(anything the car does that isn't what the dashboard last told it) puts the car on hold: shown, never commanded,
until it's unplugged or you resume from the EV page. A car that starts charging by itself when it's plugged in is
the dashboard's to stop, as it hasn't been told anything since.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

MODES = ("off", "solar")
START_AFTER = 180  # seconds there must have been enough spare power before starting
STOP_AFTER = 300  # seconds it must have been short before stopping
MIN_SWITCH = 300  # seconds between starting and stopping (each wakes the car and wears the charge port's contactor)
AMPS_EVERY = 60  # seconds between changes of current
GRACE = 180  # seconds for the car (and Tessie's copy of its state) to show a command before it counts as changed
AVERAGE = 150  # seconds of readings averaged into the spare power
FULL_SOC = 98  # the home battery counts as full from here (%)
HOME_RADIUS_M = 500  # a car within this of home is at home
MAX_GRID_W = 5000
LEAD = 1800  # seconds before spare solar is expected for a car that it's made ready (woken and read each minute)
QUIET_READ = 3600  # a car with no chance of charging soon has its charge read at most this often, never woken for it
READINESS = ("active", "ready", "quiet")
FIRST = ("battery", "shared", "car")  # who gets the sun first
SHARE_MARGIN = 1.1  # shared: the home battery is kept this much more than it needs, to be full in time
SUN_KW = 0.05  # forecast solar below this is night, for where the day's sun ends

DEFAULTS: dict[str, Any] = {"mode": "off", "first": "battery", "grid_w": 300}
MODEL_NAMES = {
    "model3": "Model 3",
    "modely": "Model Y",
    "models": "Model S",
    "modelx": "Model X",
    "cybertruck": "Cybertruck",
}
# The VIN's 10th character: its model year, 2010 to 2039 (I, O, Q, U and Z aren't used).
YEARS = {ch: 2010 + i for i, ch in enumerate("ABCDEFGHJKLMNPRSTVWXY123456789")}


def clean(body: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    """A car's control settings with the changes in `body`, checked. Raises ValueError, in words."""
    current = dict(current or {})
    if "first" not in current and "battery_first" in current:  # kept before sharing was a choice
        current["first"] = "battery" if current["battery_first"] else "car"
    current.pop("battery_first", None)
    out = {**DEFAULTS, **current}
    if "mode" in body:
        if body["mode"] not in MODES:
            raise ValueError(f"The charging mode must be one of {', '.join(MODES)}.")
        out["mode"] = body["mode"]
    if "first" in body:
        if body["first"] not in FIRST:
            raise ValueError(f"Who gets the sun first must be one of {', '.join(FIRST)}.")
        out["first"] = body["first"]
    if "grid_w" in body:
        v = body["grid_w"]
        if isinstance(v, bool) or not isinstance(v, int | float) or not 0 <= v <= MAX_GRID_W:
            raise ValueError(f"How far short the car may run must be 0 to {MAX_GRID_W:,} W.")
        out["grid_w"] = round(float(v))
    return out


def model_year(vin: str) -> int | None:
    """The car's model year, from its VIN (a 2022 Model Y's 10th character is N)."""
    return YEARS.get(vin[9].upper()) if len(vin) == 17 else None


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Metres between two points (latitude, longitude): haversine on a round earth."""
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _num(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


@dataclass(frozen=True)
class CarState:
    """What was last known of a car. `charging_state` is Tesla's: Disconnected, NoPower, Starting, Charging, Stopped
    or Complete. `at_home` is None when its location isn't known. `in_range`: whether it was heard over this server's
    Bluetooth (None when it's reached through Tessie); a car that's heard is at home, one that isn't is away."""

    vin: str
    name: str | None
    as_of: int | None  # when the car last reported, unix seconds
    asleep: bool
    charging_state: str
    soc: float | None  # %
    limit: float | None  # % it charges to
    range_km: float | None
    request_amps: int | None  # the current it's set to charge at
    max_amps: int | None  # the most the charger offers
    actual_amps: float | None
    volts: float | None
    power_kw: float | None  # Tesla's, in whole kW
    charger_phases: int | None  # as Tesla reports it while charging
    energy_added: float | None  # kWh this charge
    minutes_to_full: float | None
    at_home: bool | None
    location: tuple[float, float] | None
    fast_charger: bool
    model: str | None  # Tesla's car_type, e.g. "modely"
    in_range: bool | None = None

    @property
    def plugged(self) -> bool:
        return self.charging_state not in ("", "Disconnected")

    @property
    def charging(self) -> bool:
        return self.charging_state in ("Charging", "Starting")

    @property
    def full(self) -> bool:
        return self.charging_state == "Complete" or (
            self.soc is not None and self.limit is not None and self.soc >= self.limit
        )


def parse(vin: str, last: dict[str, Any], home: tuple[float, float] | None, in_range: bool | None = None) -> CarState:
    """A car's state from its `last_state` (app.features.tesla.client): where it is from its location, or from
    whether it's in Bluetooth range."""
    cs = last.get("charge_state") or {}
    ds = last.get("drive_state") or {}
    vs = last.get("vehicle_state") or {}
    vc = last.get("vehicle_config") or {}
    lat, lon = _num(ds.get("latitude")), _num(ds.get("longitude"))
    location = (lat, lon) if lat is not None and lon is not None and (lat, lon) != (0.0, 0.0) else None
    at_home = None if location is None or home is None else distance_m(location, home) <= HOME_RADIUS_M
    if in_range is not None:
        at_home = in_range
    ts = _num(cs.get("timestamp")) or _num(last.get("timestamp"))
    miles = _num(cs.get("battery_range"))
    amps = _num(cs.get("charge_current_request"))
    top = _num(cs.get("charge_current_request_max"))
    return CarState(
        vin=vin,
        name=str(last.get("display_name") or vs.get("vehicle_name") or "") or None,
        as_of=int(ts / 1000) if ts and ts > 1e11 else int(ts) if ts else None,
        asleep=str(last.get("state") or "") == "asleep",
        charging_state=str(cs.get("charging_state") or ""),
        soc=_num(cs.get("battery_level")),
        limit=_num(cs.get("charge_limit_soc")),
        range_km=round(miles * 1.609344) if miles is not None else None,
        request_amps=int(amps) if amps is not None else None,
        max_amps=int(top) if top else None,
        actual_amps=_num(cs.get("charger_actual_current")),
        volts=_num(cs.get("charger_voltage")),
        power_kw=_num(cs.get("charger_power")),
        charger_phases=int(p) if (p := _num(cs.get("charger_phases"))) else None,
        energy_added=_num(cs.get("charge_energy_added")),
        minutes_to_full=_num(cs.get("minutes_to_full_charge")),
        at_home=at_home,
        location=location,
        fast_charger=bool(cs.get("fast_charger_present")),
        model=str(vc.get("car_type") or "") or None,
        in_range=in_range,
    )


@dataclass(frozen=True)
class Charger:
    """How the car charges at home (its details on the dashboard, and what the charger offers)."""

    phases: int
    volts: float
    min_amps: int
    max_amps: int

    def watts(self, amps: float) -> float:
        return amps * self.volts * self.phases

    def amps_for(self, watts: float) -> int:
        """The most whole amps `watts` covers."""
        return math.floor(watts / (self.volts * self.phases) + 1e-9)


def measured(car: CarState) -> tuple[int | None, float | None]:
    """The phases and volts the car is charging on, as it reports them (None where it doesn't say): the volts while
    it charges, and the phases from its power against amps × volts (Tesla's own phase count isn't always right), else
    the phases it reports. So the current follows the real supply: 5 A on one phase at 240 V is 1.2 kW, on three
    phases 3.6 kW."""
    if not car.charging:
        return None, None
    volts = car.volts if car.volts and car.volts > 100 else None
    phases: int | None = None
    if volts and car.actual_amps and car.actual_amps >= 3 and car.power_kw:
        phases = 3 if car.power_kw * 1000 / (car.actual_amps * volts) > 2 else 1
    elif car.charger_phases in (1, 3):
        phases = car.charger_phases
    return phases, volts


def car_watts(car: CarState, charger: Charger) -> float:
    """What the car is drawing from the house now."""
    if not car.charging:
        return 0.0
    amps = car.actual_amps if car.actual_amps is not None else car.request_amps
    volts = car.volts if car.volts and car.volts > 100 else charger.volts
    return (amps or 0) * volts * charger.phases


def spare_w(
    reading: dict[str, Any],
    car_w: float,
    *,
    first: str,
    home_soc: float | None,
    battery_max_w: float,
    share: float = 0.0,
) -> float | None:
    """Power there is for the car (W, including what it's drawing): what it draws now, plus what's going to the
    grid, less what the home battery gives; with the home battery first, less what the battery could still take;
    shared, less the battery's `share` (battery_share) of what it could take. None without a grid reading."""
    grid = _num(reading.get("grid_power"))
    if grid is None:
        return None
    battery = _num(reading.get("battery_power")) or 0.0  # + discharging, - charging
    out = car_w - grid - battery  # what the battery's charging with is spare too; what it's giving isn't
    if first == "battery":
        if home_soc is not None and home_soc < FULL_SOC:
            out -= battery_max_w  # the battery's to fill at its full rate first
    elif first == "shared":
        out -= share * min(max(out, 0.0), battery_max_w)
    return out


def battery_share(
    steps: list[dict[str, Any]], now: int, *, soc: float | None, cap: float, max_kw: float
) -> tuple[float, float]:
    """Shared: the share (0 to 1) of what the home battery could take of the spare sun that it needs, to be full by
    the end of the day's sun (tomorrow's, at night), and how much it needs (kWh, with SHARE_MARGIN). All of it when
    the forecast's sun won't fill it (or there's no forecast); none once it's full, or with no battery. `steps` are
    the forecast's (app.features.forecast.service.ForecastService.steps); `soc` 0 to 1."""
    if cap <= 0:
        return 0.0, 0.0
    if soc is None:
        return 1.0, 0.0
    if soc * 100 >= FULL_SOC:
        return 0.0, 0.0
    need = (1 - soc) * cap * SHARE_MARGIN
    takes, sun = 0.0, False
    for s in steps:
        start, end = int(s["start"]), int(s["start"] + s["dur"])
        if end <= now:
            continue
        if s["pv_kw"] >= SUN_KW:
            sun = True
        elif sun:
            break  # the day's sun is over
        takes += min(max(0.0, s["pv_kw"] - s["load_kw"]), max_kw) * (end - max(start, now)) / 3600
    return (min(1.0, need / takes) if takes > 0 else 1.0), need


@dataclass
class Decision:
    """A command to send: start (at `amps`), stop, or set `amps`; and why, in a few words."""

    action: str
    why: str
    amps: int | None = None


@dataclass
class Memory:
    """What the dashboard last did with a car (kept between runs): its last command and when, the current it set,
    since when there's been enough (or too little) spare power, and a hold when the household took over."""

    command: str | None = None  # "start" or "stop"
    command_at: int = 0
    amps: int | None = None
    amps_at: int = 0
    enough_since: int | None = None
    short_since: int | None = None
    hold: str | None = None  # why the car is on hold, in words
    hold_at: int | None = None
    failures: int = 0  # commands in a row that didn't go through
    failed_at: int = 0

    @classmethod
    def load(cls, raw: dict[str, Any] | None) -> Memory:
        known = {k: v for k, v in (raw or {}).items() if k in cls.__dataclass_fields__}
        return cls(**known)

    def dump(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


def taken_over(car: CarState, mem: Memory, now: int) -> str | None:
    """Whether the household has changed what the dashboard last told the car (see the module's docstring): why,
    in words; else None."""
    if mem.command is None or now - mem.command_at < GRACE:
        return None
    if car.as_of is not None and car.as_of < max(mem.command_at, mem.amps_at) + 5:
        return None  # what's known of it is from before the dashboard's last command
    if mem.command == "stop" and car.charging:
        return "Charging was started outside the dashboard"
    if mem.command == "start" and car.charging_state == "Stopped" and not car.full:
        return "Charging was stopped outside the dashboard"
    if (
        mem.command == "start"
        and car.charging
        and mem.amps is not None
        and now - mem.amps_at >= GRACE
        and car.request_amps is not None
        and car.request_amps != mem.amps
    ):
        return f"The current was changed to {car.request_amps} A outside the dashboard"
    return None


def decide(
    mode: str,
    car: CarState,
    charger: Charger,
    spare: float | None,
    grid_w: float,
    mem: Memory,
    now: int,
) -> Decision | None:
    """What to tell a car plugged in at home, not on hold, in `mode`: None to leave it. `spare` is the power there is
    for it (spare_w, averaged). Updates `mem`'s timers."""
    if mode != "solar" or car.full or spare is None:
        return None
    if mem.command == "stop" and car.charging:
        return None  # the stop hasn't shown yet (or charging was started outside the dashboard: see taken_over)
    if mem.command == "start" and not car.charging and now - mem.command_at < GRACE:
        return None  # the start hasn't shown yet
    lo, hi = charger.min_amps, min(charger.max_amps, car.max_amps or charger.max_amps)
    lo = min(lo, hi)
    sun = charger.amps_for(spare)
    enough = sun >= lo
    keeps = charger.amps_for(spare + grid_w) >= lo
    mem.enough_since = (mem.enough_since or now) if enough else None
    mem.short_since = None if keeps else (mem.short_since or now)
    switched = now - mem.command_at if mem.command else 10**9

    if not car.charging:
        if enough and now - (mem.enough_since or now) >= START_AFTER and switched >= MIN_SWITCH:
            return Decision("start", "spare solar", min(sun, hi))
        return None

    # Charging. Stop once it's been short a while; else follow the sun.
    if not keeps:
        if now - (mem.short_since or now) >= STOP_AFTER and switched >= MIN_SWITCH:
            return Decision("stop", "not enough spare solar")
        if mem.command is None and switched >= MIN_SWITCH and not enough:
            # It started on its own when plugged in, with nothing spare: stop it now rather than wait.
            return Decision("stop", "not enough spare solar")
    target = max(lo, min(sun, hi))
    current = mem.amps if mem.amps is not None else car.request_amps
    if target != current and now - mem.amps_at >= AMPS_EVERY:
        return Decision("amps", "following the sun", target)
    return None


def spare_ahead(
    steps: list[dict[str, Any]],
    *,
    first: str,
    soc: float | None,
    cap: float,
    reserve: float,
    max_kw: float,
    share: float = 0.0,
) -> list[tuple[int, int, float]]:
    """The forecast's spare power for a car (W), step by step, as (start, end, W): solar over the usual home use;
    with the home battery first, only what's left once the forecast's battery (filling from `soc`, 0 to 1) has taken
    what it can; shared, less the battery's `share` of what it could take, as spare_w has it. `steps` are the
    forecast's (app.features.forecast.service.ForecastService.steps)."""
    from app.features.forecast.service import simulate

    rows = [dict(s) for s in steps]
    if first == "shared" and cap > 0:
        out = []
        for s in rows:
            if s["dur"] > 0:
                over = max(0.0, s["pv_kw"] - s["load_kw"])
                out.append((int(s["start"]), int(s["start"] + s["dur"]), (over - share * min(over, max_kw)) * 1000))
        return out
    if first == "battery" and cap > 0 and soc is not None:
        simulate(rows, soc, cap, reserve, max_kw)
        return [
            (int(s["start"]), int(s["start"] + s["dur"]), max(0.0, -s["grid_kwh"]) * 3600 / s["dur"] * 1000)
            for s in rows
            if s["dur"] > 0
        ]
    return [(int(s["start"]), int(s["start"] + s["dur"]), max(0.0, s["pv_kw"] - s["load_kw"]) * 1000) for s in rows]


def next_chance(ahead: list[tuple[int, int, float]], now: int, need_w: float) -> int | None:
    """When spare solar is next expected to be enough for `need_w` (its lowest charging power): now, if it is."""
    for start, end, w in ahead:
        if end > now and w >= need_w:
            return max(start, now)
    return None


def readiness(
    car: CarState | None,
    mode: str,
    held: bool,
    chance_at: int | None,
    spare_now: float | None,
    need_w: float | None,
    now: int,
) -> str:
    """How closely to follow a car (see the module's docstring): "active" while it's charging (read each minute),
    "ready" when it could start soon (read each minute, kept awake), else "quiet" (left to sleep)."""
    if car is None:
        return "quiet"
    if car.charging:
        return "active"
    if mode != "solar" or held or not car.plugged or not car.at_home or car.full or car.fast_charger:
        return "quiet"
    if need_w is not None and spare_now is not None and spare_now >= need_w:
        return "ready"
    if chance_at is not None and chance_at - now <= LEAD:
        return "ready"
    return "quiet"
