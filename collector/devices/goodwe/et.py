"""
GoodWe's ET family of hybrid inverters (ET, EH, BT, BH and their Plus and G2 versions: e.g. GW5K-EH, GW10K-ET),
with the battery and the smart meter. Decoded by the API's driver of the same id.

Ranges from the `goodwe` library's et.py (MIT): device info 35000+33; running data 35100+125 (PV strings, grid,
backup, load, battery, the energy counters); the meter 36000+45; the battery's BMS 37000+24.
"""

from __future__ import annotations

from collector.devices.goodwe.device import GoodWeDevice
from collector.devices.goodwe.protocol import ET_UNIT
from collector.devices.modbus import Range

IDENTITY: Range = (35000, 33)
RANGES: tuple[Range, ...] = ((35100, 125), (36000, 45), (37000, 24))


class EtDevice(GoodWeDevice):
    name = "hybrid"
    driver = "goodwe.et"
    default_unit = ET_UNIT
    ranges = RANGES
    identity = IDENTITY
    info = (IDENTITY,)
