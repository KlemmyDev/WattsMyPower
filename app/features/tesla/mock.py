"""
A made-up Tesla for mock mode (MOCK=1), so the EV page can be worked on without an account or a car. A Model Y,
plugged in at home, that takes commands as a real one would (charging fills it 0.25% a minute per kW). It's reached
either way:

    Tessie      connect with the access token "demo-tessie-token"
    Bluetooth   pair the VIN 7SAYGDEF1PA000001: the key card is "tapped" PAIR_SECONDS after asking. It falls asleep
                AWAKE seconds after it was last read or commanded (unless it's charging), as a real one does

Nothing here touches the network or the radio.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, ClassVar

from app.features.tesla.client import TeslaError

TOKEN = "demo-tessie-token"
VIN = "7SAYGDEF1PA000001"
PAIR_SECONDS = 4
AWAKE = 900


class DemoTesla:
    def __init__(self, home: Callable[[], tuple[float, float]], clock: Callable[[], float] = time.time):
        self.home = home
        self.clock = clock
        self.soc = 54.0
        self.limit = 80
        self.amps = 16
        self.charging = False
        self.at = clock()
        self.keys: set[str] = set()  # the keys paired over Bluetooth
        self.awake_until = clock() + AWAKE
        self.odometer_mi = 21_450.3

    def asleep(self) -> bool:
        return not self.charging and self.clock() > self.awake_until

    def touch(self) -> None:
        """Something talked to its computer: it stays awake a while longer."""
        self.awake_until = self.clock() + AWAKE

    def _advance(self) -> None:
        now = self.clock()
        if self.charging:
            self.soc = min(float(self.limit), self.soc + (now - self.at) / 60 * 0.25 * self.amps * 0.69)
            if self.soc >= self.limit:
                self.charging = False
        self.at = now

    def charge_state(self) -> dict[str, Any]:
        self._advance()
        state = "Charging" if self.charging else "Complete" if self.soc >= self.limit else "Stopped"
        return {
            "timestamp": int(self.clock() * 1000),
            "charging_state": state,
            "battery_level": round(self.soc),
            "battery_range": round(self.soc * 3.1, 1),
            "charge_limit_soc": self.limit,
            "charge_current_request": self.amps,
            "charge_current_request_max": 16,
            "charger_actual_current": self.amps if self.charging else 0,
            "charger_voltage": 236 if self.charging else 2,
            "charger_phases": 3 if self.charging else None,
            "charger_power": round(self.amps * 236 * 3 / 1000) if self.charging else 0,
            "charge_energy_added": 6.2,
            "minutes_to_full_charge": 95 if self.charging else 0,
            "fast_charger_present": False,
            "charger_pilot_current": 16,
            "conn_charge_cable": "IEC",
            "charge_port_latch": "Engaged",
            "usable_battery_level": max(0, round(self.soc) - 1),
            "scheduled_charging_mode": "Off",
            "scheduled_departure_time_minutes": 450,
            "preconditioning_enabled": False,
        }

    # What the rest of it is doing: parked in the garage, locked, sentry on, one schedule set (but switched off).
    SCHEDULE: ClassVar[dict[str, Any]] = {
        "id": 1,
        "name": "Weeknights",
        "days_of_week": 0b0111110,
        "start_enabled": True,
        "start_time": 1320,
        "end_enabled": True,
        "end_time": 360,
        "one_time": False,
        "enabled": False,
    }

    def fleet(self) -> dict[str, Any]:
        """The rest of its vehicle data, as Tessie keeps it (Tesla's Fleet API shape)."""
        ts = int(self.clock() * 1000)
        return {
            "climate_state": {
                "timestamp": ts,
                "inside_temp": 24.5,
                "outside_temp": 19.0,
                "is_climate_on": False,
                "is_preconditioning": False,
                "climate_keeper_mode": "off",
                "cabin_overheat_protection": "On",
                "battery_heater": False,
            },
            "vehicle_state": {
                "timestamp": ts,
                "locked": True,
                "df": 0,
                "pf": 0,
                "dr": 0,
                "pr": 0,
                "ft": 0,
                "rt": 0,
                "fd_window": 0,
                "fp_window": 0,
                "rd_window": 0,
                "rp_window": 0,
                "sentry_mode": True,
                "sentry_mode_available": True,
                "valet_mode": False,
                "is_user_present": False,
                "odometer": self.odometer_mi,
                "car_version": "2026.32.6 abc123",
                "software_update": {"status": "", "version": " "},
                "tpms_pressure_fl": 2.9,
                "tpms_pressure_fr": 2.9,
                "tpms_pressure_rl": 2.85,
                "tpms_pressure_rr": 2.6,
                "tpms_soft_warning_rr": True,
                "media_info": {"media_playback_status": "Stopped"},
            },
            "charge_schedule_data": {"charge_schedules": [self.SCHEDULE]},
        }

    def ble(self, groups: tuple[str, ...]) -> dict[str, Any]:
        """The details groups asked for, as the car gives them over Bluetooth (each message as MessageToDict has it)."""
        all_ = {
            "schedule": {
                "charge_schedule_state": {"charge_schedules": [self.SCHEDULE]},
                "preconditioning_schedule_state": {},
            },
            "climate": {
                "climate_state": {
                    "inside_temp_celsius": 24.5,
                    "outside_temp_celsius": 19.0,
                    "is_climate_on": False,
                    "climate_keeper_mode": {"Off": {}},
                    "cabin_overheat_protection": "CabinOverheatProtectionOn",
                }
            },
            "security": {
                "closures_state": {"locked": True, "sentry_mode_state": {"Armed": {}}, "sentry_mode_available": True}
            },
            "tyres": {
                "tire_pressure_state": {
                    "tpms_pressure_fl": 2.9,
                    "tpms_pressure_fr": 2.9,
                    "tpms_pressure_rl": 2.85,
                    "tpms_pressure_rr": 2.6,
                    "tpms_soft_warning_rr": True,
                }
            },
            "driving": {
                "drive_state": {
                    "odometer_in_hundredths_of_a_mile": round(self.odometer_mi * 100),
                    "shift_state": {"P": {}},
                }
            },
            "software": {
                "software_update_state": {"status": {"Unknown": {}}},
                "legacy_vehicle_state": {"car_version": "2026.32.6 abc123"},
            },
            "media": {"media_state": {"media_playback_status": "Stopped"}},
        }
        return {g: all_[g] for g in groups if g in all_}

    def run(self, vin: str, name: str, **params: Any) -> bool:
        if vin != VIN:
            raise TeslaError("There's no such car.", 404)
        self._advance()
        if name == "start_charging":
            self.charging = self.soc < self.limit
        elif name == "stop_charging":
            self.charging = False
        elif name == "set_charging_amps":
            self.amps = max(0, min(16, int(params["amps"])))
        elif name == "set_charge_limit":
            self.limit = int(params["percent"])
        return True


class DemoTessie:
    """The car through a made-up Tessie account (app.features.tesla.tessie's TessieClient)."""

    def __init__(self, car: DemoTesla):
        self.car = car

    def vehicles(self, want: dict[str, str] | None = None) -> list[dict[str, Any]]:
        lat, lon = self.car.home()
        return [
            {
                "vin": VIN,
                "is_active": True,
                "last_state": {
                    "display_name": "Demo Model Y",
                    "state": "online",
                    "vehicle_config": {"car_type": "modely", "trim_badging": "74d", "exterior_color": "PearlWhite"},
                    "drive_state": {"latitude": lat, "longitude": lon},
                    "charge_state": self.car.charge_state(),
                    **self.car.fleet(),
                },
            }
        ]

    def refresh_details(self, vin: str, wake: bool) -> dict[str, Any]:
        from app.features.tesla import details

        if vin != VIN:
            raise TeslaError("Tessie doesn't know that car. It may have been removed from the account.", 404)
        row = self.vehicles()[0]
        return {"vin": vin, "last_state": row["last_state"], "details": details.from_fleet(row["last_state"])}

    def command(self, vin: str, name: str, **params: Any) -> bool:
        if vin != VIN:
            raise TeslaError("Tessie doesn't know that car. It may have been removed from the account.", 404)
        return self.car.run(vin, name, **params)


class DemoRadio:
    """The car over a made-up Bluetooth radio (app.features.tesla.bluetooth's Radio)."""

    def __init__(self, car: DemoTesla, sleep: Callable[[float], None] = time.sleep):
        self.car = car
        self.sleep = sleep

    def _heard(self, vin: str) -> None:
        if vin != VIN:
            raise TeslaError(
                f"The car wasn't heard over Bluetooth. In mock mode, the car to pair is {VIN}.",
            )

    def read(
        self,
        vin: str,
        key: str,
        charge: bool,
        wake: bool,
        plugged: bool | None,
        extras: tuple[str, ...] = (),
        wake_for_extras: bool = False,
        hold: bool | None = None,
    ) -> dict[str, Any]:
        if vin != VIN:
            return {"heard": False}
        if key not in self.car.keys:
            raise TeslaError("The car doesn't know this server's key. Pair it again.", refused=True)
        asleep = self.car.asleep()
        status = {"locked": True, "open": ["Charge port"], "user_present": False, "gear": "P"}
        out: dict[str, Any] = {
            "heard": True,
            "asleep": asleep,
            "port_open": True,
            "status": status,
            "charge_state": None,
            "extras": {},
            "refused": {},
            "held": bool(hold),  # as the real radio would, while it's plugged in by day
        }
        if asleep and wake_for_extras:
            self.car.touch()
            asleep = out["asleep"] = False
            out["woke"] = True
        if (not asleep and (charge or plugged is False)) or (asleep and wake):
            self.car.touch()
            out["woke"] = asleep
            asleep = out["asleep"] = False
            out["charge_state"] = self.car.charge_state()
        if extras and not asleep:
            out["extras"] = self.car.ble(extras)
        return out

    def command(self, vin: str, key: str, name: str, params: dict[str, Any]) -> bool:
        self._heard(vin)
        self.car.touch()
        return self.car.run(vin, name, **params)

    def probe(self, vin: str, key: str) -> bool:
        self._heard(vin)
        return key in self.car.keys

    def pair(self, vin: str, key: str, seconds: float, role: str = "charging_manager") -> str | None:
        self._heard(vin)
        self.sleep(PAIR_SECONDS)  # someone gets in and taps the card
        self.car.keys.add(key)
        return "Demo Model Y"
