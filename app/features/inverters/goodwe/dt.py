"""
GoodWe's DT family of string inverters (D-NS, XS, DT, MS, SDT, e.g. GW5000D-NS, GW3000-XS), as a second, AC-coupled
solar system alongside the hybrid. The collector reads it through its Wi-Fi dongle and stores the raw words; this
turns them into values.

From the MIT-licensed `goodwe` library's dt.py (github.com/marcelblijleven/goodwe); not yet checked against a real
one here:

    30004-30011 serial, 30012-30016 model name (ASCII)
    30103-30110 PV string voltages and currents (0.1 V, 0.1 A), 30127-28 AC output (W)
    30141 temperature (0.1 °C, signed), 30144 today's yield (0.1 kWh), 30145-46 lifetime yield (0.1 kWh),
    30147-48 running hours

The library reads no rated power for this family: it's taken from the model name (GW5000D-NS: 5 kW).
"""

from __future__ import annotations

import re

from app.features.inverters.goodwe.registers import Reg, span, text, value, words
from app.features.inverters.types import Info, Raw, SolarValues

brand = "GoodWe"

REGISTERS = [
    Reg("pv2_power", 30127, 2),
    Reg("daily_pv2", 30144, 1, False, 0.1),
    Reg("total_pv2", 30145, 2, False, 0.1),
    Reg("pv2_temp", 30141, 1, True, 0.1),
]
STRINGS = ((30103, 30104), (30105, 30106), (30107, 30108), (30109, 30110))  # (volts, amps) of each PV input


def nominal_kw(model: str | None) -> float | None:
    """The rated power in a GoodWe model name: GW5000D-NS → 5.0, GW3000-XS → 3.0, GW10K-DT → 10.0."""
    m = re.match(r"GW(\d+(?:\.\d+)?)(K?)", (model or "").upper())
    if not m:
        return None
    n = float(m.group(1))
    kw = n if m.group(2) else n / 1000
    return round(kw, 1) if 0.5 <= kw <= 100 else None


def decode(raw: Raw) -> SolarValues | None:
    """This poll's figures, or None if the reading can't be real (more than the model can make)."""
    w = words(raw)
    values = {r.key: value(r, w) for r in REGISTERS}
    dc = [(span(w, v, 1), span(w, a, 1)) for v, a in STRINGS]
    powers = [vv[0] * 0.1 * aa[0] * 0.1 for vv, aa in dc if vv and aa and vv[0] != 0xFFFF and aa[0] != 0xFFFF]
    values["pv2_dc_power"] = round(sum(powers), 1) if powers else None
    if (kw := nominal_kw(text(w, 30012, 5))) is not None:
        limit_w = kw * 1000 * 1.5
        if (
            any((values[k] or 0) > limit_w for k in ("pv2_power", "pv2_dc_power"))
            or (values["daily_pv2"] or 0) > kw * 24
        ):
            return None
    return values


def decode_info(raw: Raw) -> Info:
    """Model, serial, rated power and running hours, which come with every poll's reading."""
    w = words(raw)
    model = text(w, 30012, 5)
    if model is None and span(w, 30004, 8) is None:
        return {}
    hours = value(Reg("running_hours", 30147, 2), w)
    return {
        "brand": brand,
        "model": model or "GoodWe string inverter",
        "serial": text(w, 30004, 8),
        "nominal_kw": nominal_kw(model),
        "running_hours": int(hours) if hours is not None else None,
    }
