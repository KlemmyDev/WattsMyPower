"""
One Fronius inverter (a Primo, Symo, Galvo, Eco or GEN24) as a second, AC-coupled solar system beside the main
inverter: its output and energy from the Solar API's CommonInverterData, and what it is from GetInverterInfo, both
read every poll (collector/devices/fronius/solar_api.py).

A GEN24's DAY_ENERGY is always null: its share of today's solar is then worked out from its lifetime counter
(ReadingsRepository.daily). A Datamanager inverter asleep after dark leaves PAC out: that's no output.
"""

from __future__ import annotations

from typing import Any

from app.features.inverters.fronius.site import fields, kwh, model, num
from app.features.inverters.types import Info, Raw, SolarValues

brand = "Fronius"


def decode(raw: Raw) -> SolarValues | None:
    """This poll's figures, or None if it reported none at all."""
    f = fields(raw)
    if not any(k.startswith("inverter.") for k in f):
        return None
    strings = [(num(f, f"inverter.UDC{s}"), num(f, f"inverter.IDC{s}")) for s in ("", "_2", "_3")]
    dc = [v * a for v, a in strings if v is not None and a is not None]
    pac = num(f, "inverter.PAC")
    return {
        "pv2_power": max(pac, 0.0) if pac is not None else 0.0,
        "pv2_dc_power": round(sum(dc), 1) if dc else None,
        "daily_pv2": num(f, "inverter.DAY_ENERGY", 0.001),
        "total_pv2": kwh(f, "inverter.TOTAL_ENERGY"),
        "pv2_temp": None,  # not in the Solar API
    }


def decode_info(raw: Raw) -> Info:
    f = fields(raw)
    m = model(f)
    if m is None:
        return {}
    info: dict[str, Any] = {"brand": brand, "model": m, "nominal_kw": num(f, "info.PVPower", 0.001)}
    if isinstance(serial := f.get("info.UniqueID"), str | int) and str(serial).strip():
        info["serial"] = str(serial).strip()
    return info
