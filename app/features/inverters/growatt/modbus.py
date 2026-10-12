"""
Growatt string inverters read over Modbus through an RS485 adapter (collector/devices/growatt/inverter.py), as a second,
AC-coupled solar system. The collector stores the raw words; this turns them into values.

Addresses start at 0 as in Growatt's Modbus RTU protocol documents; 32-bit values are high word first. Not yet checked
against a real one here. Both families share the identity, in holding registers:

    6-7 rated power (0.1 VA), 9-11 firmware (ASCII), 23-27 serial (ASCII)

and differ in where their readings sit (input registers):

    figure                    older (protocol 3.x)   newer (protocol 1.2x)
    DC power (0.1 W)          1-2                    1-2
    AC output (0.1 W)         11-12                  35-36
    today's yield (0.1 kWh)   26-27                  53-54
    lifetime yield (0.1 kWh)  28-29                  55-56
    running time (0.5 s)      30-31                  57-58
    temperature (0.1 °C)      32                     93
"""

from __future__ import annotations

from dataclasses import dataclass

from app.features.inverters.goodwe.registers import Reg, text, value, words
from app.features.inverters.types import Info, Raw, SolarValues

brand = "Growatt"


@dataclass(frozen=True)
class Layout:
    family: str  # how the model family is named when the inverter doesn't say
    ac: int
    today: int
    total: int
    hours: int
    temp: int


OLDER = Layout("TL", ac=11, today=26, total=28, hours=30, temp=32)
NEWER = Layout("TL-X", ac=35, today=53, total=55, hours=57, temp=93)


def nominal_kw(raw: Raw) -> float | None:
    """The rated power the inverter reports (holding 6-7, 0.1 VA), in kW; None if it's missing or can't be right."""
    va = value(Reg("pmax", 6, 2, False, 0.1), words(raw, "holding"))
    return round(va / 1000, 1) if va is not None and 500 <= va <= 100_000 else None


def decode(raw: Raw, layout: Layout) -> SolarValues | None:
    """This poll's figures, or None if the reading can't be real (more than the inverter can make)."""
    w = words(raw)
    values: SolarValues = {
        "pv2_power": value(Reg("pv2_power", layout.ac, 2, False, 0.1), w),
        "pv2_dc_power": value(Reg("pv2_dc_power", 1, 2, False, 0.1), w),
        "daily_pv2": value(Reg("daily_pv2", layout.today, 2, False, 0.1), w),
        "total_pv2": value(Reg("total_pv2", layout.total, 2, False, 0.1), w),
        "pv2_temp": value(Reg("pv2_temp", layout.temp, 1, True, 0.1), w),
    }
    if (kw := nominal_kw(raw)) is not None and (
        any((values[k] or 0) > kw * 1000 * 1.5 for k in ("pv2_power", "pv2_dc_power"))
        or (values["daily_pv2"] or 0) > kw * 24
    ):
        return None
    return values


def decode_info(raw: Raw, layout: Layout) -> Info:
    """Serial, rated power, firmware and running hours, which come with every poll's reading."""
    h = words(raw, "holding")
    serial = text(h, 23, 5)
    if serial is None:
        return {}
    kw = nominal_kw(raw)
    seconds = value(Reg("running", layout.hours, 2, False, 0.5), words(raw))
    return {
        "brand": brand,
        "model": f"{kw:g} kW {layout.family} inverter" if kw else f"{layout.family} inverter",
        "serial": serial,
        "nominal_kw": kw,
        "firmware": text(h, 9, 3),
        "running_hours": int(seconds // 3600) if seconds is not None else None,
    }
