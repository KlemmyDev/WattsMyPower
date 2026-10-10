"""
Shelly plugs, relays and meters that measure power, read straight from each on the home network every 20 seconds,
with no cloud in between: Gen1 devices by their HTTP API, Gen2 and later (Plus, Pro, Gen3, Gen4) by RPC over HTTP
(client.py). What each channel measures is in channels.py.

Connecting finds them (discovery.py: every address on the home network, or where it's told to look, is asked) and
keeps those that measure, by MAC, with where each was and its channels. A password is only needed when one is set on
the Shellys (the same on all of them); it's kept on the server and sent nowhere but the Shellys. A Shelly that stops
answering is looked for again (at most every REFIND), in case the router gave it a new address; Shellys added since
are picked up then too. While every Shelly answers, new ones are only looked for when asked (Look for new Shellys,
`find`).

Each channel is a device: its power now, and its energy counter since the device was made (so a counter that only
goes up). A relay's channel is switched with Switch.Set (Gen2) or /relay/N?turn= (Gen1).
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, ClassVar

from app.features.home.integrations.shelly.channels import Channel, gen1, gen2, names
from app.features.home.integrations.shelly.client import Get, ShellyClient, ShellyError, _get
from app.features.home.integrations.shelly.discovery import scan
from app.features.home.integrations.tapo.discovery import WhereError, addresses
from app.features.home.types import Field, Hints, Integration, IntegrationError, Reading

log = logging.getLogger(__name__)

REFIND = 10 * 60  # the soonest to look for Shellys again after one stops answering
WORKERS = 8  # Shellys read at once, so one that doesn't answer doesn't hold up the rest
ON_WIFI = "Check they're powered and on your Wi-Fi"


def _measure(client: ShellyClient, gen: int) -> tuple[str | None, list[Channel]]:
    """A Shelly's name and the channels that measure. Raises ShellyError."""
    if gen >= 2:
        status, config = client.request("/rpc/Shelly.GetStatus"), client.request("/rpc/Shelly.GetConfig")
        return gen2(status if isinstance(status, dict) else {}, config if isinstance(config, dict) else {})
    status, settings = client.request("/status"), client.request("/settings")
    return gen1(status if isinstance(status, dict) else {}, settings if isinstance(settings, dict) else {})


