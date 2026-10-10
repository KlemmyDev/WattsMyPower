"""
A made-up BYD for mock mode (MOCK=1), so the EV page can be worked on without an account or a car: connecting with
any email and password brings an Atto 3, kept at home. Its day follows the clock, so the same moment always reads the
same: it's driven to work and back (07:30 to 08:30, and 17:00 to 18:00), and charges at 7 kW from 10:00 until it
reaches 80%.

Nothing here touches the network.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

VIN = "LGXC74C40R0000001"
BATTERY_KWH = 60.5
CHARGE_KW = 7.0
TARGET = 80.0
NIGHT = 62.0  # its charge overnight
ARRIVES = 41.0  # its charge once it's at work
KM_PER_PCT = 4.2  # about 420 km on a full battery
KM_A_DAY = 46.0
ODOMETER_FROM = (1_735_689_600, 18_250.0)  # 2025-01-01, and the odometer then

H = 3600.0
PCT_H = CHARGE_KW / BATTERY_KWH * 100  # % gained an hour charging


def _between(t: float, start: float, end: float, a: float, b: float) -> float:
    return a + (b - a) * (t - start) / (end - start)


class DemoByd:
    def __init__(self, clock: Callable[[], float] = time.time):
        self.clock = clock

    def state(self) -> tuple[float, bool]:
        """Its charge now (%) and whether it's charging."""
        now = self.clock()
        lt = time.localtime(now)
        h = lt.tm_hour + lt.tm_min / 60 + lt.tm_sec / 3600
        full_at = 10 + (TARGET - ARRIVES) / PCT_H
        if h < 7.5:
            return NIGHT, False
        if h < 8.5:
            return _between(h, 7.5, 8.5, NIGHT, ARRIVES), False
        if h < 10:
            return ARRIVES, False
        if h < full_at:
            return ARRIVES + (h - 10) * PCT_H, True
        if h < 17:
            return TARGET, False
        if h < 18:
            return _between(h, 17, 18, TARGET, NIGHT), False
        return NIGHT, False

    async def read(self) -> list[dict[str, Any]]:
        now = self.clock()
        soc, charging = self.state()
        since, start = ODOMETER_FROM
        return [
            {
                "vin": VIN,
                "make": "BYD",
                "model": "Atto 3",
                "year": 2024,
                "name": "Atto",
                "plate": None,
                "hybrid": False,
                "state": {
                    "as_of": int(now) - 40,
                    "soc": round(soc, 1),
                    "range_km": round(soc * KM_PER_PCT),
                    "charging": charging,
                    "minutes_to_full": round((TARGET - soc) / PCT_H * 60) if charging else None,
                    "odometer_km": round(start + (now - since) / 86400 * KM_A_DAY),
                    "online": True,
                },
            }
        ]

    async def close(self) -> None:
        pass
