"""
Sungrow SH-RS / SH-RT hybrid inverters (e.g. SH5.0RS): decodes the raw registers the collector
stored (collector/PROTOCOL.md) into a snapshot. The collector only reads and stores the words;
everything about what they mean lives here, so a fix can be re-applied to history
(`python -m app reprocess`).

Register addresses, scaling and quirks come from
https://github.com/berndverhofstadt/sungrow-poc (MIT), which transcribed them
from Sungrow's "Communication Protocol of Residential Hybrid Inverter" V1.1.5
and verified them against an SH5.0RS + WiNet-S2.
"""

from __future__ import annotations

from typing import Any

from app.features.inverters.sungrow.registers import SENTINELS, Reg, span, value, words
from app.features.inverters.types import Info, Raw, Snapshot

brand = "Sungrow"


# All input registers (function code 0x04) we read each poll.
REGISTERS = [
    Reg("inverter_temp", 5008, 1, True, 0.1),
    Reg("mppt1_v", 5011, 1, False, 0.1),
    Reg("mppt1_a", 5012, 1, False, 0.1),
    Reg("mppt2_v", 5013, 1, False, 0.1),
    Reg("mppt2_a", 5014, 1, False, 0.1),
    Reg("pv_power", 5017, 2, False, 1),
    # Scale differs by firmware (0.1 Hz per doc, 0.01 Hz on some units) - normalised in derive().
    Reg("grid_freq", 5036, 1, False, 0.1),
    Reg("running_state", 13000),
    Reg("power_flow", 13001),
    Reg("daily_pv", 13002, 1, False, 0.1),
    Reg("total_pv", 13003, 2, False, 0.1),
    # 13005/13006 count only what the hybrid's own panels exported. An AC-coupled system behind
    # the meter exports through the same meter, so feed-in comes from the meter's counters below.
    Reg("daily_pv_export", 13005, 1, False, 0.1),
    Reg("total_pv_export", 13006, 2, False, 0.1),
    Reg("load_power", 13008, 2, True, 1),
    Reg("export_power", 13010, 2, True, 1),
    Reg("daily_direct", 13017, 1, False, 0.1),
    Reg("battery_voltage", 13020, 1, False, 0.1),
    # Doc says unsigned, but real SH5.0RS hardware reports charging current as negative.
    Reg("battery_current", 13021, 1, True, 0.1),
    Reg("battery_power_raw", 13022, 1, False, 1),
    Reg("battery_soc", 13023, 1, False, 0.1),
    Reg("battery_soh", 13024, 1, False, 0.1),
    Reg("battery_temp", 13025, 1, True, 0.1),
    Reg("daily_discharge", 13026, 1, False, 0.1),
    Reg("total_discharge", 13027, 2, False, 0.1),
    Reg("daily_import", 13036, 1, False, 0.1),
    Reg("total_import", 13037, 2, False, 0.1),
    Reg("daily_charge", 13040, 1, False, 0.1),
    Reg("total_charge", 13041, 2, False, 0.1),
    # Everything exported through the meter (the bill's feed-in), whichever system produced it.
    Reg("daily_export", 13045, 1, False, 0.1),
    Reg("total_export", 13046, 2, False, 0.1),
]


RUNNING_STATE = {
    0x0000: "Running",
    0x0040: "Running",
    0x0041: "Off-grid charge",
    0x0200: "Update failed",
    0x0400: "Maintain mode",
    0x0800: "Forced mode",
    0x1000: "Off-grid mode",
    0x1111: "Uninitialized",
    0x0010: "Initial standby",
    0x0002: "Shutdown",
    0x0008: "Standby",
    0x0004: "Emergency stop",
    0x0020: "Startup",
    0x2000: "Open loop",
    0x4000: "External EMS mode",
    0x4001: "Emergency charging",
    0x0100: "Fault",
    0x0001: "Stop",
    0x8100: "Derating",
    0x8200: "Dispatch",
    0x9100: "Warn run",
}

