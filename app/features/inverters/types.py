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

# A hybrid's battery settings, for the battery controls: mode ("self" consumption, "forced", "external", "vpp",
# "other"), mode_code (the raw mode), command ("charge", "discharge", "stop" while forced), power_w, max_soc and
# min_soc (%), max_charge_w. Values the device didn't report are None.
BatterySettings = dict[str, Any]

# Settings registers to write, in order: (address, word).
Writes = list[tuple[int, int]]


class HybridDriver(Protocol):
    """The main inverter: the one with the battery and the grid meter."""

    brand: str

    def decode(self, raw: Raw) -> Snapshot:
        """A snapshot from one poll. Figures that weren't read come out as None."""
        ...

    def decode_info(self, raw: Raw) -> Info:
        """The device's details, from the info registers the collector reads every few hours."""
        ...

    def frozen(self, previous: Raw, raw: Raw) -> bool:
        """Whether this poll is the previous one served again by a gateway that stopped refreshing
        its registers (rather than a fresh reading): such polls are left out, like missed ones."""
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


class ControlDriver(Protocol):
    """How a hybrid's battery is controlled: reading its settings registers, and what to write for each control."""

    FLOOR_RANGE: tuple[float, float]  # the floors (min SOC, %) it accepts

    def decode(self, words: Mapping[int, int]) -> BatterySettings: ...

    def normal(self) -> Writes:
        """Self-consumption: the battery runs the house and soaks up spare solar."""
        ...

    def standby(self) -> Writes:
        """The battery neither charges nor discharges."""
        ...

    def charge(self, power_w: int) -> Writes:
        """Charge at this power, from the grid if need be."""
        ...

    def floor(self, pct: float) -> Writes:
        """Discharge no lower than this (%)."""
        ...

    def holds(self, settings: BatterySettings, writes: Writes) -> bool:
        """Whether the settings read show these writes in effect."""
        ...
