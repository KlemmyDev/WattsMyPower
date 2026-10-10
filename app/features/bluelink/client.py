"""
Hyundai and Kia cars, through each maker's own cloud (Hyundai's Bluelink, Kia Connect: the ones their apps use), with
hyundai_kia_connect_api (github.com/Hyundai-Kia-Connect/hyundai_kia_connect_api, MIT): the library behind Home
Assistant's Kia/Hyundai integration (kia_uvo). Neither maker has a public API, nor a way to reach a car on the home
network or over Bluetooth, so this is a cloud integration: the account's email and password sign in as the app does,
every request goes out from this server to the maker's servers in Australia (au-apigw.ccs.hyundai.com.au,
au-apigw.ccs.kia.com.au), and nothing reaches in.

Signing in in Australia is the email and password alone: no one-time code and no captcha, so it works from a server.
Newer cars (those on Hyundai and Kia's "CCS2" protocol: an Ioniq 5 from 2024, an EV9, an EV5…) also need the app's
4-digit PIN for commands such as starting and stopping a charge; older ones don't. Genesis isn't reached in Australia:
it has its own app and servers there, which the library doesn't know.

What it reads, each from what the maker's servers last heard from the car (a cached read, which doesn't touch the car):
its charge, range, whether it's plugged in and charging, how long until it's full, its charge limits, its odometer,
where it's parked, and on CCS2 cars the power it's charging at. A forced read asks the car itself (waking its modem,
and drawing on its 12 V battery), so it's kept rare (app.features.bluelink.service). It can start and stop a charge
and set the charge limits (AC and DC, in tens of percent); it can't set the charging current (CCS2 cars take only a
"reduced" level, not amps), so solar charging only starts and stops the car.

Every call here is blocking (the library uses requests): the service runs them in a thread.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Collection
from typing import Any, Protocol

import requests
from hyundai_kia_connect_api import Vehicle, VehicleManager
from hyundai_kia_connect_api import exceptions as hx
from hyundai_kia_connect_api.const import ENGINE_TYPES, ORDER_STATUS

from app.features.tesla.control import model_year

log = logging.getLogger(__name__)

VIN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")

# Each make: its name, the library's number for it, and what its app and cloud are called.
BRANDS: dict[str, tuple[str, int, str]] = {
    "hyundai": ("Hyundai", 2, "Bluelink"),
    "kia": ("Kia", 1, "Kia Connect"),
}
# Where an account is: its name, the library's number for it, and the makes the library reaches there.
REGIONS: dict[str, tuple[str, int, tuple[str, ...]]] = {
    "AU": ("Australia", 5, ("hyundai", "kia")),
    "NZ": ("New Zealand", 7, ("kia",)),
}
LIMITS = (50, 60, 70, 80, 90, 100)  # the charge limits the cars take (AC and DC alike)
OUTCOMES = {
    ORDER_STATUS.SUCCESS: "done",
    ORDER_STATUS.FAILED: "failed",
    ORDER_STATUS.TIMEOUT: "timeout",
    ORDER_STATUS.PENDING: "pending",
}


class BluelinkError(Exception):
    """A request the maker's cloud (or the car) refused, or that didn't get through, in words. `refused`: the email and
    password were turned down. `limited`: the cloud said too many requests, so it's left alone a while. `pin`: the PIN
    was turned down (or is needed and missing): reading still works, commands don't."""

    def __init__(self, message: str, *, refused: bool = False, limited: bool = False, pin: bool = False):
        super().__init__(message)
        self.refused = refused
        self.limited = limited
        self.pin = pin


class Account(Protocol):
    """A way to reach a Hyundai or Kia account's cars: the maker's cloud (BluelinkAccount), or a made-up one in mock
    mode (mock.DemoBluelink). Blocking; each raises BluelinkError."""

    def read(self, force: Collection[str] = ()) -> list[dict[str, Any]]:
        """Each electric car on the account, as parse() gives it: what the cloud last heard from it, or, for the VINs
        in `force`, what the car says now (asked for: it wakes the car's modem)."""
        ...

    def command(self, vin: str, action: str, **params: Any) -> str | None:
        """ "start" or "stop" charging, or "limit" (percent: the AC charge limit, dc: the DC one). The command's id,
        to ask how it went (outcome); None when there's nothing to ask."""
        ...

    def outcome(self, vin: str, action_id: str) -> str:
        """How a command went: "done", "failed", "timeout" (the car didn't answer), "pending" or "unknown"."""
        ...

    def close(self) -> None: ...


