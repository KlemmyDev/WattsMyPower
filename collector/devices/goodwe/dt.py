"""
GoodWe's DT family of string (grid-tie) inverters (D-NS, XS, DT, MS, SDT: e.g. GW5000D-NS, GW3000-XS), as a
second, AC-coupled solar system. Decoded by the API's driver of the same id.

Ranges from the `goodwe` library's dt.py (MIT): device info 30001+40 and running data 30100+73, both every poll
(like the Sungrow SG-D, a second inverter's details come with each reading).
"""

from __future__ import annotations

from collector.devices.goodwe.device import GoodWeDevice
from collector.devices.goodwe.protocol import DT_UNIT
from collector.devices.modbus import Range

IDENTITY: Range = (30001, 40)
RANGES: tuple[Range, ...] = (IDENTITY, (30100, 73))


class DtDevice(GoodWeDevice):
    name = "pv2"
    driver = "goodwe.dt"
    default_unit = DT_UNIT
    ranges = RANGES
    identity = IDENTITY
