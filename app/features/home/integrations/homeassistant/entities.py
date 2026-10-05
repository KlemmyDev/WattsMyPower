"""
Which of Home Assistant's entities are a device the Home page should show, and what each is doing now.

Home Assistant has no "device that uses energy" as such: it has sensors. An integration there (Shelly, TP-Link, Tuya,
ESPHome…) gives a plug or an appliance a power sensor (device_class "power", in W or kW), an energy sensor
(device_class "energy", state_class "total_increasing" or "total", in Wh, kWh or MWh), often both, and a switch.
They're told apart from each other only by name, so they're put together by theirs: the entity id without its domain
and without the words those integrations end them with (washer_power, washer_energy, washer_today_s_consumption all
belong to washer), and switch.washer is its switch.

A device with energy sensors that start over (today's, this month's: a last_reset, or a name that says so) and one
that doesn't uses the one that doesn't, read as a counter that only goes up; with only one that starts over, it's read
as a counter of the day (or month) so far. Sensors on the whole home, the grid, the solar or the battery are left out:
the inverter already measures those, and counting them again would count the home twice.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from app.features.home.types import Reading

# Words the integrations end an entity id with, longest first: what's left is the device.
SUFFIXES = (
    "_this_month_s_consumption",
    "_today_s_consumption",
    "_current_consumption",
    "_total_consumption",
    "_power",
    "_energy",
    "_total",
)
# And its friendly name, likewise.
NAME_SUFFIXES = (
    " this month's consumption",
    " today's consumption",
    " current consumption",
    " total consumption",
    " power",
    " energy",
    " total",
    " switch",
)
POWER_UNITS = {"W": 1.0, "kW": 1000.0, "MW": 1_000_000.0}  # to W
ENERGY_UNITS = {"Wh": 0.001, "kWh": 1.0, "MWh": 1000.0}  # to kWh
# In an entity id or name: a sensor on the whole home, the grid, the solar or the battery, not one device.
WHOLE_HOME = ("grid", "solar", "inverter", "battery", "house", "home_total", "whole_home", "mains")
WHOLE_HOME_WORDS = {"pv", "import", "export"}
# How often a counter that starts over does, in words its id or name would use: the shorter the period, the better.
PERIODS = (("today", "daily", "day"), ("week", "weekly"), ("month", "monthly"), ("year", "yearly"))
# What a device is, from its name: the first that matches.
KIND_WORDS = (
    ("washer_dryer", ("washer dryer", "washer-dryer", "washerdryer")),
    ("dishwasher", ("dishwasher", "dish washer")),
    ("dryer", ("dryer", "tumble")),
    ("washer", ("washing machine", "washer", "washing")),
    ("fridge", ("fridge", "refrigerator")),
    ("freezer", ("freezer",)),
    ("oven", ("oven",)),
    ("air_conditioner", ("air conditioner", "air conditioning", "aircon", "air con")),
    ("hot_water", ("hot water", "water heater")),
    ("pool_pump", ("pool pump", "pool")),
)
KINDS = tuple(dict.fromkeys(["plug", *(k for k, _ in KIND_WORDS)]))

State = Mapping[str, Any]  # one of /api/states: {"entity_id", "state", "attributes": {…}, …}


@dataclass
class Device:
    key: str  # the entity ids' common part: "washer"
    power: State | None = None
    energies: list[State] = field(default_factory=list)
    switch: State | None = None

    @property
    def energy(self) -> State | None:
        """The energy sensor to read: one that never starts over, else the one that starts over most often."""
        return min(self.energies, key=lambda s: (_period(s), s["entity_id"])) if self.energies else None

    @property
    def name(self) -> str:
        for s in (self.switch, self.power, self.energy):
            if s is not None and (name := _trim(str(_attrs(s).get("friendly_name") or ""))):
                return name
        return self.key.replace("_", " ").capitalize()


def _attrs(s: State) -> Mapping[str, Any]:
    a = s.get("attributes")
    return a if isinstance(a, Mapping) else {}


def _object_id(s: State) -> str:
    return str(s.get("entity_id") or "").partition(".")[2]


def base(object_id: str) -> str:
    """The device an entity belongs to: its id without the words integrations end it with."""
    while True:
        for suffix in SUFFIXES:
            if object_id.endswith(suffix) and len(object_id) > len(suffix):
                object_id = object_id.removesuffix(suffix)
                break
        else:
            return object_id


def _trim(name: str) -> str:
    """A friendly name without the words that say which sensor it is ("Washer Power" → "Washer")."""
    name = name.strip()
    while True:
        for suffix in NAME_SUFFIXES:
            if name.lower().endswith(suffix) and len(name) > len(suffix):
                name = name[: -len(suffix)].rstrip()
                break
        else:
            return name


def _whole_home(s: State) -> bool:
    text = f"{_object_id(s)} {_attrs(s).get('friendly_name') or ''}".lower()
    joined = re.sub(r"[^a-z0-9]+", "_", text)
    return any(w in joined for w in WHOLE_HOME) or bool(set(joined.split("_")) & WHOLE_HOME_WORDS)


def _period(s: State) -> int:
    """0 for a counter that never starts over; else how often it does: 1 each day, 2 each week, and so on."""
    words = set(re.split(r"[^a-z0-9]+", f"{_object_id(s)} {_attrs(s).get('friendly_name') or ''}".lower()))
    for i, period in enumerate(PERIODS, 1):
        if words & set(period):
            return i
    return len(PERIODS) + 1 if _attrs(s).get("last_reset") else 0  # it starts over, but it doesn't say when


def _number(s: State | None, units: Mapping[str, float]) -> float | None:
    """A sensor's value in the units wanted, or None when it has none (unavailable, unknown)."""
    if s is None:
        return None
    try:
        v = float(str(s.get("state")))
    except (TypeError, ValueError):
        return None
    factor = units.get(str(_attrs(s).get("unit_of_measurement")))
    return v * factor if factor is not None and math.isfinite(v) else None


