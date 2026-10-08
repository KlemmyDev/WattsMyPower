"""
TP-Link Tapo smart plugs that measure energy (P110, P115…), read straight from each plug on the home network every 15
seconds, with no cloud in between: by KLAP (klap.py) on firmware before late 2026, by TPAP (tpap.py) on the newest.

Connecting finds them (discovery.py, plus any addresses given) and keeps those that answer to the account's TP-Link ID
and measure energy, with where each was and how it's spoken to. The email and password are kept on the server (never
sent anywhere but the plugs): TPAP needs the password itself each time it makes a session, and a plug's firmware can
move it from KLAP to TPAP at any time. A plug that stops answering is looked for again (at most every REFIND), in case
the router gave it a new address or an update changed how it's spoken to; plugs added since are picked up then too.
While every plug answers, new ones are only looked for when asked (Look for new plugs, `find`).

Each poll reads a plug's details (name, whether it's switched on) and its energy: get_energy_usage gives its power
now (current_power, in mW) and what it's used today (today_energy, Wh, from the plug's midnight), read as a counter
that starts over each day. Firmware without current_power there has get_current_power, in W. A plug is switched on or
off with set_device_info {"device_on": …}, over the same connection. What else the two say about the plug (its Wi-Fi
signal, how long it's been on and on today, its own count for the month, its firmware, and an overload or overheating)
is shown on its page.
"""

from __future__ import annotations

import base64
import binascii
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, ClassVar, Protocol

from app.features.home.integrations.tapo.discovery import Found, WhereError, addresses, discover
from app.features.home.integrations.tapo.klap import KlapClient, Post, TapoError, _post, auth_hash
from app.features.home.integrations.tapo.tpap import TpapClient
from app.features.home.types import Field, Hints, Integration, IntegrationError, Reading

log = logging.getLogger(__name__)

REFIND = 10 * 60  # the soonest to look for plugs again after one stops answering
THIRD_PARTY = "and that Third-Party Compatibility is on in the Tapo app (Tapo Lab → Third-Party Compatibility)"

Finder = Callable[[list[str]], list[Found]]
PROTOCOLS = ("klap", "tpap")


class Client(Protocol):
    def request(self, method: str, params: dict[str, Any] | None = None, *, again: bool = True) -> dict[str, Any]: ...


@dataclass(frozen=True)
class Account:
    """The TP-Link ID the plugs answer to. `password` is None for a sign-in kept before TPAP (a hash alone)."""

    email: str
    password: str | None
    hash: bytes


def _name(info: dict[str, Any]) -> str | None:
    """A plug's name, which it sends base64-encoded."""
    try:
        return base64.b64decode(str(info.get("nickname") or "")).decode().strip() or None
    except (binascii.Error, UnicodeDecodeError):
        return None


def _power_w(client: Client, energy: dict[str, Any]) -> float | None:
    if (mw := energy.get("current_power")) is not None:
        return float(mw) / 1000
    try:
        w = client.request("get_current_power").get("current_power")
    except TapoError:
        return None
    return float(w) if w is not None else None


SIGNAL = {3: "Strong", 2: "Good", 1: "Weak", 0: "Very weak"}


def _hours(minutes: float) -> str:
    """60 → "1 h", 312 → "5 h 12 min", 9 → "9 min"."""
    h, m = divmod(round(minutes), 60)
    return " ".join(p for p in (f"{h} h" if h else "", f"{m} min" if m or not h else "") if p)


def _info(info: dict[str, Any], energy: dict[str, Any]) -> dict[str, str]:
    """What the plug says about itself, in words, for its page."""
    out: dict[str, str] = {}
    rssi, level = info.get("rssi"), info.get("signal_level")
    if isinstance(level, int) and level in SIGNAL:
        out["Wi-Fi signal"] = SIGNAL[level] + (f" ({rssi} dBm)" if isinstance(rssi, int) else "")
    elif isinstance(rssi, int):
        out["Wi-Fi signal"] = f"{rssi} dBm"
    if info.get("device_on") and isinstance(on := info.get("on_time"), int | float) and on > 0:
        out["On for"] = _hours(on / 60)
    if isinstance(today := energy.get("today_runtime"), int | float):
        out["On today"] = _hours(today)
    month, runtime = energy.get("month_energy"), energy.get("month_runtime")
    if isinstance(month, int | float):
        out["This month, by the plug"] = f"{month / 1000:.2f} kWh" + (
            f" over {_hours(runtime)}" if isinstance(runtime, int | float) and runtime else ""
        )
    if fw := str(info.get("fw_ver") or "").split(" ")[0]:
        out["Firmware"] = fw
    return out


