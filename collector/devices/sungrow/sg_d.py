"""
Sungrow SG-D string inverters (e.g. SG5K-D), as a second, AC-coupled solar system alongside the
hybrid, read through their encrypted Wi-Fi dongle. Decoded by the API's driver of the same id.

Ranges are from Sungrow's protocol for residential grid-connected inverters (protocol address =
Modbus address + 1), checked against a real SG5K-D.
"""

from __future__ import annotations

from collector.devices.modbus import Range
from collector.devices.sungrow.dongle import DongleDevice

# Input registers read every poll: 5000 type, 5001 nominal, 5003 daily, 5004-05 total, 5006-07 hours,
# 5008 temp; 5011-14 MPPT V/A, 5017-18 DC power; 5031-32 AC power. No separate info: 5000-5008
# already carry the type, nominal power and running hours.
RANGES: tuple[Range, ...] = ((5000, 9), (5011, 8), (5031, 2))


class SgDDevice(DongleDevice):
    name = "pv2"
    driver = "sungrow.sg_d"
    ranges = RANGES
