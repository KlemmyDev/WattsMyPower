"""
A made-up Hyundai for mock mode (MOCK=1), so the EV page can be worked on without an account or a car: connecting with
any email and password brings a 2023 Ioniq 5, plugged into a 10 A portable charger at home (2.4 kW) all day, except
from 17:30 to 18:30, when it's out (and comes back with less charge). It never starts charging by itself: start and
stop it (from the EV page, or by charging from spare solar) and its charge follows the clock until its limit.

Like the real cloud, a cached read gives what the car last sent: when it was plugged in or out, charged or stopped,
took a command, and every half hour while it charges. A forced read asks it now. Nothing here touches the network.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Collection
from typing import Any

from app.features.bluelink.client import LIMITS, BluelinkError

VIN = "KMHKN81AFPU000001"  # P: a 2023
BATTERY_KWH = 77.4
CHARGE_KW = 2.4
START_SOC = 58.0
DRIVE = (17.5, 18.5)  # out, in hours of the day
DRIVE_PCT = 12.0  # the charge it uses while out
KM_PER_PCT = 5.0  # about 500 km on a full battery
ODOMETER_FROM = (1_735_689_600, 21_400.0)  # 2025-01-01, and the odometer then
KM_A_DAY = 38.0
PUSH_EVERY = 1800  # while charging, the car sends its state this often
STEP = 60

PCT_S = CHARGE_KW / BATTERY_KWH * 100 / 3600  # % gained a second charging


class DemoBluelink:
    def __init__(self, home: Callable[[], tuple[float, float]], clock: Callable[[], float] = time.time):
        self.home = home
        self.clock = clock
        self.soc = START_SOC
        self.limit = 80.0
        self.limit_dc = 90.0
        self.charging = False
        self._t: float | None = None
        self._sent: dict[str, Any] | None = None  # what the car last sent to the cloud
        self._sent_at = 0.0
        self._actions: dict[str, str] = {}

    @staticmethod
    def _away(t: float) -> bool:
        lt = time.localtime(t)
        h = lt.tm_hour + lt.tm_min / 60
        return DRIVE[0] <= h < DRIVE[1]

    def _send(self, t: float) -> None:
        """The car sends its state to the cloud (as it does on each change, and when it's asked)."""
        away = self._away(t)
        lat, lon = self.home()
        since, start = ODOMETER_FROM
        self._sent = {
            "as_of": int(t),
            "soc": round(self.soc),
            "range_km": round(self.soc * KM_PER_PCT),
            "plugged": not away,
            "fast": False,
            "charging": self.charging,
            "minutes_to_full": round((self.limit - self.soc) / PCT_S / 60) if self.charging else None,
            "limit": self.limit,
            "limit_dc": self.limit_dc,
            "power_kw": None,
            "odometer_km": round(start + (t - since) / 86400 * KM_A_DAY),
            "location": [lat + 0.05, lon + 0.03] if away else [lat, lon],
        }
        self._sent_at = t

    def _advance(self) -> float:
        now = self.clock()
        if self._t is None:
            self._t = now
            self._send(now)
            return now
        t = self._t
        while t < now:
            dt = min(STEP, now - t)
            was_away = self._away(t)
            t += dt
            away = self._away(t)
            if away:
                self.charging = False
                self.soc = max(5.0, self.soc - DRIVE_PCT * dt / ((DRIVE[1] - DRIVE[0]) * 3600))
            elif self.charging:
                self.soc = min(self.limit, self.soc + PCT_S * dt)
                if self.soc >= self.limit:
                    self.charging = False
                    self._send(t)  # charged
                elif t - self._sent_at >= PUSH_EVERY:
                    self._send(t)
            if away != was_away:
                self._send(t)  # unplugged to go out, or plugged in again
        self._t = now
        return now

    def read(self, force: Collection[str] = ()) -> list[dict[str, Any]]:
        now = self._advance()
        if VIN in force:
            self._send(now)
        return [
            {
                "vin": VIN,
                "make": "Hyundai",
                "model": "Ioniq 5",
                "year": 2023,
                "name": "Ioniq",
                "hybrid": False,
                "ccs2": False,
                "state": dict(self._sent or {}),
            }
        ]

    def command(self, vin: str, action: str, **params: Any) -> str | None:
        now = self._advance()
        if vin != VIN:
            raise BluelinkError("That car isn't on the account any more.")
        ok = True
        if action == "start":
            ok = not self._away(now) and self.soc < self.limit
            self.charging = ok
        elif action == "stop":
            self.charging = False
        elif action == "limit":
            pct = float(params["percent"])
            if pct not in LIMITS:
                raise BluelinkError("The charge limit must be 50 to 100%, in tens.")
            self.limit = pct
            if self.charging and self.soc >= pct:
                self.charging = False
        else:
            raise BluelinkError("Unknown command.")
        self._send(now)
        action_id = f"demo-{len(self._actions) + 1}"
        self._actions[action_id] = "done" if ok else "failed"
        return action_id

    def outcome(self, vin: str, action_id: str) -> str:
        return self._actions.get(action_id, "unknown")

    def close(self) -> None:
        pass