def kind(name: str) -> str:
    """What a device is, from its name: a washer, a fridge… else a smart plug."""
    text = " " + re.sub(r"[^a-z0-9/-]+", " ", name.lower()) + " "
    return next((k for k, words in KIND_WORDS if any(f" {w} " in text for w in words)), "plug")


def devices(states: list[State]) -> dict[str, Device]:
    """Every device among Home Assistant's entities that measures power or energy, by key."""
    found: dict[str, Device] = {}
    switches: dict[str, State] = {}
    for s in states:
        if not isinstance(s, Mapping):
            continue
        entity_id = str(s.get("entity_id") or "")
        if entity_id.startswith("switch."):
            switches.setdefault(_object_id(s), s)
            continue
        if not entity_id.startswith("sensor.") or _whole_home(s):
            continue
        a = _attrs(s)
        unit = str(a.get("unit_of_measurement"))
        if a.get("device_class") == "power" and unit in POWER_UNITS:
            role = "power"
        elif (
            a.get("device_class") == "energy"
            and unit in ENERGY_UNITS
            and a.get("state_class") in ("total_increasing", "total")
        ):
            role = "energy"
        else:
            continue
        key = base(_object_id(s))
        if key == "home":  # sensor.home_power, sensor.home_energy: the whole home
            continue
        d = found.setdefault(key, Device(key))
        if role == "energy":
            d.energies.append(s)
        elif d.power is None or (_number(d.power, POWER_UNITS) is None and _number(s, POWER_UNITS) is not None):
            d.power = s  # with two, one that has a value
    for key, d in found.items():
        d.switch = switches.get(key) or switches.get(f"{key}_switch")
    return found


def reading(d: Device) -> Reading:
    """What a device is doing now."""
    energy = d.energy
    entities = [s for s in (d.power, energy, d.switch) if s is not None]
    counter: Literal["total", "cycle"] = "cycle" if energy is not None and _period(energy) else "total"
    switched = str(d.switch.get("state")) if d.switch is not None else None
    name = d.name
    return Reading(
        key=d.key,
        name=name,
        kind=kind(name),
        online=not all(s.get("state") == "unavailable" for s in entities),
        power_w=_number(d.power, POWER_UNITS),
        energy_kwh=_number(energy, ENERGY_UNITS),
        counter=counter,
        switched_on={"on": True, "off": False}.get(switched or ""),
        raw={
            str(s.get("entity_id")): {
                "state": s.get("state"),
                **{k: _attrs(s).get(k) for k in ("unit_of_measurement", "device_class", "state_class", "last_reset")},
            }
            for s in entities
        },
    )
