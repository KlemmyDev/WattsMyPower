"""
What every inverter driver works with, whatever the brand.

The collector stores each device's reading uninterpreted (collector/PROTOCOL.md). A driver turns
that raw payload into figures in the shapes below, so everything past the driver (merging, the
database, the dashboard) is brand-agnostic. Drivers live in a package per brand, one module per
model family (e.g. sungrow/sh_rs.py), and are registered by id in drivers.py.

Sign conventions for the power values in a snapshot - positive always means
"power flowing into the house":
    pv_power       W  solar production (>= 0)
    load_power     W  house consumption (>= 0)
    grid_power     W  + importing from grid, - exporting to grid
    battery_power  W  + discharging into house, - charging
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

# One device's raw reading as the collector stored it. Its shape belongs to the driver: Modbus
# drivers get {"input": {address: word}, "holding": {address: word}}.
Raw = Mapping[str, Any]

# One reading, keyed by sample column (see app.core.schema), in the sign conventions above.
Snapshot = dict[str, Any]

# A second inverter's figures for one poll, keyed pv2_power and pv2_dc_power (W), daily_pv2 and
# total_pv2 (kWh) and pv2_temp (°C). Missing figures are None.
SolarValues = dict[str, float | None]

# Details about a device that rarely change. Hybrids: brand, model, serial, nominal_kw, phases,
# battery_kwh, reserve (%). Second inverters: brand, model, nominal_kw, running_hours. Keys the
# device can't report are left out.
Info = dict[str, Any]


class HybridDriver(Protocol):
    """The main inverter: the one with the battery and the grid meter."""

    brand: str

    def decode(self, raw: Raw) -> Snapshot:
        """A snapshot from one poll. Figures that weren't read come out as None."""
        ...

    def decode_info(self, raw: Raw) -> Info:
        """The device's details, from the info registers the collector reads every few hours."""
        ...


class SolarDriver(Protocol):
    """A second, AC-coupled solar inverter (no battery, no meter)."""

    brand: str

    def decode(self, raw: Raw) -> SolarValues | None:
        """This poll's figures, or None if the reading is garbled as a whole (treated as a missed read)."""
        ...

    def decode_info(self, raw: Raw) -> Info:
        """The device's details, from the same poll's reading."""
        ...
