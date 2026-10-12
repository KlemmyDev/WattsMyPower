"""
Growatt string (grid-tie) inverters, as a second, AC-coupled solar system alongside the hybrid. Decoded by the API's
driver of the same id.

Growatt's Wi-Fi sticks (ShineWiFi) only talk to Growatt's cloud, so the inverter is read through its RS485 port with
a small RS485-to-network adapter (an Elfin EW11, a Waveshare RS485-to-Ethernet, a USR-W610). Adapters come two ways:

  - Modbus TCP gateway (port 502, the usual setting): ordinary Modbus TCP, which the adapter turns into RTU.
  - Transparent (any other port, often 8899 or 4196): raw Modbus RTU frames passed through as they are.

The adapter's serial side should be 9600 baud, 8N1; the inverter's Modbus address is 1 unless it was changed on its
screen. Growatt answers input registers (function 0x04, its readings) and holding registers (0x03, its settings and
identity), addressed from 0 as printed in Growatt's Modbus RTU protocol documents.

Two families share the identity registers but not the readings:

  - `growatt.tl`: older TL inverters (e.g. 3000TL, 5000MTL, MTL-S, S-series), protocol 3.x. Readings in input 0-44.
  - `growatt.tlx`: newer ones (MIN/MIC TL-X, MAX, MOD), protocol 1.2x. Readings in input 0-124; an older one
    rejects past 44, which is how a probe tells them apart.

The identity (rated power 6-7, firmware 9-14, serial 23-27, module 28-29) is read with every poll, as a second
inverter's details are (the API reads them from the same reading).
"""

from __future__ import annotations

import inspect
from typing import Any

from pymodbus import FramerType
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusException

from collector.devices import RawReading, Words
from collector.devices.modbus import Range, read_ranges

TCP_PORT = 502
IDENTITY: Range = (0, 30)  # holding
# Growatt's documents cap a read at 45 registers on some firmware, so longer stretches go in pieces.
TL_RANGES: tuple[Range, ...] = ((0, 45),)
TLX_RANGES: tuple[Range, ...] = ((0, 45), (45, 45), (90, 35))
NEWER: Range = (45, 15)  # only the newer family answers past 44


def _printable(words: list[int]) -> bool:
    """Whether a serial number's registers hold printable ASCII, as a Growatt's do (and nothing else's here would)."""
    raw = b"".join(w.to_bytes(2, "big") for w in words).strip(b"\x00 ")
    return len(raw) >= 6 and all(32 <= b < 127 for b in raw)


class GrowattDevice:
    name = "pv2"
    driver: str
    ranges: tuple[Range, ...]
    newer: bool  # this family answers past input 44

    def __init__(self, host: str, port: int = TCP_PORT, unit: int = 1, client_cls: Any = None, timeout: float = 5):
        self.host, self.port, self.unit, self.timeout = host, port, unit or 1, timeout
        self._client_cls = client_cls or ModbusTcpClient
        self._bad_input: set[int] = set()
        self._bad_holding: set[int] = set()
        params = inspect.signature(self._client_cls.read_input_registers).parameters
        self._unit_kw = next((k for k in ("device_id", "slave", "unit") if k in params), "slave")

    def _client(self, timeout: float, retries: int) -> Any:
        # A transparent adapter passes RTU frames through; a gateway on 502 takes Modbus TCP.
        framer = FramerType.SOCKET if self.port == TCP_PORT else FramerType.RTU
        return self._client_cls(self.host, port=self.port, framer=framer, timeout=timeout, retries=retries)

    def _read(self, client: Any, address: int, count: int, holding: bool = False) -> list[int] | None:
        fn = client.read_holding_registers if holding else client.read_input_registers
        rr = fn(address, count=count, **{self._unit_kw: self.unit})
        return None if rr.isError() else list(rr.registers)

    def probe(self) -> Words | None:
        """The identity (holding) registers, or None if nothing here answers like this family of Growatt. One quick
        try, for a scan. Its readings must answer too, and past input 44 only for the newer family."""
        client = self._client(timeout=3, retries=0)
        try:
            if not client.connect():
                return None
            ident = self._read(client, *IDENTITY, holding=True)
            if not ident or len(ident) != IDENTITY[1] or not _printable(ident[23:28]):
                return None
            first = self._read(client, 0, 45)
            if not first or len(first) != 45:
                return None
            if self.newer and not self._read(client, *NEWER):
                return None
        except (ModbusException, OSError):
            return None
        finally:
            client.close()
        return dict(zip(range(IDENTITY[0], IDENTITY[0] + IDENTITY[1]), ident, strict=True))

    def read(self, include_info: bool) -> RawReading:
        """One connect -> read -> disconnect cycle: its readings and identity. Raises ConnectionError if unreachable."""
        if not self.host:
            raise ConnectionError("No inverter address set. Connect it in Manage → Integrations.")
        client = self._client(timeout=self.timeout, retries=1)
        if not client.connect():
            raise ConnectionError(f"Could not connect to {self.host}:{self.port}")
        try:
            words = read_ranges(lambda a, c: self._read(client, a, c), self.ranges, self._bad_input, self.name)
            ident = read_ranges(
                lambda a, c: self._read(client, a, c, holding=True), (IDENTITY,), self._bad_holding, self.name
            )
        except ModbusException as e:  # timeouts and dropped connections mid-read
            raise ConnectionError(f"{self.host}: {e}") from e
        finally:
            client.close()
        if not words:
            raise ConnectionError(f"{self.host} answered but sent no readings")
        return RawReading(input=words, holding=ident)


class TlDevice(GrowattDevice):
    driver = "growatt.tl"
    ranges = TL_RANGES
    newer = False


class TlxDevice(GrowattDevice):
    driver = "growatt.tlx"
    ranges = TLX_RANGES
    newer = True
