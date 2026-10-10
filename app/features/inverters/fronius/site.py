"""
A Fronius site as the main inverter: a GEN24 (Primo GEN24 or Symo GEN24, with its battery if there is one) or a
Datamanager inverter (Symo, Primo, Symo Hybrid), with a Fronius Smart Meter at the grid connection. Decodes what the
collector stored from its Solar API (collector/devices/fronius/solar_api.py): the figures as Fronius reported them, by
name.

From Fronius' Solar API V1 spec, checked against the responses of real GEN24, GEN24-with-battery and Symo inverters
recorded by Home Assistant's Fronius integration; not yet tried on one here. Fronius' signs are the dashboard's:
P_Grid is + importing, P_Akku + discharging; P_Load is negative while the house uses power. Energy is in Wh.

A GEN24 reports no daily counters (E_Day is always null) and the Solar API has no battery energy counters at all, so
those days' totals are worked out from the lifetime counters and power (ReadingsRepository.daily).
"""

from __future__ import annotations

import html
from collections.abc import Mapping
from typing import Any

from app.features.inverters.fronius.models import MODELS
from app.features.inverters.types import Info, Raw, Snapshot

brand = "Fronius"

# DeviceStatus.StatusCode as the running states the dashboard knows (Sungrow's codes; see inverters.types).
STATUS = {7: 0x0000, 8: 0x0008, 9: 0x0400, 10: 0x0100, 11: 0x0008, 12: 0x0008, 13: 0x0002}


def fields(raw: Raw) -> Mapping[str, Any]:
    return raw.get("input") or {}


def num(f: Mapping[str, Any], key: str, scale: float = 1.0) -> float | None:
    v = f.get(key)
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    return round(v * scale, 3)


def kwh(f: Mapping[str, Any], key: str) -> float | None:
    """An energy counter in kWh. Zero means none: a GEN24 reports 0 while it updates its firmware."""
    v = num(f, key, 0.001)
    return v if v else None


def decode(raw: Raw) -> Snapshot:
    f = fields(raw)
    flowing = any(k.startswith("flow.") for k in f)
    pv = num(f, "flow.P_PV")
    load = num(f, "flow.P_Load")
    battery = num(f, "flow.P_Akku")
    current = num(f, "storage.Current_DC")  # + charging: the dashboard's battery current is - charging
    soc = num(f, "storage.StateOfCharge_Relative")
    if soc is None and battery is not None:
        soc = num(f, "flow.inverter.SOC")  # a GEN24 without a battery used to report 0 here: only with one
    status = num(f, "inverter.DeviceStatus.StatusCode")
    return {
        # Solar is null while the inverter sleeps: that's none, so long as the site answered.
        "pv_power": pv if pv is not None else (0.0 if flowing else None),
        "load_power": -load if load is not None else None,
        "grid_power": num(f, "flow.P_Grid"),
        "battery_power": battery,
        "battery_soc": soc,
        "battery_voltage": num(f, "storage.Voltage_DC"),
        "battery_current": -current if current is not None else None,
        "battery_temp": num(f, "storage.Temperature_Cell"),
        "grid_voltage": num(f, "meter.Voltage_AC_Phase_1") or num(f, "inverter.UAC"),
        "grid_freq": num(f, "meter.Frequency_Phase_Average") or num(f, "inverter.FAC"),
        "mppt1_v": num(f, "inverter.UDC"),
        "mppt1_a": num(f, "inverter.IDC"),
        "mppt2_v": num(f, "inverter.UDC_2"),
        "mppt2_a": num(f, "inverter.IDC_2"),
        "daily_pv": num(f, "flow.E_Day", 0.001),
        "total_pv": kwh(f, "flow.E_Total"),
        "total_import": kwh(f, "meter.EnergyReal_WAC_Plus_Absolute"),
        "total_export": kwh(f, "meter.EnergyReal_WAC_Minus_Absolute"),
        "running_state": STATUS.get(int(status)) if status is not None else None,
    }


def frozen(previous: Raw, raw: Raw) -> bool:
    """Never: the Solar API answers from the inverter itself, not from a gateway's copy that can stop refreshing."""
    return False


def model(f: Mapping[str, Any]) -> str | None:
    dt = num(f, "info.DT")
    if dt is None:
        return None
    name = MODELS.get(int(dt))
    if name == "GEN24":  # every GEN24 says 1: its rated power tells the size
        kw = num(f, "info.PVPower", 0.001)
        return f"GEN24 {kw:g}" if kw else "GEN24"
    return name or f"Fronius (type {int(dt)})"


def decode_info(raw: Raw) -> Info:
    """Model, serial, rated power, the name it was given and its battery's size, from the info read every few hours."""
    f = fields(raw)
    info: dict[str, Any] = {}
    if (m := model(f)) is not None:
        info["model"] = m
    if isinstance(serial := f.get("info.UniqueID"), str | int) and str(serial).strip():
        info["serial"] = str(serial).strip()
    if (kw := num(f, "info.PVPower", 0.001)) is not None:
        info["nominal_kw"] = round(kw, 1)
    if isinstance(name := f.get("info.CustomName"), str) and name.strip():
        info["name"] = html.unescape(name).strip()  # a Datamanager sends it as HTML entities
    if (cap := num(f, "storage.Capacity_Maximum", 0.001)) is not None and cap > 0:
        info["battery_kwh"] = round(cap, 2)
    return {"brand": brand, **info} if info else info