DEVICE_TYPES = {
    0x0D17: "SH3.0RS",
    0x0D0D: "SH3.6RS",
    0x0D18: "SH4.0RS",
    0x0D0F: "SH5.0RS",
    0x0D10: "SH6.0RS",
    0x0D1A: "SH8.0RS",
    0x0D1B: "SH10RS",
    0x0E00: "SH5.0RT",
    0x0E01: "SH6.0RT",
    0x0E02: "SH8.0RT",
    0x0E03: "SH10RT",
    0x0E10: "SH5.0RT-20",
    0x0E11: "SH6.0RT-20",
    0x0E12: "SH8.0RT-20",
    0x0E13: "SH10RT-20",
}

FLOW_BATTERY_CHARGING = 1 << 1
FLOW_BATTERY_DISCHARGING = 1 << 2

# Input registers the collector reads only on start and every 6 hours (serial, type and nominal
# power, battery capacity): left out when comparing one poll with the last.
INFO_INPUT = frozenset([*range(4990, 5003), 5639])


def derive(values: dict[str, float | None]) -> Snapshot:
    """Turn raw register values into the snapshot shape stored in the DB."""
    snap: Snapshot = {k: v for k, v in values.items() if k not in ("battery_power_raw", "export_power")}

    flow = int(values.get("power_flow") or 0)
    bp = values.get("battery_power_raw")
    if bp is not None:
        snap["battery_power"] = -bp if flow & FLOW_BATTERY_CHARGING else bp
    else:
        snap["battery_power"] = None

    f = values.get("grid_freq")
    if f is not None and f > 100:
        snap["grid_freq"] = round(f / 10, 2)

    export = values.get("export_power")
    snap["grid_power"] = -export if export is not None else None
    return snap


def decode(raw: Raw) -> Snapshot:
    """A snapshot from one poll's input registers. Registers that weren't read come out as None."""
    w = words(raw)
    return derive({r.key: value(r, w) for r in REGISTERS})


def frozen(previous: Raw, raw: Raw) -> bool:
    """
    Whether this poll is the previous one served again: every word read each poll identical.

    The WiNet-S/S2 answers from its own copy of the registers, refreshed every 30-60 s, and at
    times (at start-up, after a hiccup) stops refreshing it for minutes while still answering.
    A live inverter doesn't repeat the whole block: reactive power (5033) and power factor (5035)
    move on nearly every poll, day and night, even while solar, the battery or home use hold
    steady. Over a day of real SH5.0RS polls, at least two words changed between every pair,
    while solar alone held one value for 54 polls at midday, home use for 62 at night, and the
    whole 13000 block for two polls running. So single figures standing still prove nothing; the
    whole block standing still does. A poll missing words (a range that couldn't be read) never
    counts as a repeat.
    """
    now = {a: w for a, w in words(raw).items() if a not in INFO_INPUT}
    return bool(now) and now == {a: w for a, w in words(previous).items() if a not in INFO_INPUT}


def decode_info(raw: Raw) -> Info:
    """System details from the info registers (read on start and every 6 hours)."""
    inp, holding = words(raw), words(raw, "holding")
    info: dict[str, Any] = {}
    w = span(inp, 4990, 10)  # serial number, 10 registers of ASCII
    if w:
        info["serial"] = b"".join(x.to_bytes(2, "big") for x in w).decode("ascii", "replace").strip("\x00 ")
    w = span(inp, 5000, 3)  # device type, nominal power (0.1 kW), output type
    if w:
        info["model"] = DEVICE_TYPES.get(w[0], f"Unknown (0x{w[0]:04X})")
        info["nominal_kw"] = round(w[1] * 0.1, 1)
        info["phases"] = {0: "Single phase", 1: "Three phase", 2: "Three phase"}.get(w[2])
    w = span(inp, 5639, 1)  # battery capacity, 0.01 kWh
    if w and w[0] not in SENTINELS:
        info["battery_kwh"] = round(w[0] * 0.01, 2)
    w = span(holding, 13059, 1)  # min SOC = backup reserve, 0.1 % (read only)
    if w and w[0] not in SENTINELS:
        info["reserve"] = round(w[0] * 0.1, 1)
    return {"brand": brand, **info} if info else info
