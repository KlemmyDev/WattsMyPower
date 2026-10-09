"""
A Tesla's details beyond its charge, the same whichever way the car is reached: Tessie's copy of Tesla's vehicle data
(from_fleet) or what the car says over Bluetooth (from_ble). Pure.

Groups, and what reading each costs:

    status      locked, doors and boot open, someone in it, gear. Free: over Bluetooth it's the security computer,
                which answers without waking the car; through Tessie, Tessie's copy
    charging    what the charger offers, the cable, the port's latch, time to the limit: part of the charge reading
    schedule    scheduled charging or departure set in the car, and its charge and preconditioning schedules (which
                start charging by themselves: the dashboard then puts the car on hold)
    climate     temperatures, climate and preconditioning, cabin overheat protection, the battery heater
    security    sentry mode, valet mode, windows open
    tyres       each tyre's pressure (bar), and any warning
    driving     odometer, gear, speed, power
    software    the version installed, and an update downloading, waiting or installing
    media       what's playing

Every group but status needs the car awake. The dashboard never wakes a car just to read them: over Bluetooth they're
read while it's awake anyway (app.features.tesla.bluetooth), and a refresh that would wake it asks first.

Each group is {"as_of": unix seconds, "data": {...}}, or {"as_of", "refused": why} when the car won't give it to the
dashboard's key (a charging manager may not see everything).
"""

from __future__ import annotations

import math
from typing import Any

GROUPS = ("status", "charging", "schedule", "climate", "security", "tyres", "driving", "software", "media")
EXTRAS = ("schedule", "climate", "security", "tyres", "driving", "software", "media")  # each its own read over BLE
MILE_KM = 1.609344
DAYS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")  # days_of_week's bits, Sunday first
TYRES = ("fl", "fr", "rl", "rr")


