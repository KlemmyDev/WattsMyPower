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
    """A connected inverter, as stored in the collector's database (Settings → Integrations).

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


class Device(Protocol):
    """An inverter the poller reads."""

    name: str  # its role: "hybrid" (the inverter with the battery and meter) or "pv2" (a second solar inverter)
    driver: str  # what the readings are, for the API to decode them with, e.g. "sungrow.sh_rs"
    host: str

    def read(self, include_info: bool) -> RawReading:
        """One connect -> read -> disconnect cycle. Raises ConnectionError if the device can't be read."""
        ...
