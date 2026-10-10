"""
GoodWe's ET family of hybrid inverters (ET, EH, BT, BH and their Plus/G2 versions, e.g. GW5K-EH, GW10K-ET): decodes
the raw registers the collector stored (collector/PROTOCOL.md) into a snapshot.

Addresses, sizes, signs and scaling are from the MIT-licensed `goodwe` library's et.py
(github.com/marcelblijleven/goodwe), the reference behind Home Assistant's GoodWe integration. Not yet checked
against a real GoodWe here: what each word means lives in this file, so a fix can be re-applied to everything
recorded (`python -m app reprocess`).

    35000+33   info: rated power (W), AC output type, serial (35003, 8 registers), model name (35011, 5 registers)
    35100+125  running data: PV strings, grid, load, battery, temperatures, the energy counters
    36000+45   the smart meter
    37000+24   the battery's BMS: temperature, state of charge and health

Grid power at 35140 is positive while exporting; battery power at 35182-83 positive while discharging. Home use is
worked out as the library does: solar + battery - grid export.
"""

from __future__ import annotations

from typing import Any

from app.features.inverters.goodwe.registers import Reg, span, text, value, words
from app.features.inverters.types import Info, Raw, Snapshot

brand = "GoodWe"

PV_POWER = [Reg(f"ppv{n}", a, 2) for n, a in ((1, 35105), (2, 35109), (3, 35113), (4, 35117))]
ACTIVE_POWER = Reg("active_power", 35140, 1, True)  # the grid: + exporting
BATTERY_POWER = Reg("pbattery1", 35182, 2, True)  # + discharging
WORK_MODE = Reg("work_mode", 35187)
BATTERY_MODE = Reg("battery_mode", 35184)  # 0: no battery

REGISTERS = [
    Reg("mppt1_v", 35103, 1, False, 0.1),
    Reg("mppt1_a", 35104, 1, False, 0.1),
    Reg("mppt2_v", 35107, 1, False, 0.1),
    Reg("mppt2_a", 35108, 1, False, 0.1),
    Reg("grid_voltage", 35121, 1, False, 0.1),
    Reg("grid_freq", 35123, 1, True, 0.01),
    Reg("inverter_temp", 35176, 1, True, 0.1),  # the radiator's
    Reg("battery_voltage", 35180, 1, False, 0.1),
    Reg("battery_current", 35181, 1, True, 0.1),
    Reg("total_pv", 35191, 2, False, 0.1),
    Reg("daily_pv", 35193, 2, False, 0.1),
    Reg("total_export", 35195, 2, False, 0.1),
    Reg("daily_export", 35199, 1, False, 0.1),
    Reg("total_import", 35200, 2, False, 0.1),
    Reg("daily_import", 35202, 1, False, 0.1),
    Reg("total_charge", 35206, 2, False, 0.1),
    Reg("daily_charge", 35208, 1, False, 0.1),
    Reg("total_discharge", 35209, 2, False, 0.1),
    Reg("daily_discharge", 35211, 1, False, 0.1),
    Reg("battery_temp", 37003, 1, True, 0.1),
    Reg("battery_soc", 37007),
    Reg("battery_soh", 37008),
]

# Work mode (35187) as the running states the dashboard knows (Sungrow's codes, which running_state is kept in;
# see app.features.inverters.types): 0x1000 is running without the grid, which the Grid page reports as an outage.
WORK_MODES = {
    0: 0x0008,  # waiting: standby
    1: 0x0000,  # on-grid: running
    2: 0x1000,  # off-grid: running the house on the battery
    3: 0x0100,  # fault
    4: 0x0400,  # upgrading its firmware: maintenance
    5: 0x0010,  # checking itself: starting up
}

AC_OUTPUT = {0: "Single phase", 1: "Three phase", 2: "Three phase"}

# Registers that don't move between polls of a live inverter for reasons of their own: left out of `frozen`.
INFO_WORDS = frozenset(range(35000, 35033))


def decode(raw: Raw) -> Snapshot:
    """A snapshot from one poll. Registers that weren't read come out as None."""
    w = words(raw)
    snap: Snapshot = {r.key: value(r, w) for r in REGISTERS}
    strings = [value(r, w) for r in PV_POWER]
    pv = sum(max(p, 0.0) for p in strings if p is not None) if any(p is not None for p in strings) else None
    grid_export, battery = value(ACTIVE_POWER, w), value(BATTERY_POWER, w)
    snap["pv_power"] = pv
    snap["grid_power"] = -grid_export if grid_export is not None else None
    snap["battery_power"] = battery
    snap["load_power"] = (
        round(pv + (battery or 0.0) - grid_export, 3) if pv is not None and grid_export is not None else None
    )
    mode = value(WORK_MODE, w)
    snap["running_state"] = WORK_MODES.get(int(mode)) if mode is not None else None
    if value(BATTERY_MODE, w) == 0:  # no battery fitted: the BMS block reads zeros
        snap["battery_soc"] = snap["battery_soh"] = snap["battery_temp"] = None
    return snap


def frozen(previous: Raw, raw: Raw) -> bool:
    """Whether this poll repeats the last word for word. The running data starts with the inverter's own clock
    (35100-35102, to the second), so a fresh reading always differs."""
    now = {a: x for a, x in words(raw).items() if a not in INFO_WORDS}
    return bool(now) and now == {a: x for a, x in words(previous).items() if a not in INFO_WORDS}


def decode_info(raw: Raw) -> Info:
    """Model, serial, rated power and phases, from the info registers (read on start and every 6 hours)."""
    w = words(raw)
    info: dict[str, Any] = {}
    if (serial := text(w, 35003, 8)) is not None:
        info["serial"] = serial
    if (model := text(w, 35011, 5)) is not None:
        info["model"] = model
    got = span(w, 35001, 2)
    if got:
        if got[0] not in (0, 0xFFFF):
            info["nominal_kw"] = round(got[0] / 1000, 1)
        if got[1] in AC_OUTPUT:
            info["phases"] = AC_OUTPUT[got[1]]
    if info and "model" not in info:
        info["model"] = "GoodWe hybrid"
        info["untested"] = True
    return {"brand": brand, **info} if info else info