def _warnings(info: dict[str, Any]) -> dict[str, str]:
    """Anything wrong the plug reports, for its card."""
    out: dict[str, str] = {}
    if info.get("overheated") is True:
        out["Overheated"] = "Yes"
    for key, label in (("power_protection_status", "Overload"), ("overcurrent_status", "Over current")):
        if (v := info.get(key)) and str(v).lower() not in ("normal", "none", "0"):
            out[label] = str(v).replace("_", " ").capitalize()
    return out


class Tapo(Integration):
    id = "tapo"
    name = "TP-Link Tapo"
    via = "your home network"
    about = (
        "Tapo smart plugs that measure energy (P110, P115 and others), read straight from each plug on your network "
        "every 15 seconds, without TP-Link's cloud."
    )
    icon = "plug"
    kinds = ("plug",)
    fields = (
        Field(
            "email",
            "TP-Link ID",
            "email",
            placeholder="you@example.com",
            help="The email you sign in to the Tapo app with, exactly as you type it there: the plugs only answer to "
            "their owner.",
        ),
        Field(
            "password",
            "Password",
            "password",
            secret=True,
            help="Kept on this server and never shown or sent anywhere but your plugs: those on the newest firmware "
            "need it each time they're read.",
        ),
        Field(
            "where",
            "Where to look",
            placeholder="Your home network",
            optional=True,
            help="Leave empty to look on the network your inverter is on. Plugs on a separate IoT or guest Wi-Fi are on "
            "a network of their own: give it here (192.168.20.0/24), or the plugs' addresses, separated by commas (in the "
            "Tapo app: the plug → ⚙ → Device info). Several can be given.",
        ),
    )
    poll_seconds = 15
    find_label = "Look for new plugs"
    can_switch = True
    # How plugs are spoken to and found: replaced in tests.
    post: ClassVar[Post] = staticmethod(_post)
    finder: ClassVar[Finder] = staticmethod(discover)

    @classmethod
    def _client(cls, host: str, port: int, protocol: str, account: Account) -> Client:
        if protocol == "tpap":
            if account.password is None:
                raise TapoError(f"{host} has newer firmware that needs the password: sign in again.", refused=True)
            return TpapClient(host, account.email, account.password, post=cls.post, port=port)
        return KlapClient(host, [account.hash], post=cls.post, port=port)

    @classmethod
    def _find(cls, account: Account, where: str) -> tuple[dict[str, dict[str, Any]], str | None]:
        """The plugs that answer to the account and measure energy, by device id, and if there are none, why not."""
        try:
            hosts, named = addresses(where)
        except WhereError as e:
            raise IntegrationError(str(e)) from e
        if not hosts:
            raise IntegrationError("Say where to look: your home network, or the plugs' addresses.")
        found = cls.finder(hosts)
        # Each address, and how it may be spoken to (in order).
        candidates: dict[str, tuple[int, tuple[str, ...]]] = {
            f.host: (f.port, (f.encrypt_type.lower(),)) for f in found if f.encrypt_type.lower() in PROTOCOLS
        }
        old = [f for f in found if f.encrypt_type and f.encrypt_type.lower() not in PROTOCOLS]
        for host in named:  # given by hand: try it, even if it didn't answer the probe (unless it's older firmware)
            if host not in {f.host for f in old}:
                candidates.setdefault(host, (80, PROTOCOLS))
        plugs: dict[str, dict[str, Any]] = {}
        refused = no_energy = 0
        failed: list[str] = []  # answered, but couldn't be read: what went wrong, in words
        blocked = False
        for host, (port, protocols) in candidates.items():
            for protocol in protocols:
                client = cls._client(host, port, protocol, account) if protocol == "klap" or account.password else None
                if client is None:
                    continue
                try:
                    info = client.request("get_device_info")
                except TapoError as e:
                    log.info("Tapo device at %s:%s (%s): %s", host, port, protocol, e)
                    refused += e.refused
                    blocked |= e.wait
                    if not e.refused and not e.wait and len(protocols) == 1:
                        failed.append(str(e))
                    continue
                try:
                    client.request("get_energy_usage")
                except TapoError as e:
                    log.info("Tapo device at %s doesn't report energy: %s", host, e)
                    no_energy += 1
                    break
                device_id = str(info.get("device_id") or host)
                plugs[device_id] = {"host": host, "port": port, "protocol": protocol, "model": info.get("model"),
                                    "name": _name(info)}  # fmt: skip
                break
        why = None
        if not plugs:
            if blocked:
                why = "blocked"
            elif refused:
                why = "refused"
            elif failed:
                why = "failed: " + failed[0]
            elif no_energy:
                why = "no_energy"
            elif old:
                why = "old"
            else:
                why = "none"
        return plugs, why

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        account = Account(form["email"], form["password"], auth_hash(form["email"], form["password"]))
        where = form.get("where") or hints.network or ""
        plugs, why = cls._find(account, where)
        if why == "blocked":
            raise IntegrationError(
                "The Tapo plugs have stopped accepting sign-ins for a while after too many tries. Wait half an hour, "
                "then try again.",
                retry_after=1800,
            )
        if why == "refused":
            raise IntegrationError(
                f"Tapo plugs answered on {where}, but not to that TP-Link ID and password. Check them (the email is "
                f"case-sensitive), {THIRD_PARTY}.",
                signed_out=True,
            )
        if why and why.startswith("failed: "):
            raise IntegrationError(
                f"Tapo plugs answered on {where}, but couldn't be read ({why.removeprefix('failed: ').rstrip('.')}). "
                "Check that Third-Party Compatibility is on in the Tapo app (Tapo Lab → Third-Party Compatibility), "
                "then try again."
            )
        if why == "no_energy":
            raise IntegrationError(
                f"The Tapo devices on {where} don't measure energy (a P100 doesn't; a P110 or P115 does)."
            )
        if why == "old":
            raise IntegrationError(
                f"The Tapo plugs on {where} have older firmware that can't be read on the network. Update them in the "
                "Tapo app, then try again."
            )
        if why == "none":
            raise IntegrationError(
                f"No Tapo plugs answered on {where}. Check they're plugged in, {THIRD_PARTY}. If they're on a separate IoT "
                "or guest Wi-Fi, give that network (or their addresses) in Where to look, and let your router reach it "
                "from this server."
            )
        return {
            "email": form["email"],
            "password": form["password"],
            "hash": base64.b64encode(account.hash).decode(),
            "where": where,
            "plugs": plugs,
            "found_at": int(time.time()),
        }

    def find(self) -> tuple[int, int]:
        account = self._account()
        found, why = self._find(account, str(self.saved.get("where") or ""))
        if not found and why == "blocked":
            raise IntegrationError(
                "The Tapo plugs have stopped accepting sign-ins for a while after too many tries. Try again later."
            )
        if not found and why == "refused":
            raise IntegrationError(
                f"The Tapo plugs no longer accept the saved TP-Link ID (a changed password?). Sign in again, {THIRD_PARTY}.",
                signed_out=True,
            )
        plugs: dict[str, dict[str, Any]] = {k: dict(v) for k, v in (self.saved.get("plugs") or {}).items()}
        new = sum(device_id not in plugs for device_id in found)
        for device_id, plug in found.items():  # new ones added; known ones with where they are now
            plugs[device_id] = {**plugs.get(device_id, {}), **plug}
        self.saved = {**self.saved, "plugs": plugs, "found_at": int(time.time())}
        return new, len(found)

    def switch(self, key: str, on: bool) -> None:
        plug = (self.saved.get("plugs") or {}).get(key)
        if not isinstance(plug, dict):
            raise IntegrationError("That plug isn't on this account any more. Look for new plugs.")
        client = self._client(plug["host"], int(plug.get("port") or 80), str(plug.get("protocol") or "klap"),
                              self._account())  # fmt: skip
        try:
            client.request("set_device_info", {"device_on": on})
        except TapoError as e:
            raise IntegrationError(
                f"{plug.get('name') or 'The plug'} couldn't be switched {'on' if on else 'off'} ({str(e).rstrip('.')}).",
                signed_out=e.refused,
            ) from e

    def label(self) -> str:
        n = len(self.saved.get("plugs") or {})
        return f"{self.saved.get('email', '')} · {n} {'plug' if n == 1 else 'plugs'}"

    def _account(self) -> Account:
        try:
            hash = base64.b64decode(str(self.saved.get("hash") or ""), validate=True)
        except binascii.Error as e:
            raise IntegrationError("The saved sign-in can't be read. Sign in again.", signed_out=True) from e
        password = self.saved.get("password")
        email = str(self.saved.get("email") or "")
        return Account(email, password if isinstance(password, str) else None, hash or auth_hash(email, password or ""))

    def _read(self, device_id: str, plug: dict[str, Any], account: Account) -> Reading:
        protocol = str(plug.get("protocol") or "klap")
        client = self._client(plug["host"], int(plug.get("port") or 80), protocol, account)
        info = client.request("get_device_info")
        energy = client.request("get_energy_usage")
        plug["name"] = _name(info) or plug.get("name")
        plug["model"] = info.get("model") or plug.get("model")
        today = energy.get("today_energy")
        on = info.get("device_on")
        return Reading(
            key=device_id,
            name=plug["name"] or plug["model"] or "Tapo plug",
            kind="plug",
            model=plug["model"],
            power_w=_power_w(client, energy) if on is not False else 0.0,
            energy_kwh=float(today) / 1000 if today is not None else None,
            counter="cycle",  # today's energy: starts over at the plug's midnight
            switched_on=on if isinstance(on, bool) else None,
            details=_warnings(info),
            info=_info(info, energy),
            raw={"device_info": {k: info.get(k) for k in ("model", "fw_ver", "hw_ver", "device_on", "type", "ip",
                                                          "rssi", "signal_level", "on_time", "overheated",
                                                          "power_protection_status", "overcurrent_status")},
                 "energy": energy},
        )  # fmt: skip

    def poll(self) -> list[Reading]:
        account = self._account()
        plugs: dict[str, dict[str, Any]] = {k: dict(v) for k, v in (self.saved.get("plugs") or {}).items()}
        readings: dict[str, Reading] = {}
        refused = blocked = False
        for device_id, plug in plugs.items():
            try:
                readings[device_id] = self._read(device_id, plug, account)
            except TapoError as e:
                refused |= e.refused
                blocked |= e.wait
        now = int(time.time())
        missing = [d for d in plugs if d not in readings]
        if missing and not blocked and now - int(self.saved.get("found_at") or 0) >= REFIND:
            # A plug that's stopped answering may have a new address, or firmware that's spoken to differently; any
            # added since are picked up too.
            found, _ = self._find(account, str(self.saved.get("where") or ""))
            for device_id, plug in found.items():
                if device_id in readings:
                    continue
                plugs[device_id] = {**plugs.get(device_id, {}), **plug}
                try:
                    readings[device_id] = self._read(device_id, plugs[device_id], account)
                except TapoError as e:
                    refused |= e.refused
            self.saved = {**self.saved, "found_at": now}
        if blocked and not readings:
            raise IntegrationError(
                "The Tapo plugs have stopped accepting sign-ins for a while after too many tries. Trying again later.",
                retry_after=1800,
            )
        if refused and not readings:
            raise IntegrationError(
                f"The Tapo plugs no longer accept the saved TP-Link ID (a changed password?). Sign in again, {THIRD_PARTY}.",
                signed_out=True,
            )
        self.saved = {**self.saved, "plugs": plugs}
        for device_id, plug in plugs.items():  # one that can't be reached is there, but offline
            if device_id not in readings:
                readings[device_id] = Reading(
                    device_id,
                    plug.get("name") or plug.get("model") or "Tapo plug",
                    "plug",
                    plug.get("model"),
                    online=False,
                )
        return list(readings.values())