class Shelly(Integration):
    id = "shelly"
    name = "Shelly"
    via = "your home network"
    about = (
        "Shelly plugs, relays and meters that measure power (Plus Plug, 1PM, 2PM, Pro EM, and the older Plug S and "
        "2.5), read straight from each on your network every 20 seconds, without Shelly's cloud."
    )
    icon = "plug"
    category = "plugs"
    kinds = ("plug",)
    fields = (
        Field(
            "where",
            "Where to look",
            placeholder="Your home network",
            optional=True,
            help="Leave empty to look on the network your inverter is on. Shellys on a separate IoT or guest Wi-Fi are "
            "on a network of their own: give it here (192.168.20.0/24), or the Shellys' addresses, separated by commas "
            "(in the Shelly app: the device → ⚙ → Device information). Several can be given.",
        ),
        Field(
            "password",
            "Password",
            "password",
            secret=True,
            optional=True,
            help="Only if your Shellys are protected by one (in the Shelly app: the device → ⚙ → Authentication). Kept "
            "on this server and never shown or sent anywhere but your Shellys.",
        ),
    )
    poll_seconds = 20
    find_label = "Look for new Shellys"
    can_switch = True
    # How Shellys are spoken to: replaced in tests.
    get: ClassVar[Get] = staticmethod(_get)

    @classmethod
    def _client(cls, host: str, password: str | None) -> ShellyClient:
        return ShellyClient(host, password or None, cls.get)

    @classmethod
    def _find(cls, password: str | None, where: str) -> tuple[dict[str, dict[str, Any]], str | None]:
        """The Shellys that measure, by MAC, and if there are none, why not."""
        try:
            hosts, _ = addresses(where)
        except WhereError as e:
            raise IntegrationError(str(e)) from e
        if not hosts:
            raise IntegrationError("Say where to look: your home network, or the Shellys' addresses.")
        devices: dict[str, dict[str, Any]] = {}
        refused = no_power = 0
        failed: list[str] = []  # answered, but couldn't be read: what went wrong, in words
        for f in scan(hosts, cls.get):
            try:
                name, channels = _measure(cls._client(f.host, password), f.gen)
            except ShellyError as e:
                log.info("Shelly at %s: %s", f.host, e)
                refused += e.refused
                if not e.refused:
                    failed.append(str(e))
                continue
            if not channels:
                no_power += 1
                continue
            label = name or f.name or f.model or "Shelly"
            devices[f.mac] = {"host": f.host, "gen": f.gen, "model": f.model or None, "name": label,
                              "channels": _channels(label, channels)}  # fmt: skip
        why = None
        if not devices:
            if refused:
                why = "refused"
            elif failed:
                why = "failed: " + failed[0]
            elif no_power:
                why = "no_power"
            else:
                why = "none"
        return devices, why

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        password = form.get("password") or None
        where = form.get("where") or hints.network or ""
        devices, why = cls._find(password, where)
        if why == "refused" and not password:
            raise IntegrationError(
                f"The Shellys on {where} are protected by a password. Enter it (in the Shelly app: the device → ⚙ → "
                "Authentication).",
                signed_out=True,
            )
        if why == "refused":
            raise IntegrationError(
                f"Shellys answered on {where}, but not to that password. Check it (it's the one set in the Shelly app, "
                "for the user admin).",
                signed_out=True,
            )
        if why and why.startswith("failed: "):
            raise IntegrationError(
                f"Shellys answered on {where}, but couldn't be read ({why.removeprefix('failed: ').rstrip('.')}). "
                "Try again in a minute."
            )
        if why == "no_power":
            raise IntegrationError(
                f"The Shellys on {where} don't measure power (a Plus 1 doesn't; a Plus 1PM or Plus Plug does)."
            )
        if why == "none":
            raise IntegrationError(
                f"No Shellys answered on {where}. {ON_WIFI}. If they're on a separate IoT or guest Wi-Fi, give that "
                "network (or their addresses) in Where to look, and let your router reach it from this server."
            )
        return {
            **({"password": password} if password else {}),
            "where": where,
            "devices": devices,
            "found_at": int(time.time()),
        }

    def _password(self) -> str | None:
        password = self.saved.get("password")
        return password if isinstance(password, str) and password else None

    def find(self) -> tuple[int, int]:
        found, why = self._find(self._password(), str(self.saved.get("where") or ""))
        if not found and why == "refused":
            raise IntegrationError(
                "The Shellys no longer accept the saved password (a changed one?). Sign in again.", signed_out=True
            )
        devices: dict[str, dict[str, Any]] = {k: dict(v) for k, v in (self.saved.get("devices") or {}).items()}
        new = sum(mac not in devices for mac in found)
        for mac, device in found.items():  # new ones added; known ones with where they are now
            devices[mac] = {**devices.get(mac, {}), **device}
        self.saved = {**self.saved, "devices": devices, "found_at": int(time.time())}
        return new, len(found)

    def switch(self, key: str, on: bool) -> None:
        mac, _, channel = key.partition(":")
        device = (self.saved.get("devices") or {}).get(mac)
        about = device.get("channels", {}).get(channel) if isinstance(device, dict) else None
        if not isinstance(device, dict) or not isinstance(about, dict):
            raise IntegrationError("That Shelly isn't on this account any more. Look for new Shellys.")
        word = "on" if on else "off"
        if not about.get("switch"):
            raise IntegrationError(
                f"{about.get('name') or 'That Shelly'} only measures: it has no switch to turn {word}."
            )
        if int(device.get("gen") or 1) >= 2:
            path = f"/rpc/Switch.Set?id={channel}&on={'true' if on else 'false'}"
        else:
            path = f"/relay/{channel}?turn={word}"
        try:
            self._client(device["host"], self._password()).request(path)
        except ShellyError as e:
            raise IntegrationError(
                f"{about.get('name') or 'The Shelly'} couldn't be switched {word} ({str(e).rstrip('.')}).",
                signed_out=e.refused,
            ) from e

    def label(self) -> str:
        n = len(self.saved.get("devices") or {})
        return f"{n} {'Shelly' if n == 1 else 'Shellys'} on {self.saved.get('where', '')}"

    def _read(self, mac: str, device: dict[str, Any], password: str | None) -> tuple[dict[str, Any], list[Reading]]:
        """A Shelly's channels as readings, and what's kept about it with its name and channels brought up to date."""
        name, channels = _measure(self._client(device["host"], password), int(device.get("gen") or 1))
        label = name or device.get("name") or device.get("model") or "Shelly"
        device = {**device, "name": label, "channels": _channels(label, channels)}
        readings = [
            Reading(
                key=f"{mac}:{c.id}",
                name=device["channels"][c.id]["name"],
                kind="plug",
                model=device.get("model"),
                power_w=c.power_w,
                energy_kwh=c.energy_kwh,
                counter="total",  # since the device was made
                switched_on=c.switched_on,
                raw={"host": device["host"], "gen": device.get("gen"), **c.raw},
            )
            for c in channels
        ]
        return device, readings

    def _read_all(
        self, devices: dict[str, dict[str, Any]], password: str | None
    ) -> dict[str, tuple[dict[str, Any], list[Reading]] | ShellyError]:
        def one(mac: str) -> tuple[dict[str, Any], list[Reading]] | ShellyError:
            try:
                return self._read(mac, devices[mac], password)
            except ShellyError as e:
                log.info("Shelly %s at %s: %s", mac, devices[mac].get("host"), e)
                return e

        if not devices:
            return {}
        with ThreadPoolExecutor(min(WORKERS, len(devices))) as pool:
            return dict(zip(devices, pool.map(one, devices), strict=True))

    def poll(self) -> list[Reading]:
        password = self._password()
        devices: dict[str, dict[str, Any]] = {k: dict(v) for k, v in (self.saved.get("devices") or {}).items()}
        readings: dict[str, list[Reading]] = {}
        refused = False
        for mac, got in self._read_all(devices, password).items():
            if isinstance(got, ShellyError):
                refused |= got.refused
            else:
                devices[mac], readings[mac] = got
        now = int(time.time())
        missing = [mac for mac in devices if mac not in readings]
        if missing and not (refused and not readings) and now - int(self.saved.get("found_at") or 0) >= REFIND:
            # A Shelly that's stopped answering may have a new address; any added since are picked up too.
            found, _ = self._find(password, str(self.saved.get("where") or ""))
            again = {mac: {**devices.get(mac, {}), **d} for mac, d in found.items() if mac not in readings}
            devices.update(again)
            for mac, got in self._read_all(again, password).items():
                if not isinstance(got, ShellyError):
                    devices[mac], readings[mac] = got
            self.saved = {**self.saved, "found_at": now}
        if refused and not readings:
            raise IntegrationError(
                "The Shellys no longer accept the saved password (a changed one?). Sign in again.", signed_out=True
            )
        self.saved = {**self.saved, "devices": devices}
        out = [r for rs in readings.values() for r in rs]
        for mac, device in devices.items():  # one that can't be reached is there, but offline
            if mac not in readings:
                out += [
                    Reading(
                        f"{mac}:{channel}", about.get("name") or "Shelly", "plug", device.get("model"), online=False
                    )
                    for channel, about in (device.get("channels") or {}).items()
                ]
        return out


def _channels(device: str, channels: list[Channel]) -> dict[str, dict[str, Any]]:
    """What's kept about each channel: what it's called, and whether it can be switched."""
    return {c.id: {"name": n, "switch": c.switch} for c, n in zip(channels, names(device, channels), strict=True)}
