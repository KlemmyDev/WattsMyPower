"""
BYD cars, through BYD's own cloud (the one the BYD app uses), with pyBYD (github.com/jkaberg/pyBYD, MIT): the library
behind the Home Assistant BYD integration, which has worked out how the app talks to BYD. BYD has no public API, and
no way to read a car on the home network or over Bluetooth, so this is a cloud integration: the account's email and
password sign in as the app does, every request goes out from this server to BYD's servers for the region
(Australia's and New Zealand's are dilinkappoversea-au.byd.auto), and nothing reaches in.

It only reads: each car on the account, and each one's latest state (its charge, its range, whether it's charging and
how long until it's full, its odometer). BYD's cloud can start a charge but not stop one (pyBYD found the stop
command answers "done" and changes nothing), nor set the current, so charging from spare solar isn't offered.

BYD lets an account be signed in in one place at a time, so signing in here signs the BYD app out on a phone using
the same account. A second account, with the car shared to it from the app, avoids that.

Reading a car's state asks the car for it (BYD's servers pass the request to the car's own modem, and answer once it
has replied, or with the last state they have), so cars are read every few minutes, not continuously.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Protocol

from pybyd import BydClient, BydConfig
from pybyd import exceptions as bx
from pybyd.models.realtime import VehicleRealtimeData
from pybyd.models.vehicle import EnergyType, Vehicle

from app.features.tesla.control import model_year

log = logging.getLogger(__name__)

VIN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")

# Where an account is, as the BYD app asks when signing in: its country code, in words, and the BYD servers for it.
REGIONS: dict[str, tuple[str, str]] = {
    "AU": ("Australia", "https://dilinkappoversea-au.byd.auto"),
    "NZ": ("New Zealand", "https://dilinkappoversea-au.byd.auto"),
}

# How long to wait for a car to answer before taking the last state BYD's servers have: tries, seconds apart.
POLL_TRIES = 6
POLL_GAP = 2.0


class BydError(Exception):
    """A request BYD refused, or that didn't get through, in words. `refused`: the email and password were turned
    down, so trying again won't help until they're entered again."""

    def __init__(self, message: str, *, refused: bool = False):
        super().__init__(message)
        self.refused = refused


class Account(Protocol):
    """A way to read a BYD account's cars: BYD's cloud (BydAccount), or a made-up one in mock mode (mock.DemoByd)."""

    async def read(self) -> list[dict[str, Any]]:
        """Each car on the account, as parse() gives it. Raises BydError."""
        ...

    async def close(self) -> None: ...


def model_name(raw: str) -> str | None:
    """A model as BYD writes it ("ATTO 3", "SEALION 7") as it's said: "Atto 3", "Sealion 7"."""
    words = raw.strip().split()
    return " ".join(w if any(c.isdigit() for c in w) or len(w) <= 2 else w.capitalize() for w in words) or None


def _number(value: float | None) -> float | None:
    return None if value is None or value < 0 else value


def parse(vehicle: Vehicle, rt: VehicleRealtimeData | None) -> dict[str, Any]:
    """One car, as the EV page shows it: who made it and which it is, and its state (None until it's answered).

    `charging` is only true while BYD says it's charging. Whether it's plugged in otherwise isn't told reliably (pyBYD
    found the "connected" value stays put when the cable's pulled out), so it isn't claimed."""
    state = None
    if rt is not None:
        soc = _number(rt.elec_percent if rt.elec_percent is not None else rt.power_battery)
        range_km = _number(rt.endurance_mileage if rt.endurance_mileage is not None else rt.ev_endurance)
        if soc is not None or range_km is not None:
            charging = rt.is_charging
            state = {
                "as_of": int(rt.timestamp.timestamp()) if rt.timestamp else None,
                "soc": soc,
                "range_km": round(range_km) if range_km is not None else None,
                "charging": charging,
                "minutes_to_full": rt.time_to_full_minutes if charging else None,
                "odometer_km": round(rt.total_mileage) if rt.total_mileage else None,
                "online": rt.is_online,
            }
    return {
        "vin": vehicle.vin,
        "make": "BYD",
        "model": model_name(vehicle.model_name or vehicle.out_model_type),
        "year": model_year(vehicle.vin),
        "name": vehicle.auto_alias.strip() or None,
        "plate": vehicle.auto_plate.strip() or None,
        # A plug-in hybrid (the Shark 6, Sealion 6 DM-i): its range is the battery's alone.
        "hybrid": vehicle.energy_type == EnergyType.HYBRID,
        "state": state,
    }


def _words(e: bx.BydError) -> BydError:
    """What went wrong, as the household can act on it."""
    if isinstance(e, bx.BydAuthenticationError) and not isinstance(e, bx.BydSessionExpiredError):
        return BydError(
            "BYD didn't accept the email and password. Check them in the BYD app, and that the region is the one "
            "the account was made in.",
            refused=True,
        )
    if isinstance(e, bx.BydRateLimitError | bx.BydServiceBusyError):
        return BydError("BYD is busy and asked for fewer requests. Trying again shortly.")
    if isinstance(e, bx.BydTransportError):
        return BydError("BYD's servers couldn't be reached. Check the server's internet connection.")
    if isinstance(e, bx.BydCryptoError):
        return BydError("BYD's answer couldn't be read. BYD may have changed how its app talks to its servers.")
    return BydError(f"BYD answered with an error ({getattr(e, 'code', None) or type(e).__name__}).")


class BydAccount:
    """A BYD account in BYD's cloud. It stays signed in between reads (BYD's sign-in lasts about 12 hours, and is
    renewed as it runs out), so it doesn't sign in afresh each time. `session`: how requests are sent (an aiohttp
    session; a fake one in tests), else its own."""

    def __init__(self, username: str, password: str, region: str, time_zone: str, session: Any = None):
        if region not in REGIONS:
            raise BydError("Choose the region the account was made in.")
        self.config = BydConfig(
            username=username,
            password=password,
            base_url=REGIONS[region][1],
            country_code=region,
            language="en",
            time_zone=time_zone,
            # BYD can also push changes as they happen (MQTT), but reading every few minutes is enough here and
            # keeps it to plain requests.
            mqtt_enabled=False,
        )
        self._session = session
        self._client: BydClient | None = None

    async def _started(self) -> BydClient:
        if self._client is None:
            client = BydClient(self.config, session=self._session)
            await client.async_start()
            self._client = client
        return self._client

    async def read(self) -> list[dict[str, Any]]:
        try:
            client = await self._started()
            vehicles = [v for v in await client.get_vehicles() if VIN.match(v.vin)]
            cars = []
            for v in vehicles:
                if v.energy_type == EnergyType.ICE:
                    continue
                rt: VehicleRealtimeData | None = None
                try:
                    rt = await client.get_vehicle_realtime(v.vin, poll_attempts=POLL_TRIES, poll_interval=POLL_GAP)
                except (bx.BydDataUnavailableError, bx.BydEndpointNotSupportedError) as e:
                    log.info("BYD %s didn't answer: %s", v.vin, e)  # out of coverage, or deeply asleep: shown unread
                cars.append(parse(v, rt))
            return cars
        except bx.BydError as e:
            if isinstance(e, bx.BydAuthenticationError):
                await self.close()  # signed in afresh next time
            raise _words(e) from e

    async def close(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.async_close()


def email_hint(email: str) -> str:
    """Enough of an email to recognise it: "ma…@example.com"."""
    name, at, domain = email.partition("@")
    return f"{name[:2]}…@{domain}" if at else f"{email[:2]}…"
