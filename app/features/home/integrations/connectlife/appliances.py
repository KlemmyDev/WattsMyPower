"""
What a ConnectLife appliance's properties mean. Each appliance on the account comes with a `statusList` of properties,
every value a string. The names and values below are the ones seen on Hisense washers (device type 025) and dryers
(030), as collected by the Home Assistant integration's users; models differ, so anything not recognised is left out
rather than guessed, and the raw properties are kept to check a model against.

Laundry doesn't report its power. It reports each cycle's energy once the cycle's finished:
Electricit_consumption_int + Electricit_consumption_decimal / 100, kWh (0.54), going back to 0 afterwards. That's
read as a cycle counter (app.features.home.energy): the cycle's energy lands across the run it belongs to.

  machine_status          0 off, 1 standby, 2 running, 3 paused, 4 alarm
  Current_program_phase   washer: 1 weighing, 2 prewash, 3 washing, 4 rinsing, 7 spinning, 8 drying, 10 finished,
                          11 waiting for a delayed start (one family numbers its phases differently)
                          dryer: 1 waiting for a delayed start, 2 and 3 drying, 4 anti-crease, 5 finished
  Remaining_time_of_selected_program / Selected_program_remaining_time_in_minutes   minutes left
  Water_consumption_int + _decimal / 100    litres in the cycle, once finished
  error_code              0 none, 1–24 F01–F24, 100 unbalanced load

Running is "running" or "paused", except in a phase that isn't (finished, or waiting to start). A dryer's anti-crease
tumbling after it's dried still counts: its energy's only reported once it's finished, which comes after.
`offlineState` 1 means online.
"""

from __future__ import annotations

from typing import Any

from app.features.home.types import Reading

WASHERS = {"025", "027", "003"}  # Hisense, Gorenje, ASKO
DRYERS = {"030", "032", "004"}
PHASES: dict[str, dict[int, str]] = {
    "washer": {1: "Weighing", 2: "Prewash", 3: "Washing", 4: "Rinsing", 7: "Spinning", 8: "Drying", 10: "Finished",
               11: "Waiting to start"},
    "dryer": {1: "Waiting to start", 2: "Drying", 3: "Drying", 4: "Anti-crease", 5: "Finished"},
}  # fmt: skip
IDLE_PHASES = {"washer": {10, 11}, "dryer": {1, 5}}
# What's kept of an appliance's own description alongside its properties, for checking a model against.
IDENTITY = ("deviceTypeCode", "deviceTypeName", "deviceFeatureCode", "deviceFeatureName", "offlineState")
MACHINE = {0: "Off", 1: "Standby", 2: "Running", 3: "Paused", 4: "Alarm"}
# Words in an appliance's type name -> what kind of device it is, for types without laundry codes. First match wins.
TYPE_WORDS = [
    (("washer dryer", "washer-dryer", "washer and dryer"), "washer_dryer"),
    (("dish",), "dishwasher"),
    (("wash",), "washer"),
    (("dryer", "tumble"), "dryer"),
    (("freezer",), "freezer"),
    (("fridge", "refrigerator"), "fridge"),
    (("oven", "cooker", "hob"), "oven"),
    (("water heater", "heat pump water"), "hot_water"),
    (("air", "conditioner", "split", "window"), "air_conditioner"),
]


def _status(d: dict[str, Any]) -> dict[str, str]:
    """The properties, by their name with stray spaces trimmed (some models send " slotdry")."""
    raw = d.get("statusList")
    return {str(k).strip(): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}


def _int(status: dict[str, str], *keys: str) -> int | None:
    for k in keys:
        try:
            return int(float(status[k]))
        except (KeyError, ValueError):
            continue
    return None


def _decimal(status: dict[str, str], name: str) -> float | None:
    """A value sent as name_int and name_decimal (hundredths)."""
    whole, hundredths = _int(status, f"{name}_int", f"{name}_Int"), _int(status, f"{name}_decimal", f"{name}_Decimal")
    if whole is None and hundredths is None:
        return None
    return round((whole or 0) + (hundredths or 0) / 100, 2)


def kind_of(d: dict[str, Any]) -> str:
    code = str(d.get("deviceTypeCode") or "")
    if code in WASHERS:
        return "washer"
    if code in DRYERS:
        return "dryer"
    name = str(d.get("deviceTypeName") or "").lower()
    return next((kind for words, kind in TYPE_WORDS if any(w in name for w in words)), "other")


def reading(d: dict[str, Any]) -> Reading | None:
    """An appliance as a reading, or None for an entry that isn't one (no id)."""
    key = str(d.get("puid") or d.get("deviceId") or "")
    if not key:
        return None
    kind = kind_of(d)
    status = _status(d)
    name = str(d.get("deviceNickName") or d.get("deviceTypeName") or "Appliance").strip()
    model = str(d.get("deviceFeatureName") or "").strip() or None
    online = str(d.get("offlineState")) == "1"
    if not status:  # sometimes left out: the appliance is there, but what it's doing isn't known this time
        return Reading(key, name, kind, model, online=online, raw={})

    machine = _int(status, "machine_status")
    phase = _int(status, "Current_program_phase")
    laundry = kind if kind in PHASES else None
    running = None
    if machine is not None:
        running = machine in (2, 3) and not (laundry and phase in IDLE_PHASES[laundry])
    energy = _decimal(status, "Electricit_consumption")
    water = _decimal(status, "Water_consumption")
    remaining = _int(status, "Remaining_time_of_selected_program", "Selected_program_remaining_time_in_minutes")
    error = _int(status, "error_code")
    details: dict[str, str] = {}
    if machine in (3, 4):
        details["Status"] = MACHINE[machine]
    if running and (program := _int(status, "Selected_program_ID")) is not None:
        details["Program"] = f"No. {program}"  # programs are numbered differently on each model
    if water:
        details["Water last cycle"] = f"{water:g} L"
    if error:
        details["Error"] = "Unbalanced load" if error == 100 else f"F{error:02d}"
    return Reading(
        key=key,
        name=name,
        kind=kind,
        model=model,
        online=online,
        energy_kwh=energy,
        counter="cycle",
        running=running,
        phase=PHASES[laundry].get(phase or 0) if laundry and running else None,
        remaining_min=remaining if running and remaining else None,
        details=details,
        raw={**{k: d.get(k) for k in IDENTITY}, "statusList": status},
    )
