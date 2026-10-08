"""
The inverters the collector reads, and what a read returns, whatever the brand.

A device returns raw 16-bit words keyed by register address (as printed in the maker's docs)
and nothing else: no scaling, signs or sentinels. What the words mean is the API's business (its
driver with the same id decodes them), so a mapping fix there can be re-applied to everything
already stored. Readers live in a package per brand, one module per model family, and are
registered by driver id in drivers.py.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

# Register address -> raw unsigned 16-bit word.
Words = dict[int, int]

# The roles a device can have: the inverter with the battery and the grid meter, and a second,
# AC-coupled solar inverter. One device per role.
ROLES = ("hybrid", "pv2")


@dataclass(frozen=True)
class DeviceConfig:
    """A connected inverter, as stored in the collector's database (Manage → Integrations).

    `settings` belong to the API (e.g. where a second inverter connects): stored and served as they
    are, never interpreted here.
    """

    role: str
    driver: str
    host: str
    port: int = 502
    unit: int = 1
    settings: Mapping[str, Any] = field(default_factory=dict)
    added_at: int = 0

    def as_json(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "driver": self.driver,
            "host": self.host,
            "port": self.port,
            "unit": self.unit,
            "settings": dict(self.settings),
            "added_at": self.added_at,
        }


@dataclass(frozen=True)
class RawReading:
    """One device's words from one poll.

    `input` / `holding` are everything read this poll, info registers included when they were read:
    exactly what goes into the stored row. `info_input` / `info_holding` repeat just the info
    registers (empty on polls that didn't read them), for the status endpoint.
    """

    input: Words
    holding: Words = field(default_factory=dict)
    info_input: Words = field(default_factory=dict)
    info_holding: Words = field(default_factory=dict)


class WriteRefused(Exception):
    """The device answered, but refused a write (e.g. a value outside what it accepts). Readable as it is."""


class Device(Protocol):
    """An inverter the poller reads."""

    name: str  # its role: "hybrid" (the inverter with the battery and meter) or "pv2" (a second solar inverter)
    driver: str  # what the readings are, for the API to decode them with, e.g. "sungrow.sh_rs"
    host: str

    def read(self, include_info: bool) -> RawReading:
        """One connect -> read -> disconnect cycle. Raises ConnectionError if the device can't be read."""
        ...


class Settable(Protocol):
    """A device some of whose settings (holding registers) can be read on demand and changed: the hybrid, for the
    dashboard's battery controls. The collector only checks an address is one the driver allows to be written;
    what to write is the API's business (its driver's control module)."""

    readable: tuple[tuple[int, int], ...]  # holding ranges (start, count) read on demand
    writable: frozenset[int]  # holding addresses that may be written

    def read_holding(self) -> Words:
        """The `readable` ranges, now. Raises ConnectionError if the device can't be read."""
        ...

    def write_holding(self, words: list[tuple[int, int]]) -> None:
        """Write each (address, word) in turn, one register per request. Raises WriteRefused when the device refuses
        one (those before it stay written), ConnectionError when it can't be reached."""
        ...