def model_name(raw: str | None) -> str | None:
    """A model as the maker writes it ("IONIQ 5", "KONA ELECTRIC", "EV9 GT-LINE") as it's said: "Ioniq 5", "Kona
    Electric", "EV9 GT-Line"."""

    def word(w: str) -> str:
        if any(c.isdigit() for c in w) or len(w) <= 2:
            return w.upper() if w.isalpha() or any(c.isdigit() for c in w) else w
        return w.capitalize()

    out = " ".join("-".join(word(p) for p in w.split("-")) for w in (raw or "").strip().split())
    return out or None


def _num(value: Any) -> float | None:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return x if x >= 0 else None


def _coord(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _km(value: Any, unit: str | None) -> int | None:
    x = _num(value)
    if x is None:
        return None
    return round(x * 1.609344) if unit == "mi" else round(x)


def parse(v: Vehicle, brand: str) -> dict[str, Any]:
    """One car, as the EV page shows it: who made it and which it is, and its state as the cloud last had it (None
    until it's said anything).

    `plugged` is None when the car didn't say. A plug state of 1 is a DC fast charger (the library's own reading of
    it), so `fast` says it's charging away from home. `power_kw` is only said by CCS2 cars."""
    state = None
    soc = _num(v.ev_battery_percentage)
    if soc is not None or v.ev_battery_is_plugged_in is not None:
        plug = v.ev_battery_is_plugged_in
        charging = bool(v.ev_battery_is_charging)
        minutes = _num(v.ev_estimated_current_charge_duration)
        lat, lon = _coord(v.location_latitude), _coord(v.location_longitude)
        power = _num(v.ev_charging_power)
        state = {
            "as_of": int(v.last_updated_at.timestamp()) if v.last_updated_at else None,
            "soc": soc,
            "range_km": _km(v.ev_driving_range, v.ev_driving_range_unit),
            "plugged": None if plug is None else bool(plug) or charging,
            "fast": plug == 1 and not v.ccu_ccs2_protocol_support,
            "charging": charging,
            "minutes_to_full": round(minutes) if charging and minutes else None,
            "limit": _num(v.ev_charge_limits_ac),
            "limit_dc": _num(v.ev_charge_limits_dc),
            "power_kw": power if charging and power else None,
            "odometer_km": _km(v.odometer, v.odometer_unit),
            "location": [lat, lon] if lat is not None and lon is not None and (lat, lon) != (0.0, 0.0) else None,
        }
    return {
        "vin": v.VIN,
        "make": BRANDS[brand][0],
        "model": model_name(v.model),
        "year": model_year(v.VIN),
        "name": (v.name or "").strip() or None,
        # A plug-in hybrid (a Niro PHEV, a Sorento PHEV): its range is the battery's alone.
        "hybrid": v.engine_type == ENGINE_TYPES.PHEV,
        # A CCS2 car: commands need the app's PIN.
        "ccs2": bool(v.ccu_ccs2_protocol_support),
        "state": state,
    }


def _words(e: Exception, cloud: str) -> BluelinkError:
    """What went wrong, as the household can act on it."""
    if isinstance(e, BluelinkError):
        return e
    if isinstance(e, hx.AuthenticationError):
        return BluelinkError(
            f"{cloud} didn't accept the email and password. Check them in the {cloud} app, and that the make and "
            "country are the ones the account is with.",
            refused=True,
        )
    if isinstance(e, hx.PINMissingError) or (isinstance(e, hx.APIError) and "PIN" in str(e)):
        return BluelinkError(
            f"The car needs the 4-digit PIN you use in the {cloud} app to take commands, and it wasn't accepted. "
            "Enter it again on the Hyundai and Kia page.",
            pin=True,
        )
    if isinstance(e, hx.RateLimitingError):
        return BluelinkError(
            f"{cloud} says there have been too many requests for this account today. The dashboard leaves it alone "
            "for an hour.",
            limited=True,
        )
    if isinstance(e, hx.DuplicateRequestError):
        return BluelinkError("The car is still working on the last command. Try again in a minute.")
    if isinstance(e, hx.RequestTimeoutError):
        return BluelinkError("The car didn't answer in time: it may be out of mobile coverage. Trying again later.")
    if isinstance(e, hx.ServiceTemporaryUnavailable):
        return BluelinkError(f"{cloud} is unavailable for a moment. Trying again shortly.")
    if isinstance(e, hx.UnsupportedControlError):
        return BluelinkError(f"{cloud} says this car can't take that command.")
    if isinstance(e, requests.RequestException):
        return BluelinkError(f"{cloud}'s servers couldn't be reached. Check the server's internet connection.")
    if isinstance(e, hx.APIError):
        return BluelinkError(f"{cloud} answered with an error ({str(e)[:120] or type(e).__name__}).")
    return BluelinkError(f"{cloud}'s answer couldn't be read. It may have changed how its app talks to its servers.")


class BluelinkAccount:
    """A Hyundai or Kia account in the maker's cloud. It stays signed in between reads (the sign-in is renewed as it
    runs out), so it doesn't sign in afresh each time. `manager`: makes the library's VehicleManager (a fake in tests)."""

    def __init__(
        self,
        username: str,
        password: str,
        pin: str,
        region: str,
        brand: str,
        manager: Callable[..., Any] = VehicleManager,
    ):
        if region not in REGIONS or brand not in REGIONS[region][2]:
            raise BluelinkError("Choose the make and the country the account is with.")
        self.cloud = BRANDS[brand][2]
        self.brand = brand
        self._make = lambda: manager(
            region=REGIONS[region][1],
            brand=BRANDS[brand][1],
            username=username,
            password=password,
            pin=pin,
            language="en",
        )
        self._vm: Any = None

    def _manager(self) -> Any:
        if self._vm is None:
            self._vm = self._make()
        self._vm.check_and_refresh_token()  # signs in the first time, and again once the sign-in runs out
        return self._vm

    def _id(self, vm: Any, vin: str) -> str:
        for vid, v in vm.vehicles.items():
            if vin == v.VIN:
                return str(vid)
        raise BluelinkError("That car isn't on the account any more.")

    def _failed(self, e: Exception) -> BluelinkError:
        out = _words(e, self.cloud)
        if out.refused:
            self._vm = None  # signed in afresh next time
        elif not isinstance(e, BluelinkError | hx.HyundaiKiaException | requests.RequestException):
            log.warning("%s answered unexpectedly", self.cloud, exc_info=e)
        return out

    def read(self, force: Collection[str] = ()) -> list[dict[str, Any]]:
        try:
            vm = self._manager()
            cars = []
            for vid, v in vm.vehicles.items():
                if not VIN.match(v.VIN or "") or v.engine_type not in (ENGINE_TYPES.EV, ENGINE_TYPES.PHEV):
                    continue
                if v.VIN in force:
                    try:
                        vm.force_refresh_vehicle_state(vid)
                    except (hx.RequestTimeoutError, hx.ServiceTemporaryUnavailable, hx.NoDataFound) as e:
                        log.info("%s %s didn't answer a forced read: %s", self.cloud, v.VIN[-6:], e)
                        vm.update_vehicle_with_cached_state(vid)
                else:
                    vm.update_vehicle_with_cached_state(vid)
                cars.append(parse(v, self.brand))
            return cars
        except Exception as e:
            raise self._failed(e) from e

    def command(self, vin: str, action: str, **params: Any) -> str | None:
        try:
            vm = self._manager()
            vid = self._id(vm, vin)
            if action == "start":
                return str(vm.start_charge(vid))
            if action == "stop":
                return str(vm.stop_charge(vid))
            if action == "limit":
                v = vm.get_vehicle(vid)
                dc = params.get("dc") or v.ev_charge_limits_dc or 100
                return str(vm.set_charge_limits(vid, int(params["percent"]), int(dc)))
            raise BluelinkError("Unknown command.")
        except Exception as e:
            raise self._failed(e) from e

    def outcome(self, vin: str, action_id: str) -> str:
        try:
            vm = self._manager()
            status = vm.check_action_status(self._id(vm, vin), action_id, synchronous=False)
        except Exception as e:
            raise self._failed(e) from e
        return OUTCOMES.get(status, "unknown")

    def close(self) -> None:
        self._vm = None


def email_hint(email: str) -> str:
    """Enough of an email to recognise it: "ma…@example.com"."""
    name, at, domain = email.partition("@")
    return f"{name[:2]}…@{domain}" if at else f"{email[:2]}…"
