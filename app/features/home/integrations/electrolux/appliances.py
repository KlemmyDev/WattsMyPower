"""
What an Electrolux Group appliance's state means. Each appliance's state has `connectionState` ("connected" or not)
and `properties.reported`: everything it reports, by name, in camelCase with UPPER_CASE values. The names below are
the ones Electrolux's SDK reads (its appliance_config), and those seen on an AEG fridge-freezer; models differ, so
anything not recognised is left out rather than guessed, and the reported properties are kept to check a model against.

The appliance's type comes with the account's list (applianceType):

  CR                fridge or fridge-freezer: compartments `fridge`, `freezer`, `extraCavity`, `iceMaker`, each with
                    applianceState, doorState (OPEN / CLOSED), targetTemperatureC, sometimes sensorTemperatureC,
                    fastMode and alerts; the whole appliance's alerts, vacationHolidayMode, energySavingMode,
                    waterFilterState, airFilterState, compressorState and defrostRoutineState
  WM TD WD DW       washer, dryer, washer-dryer, dishwasher: applianceState (RUNNING, PAUSED, DELAYED_START,
                    END_OF_CYCLE, IDLE, OFF…), timeToEnd (seconds), cyclePhase, userSelections.programUID, doorState
  OV SO HB          oven, steam oven, hob: applianceState, timeToEnd, program, displayTemperatureC
  AC CA DAM_AC and  air conditioners (+home's Westinghouse and Kelvinator ones among them): applianceState (RUNNING,
  Azul Bogong…      OFF), mode, targetTemperatureC, ambientTemperatureC, fanSpeedSetting

Anything else (air purifiers, dehumidifiers, robot vacuums, rangehoods) is listed as "other" with its state in words.

No Electrolux appliance reports its power or energy through this API, so none is recorded: a fridge shows its
temperatures, doors and alerts, and the rest when they run.
"""

from __future__ import annotations

from typing import Any

from app.features.home.types import Reading

TYPES = {
    "CR": "fridge",
    "WM": "washer",
    "TD": "dryer",
    "WD": "washer_dryer",
    "DW": "dishwasher",
    "OV": "oven",
    "SO": "oven",
    "HB": "oven",
    **dict.fromkeys(("AC", "CA", "DAM_AC", "AZUL", "BOGONG", "PANTHER", "TELICA"), "air_conditioner"),
}
# Words in the appliance's own device type (applianceInfo.deviceType), for a type code that isn't above. First wins.
TYPE_WORDS = [
    (("WASHER_DRYER", "WASHERDRYER"), "washer_dryer"),
    (("DISH",), "dishwasher"),
    (("WASH",), "washer"),
    (("DRYER",), "dryer"),
    (("FREEZER",), "freezer"),
    (("REFRIGERATOR", "FRIDGE", "COOLING"), "fridge"),
    (("OVEN", "HOB", "COOK"), "oven"),
    (("AIR_CONDITIONER", "AIRCONDITIONER"), "air_conditioner"),
]
COMPARTMENTS = {"fridge": "Fridge", "freezer": "Freezer", "extraCavity": "Extra compartment", "iceMaker": "Ice maker"}
FAST = {"fridge": "Fast cool", "freezer": "Fast freeze"}
RUNNING = {"RUNNING", "PAUSED"}  # a paused cycle is still under way
SAID = {"PAUSED": "Paused", "DELAYED_START": "Delayed start", "READY_TO_START": "Ready to start",
        "END_OF_CYCLE": "Finished", "ALARM": "Alarm"}  # fmt: skip
NOTHING = {"", "NONE", "UNAVAILABLE", "UNKNOWN", "OFF"}


