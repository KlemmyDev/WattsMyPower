"""
Bluetti power stations as room batteries, read straight from each over this server's Bluetooth every minute, with no
cloud in between (radio.py; what they say is in protocol.py).

Connecting listens for Bluetti stations nearby (or the one at the address given) and keeps each that can be read, by
its Bluetooth name (its model and serial number, so it's the same station even if its address changes). Each poll
connects to each in turn, reads its charge and its power in and out, and lets it go, so the Bluetti app can still
connect between polls.

Each station is a portable battery, as every brand's is (app.features.home.stations). Switching it switches its AC
outlets, on the stations that can (protocol.MODELS).
"""

from __future__ import annotations

import logging
from typing import Any, ClassVar

from app.features.home.integrations.bluetti.protocol import (
    LAYOUTS,
    MODELS,
    OTHER,
    ProtocolError,
    identify,
    parse,
    requests,
    status,
    write_request,
)
from app.features.home.integrations.bluetti.radio import Bleak, Radio, RadioError
from app.features.home.stations import Station, offline, reading
from app.features.home.types import Field, Hints, Integration, IntegrationError, Reading

log = logging.getLogger(__name__)

SCAN_SECONDS = 10
NEARBY = "Check it's switched on, within about 10 m of this server, and not connected to the Bluetti app on a phone"
ENCRYPTED = (
    "{name} encrypts its Bluetooth, so it can't be read yet. On an AC180 or AC70, turning off its Bluetooth password "
    "in the Bluetti app (the station → ⚙ → Bluetooth password → No password) may let it be read."
)


class Bluetti(Integration):
    id = "bluetti"
    name = "Bluetti"
    via = "Bluetooth"
    about = (
        "Bluetti power stations as room batteries (AC180, AC70, EB3A, AC200M, Elite 100 V2 and more): their charge, "
        "what they're charging from and powering, read over this server's Bluetooth without Bluetti's cloud."
    )
    icon = "battery"
    category = "batteries"
    kinds = ("power_station",)
    fields = (
        Field(
            "address",
            "Bluetooth address",
            placeholder="Any nearby",
            optional=True,
            help="Leave empty to connect every Bluetti this server can hear. To connect just one, give its Bluetooth "
            "address (on Linux, like 24:4C:AB:01:02:03).",
        ),
    )
    poll_seconds = 60
    find_label = "Look for new batteries"
    can_switch = True
    # How stations are spoken to: replaced in tests.
    radio: ClassVar[Radio] = Bleak()

    @classmethod
    def _listen(cls, address: str = "") -> tuple[dict[str, dict[str, Any]], list[str]]:
        """The stations that can be read, by Bluetooth name, and the names of Bluettis heard that can't be."""
        try:
            heard = cls.radio.scan(SCAN_SECONDS)
        except RadioError as e:
            raise IntegrationError(str(e)) from e
        found: dict[str, dict[str, Any]] = {}
        unsupported: list[str] = []
        for where, name in heard:
            if address and where.lower() != address.lower():
                continue
            known = identify(name)
            if known:
                model, serial = known
                found[name] = {"address": where, "model": model, "serial": serial}
            elif name and OTHER.match(name):
                unsupported.append(name)
        return found, unsupported

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        address = (form.get("address") or "").strip()
        found, unsupported = cls._listen(address)
        if not found and unsupported:
            raise IntegrationError(
                f"Heard {', '.join(unsupported)}, but that model can't be read yet: only Bluetti's portable stations "
                "(AC, EB and Elite) are, so far."
            )
        if not found:
            where = f"at {address}" if address else "nearby"
            raise IntegrationError(f"No Bluetti was heard {where}. {NEARBY}.")
        # Each is read now, so one that can't be (encrypted, or held by the app) says so here rather than every poll.
        readable: dict[str, dict[str, Any]] = {}
        problems: list[str] = []
        for name, station in found.items():
            try:
                cls._read(name, station)
            except IntegrationError as e:
                problems.append(str(e))
            else:
                readable[name] = station
        if not readable:
            raise IntegrationError(problems[0])
        return {"stations": readable}

    def label(self) -> str:
        n = len(self.saved.get("stations", {}))
        return f"{n} station{'s' if n != 1 else ''} over Bluetooth"

    @classmethod
    def _read(cls, name: str, station: dict[str, Any]) -> Reading:
        """A station now. Raises IntegrationError, in words."""
        model = MODELS[station["model"]]
        asks = requests(model)
        try:
            answers = cls.radio.exchange(station["address"], asks)
            s = status(model, asks, answers)
        except RadioError as e:
            if e.encrypted:
                raise IntegrationError(ENCRYPTED.format(name=f"The {station['model']}")) from e
            raise IntegrationError(f"The {station['model']} couldn't be read: {e}") from e
        except ProtocolError as e:
            if str(e) == "encrypted":
                raise IntegrationError(ENCRYPTED.format(name=f"The {station['model']}")) from e
            raise IntegrationError(f"The {station['model']} answered, but not as expected: {e}.") from e
        return reading(
            name,
            f"Bluetti {station['model']}",
            station["model"],
            Station(
                soc=s.soc,
                house_w=s.ac_in_w,
                solar_w=s.dc_in_w,
                output_w=s.ac_out_w + s.dc_out_w,
                ac_on=s.ac_on,
                dc_on=s.dc_on,
                capacity_kwh=model.capacity_kwh,
            ),
            info={
                "Serial number": station["serial"],
                "Bluetooth address": station["address"],
                "Register layout": f"V{model.layout}",
            },
            raw={str(k): v for k, v in sorted(s.registers.items())},
        )

    def poll(self) -> list[Reading]:
        stations: dict[str, dict[str, Any]] = self.saved.get("stations", {})
        readings: list[Reading] = []
        problems: list[str] = []
        for name, station in stations.items():
            try:
                readings.append(self._read(name, station))
            except IntegrationError as e:
                log.info("Bluetti %s: %s", name, e)
                problems.append(str(e))
                readings.append(offline(name, f"Bluetti {station['model']}", station["model"]))
        if stations and len(problems) == len(stations):
            raise IntegrationError(problems[0])
        return readings

    def find(self) -> tuple[int, int]:
        found, _ = self._listen()
        stations = dict(self.saved.get("stations", {}))
        new = [name for name in found if name not in stations]
        for name, station in found.items():
            stations[name] = station  # a known one keeps its name, with where it is now
        self.saved = {**self.saved, "stations": stations}
        return len(new), len(found)

    def switch(self, key: str, on: bool) -> None:
        station = self.saved.get("stations", {}).get(key)
        if station is None:
            raise IntegrationError("That station isn't connected any more.")
        model = MODELS[station["model"]]
        if not model.outlets:
            raise IntegrationError(f"The {station['model']}'s outlets can't be switched over Bluetooth yet.")
        request = write_request(LAYOUTS[model.layout].ac_switch, int(on))
        try:
            (answer,) = self.radio.exchange(station["address"], [request])
            parse(request, answer)
        except RadioError as e:
            if e.encrypted:
                raise IntegrationError(ENCRYPTED.format(name=f"The {station['model']}")) from e
            raise IntegrationError(f"The {station['model']} couldn't be switched: {e}") from e
        except ProtocolError as e:
            raise IntegrationError(f"The {station['model']} didn't take the switch: {e}.") from e
