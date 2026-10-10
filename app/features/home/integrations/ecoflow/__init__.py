"""
EcoFlow power stations as room batteries, read every minute through EcoFlow's Developer API (client.py; what each
model reports is in models.py). EcoFlow's stations only speak to its cloud (on Bluetooth they need a reverse-engineered
encrypted protocol, which isn't here yet), so this is one of the few integrations that needs the internet.

Connecting takes the access key and secret key made in EcoFlow's developer portal, finds the region they work in, and
keeps each power station on the account (by serial number) with its product name. A station that's offline when it's
polled is shown as offline; one added to the account since is picked up by Look for new batteries.

Each station is a portable battery, as every brand's is (app.features.home.stations). Switching it switches its AC
outlets, on the models whose command is known (models.MODELS).
"""

from __future__ import annotations

import logging
from typing import Any, ClassVar

from app.features.home.integrations.ecoflow.client import EcoFlowClient, Transport, _transport, find_host
from app.features.home.integrations.ecoflow.models import Model, ac_command, model, station
from app.features.home.stations import offline, reading
from app.features.home.types import Field, Hints, Integration, IntegrationError, Reading, mask

log = logging.getLogger(__name__)

STATIONS = ("RIVER", "DELTA")  # what EcoFlow's power stations' product names start with


class EcoFlow(Integration):
    id = "ecoflow"
    name = "EcoFlow"
    via = "EcoFlow's Developer API"
    cloud = True
    about = (
        "EcoFlow power stations as room batteries (RIVER 2 and 3, DELTA 2 and 3, DELTA Pro and Max): their charge, "
        "what they're charging from and powering, through EcoFlow's cloud."
    )
    icon = "battery"
    kinds = ("power_station",)
    fields = (
        Field(
            "access_key",
            "Access key",
            help="Made for your EcoFlow account in EcoFlow's developer portal (developer.ecoflow.com: sign in, apply "
            "to become a developer, then Profile → Developer → Create access key).",
        ),
        Field(
            "secret_key",
            "Secret key",
            "password",
            secret=True,
            help="Shown beside the access key. Kept on this server and never shown or sent anywhere but EcoFlow.",
        ),
    )
    poll_seconds = 60
    find_label = "Look for new batteries"
    can_switch = True
    # How requests are sent: replaced in tests.
    transport: ClassVar[Transport] = staticmethod(_transport)

    def _client(self) -> EcoFlowClient:
        return EcoFlowClient(
            self.saved["access_key"], self.saved["secret_key"], self.saved["host"], type(self).transport
        )

    @classmethod
    def _stations(cls, client: EcoFlowClient, devices: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """The power stations among an account's devices, by serial number: those named as one, and any other that
        reports a charge (asked only while it's online)."""
        found: dict[str, dict[str, Any]] = {}
        for d in devices:
            product = str(d.get("productName") or "")
            entry = {"name": str(d.get("deviceName") or product or d["sn"]), "product": product}
            named = product.upper().startswith(STATIONS)
            if named or (d.get("online") and model(product, client.quota(d["sn"])) is not None):
                found[d["sn"]] = entry
        return found

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        access_key, secret_key = form["access_key"].strip(), form["secret_key"].strip()
        host, devices = find_host(access_key, secret_key, cls.transport)
        client = EcoFlowClient(access_key, secret_key, host, cls.transport)
        stations = cls._stations(client, devices)
        if not stations:
            raise IntegrationError(
                f"EcoFlow accepted the keys, but the account has no power stations "
                f"({len(devices)} other device{'s' if len(devices) != 1 else ''}). Add it in the EcoFlow app first."
            )
        return {"access_key": access_key, "secret_key": secret_key, "host": host, "stations": stations}

    def label(self) -> str:
        n = len(self.saved.get("stations", {}))
        return f"{n} station{'s' if n != 1 else ''} · key {mask(str(self.saved.get('access_key') or ''))}"

    def _read(self, client: EcoFlowClient, sn: str, entry: dict[str, Any]) -> Reading:
        quota = client.quota(sn)
        m = model(entry["product"], quota)
        s = station(m, quota) if m else None
        if m is None or s is None:
            return offline(sn, entry["name"], entry["product"] or None)
        return reading(
            sn,
            entry["name"],
            entry["product"] or None,
            s,
            info={"Serial number": sn, "Generation": str(m.generation), "Region": self.saved["host"]},
            raw=quota,
        )

    def poll(self) -> list[Reading]:
        client = self._client()
        stations: dict[str, dict[str, Any]] = self.saved.get("stations", {})
        readings: list[Reading] = []
        problems: list[IntegrationError] = []
        for sn, entry in stations.items():
            try:
                readings.append(self._read(client, sn, entry))
            except IntegrationError as e:
                if e.signed_out:
                    raise
                log.info("EcoFlow %s: %s", sn, e)
                problems.append(e)
                readings.append(offline(sn, entry["name"], entry["product"] or None))
        if stations and len(problems) == len(stations):
            raise problems[0]
        return readings

    def find(self) -> tuple[int, int]:
        client = self._client()
        found = self._stations(client, client.devices())
        stations = dict(self.saved.get("stations", {}))
        new = [sn for sn in found if sn not in stations]
        stations.update({sn: found[sn] for sn in new})
        self.saved = {**self.saved, "stations": stations}
        return len(new), len(found)

    def switch(self, key: str, on: bool) -> None:
        entry = self.saved.get("stations", {}).get(key)
        if entry is None:
            raise IntegrationError("That station isn't on the EcoFlow account any more.")
        client = self._client()
        m: Model | None = model(entry["product"], client.quota(key))
        command = ac_command(m, key, on) if m else None
        if command is None:
            raise IntegrationError(f"{entry['name']}'s outlets can't be switched from here yet.")
        client.command(command)
