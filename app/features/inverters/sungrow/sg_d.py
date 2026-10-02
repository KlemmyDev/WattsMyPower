"""
Sungrow SG-D string inverters (e.g. SG5K-D), as a second, AC-coupled solar system alongside the
hybrid. The collector reads it through its encrypted Wi-Fi dongle and stores the raw words; this
turns them into values.

Registers are from Sungrow's protocol for residential grid-connected inverters
(protocol address = Modbus address + 1, 32-bit values low word first), checked
against a real SG5K-D:

    5000 type code, 5001 nominal power (0.1 kW), 5003 daily yield (0.1 kWh), 5004-05 total yield (kWh),
    5006-07 running hours, 5008 temperature (0.1 °C, signed), 5017-18 DC power (W), 5031-32 AC power (W)
"""

from __future__ import annotations

from app.features.inverters.sungrow.registers import Reg, value, words
from app.features.inverters.types import Info, Raw, SolarValues

brand = "Sungrow"

# Device type codes seen on real hardware.
MODELS = {0x0126: "SG5K-D"}

REGISTERS = [
    Reg("pv2_power", 5031, 2),
    Reg("pv2_dc_power", 5017, 2),
    Reg("daily_pv2", 5003, 1, False, 0.1),
    Reg("total_pv2", 5004, 2),
    Reg("pv2_temp", 5008, 1, True, 0.1),
]


NOMINAL = Reg("nominal_kw", 5001, 1, False, 0.1)


def decode(raw: Raw) -> SolarValues | None:
    """This poll's figures from its input registers, or None if they can't be real.

    A reply decrypted with a stale key comes out as random words that can still look like a valid
    frame, so the whole reading is checked against the inverter's own nominal power (which comes
    with every poll): an SG-D can't report more than 1-100 kW nominal, or output well beyond it.
    """
    w = words(raw)
    values = {r.key: value(r, w) for r in REGISTERS}
    nominal = value(NOMINAL, w)
    if nominal is not None:
        limit_w = nominal * 1000 * 1.5
        if not 1 <= nominal <= 100 or any((values[k] or 0) > limit_w for k in ("pv2_power", "pv2_dc_power")):
            return None
        if (values["daily_pv2"] or 0) > nominal * 24:
            return None
    return values


def decode_info(raw: Raw) -> Info:
    """Model, nominal power and running hours, which come with every poll's reading."""
    w = words(raw)
    type_code = w.get(5000)
    if type_code is None:
        return {}
    hours = value(Reg("running_hours", 5006, 2), w)
    return {
        "brand": brand,
        "model": MODELS.get(type_code, f"Unknown (0x{type_code:04X})"),
        "nominal_kw": value(NOMINAL, w),
        "running_hours": int(hours) if hours is not None else None,
    }
