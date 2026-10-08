"""
Portable power stations as room batteries, whatever their brand (Bluetti over Bluetooth, EcoFlow through its cloud…):
an integration reads its figures off each station into a Station, and they all become a Reading here, the same way,
so the Home page, the Battery page and the home's breakdown treat every brand alike.

What a station draws from the wall is its use (so charging it counts in the home's breakdown, like any appliance);
its charge, what it holds, what its own panels bring in and what it's powering are its battery. A station that can
switch its AC outlets reports whether they're on as `switched_on`, and its integration's `switch` switches them.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.features.home.types import Battery, Reading

KIND = "power_station"


@dataclass(frozen=True)
class Station:
    """A station now, as its integration read it."""

    soc: float  # % charged
    house_w: float  # drawn from the wall: what it takes from the house
    solar_w: float  # from its own panels (or a car's socket): not the house
    output_w: float  # what it's powering, from all its outlets
    ac_on: bool | None = None  # its AC outlets are on (None: it doesn't say)
    dc_on: bool | None = None
    capacity_kwh: float | None = None  # what it holds full (None: not known)


def _w(watts: float) -> str:
    return f"{watts / 1000:.2f} kW" if watts >= 1000 else f"{watts:.0f} W"


def reading(
    key: str,
    name: str,
    model: str | None,
    s: Station,
    info: Mapping[str, str] | None = None,
    raw: Mapping[str, Any] | None = None,
) -> Reading:
    """A station as a portable battery."""
    details = {"Battery": f"{s.soc:.0f}%"}
    if s.output_w > 0:
        details["Powering"] = _w(s.output_w)
    if s.solar_w > 0:
        details["Solar in"] = _w(s.solar_w)
    if s.dc_on is not None:
        details["DC outlets"] = "On" if s.dc_on else "Off"
    return Reading(
        key=key,
        name=name,
        kind=KIND,
        model=model,
        power_w=s.house_w,
        switched_on=s.ac_on,
        battery=Battery(soc=s.soc, capacity_kwh=s.capacity_kwh, solar_w=s.solar_w, output_w=s.output_w),
        details=details,
        info=dict(info or {}),
        raw=dict(raw or {}),
    )


def offline(key: str, name: str, model: str | None) -> Reading:
    """A station that couldn't be read this time."""
    return Reading(key=key, name=name, kind=KIND, model=model, online=False)
