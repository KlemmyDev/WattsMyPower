"""Growatt's older string inverters (TL, MTL, MTL-S, S-series; protocol 3.x), through an RS485 adapter. See modbus.py for the registers."""

from __future__ import annotations

from app.features.inverters.growatt import modbus
from app.features.inverters.types import Info, Raw, SolarValues

brand = modbus.brand


def decode(raw: Raw) -> SolarValues | None:
    return modbus.decode(raw, modbus.OLDER)


def decode_info(raw: Raw) -> Info:
    return modbus.decode_info(raw, modbus.OLDER)
