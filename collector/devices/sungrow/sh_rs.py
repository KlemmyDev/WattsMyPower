"""
Sungrow SH-RS / SH-RT hybrid inverters (e.g. SH5.0RS): reads their registers over plain Modbus TCP,
through the WiNet-S / WiNet-S2 dongle. Decoded by the API's driver of the same id.

Register ranges are from Sungrow's "Communication Protocol of Residential Hybrid Inverter" V1.1.5
(as transcribed by https://github.com/berndverhofstadt/sungrow-poc, MIT) and verified against an
SH5.0RS + WiNet-S2. What each word means is decoded by the API, not here.
"""

from __future__ import annotations

import inspect
from typing import Any

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusException

from collector.devices import RawReading, Words
from collector.devices.modbus import Range, read_ranges

# Per Sungrow's doc: communication address = protocol address - 1.
ADDRESS_OFFSET = -1

# Input registers (function 0x04) read every poll, as contiguous ranges: one request each instead
# of ~30 single-register requests. Every multi-word value must sit wholly inside one range: 13041-42
# (total charge) used to straddle the end of a 13000+42 block, so its high word was never read.
BLOCKS: tuple[Range, ...] = ((5008, 29), (13000, 41), (13041, 2), (13045, 3))

# System details that rarely change, read on start and every 6 hours:
# serial number (10 words of ASCII), device type / nominal power / output type, battery capacity.
INFO_INPUT: tuple[Range, ...] = ((4990, 10), (5000, 3), (5639, 1))
# Min SOC, i.e. the backup reserve. A holding register (function 0x03); only ever read.
INFO_HOLDING: tuple[Range, ...] = ((13059, 1),)


class ShRsDevice:
    name = "hybrid"
    driver = "sungrow.sh_rs"

    def __init__(self, host: str, port: int = 502, unit: int = 1, client_cls: Any = None):
        self.host, self.port, self.unit = host, port, unit
        self._client_cls = client_cls or ModbusTcpClient
        # Ranges the gateway rejected, by first address: read one register at a time from then on.
        self._bad_input: set[int] = set()
        self._bad_holding: set[int] = set()
        # pymodbus renamed the unit-id kwarg across 3.x versions.
        params = inspect.signature(self._client_cls.read_input_registers).parameters
        self._unit_kw = next((k for k in ("device_id", "slave", "unit") if k in params), "slave")

    def _read(self, client: Any, address: int, count: int, holding: bool = False) -> list[int] | None:
        fn = client.read_holding_registers if holding else client.read_input_registers
        rr = fn(address + ADDRESS_OFFSET, count=count, **{self._unit_kw: self.unit})
        if rr.isError():
            return None
        return list(rr.registers)

    def read(self, include_info: bool) -> RawReading:
        """One connect -> read -> disconnect cycle. Raises ConnectionError if unreachable."""
        if not self.host:
            raise ConnectionError(
                "No inverter address set. Set INVERTER_HOST in .env, or run: bash install.sh --configure"
            )
        client = self._client_cls(self.host, port=self.port, timeout=5, retries=1)
        if not client.connect():
            raise ConnectionError(f"Could not connect to {self.host}:{self.port}")
        info_input: Words = {}
        info_holding: Words = {}
        try:
            if include_info:
                info_input = read_ranges(lambda a, c: self._read(client, a, c), INFO_INPUT, self._bad_input, self.name)
                info_holding = read_ranges(
                    lambda a, c: self._read(client, a, c, holding=True), INFO_HOLDING, self._bad_holding, self.name
                )
            words = read_ranges(lambda a, c: self._read(client, a, c), BLOCKS, self._bad_input, self.name)
        except ModbusException as e:  # timeouts and dropped connections mid-read
            raise ConnectionError(f"{self.host}: {e}") from e
        finally:
            client.close()
        if not words:
            raise ConnectionError("Inverter connected but returned no data")
        return RawReading(
            input={**info_input, **words},
            holding=dict(info_holding),
            info_input=info_input,
            info_holding=info_holding,
        )
