"""
Reads a snapshot from a Sungrow SH-RS / SH-RT hybrid inverter over Modbus TCP
(via the WiNet-S2 dongle). The mock inverter for local development is in mock.py.

Register addresses, scaling and quirks come from
https://github.com/berndverhofstadt/sungrow-poc (MIT), which transcribed them
from Sungrow's "Communication Protocol of Residential Hybrid Inverter" V1.1.5
and verified them against an SH5.0RS + WiNet-S2.

Sign conventions for the power values in a snapshot - positive always means
"power flowing into the house":
    pv_power       W  solar production (>= 0)
    load_power     W  house consumption (>= 0)
    grid_power     W  + importing from grid, - exporting to grid
    battery_power  W  + discharging into house, - charging
"""

from __future__ import annotations

import inspect
import logging
import time
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)

# One reading, keyed by sample column (see app.core.schema), in the sign conventions above.
Snapshot = dict[str, Any]

# Per Sungrow's doc: communication address = protocol address - 1.
ADDRESS_OFFSET = -1
# Raw values that mean "no data" (e.g. export power with no meter fitted).
SENTINELS = {0xFFFF, 0x7FFF, 0xFFFFFFFF, 0x7FFFFFFF}


@dataclass(frozen=True)
class Reg:
    key: str
    address: int  # protocol address, as printed in the Sungrow doc
    count: int = 1
    signed: bool = False
    scale: float = 1.0


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

# Contiguous ranges read in one request each, instead of ~30 single-register
# requests per poll. If the gateway rejects a block (some addresses inside a
# range can be "Illegal Data Address" on some models, e.g. MPPT3 on SH5.0RS),
# that block permanently falls back to one request per register.
# Each register must sit wholly inside one block: 13041-42 (total charge) used to straddle the
# end of a 13000+42 block, so its high word was never read.
BLOCKS = [(5008, 29), (13000, 41), (13041, 2), (13045, 3)]

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


def _combine(words: list[int]) -> int:
    """Low word first, per Sungrow doc."""
    return words[0] if len(words) == 1 else (words[1] << 16) | words[0]


def _decode(reg: Reg, words: list[int]) -> float | None:
    raw = _combine(words)
    if raw in SENTINELS:
        return None
    if reg.signed:
        bits = 16 * reg.count
        if raw >= 1 << (bits - 1):
            raw -= 1 << bits
    return round(raw * reg.scale, 3)


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


class SungrowInverter:
    def __init__(self, host: str, port: int = 502, unit: int = 1):
        from pymodbus.client import ModbusTcpClient

        self.host, self.port, self.unit = host, port, unit
        self._client_cls = ModbusTcpClient
        self._bad_blocks: set[int] = set()
        self.info: dict[str, Any] = {}
        self._info_at = 0.0
        # pymodbus renamed the unit-id kwarg across 3.x versions.
        params = inspect.signature(ModbusTcpClient.read_input_registers).parameters
        self._unit_kw = next((k for k in ("device_id", "slave", "unit") if k in params), "slave")

    @property
    def model(self) -> str | None:
        return self.info.get("model")

    @property
    def battery_kwh(self) -> float | None:
        return self.info.get("battery_kwh")

    def _read(self, client: Any, address: int, count: int, holding: bool = False) -> list[int] | None:
        fn = client.read_holding_registers if holding else client.read_input_registers
        rr = fn(address + ADDRESS_OFFSET, count=count, **{self._unit_kw: self.unit})
        if rr.isError():
            return None
        return list(rr.registers)

    def _read_info(self, client: Any) -> None:
        """System details that rarely change. Read on first connect, then every 6 hours."""
        info = dict(self.info)
        w = self._read(client, 4990, 10)  # serial number, 10 registers of ASCII
        if w:
            info["serial"] = b"".join(x.to_bytes(2, "big") for x in w).decode("ascii", "replace").strip("\x00 ")
        w = self._read(client, 5000, 3)  # device type, nominal power (0.1 kW), output type
        if w:
            info["model"] = DEVICE_TYPES.get(w[0], f"Unknown (0x{w[0]:04X})")
            info["nominal_kw"] = round(w[1] * 0.1, 1)
            info["phases"] = {0: "Single phase", 1: "Three phase", 2: "Three phase"}.get(w[2])
        w = self._read(client, 5639, 1)  # battery capacity, 0.01 kWh
        if w and w[0] not in SENTINELS:
            info["battery_kwh"] = round(w[0] * 0.01, 2)
        w = self._read(client, 13059, 1, holding=True)  # min SOC = backup reserve, 0.1 % (read only)
        if w and w[0] not in SENTINELS:
            info["reserve"] = round(w[0] * 0.1, 1)
        self.info = info
        self._info_at = time.time()

    def read_snapshot(self) -> Snapshot:
        """One connect -> read -> disconnect cycle. Raises ConnectionError if unreachable."""
        if not self.host:
            raise ConnectionError(
                "No inverter address set. Set INVERTER_HOST in .env, or run: bash install.sh --configure"
            )
        client = self._client_cls(self.host, port=self.port, timeout=5, retries=1)
        if not client.connect():
            raise ConnectionError(f"Could not connect to {self.host}:{self.port}")
        try:
            if time.time() - self._info_at > 6 * 3600:
                self._read_info(client)

            values: dict[str, float | None] = {}
            for start, count in BLOCKS:
                regs = [r for r in REGISTERS if start <= r.address < start + count]
                words = None if start in self._bad_blocks else self._read(client, start, count)
                if words is None and start not in self._bad_blocks:
                    log.warning("Block read %s+%s rejected; falling back to single-register reads", start, count)
                    self._bad_blocks.add(start)
                for r in regs:
                    if words is not None:
                        off = r.address - start
                        values[r.key] = _decode(r, words[off : off + r.count])
                    else:
                        w = self._read(client, r.address, r.count)
                        values[r.key] = _decode(r, w) if w else None

            if all(v is None for v in values.values()):
                raise ConnectionError("Inverter connected but returned no data")
            return derive(values)
        finally:
            client.close()