def kind_of(appliance_type: str, info: dict[str, Any] | None = None, reported: dict[str, Any] | None = None) -> str:
    """What kind of device an appliance is, by its type code, else by the words of its device type."""
    kind = TYPES.get(appliance_type.upper())
    if kind is None:
        device_type = str(((info or {}).get("applianceInfo") or {}).get("deviceType") or "").upper()
        kind = next((k for words, k in TYPE_WORDS if any(w in device_type for w in words)), "other")
    # A freezer on its own reports only a freezer compartment.
    if kind == "fridge" and isinstance(reported, dict) and "freezer" in reported and "fridge" not in reported:
        return "freezer"
    return kind


def words(value: Any) -> str:
    """An UPPER_CASE value in words: "VERY_GOOD" -> "Very good"."""
    return " ".join(str(value).replace("_", " ").split()).capitalize()


def _number(d: dict[str, Any], key: str) -> float | None:
    v = d.get(key)
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def _celsius(v: float) -> str:
    return f"{round(v, 1):g} °C"


def _on(v: Any) -> bool:
    return isinstance(v, str) and v.upper() == "ON"


def _alerts(alerts: Any, where: str = "") -> list[str]:
    """The alerts an appliance (or one compartment) reports now, in words: "Freezer: temperature too high"."""
    out = []
    for a in alerts if isinstance(alerts, list) else []:
        code = a.get("code") if isinstance(a, dict) else a
        if code:
            said = words(code)
            out.append(f"{where}: {said[0].lower()}{said[1:]}" if where else said)
    return out


def program(reported: dict[str, Any]) -> str | None:
    """The program in words. A laundry programUID is "COTTON_PR_COTTONS": the part before _PR_ is the name."""
    selections = reported.get("userSelections")
    uid = (selections.get("programUID") if isinstance(selections, dict) else None) or reported.get("program")
    if not isinstance(uid, str) or uid.upper() in NOTHING:
        return None
    return words(uid.split("_PR_")[0])


def _fridge(reported: dict[str, Any], details: dict[str, str], info: dict[str, str]) -> None:
    """A fridge's compartments, doors, modes and alerts."""
    alerts = _alerts(reported.get("alerts"))
    open_doors = []
    for key, label in COMPARTMENTS.items():
        c = reported.get(key)
        if not isinstance(c, dict):
            continue
        state = c.get("applianceState")
        sensor, target = _number(c, "sensorTemperatureC"), _number(c, "targetTemperatureC")
        if isinstance(state, str) and state.upper() == "OFF":
            details[label] = "Off"
        elif sensor is not None:
            details[label] = _celsius(sensor) + (f" (set to {_celsius(target)})" if target is not None else "")
        elif target is not None:
            details[label] = f"Set to {_celsius(target)}"
        elif key == "iceMaker" and isinstance(state, str):
            details[label] = words(state)
        if isinstance(c.get("doorState"), str) and c["doorState"].upper() == "OPEN":
            open_doors.append(label.lower())
        if key in FAST and _on(c.get("fastMode")):
            details[FAST[key]] = "On"
        alerts += _alerts(c.get("alerts"), label)
    if any(isinstance(reported.get(k), dict) and "doorState" in reported[k] for k in COMPARTMENTS):
        details["Door"] = "Closed" if not open_doors else f"{' and '.join(open_doors).capitalize()} open"
    if _on(reported.get("vacationHolidayMode")):
        details["Holiday mode"] = "On"
    if _on(reported.get("energySavingMode")):
        details["Eco mode"] = "On"
    defrost = reported.get("defrostRoutineState")
    if isinstance(defrost, str) and defrost.upper() not in NOTHING | {"IDLE", "INACTIVE", "NOT_ACTIVE"}:
        details["Defrost"] = words(defrost)
    if alerts:
        details["Alerts"] = ", ".join(dict.fromkeys(alerts))
    for key, label in (("compressorState", "Compressor"), ("waterFilterState", "Water filter"),
                       ("airFilterState", "Air filter")):  # fmt: skip
        if isinstance(reported.get(key), str):
            info[label] = words(reported[key])


