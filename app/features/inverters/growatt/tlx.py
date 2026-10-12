"""Growatt's newer string inverters (MIN/MIC TL-X, MAX, MOD; protocol 1.2x), through an RS485 adapter. See modbus.py for the registers."""

from __future__ import annotations

from app.features.inverters.growatt import modbus
from app.features.inverters.types import Info, Raw, SolarValues

brand = modbus.brand


def decode(raw: Raw) -> SolarValues | None:
    return modbus.decode(raw, modbus.NEWER)


def decode_info(raw: Raw) -> Info:
    return modbus.decode_info(raw, modbus.NEWER)
