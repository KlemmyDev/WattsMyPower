"""
What every GoodWe reader shares: the ranges read each poll and every few hours, through GoodWeClient. A model
family's reader subclasses GoodWeDevice and says which ranges (see et.py, dt.py).

GoodWe only has holding registers (function 0x03), but they hold the inverter's readings, so they're stored as a
reading's `input` words like every other inverter's.
"""

from __future__ import annotations

from collector.devices import RawReading, Words
from collector.devices.goodwe.protocol import UDP_PORT, GoodWeClient
from collector.devices.modbus import Range, read_ranges


class GoodWeDevice:
    name: str
    driver: str
    default_unit: int
    ranges: tuple[Range, ...]  # read every poll
    identity: Range  # model, serial, rated power: what a probe reads
    info: tuple[Range, ...] = ()  # read on start and every 6 hours

    def __init__(self, host: str, port: int = UDP_PORT, unit: int = 0, timeout: float = 2.0, retries: int = 2):
        self.host, self.port = host, port
        # Unit 0 (or a Modbus default of 1 from a form that didn't ask) means the family's own address.
        self.unit = unit if unit not in (0, 1) else self.default_unit
        self.client = GoodWeClient(host, port, self.unit, timeout, retries)
        self._bad: set[int] = set()

    def probe(self) -> Words | None:
        """The identity registers, or None if nothing here answers like this family. One quick try, for a scan."""
        start, count = self.identity
        quick = GoodWeClient(self.host, self.port, self.unit, timeout=1.0, retries=0)
        try:
            block = quick.read(start, count)
        except ConnectionError:
            return None
        return dict(zip(range(start, start + count), block, strict=True)) if block else None

    def read(self, include_info: bool) -> RawReading:
        if not self.host:
            raise ConnectionError("No inverter address set. Connect it in Manage → Integrations.")
        info = read_ranges(self.client.read, self.info, self._bad, self.name) if include_info else {}
        words = read_ranges(self.client.read, self.ranges, self._bad, self.name)
        if not words:
            raise ConnectionError(f"{self.host} answered but returned no data")
        return RawReading(input={**info, **words}, info_input=info)
