"""
Reads a snapshot from a Sungrow SH-RS / SH-RT hybrid inverter over Modbus TCP
(via the WiNet-S2 dongle), plus a mock inverter for local development.

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
import math
import random
import time
from dataclasses import dataclass

log = logging.getLogger(__name__)

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
    Reg("daily_export", 13005, 1, False, 0.1),
    Reg("total_export", 13006, 2, False, 0.1),
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
]

# Contiguous ranges read in one request each, instead of ~30 single-register
# requests per poll. If the gateway rejects a block (some addresses inside a
# range can be "Illegal Data Address" on some models, e.g. MPPT3 on SH5.0RS),
# that block permanently falls back to one request per register.
BLOCKS = [(5008, 29), (13000, 42)]

RUNNING_STATE = {
    0x0000: "Running", 0x0040: "Running", 0x0041: "Off-grid charge",
    0x0200: "Update failed", 0x0400: "Maintain mode", 0x0800: "Forced mode",
    0x1000: "Off-grid mode", 0x1111: "Uninitialized", 0x0010: "Initial standby",
    0x0002: "Shutdown", 0x0008: "Standby", 0x0004: "Emergency stop",
    0x0020: "Startup", 0x2000: "Open loop", 0x4000: "External EMS mode",
    0x4001: "Emergency charging", 0x0100: "Fault", 0x0001: "Stop",
    0x8100: "Derating", 0x8200: "Dispatch", 0x9100: "Warn run",
}

DEVICE_TYPES = {
    0x0D17: "SH3.0RS", 0x0D0D: "SH3.6RS", 0x0D18: "SH4.0RS", 0x0D0F: "SH5.0RS",
    0x0D10: "SH6.0RS", 0x0D1A: "SH8.0RS", 0x0D1B: "SH10RS",
    0x0E00: "SH5.0RT", 0x0E01: "SH6.0RT", 0x0E02: "SH8.0RT", 0x0E03: "SH10RT",
    0x0E10: "SH5.0RT-20", 0x0E11: "SH6.0RT-20", 0x0E12: "SH8.0RT-20", 0x0E13: "SH10RT-20",
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


def derive(values: dict) -> dict:
    """Turn raw register values into the snapshot shape stored in the DB."""
    snap = {k: v for k, v in values.items() if k not in ("battery_power_raw", "export_power")}

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
        self.info: dict = {}
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

    def _read(self, client, address: int, count: int, holding: bool = False) -> list[int] | None:
        fn = client.read_holding_registers if holding else client.read_input_registers
        rr = fn(address + ADDRESS_OFFSET, count=count, **{self._unit_kw: self.unit})
        if rr.isError():
            return None
        return list(rr.registers)

    def _read_info(self, client) -> None:
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

    def read_snapshot(self) -> dict:
        """One connect -> read -> disconnect cycle. Raises ConnectionError if unreachable."""
        if not self.host:
            raise ConnectionError("No inverter address set. Set INVERTER_HOST in .env, or run: bash install.sh --configure")
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
                        values[r.key] = _decode(r, words[off:off + r.count])
                    else:
                        w = self._read(client, r.address, r.count)
                        values[r.key] = _decode(r, w) if w else None

            if all(v is None for v in values.values()):
                raise ConnectionError("Inverter connected but returned no data")
            return derive(values)
        finally:
            client.close()


class MockInverter:
    """Plausible fake data: a sunny-ish day, an evening load peak, a 10 kWh battery."""

    CAPACITY_WH = 16_000
    model = "Mock SH5.0RS"
    battery_kwh = 16.0
    info = {"model": model, "serial": "MOCK0000001", "nominal_kw": 5.0, "phases": "Single phase",
            "battery_kwh": battery_kwh, "reserve": 5.0}

    def __init__(self):
        self.soc = 55.0
        self.day = None
        self.totals = {"pv": 8_000.0, "import": 3_000.0, "export": 4_000.0, "charge": 2_000.0, "discharge": 1_800.0}
        self.daily = dict.fromkeys(self.totals, 0.0)
        self.last_ts = None
        self.cloud = 1.0

    def simulate(self, ts: float) -> dict:
        lt = time.localtime(ts)
        if lt.tm_yday != self.day:
            self.day = lt.tm_yday
            self.daily = dict.fromkeys(self.totals, 0.0)
        dt_h = 0 if self.last_ts is None else min(ts - self.last_ts, 600) / 3600
        self.last_ts = ts
        hour = lt.tm_hour + lt.tm_min / 60 + lt.tm_sec / 3600

        self.cloud = min(1.0, max(0.25, self.cloud + random.uniform(-0.02, 0.02)))
        sun = max(0.0, math.sin(math.pi * (hour - 6) / 13))
        pv = 5200 * sun ** 1.4 * self.cloud
        load = 350 + 150 * random.random() + 1800 * math.exp(-((hour - 18.5) ** 2) / 3) + 600 * math.exp(-((hour - 7.5) ** 2) / 1)
        if random.random() < 0.003:
            load += 2000  # kettle

        surplus = pv - load
        batt = 0.0  # + discharge
        if surplus > 0 and self.soc < 100:
            batt = -min(surplus, 5000)
        elif surplus < 0 and self.soc > 10:
            batt = min(-surplus, 5000)
        self.soc = min(100.0, max(0.0, self.soc - batt * dt_h / self.CAPACITY_WH * 100))
        grid = load - pv - batt

        for k, w in (("pv", pv), ("import", max(grid, 0)), ("export", max(-grid, 0)),
                     ("charge", max(-batt, 0)), ("discharge", max(batt, 0))):
            self.daily[k] += w * dt_h / 1000
            self.totals[k] += w * dt_h / 1000

        flow = (1 if pv > 0 else 0) | (FLOW_BATTERY_CHARGING if batt < 0 else 0) | \
            (FLOW_BATTERY_DISCHARGING if batt > 0 else 0) | 8 | (16 if grid < 0 else 0) | (32 if grid > 0 else 0)
        r = lambda v, n=1: round(v, n)
        return {
            "pv_power": r(pv, 0), "load_power": r(load, 0), "grid_power": r(grid, 0), "battery_power": r(batt, 0),
            "battery_soc": r(self.soc), "battery_soh": 99.0, "battery_temp": r(24 + 4 * sun),
            "battery_voltage": r(360 + self.soc * 0.4), "battery_current": r(abs(batt) / 380),
            "inverter_temp": r(30 + 15 * sun), "grid_freq": r(50 + random.uniform(-0.05, 0.05), 2),
            "mppt1_v": r(320 * min(1, sun * 4)), "mppt1_a": r(pv * 0.55 / 320 if pv else 0),
            "mppt2_v": r(310 * min(1, sun * 4)), "mppt2_a": r(pv * 0.45 / 310 if pv else 0),
            "running_state": 0, "power_flow": flow,
            "daily_pv": r(self.daily["pv"]), "daily_import": r(self.daily["import"]),
            "daily_export": r(self.daily["export"]), "daily_charge": r(self.daily["charge"]),
            "daily_discharge": r(self.daily["discharge"]),
            "daily_direct": r(max(0.0, self.daily["pv"] - self.daily["export"] - self.daily["charge"])),
            "total_pv": r(self.totals["pv"]), "total_import": r(self.totals["import"]),
            "total_export": r(self.totals["export"]), "total_charge": r(self.totals["charge"]),
            "total_discharge": r(self.totals["discharge"]),
        }

    def read_snapshot(self) -> dict:
        return self.simulate(time.time())