def _num(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _int(v: Any) -> int | None:
    x = _num(v)
    return round(x) if x is not None else None


def _bool(v: Any) -> bool | None:
    if v is None or v == "":
        return None
    if isinstance(v, str):
        return v.lower() in ("true", "1", "on", "yes")
    return bool(v)


def oneof(v: Any) -> str | None:
    """A protobuf "enum" message as MessageToDict gives it ({"Armed": {}}) or a plain string: its name."""
    if isinstance(v, dict):
        return next(iter(v), None)
    return str(v) if v not in (None, "") else None


def _ts(v: Any) -> int | None:
    """Unix seconds from Tesla's milliseconds or seconds."""
    x = _num(v)
    if not x:
        return None
    return int(x / 1000) if x > 1e11 else int(x)


def days(mask: Any) -> list[str]:
    m = _int(mask) or 0
    return [d for i, d in enumerate(DAYS) if m & (1 << i)]


def _km(miles: Any) -> float | None:
    m = _num(miles)
    return round(m * MILE_KM, 1) if m is not None else None


def _group(as_of: int | None, data: dict[str, Any]) -> dict[str, Any]:
    return {"as_of": as_of, "data": data}


# -- what both ways share ----------------------------------------------------------------------------------------------


def _charging(cs: dict[str, Any]) -> dict[str, Any]:
    """The charging details from a charge_state (the same keys either way)."""
    return {
        "pilot_amps": _int(cs.get("charger_pilot_current")),
        "cable": oneof(cs.get("conn_charge_cable"))
        if cs.get("conn_charge_cable") not in ("SNA", {"SNA": {}})
        else None,
        "latch": oneof(cs.get("charge_port_latch")),
        "minutes_to_limit": _int(cs.get("minutes_to_charge_limit", cs.get("minutes_to_full_charge"))),
        "usable_soc": _num(cs.get("usable_battery_level")),
        "energy_added": _num(cs.get("charge_energy_added")),
        "battery_heater": _bool(cs.get("battery_heater_on")),
        "low_power_mode": _bool(cs.get("low_power_mode")),
    }


def _schedule_mode(cs: dict[str, Any]) -> dict[str, Any]:
    """Scheduled charging and departure, as the charge_state says them."""
    mode = str(oneof(cs.get("scheduled_charging_mode")) or "").lower().removeprefix("scheduledchargingmode")
    mode = {"startat": "start_at", "departby": "depart_by"}.get(mode, "off" if mode in ("off", "") else mode)
    start = _int(cs.get("scheduled_charging_start_time_minutes", cs.get("scheduled_charging_start_time_app")))
    return {
        "mode": mode,
        "start_minutes": start if mode == "start_at" else None,
        "departure_minutes": _int(cs.get("scheduled_departure_time_minutes")) if mode == "depart_by" else None,
        "preconditioning": _bool(cs.get("preconditioning_enabled")),
    }


def _schedules(charge: list[Any], precondition: list[Any]) -> dict[str, Any]:
    return {
        "charge_schedules": [
            {
                "name": s.get("name") or None,
                "days": days(s.get("days_of_week")),
                "start": _int(s.get("start_time")) if _bool(s.get("start_enabled")) else None,
                "end": _int(s.get("end_time")) if _bool(s.get("end_enabled")) else None,
                "one_time": bool(_bool(s.get("one_time"))),
                "enabled": bool(_bool(s.get("enabled"))),
            }
            for s in charge
            if isinstance(s, dict)
        ],
        "precondition_schedules": [
            {
                "name": s.get("name") or None,
                "days": days(s.get("days_of_week")),
                "time": _int(s.get("precondition_time")),
                "one_time": bool(_bool(s.get("one_time"))),
                "enabled": bool(_bool(s.get("enabled"))),
            }
            for s in precondition
            if isinstance(s, dict)
        ],
    }


def overrides_solar(schedule: dict[str, Any] | None) -> str | None:
    """Why the car may start charging by itself, whatever the dashboard does (then it's put on hold), in words; None
    when nothing in the car will."""
    if not schedule:
        return None
    if schedule.get("mode") == "start_at":
        return "Scheduled charging is on in the car: it starts charging by itself at the set time"
    if schedule.get("mode") == "depart_by":
        return "A departure time is set in the car: it starts charging by itself to be ready by then"
    if any(s["enabled"] and s["start"] is not None for s in schedule.get("charge_schedules") or []):
        return "A charge schedule is set in the car: it starts charging by itself when it's due"
    return None


def parked_draw(groups: dict[str, Any]) -> list[str]:
    """What's using power while the car's parked, from its climate and security (plugged in, it comes from the
    house): sentry mode, climate, preconditioning, a keeper mode, cabin overheat protection, the battery heater."""
    climate = (groups.get("climate") or {}).get("data") or {}
    security = (groups.get("security") or {}).get("data") or {}
    out = []
    if security.get("sentry") in ("Armed", "Aware", "Panic", "Idle", "Quiet"):
        out.append("Sentry mode (about 250 W)")
    keeper = climate.get("keeper")
    if keeper in ("Dog", "Camp", "Party", "On"):
        out.append(f"{'Climate keeper' if keeper == 'On' else keeper + ' mode'}")
    elif climate.get("climate_on"):
        out.append("Climate")
    if climate.get("preconditioning"):
        out.append("Preconditioning")
    if climate.get("cabin_overheat") in ("on", "fan_only") and (climate.get("inside_c") or 0) >= 40:
        out.append("Cabin overheat protection")
    if climate.get("battery_heater"):
        out.append("Battery heater")
    return out


# -- through Tessie: Tesla's vehicle data -------------------------------------------------------------------------------


def from_fleet(last: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Every group from a car's vehicle data as Tessie keeps it (Tesla's Fleet API shape)."""
    cs = last.get("charge_state") or {}
    cl = last.get("climate_state") or {}
    vs = last.get("vehicle_state") or {}
    ds = last.get("drive_state") or {}
    at = _ts(last.get("timestamp")) or _ts(cs.get("timestamp"))  # when Tessie had it, else when its charge was read
    vs_at = _ts(vs.get("timestamp")) or at
    doors = {
        "df": "Driver door",
        "pf": "Passenger door",
        "dr": "Rear left door",
        "pr": "Rear right door",
        "ft": "Frunk",
        "rt": "Boot",
    }
    windows = {"fd_window": "Driver", "fp_window": "Passenger", "rd_window": "Rear left", "rp_window": "Rear right"}
    out: dict[str, dict[str, Any]] = {}
    if vs:
        opened = [name for k, name in doors.items() if _int(vs.get(k))]
        if _bool(cs.get("charge_port_door_open")):
            opened.append("Charge port")
        out["status"] = _group(
            vs_at,
            {
                "locked": _bool(vs.get("locked")),
                "open": opened,
                "user_present": _bool(vs.get("is_user_present")),
                "gear": ds.get("shift_state") or ("P" if ds else None),
            },
        )
        sentry = vs.get("sentry_mode")
        out["security"] = _group(
            vs_at,
            {
                "sentry": None if sentry is None else ("Armed" if _bool(sentry) else "Off"),
                "sentry_available": _bool(vs.get("sentry_mode_available")),
                "valet": _bool(vs.get("valet_mode")),
                "windows_open": [name for k, name in windows.items() if _int(vs.get(k))],
            },
        )
        out["tyres"] = _group(
            vs_at,
            {
                **{t: _num(vs.get(f"tpms_pressure_{t}")) for t in TYRES},
                "warnings": [t for t in TYRES if vs.get(f"tpms_hard_warning_{t}") or vs.get(f"tpms_soft_warning_{t}")],
            },
        )
        su = vs.get("software_update") or {}
        out["software"] = _group(
            vs_at,
            {
                "version": str(vs.get("car_version") or "").split(" ")[0] or None,
                "update": _update(
                    su.get("status"),
                    su.get("version"),
                    su.get("download_perc"),
                    su.get("install_perc"),
                    su.get("scheduled_time_ms"),
                    su.get("expected_duration_sec"),
                ),
            },
        )
        mi = vs.get("media_info") or {}
        out["media"] = _group(
            vs_at,
            {
                "playing": str(mi.get("media_playback_status") or "").lower() == "playing",
                "title": mi.get("now_playing_title") or None,
                "artist": mi.get("now_playing_artist") or None,
                "source": mi.get("now_playing_source") or None,
                "volume": _num(mi.get("audio_volume")),
            },
        )
        out["driving"] = _group(
            _ts(ds.get("timestamp")) or vs_at,
            {
                "odometer_km": _km(vs.get("odometer")),
                "gear": ds.get("shift_state") or None,
                "speed_kmh": _km(ds.get("speed")),
                "power_kw": _num(ds.get("power")),
            },
        )
    if cs:
        cs_at = _ts(cs.get("timestamp")) or at
        out["charging"] = _group(cs_at, _charging(cs))
        sched = last.get("charge_schedule_data") or {}
        pre = last.get("preconditioning_schedule_data") or {}
        out["schedule"] = _group(
            cs_at,
            _schedule_mode(cs)
            | _schedules(sched.get("charge_schedules") or [], pre.get("precondition_schedules") or []),
        )
    if cl:
        cop = str(cl.get("cabin_overheat_protection") or "").lower()
        out["climate"] = _group(
            _ts(cl.get("timestamp")) or at,
            {
                "inside_c": _num(cl.get("inside_temp")),
                "outside_c": _num(cl.get("outside_temp")),
                "climate_on": _bool(cl.get("is_climate_on")),
                "preconditioning": _bool(cl.get("is_preconditioning")),
                "keeper": {"dog": "Dog", "camp": "Camp", "on": "On"}.get(
                    str(cl.get("climate_keeper_mode") or "").lower()
                ),
                "cabin_overheat": {"on": "on", "fanonly": "fan_only", "off": "off"}.get(cop),
                "battery_heater": _bool(cl.get("battery_heater")),
                "defrost": _bool(cl.get("is_front_defroster_on")),
            },
        )
    return out


def _update(status: Any, version: Any, dl: Any, inst: Any, when_ms: Any, secs: Any) -> dict[str, Any] | None:
    s = str(oneof(status) or "").lower()
    s = {"downloadingwifiwait": "waiting_for_wifi", "downloading_wifi_wait": "waiting_for_wifi"}.get(s, s)
    if s in ("", "unknown"):
        return None
    return {
        "status": s,  # available, downloading, waiting_for_wifi, scheduled, installing
        "version": str(version or "").split(" ")[0] or None,
        "download_pct": _int(dl),
        "install_pct": _int(inst),
        "scheduled_at": _ts(when_ms),
        "minutes": round(secs / 60) if (secs := _num(secs)) else None,
    }


# -- over Bluetooth: what the car says --------------------------------------------------------------------------------


def from_ble(
    status: dict[str, Any] | None,
    status_at: int | None,
    charge: dict[str, Any] | None,
    charge_at: int | None,
    extras: dict[str, tuple[int, dict[str, Any]]],
    refused: dict[str, tuple[int, str]],
) -> dict[str, dict[str, Any]]:
    """Every group known of a car over Bluetooth: its security computer's `status` (already in words, from
    app.features.tesla.bluetooth), its charge_state, and the `extras` read while it was awake, each as MessageToDict
    gave it ({group: (when, {field: message})}). `refused` are the groups its key may not read: {group: (when, why)}."""
    out: dict[str, dict[str, Any]] = {}
    if status:
        out["status"] = _group(status_at, status)
    if charge:
        out["charging"] = _group(charge_at, _charging(charge))
    for g, (at, raw) in extras.items():
        data = _BLE[g](raw)
        if g == "schedule" and charge:
            data = _schedule_mode(charge) | data
        out[g] = _group(at, data)
    if charge and "schedule" not in out:
        out["schedule"] = _group(
            charge_at, _schedule_mode(charge) | {"charge_schedules": None, "precondition_schedules": None}
        )
    for g, (at, why) in refused.items():
        if g not in out:
            out[g] = {"as_of": at, "refused": why}
    return out


def _ble_schedule(raw: dict[str, Any]) -> dict[str, Any]:
    return _schedules(
        (raw.get("charge_schedule_state") or {}).get("charge_schedules") or [],
        (raw.get("preconditioning_schedule_state") or {}).get("precondition_schedules") or [],
    )


def _ble_climate(raw: dict[str, Any]) -> dict[str, Any]:
    cl = raw.get("climate_state") or {}
    cop = str(cl.get("cabin_overheat_protection") or "").lower().removeprefix("cabinoverheatprotection")
    keeper = oneof(cl.get("climate_keeper_mode"))
    return {
        "inside_c": _num(cl.get("inside_temp_celsius")),
        "outside_c": _num(cl.get("outside_temp_celsius")),
        "climate_on": _bool(cl.get("is_climate_on")),
        "preconditioning": _bool(cl.get("is_preconditioning")),
        "keeper": {"On": "On", "Dog": "Dog", "Party": "Camp"}.get(keeper or ""),  # Party is Camp mode
        "cabin_overheat": {"on": "on", "fanonly": "fan_only", "off": "off"}.get(cop),
        "battery_heater": _bool(cl.get("battery_heater")),
        "defrost": _bool(cl.get("is_front_defroster_on")) or oneof(cl.get("defrost_mode")) in ("Normal", "Max"),
    }


def _ble_security(raw: dict[str, Any]) -> dict[str, Any]:
    c = raw.get("closures_state") or {}
    windows = {
        "window_open_driver_front": "Driver",
        "window_open_passenger_front": "Passenger",
        "window_open_driver_rear": "Rear left",
        "window_open_passenger_rear": "Rear right",
    }
    return {
        "sentry": oneof(c.get("sentry_mode_state")),
        "sentry_available": _bool(c.get("sentry_mode_available")),
        "valet": _bool(c.get("valet_mode")),
        "windows_open": [name for k, name in windows.items() if _bool(c.get(k))],
    }


def _ble_tyres(raw: dict[str, Any]) -> dict[str, Any]:
    t = raw.get("tire_pressure_state") or {}
    return {
        **{p: _num(t.get(f"tpms_pressure_{p}")) for p in TYRES},
        "warnings": [
            p for p in TYRES if _bool(t.get(f"tpms_hard_warning_{p}")) or _bool(t.get(f"tpms_soft_warning_{p}"))
        ],
    }


def _ble_driving(raw: dict[str, Any]) -> dict[str, Any]:
    d = raw.get("drive_state") or {}
    hundredths = _num(d.get("odometer_in_hundredths_of_a_mile"))
    gear = oneof(d.get("shift_state"))
    return {
        "odometer_km": round(hundredths / 100 * MILE_KM, 1) if hundredths is not None else None,
        "gear": gear if gear in ("P", "R", "N", "D") else None,
        "speed_kmh": _km(d.get("speed_float", d.get("speed"))),
        "power_kw": _num(d.get("power")),
    }


def _ble_software(raw: dict[str, Any]) -> dict[str, Any]:
    su = raw.get("software_update_state") or {}
    legacy = raw.get("legacy_vehicle_state") or {}
    return {
        "version": str(legacy.get("car_version") or "").split(" ")[0] or None,
        "update": _update(
            su.get("status"),
            su.get("version"),
            su.get("download_perc"),
            su.get("install_perc"),
            su.get("scheduled_time_ms"),
            su.get("expected_duration_sec"),
        ),
    }


def _ble_media(raw: dict[str, Any]) -> dict[str, Any]:
    m = raw.get("media_state") or {}
    return {
        "playing": oneof(m.get("media_playback_status")) == "Playing",
        "title": m.get("now_playing_title") or None,
        "artist": m.get("now_playing_artist") or None,
        "source": oneof(m.get("now_playing_source")),
        "volume": _num(m.get("audio_volume")),
    }


_BLE = {
    "schedule": _ble_schedule,
    "climate": _ble_climate,
    "security": _ble_security,
    "tyres": _ble_tyres,
    "driving": _ble_driving,
    "software": _ble_software,
    "media": _ble_media,
}