def _air_conditioner(reported: dict[str, Any], details: dict[str, str]) -> None:
    state = reported.get("applianceState")
    on = isinstance(state, str) and state.upper() == "RUNNING"
    if isinstance(state, str):
        details["Status"] = "On" if on else words(state)
    if on and isinstance(reported.get("mode"), str):
        details["Mode"] = words(reported["mode"])
    if on and (target := _number(reported, "targetTemperatureC")) is not None:
        details["Set to"] = _celsius(target)
    if (room := _number(reported, "ambientTemperatureC")) is not None:
        details["Room"] = _celsius(room)
    if on and isinstance(reported.get("fanSpeedSetting"), str):
        details["Fan"] = words(reported["fanSpeedSetting"])


def _cycles(
    reported: dict[str, Any], details: dict[str, str]
) -> tuple[bool | None, str | None, str | None, float | None]:
    """A laundry, dishwasher or oven's state: whether it's running, its program and phase, and minutes left."""
    state = str(reported.get("applianceState") or "").upper()
    running = state in RUNNING if state else None
    if state in SAID:
        details["Status"] = SAID[state]
    if isinstance(reported.get("doorState"), str) and reported["doorState"].upper() == "OPEN":
        details["Door"] = "Open"
    if running and (temperature := _number(reported, "displayTemperatureC")) is not None:
        details["Temperature"] = _celsius(temperature)
    phase = reported.get("cyclePhase")
    seconds = _number(reported, "timeToEnd")
    return (
        running,
        program(reported) if running else None,
        words(phase) if running and isinstance(phase, str) and phase.upper() not in NOTHING else None,
        round(seconds / 60) if running and seconds and seconds > 0 else None,
    )


def reading(appliance_id: str, entry: dict[str, Any], state: dict[str, Any] | None) -> Reading:
    """An appliance as a reading, from what's kept of it (`entry`: its name, type and what its info said) and its
    state now (None or empty: it couldn't be read, so it's offline)."""
    name = str(entry.get("name") or "Appliance")
    model = entry.get("model") or None
    reported = ((state or {}).get("properties") or {}).get("reported")
    reported = reported if isinstance(reported, dict) else {}
    kind = kind_of(str(entry.get("type") or ""), {"applianceInfo": {"deviceType": entry.get("device_type")}}, reported)
    info: dict[str, str] = {
        k: str(entry[f]) for f, k in (("brand", "Brand"), ("pnc", "Product number")) if entry.get(f)
    }
    if not state:
        return Reading(appliance_id, name, kind, model, online=False, info=info)
    connection = str(state.get("connectionState") or reported.get("connectivityState") or "").lower()
    online = connection == "connected"
    signal = (reported.get("networkInterface") or {}).get("linkQualityIndicator")
    if isinstance(signal, str):
        info["Signal"] = words(signal)
    details: dict[str, str] = {}
    running = phase = prog = remaining = None
    if kind in ("fridge", "freezer"):
        _fridge(reported, details, info)
    elif kind == "air_conditioner":
        _air_conditioner(reported, details)
    elif kind in ("washer", "dryer", "washer_dryer", "dishwasher", "oven"):
        running, prog, phase, remaining = _cycles(reported, details)
        if alerts := _alerts(reported.get("alerts")):
            details["Alerts"] = ", ".join(dict.fromkeys(alerts))
    else:
        if isinstance(reported.get("applianceState"), str):
            details["Status"] = words(reported["applianceState"])
        if alerts := _alerts(reported.get("alerts")):
            details["Alerts"] = ", ".join(dict.fromkeys(alerts))
    return Reading(
        key=appliance_id,
        name=name,
        kind=kind,
        model=model,
        online=online,
        running=running if online else None,
        program=prog,
        phase=phase,
        remaining_min=remaining,
        details=details,
        info=info,
        raw={
            "type": entry.get("type"),
            "connectionState": state.get("connectionState"),
            "status": state.get("status"),
            "reported": reported,
        },
    )
