"""
Home Assistant, through its REST API on the home network: the plugs and appliances it already measures, whatever
brand they are, every 30 seconds (entities.py says which of its entities are a device, and what they're doing).

Connecting takes Home Assistant's address and a long-lived access token (made in Home Assistant: your profile →
Security), and checks both with GET /api/, which answers {"message": "API running."}. The token is kept on the server
and sent nowhere but Home Assistant, as `Authorization: Bearer …`. Each poll reads every entity at once
(GET /api/states). A device with a switch is switched with POST /api/services/switch/turn_on (or turn_off) and
{"entity_id": …}.
"""

from __future__ import annotations

import http.client
import json
import ssl
import urllib.error
import urllib.parse
from collections.abc import Callable
from typing import Any, ClassVar

from app.core.http import request_json
from app.features.home.integrations.homeassistant.entities import KINDS, devices, reading
from app.features.home.types import Field, Hints, Integration, IntegrationError, Reading

TIMEOUT = 15
EXAMPLE = "http://homeassistant.local:8123"
TOKEN_HELP = "your profile (bottom left in Home Assistant) → Security → Long-lived access tokens → Create token"

# (method, url, headers, body, timeout) -> the decoded JSON answer. Raises as urllib does.
Transport = Callable[[str, str, dict[str, str], bytes | None, float], Any]


def _transport(method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Any:
    return request_json(method, url, body, headers, timeout)


def address(url: str) -> str:
    """Home Assistant's address as entered, tidied: a scheme if it had none, without a trailing / or /api."""
    given = url.strip()
    url = given if "://" in given else f"http://{given}"
    try:
        parts = urllib.parse.urlsplit(url)
        parts.port  # noqa: B018 (raises for a port that isn't one)
    except ValueError:
        parts = None
    if parts is None or parts.scheme not in ("http", "https") or not parts.hostname:
        raise IntegrationError(
            f"{given or 'That'} isn't an address Home Assistant can be reached at: give one like {EXAMPLE}."
        )
    path = parts.path.rstrip("/").removesuffix("/api")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, "", ""))


class HomeAssistant(Integration):
    id = "homeassistant"
    name = "Home Assistant"
    via = "its API on your network"
    about = (
        "The plugs and appliances your Home Assistant already measures, whatever their brand, from their power and "
        "energy sensors every 30 seconds. Those with a switch there can be switched from here too."
    )
    icon = "bolt"
    kinds = KINDS
    fields = (
        Field(
            "url",
            "Address",
            "url",
            placeholder=EXAMPLE,
            help="The address you open Home Assistant at on your home network, with its port.",
        ),
        Field(
            "token",
            "Long-lived access token",
            "password",
            secret=True,
            help=f"Make one in {TOKEN_HELP}. Kept on this server and never shown or sent anywhere but Home Assistant.",
        ),
    )
    poll_seconds = 30
    can_switch = True
    # How requests are sent: replaced in tests.
    transport: ClassVar[Transport] = staticmethod(_transport)

    @classmethod
    def _call(cls, url: str, token: str, method: str, path: str, body: Any = None) -> Any:
        headers = {"Authorization": f"Bearer {token}"}
        data: bytes | None = None
        if body is not None:
            data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
        try:
            return cls.transport(method, url + path, headers, data, TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise IntegrationError(
                    f"Home Assistant didn't accept the access token. Make a new one in {TOKEN_HELP}, and sign in again "
                    "with it.",
                    signed_out=True,
                ) from e
            if e.code == 403:
                raise IntegrationError(
                    "Home Assistant is refusing this server: after too many wrong tokens it bans an address. Check its "
                    "notifications, and take this server's address out of ip_bans.yaml."
                ) from e
            if e.code == 404:
                raise IntegrationError(
                    f"Something answered at {url}, but not Home Assistant's API. Check the address: it's the one you "
                    f"open Home Assistant at, like {EXAMPLE}."
                ) from e
            raise IntegrationError(f"Home Assistant had a problem ({e.code}). It'll try again shortly.") from e
        except urllib.error.URLError as e:
            if isinstance(e.reason, ssl.SSLError):
                raise IntegrationError(
                    f"Home Assistant's certificate at {url} isn't one this server trusts. Give its http:// address on "
                    "your network instead."
                ) from e
            raise IntegrationError(
                f"Home Assistant didn't answer at {url}. Check the address, and that it can be reached from this server."
            ) from e
        except (TimeoutError, OSError, http.client.HTTPException) as e:
            raise IntegrationError(
                f"Home Assistant didn't answer at {url}. Check the address, and that it can be reached from this server."
            ) from e
        except ValueError as e:  # not JSON
            raise IntegrationError(
                f"Something answered at {url}, but it isn't Home Assistant. Check the address, like {EXAMPLE}."
            ) from e

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        url, token = address(form["url"]), form["token"]
        answer = cls._call(url, token, "GET", "/api/")
        if not isinstance(answer, dict) or answer.get("message") != "API running.":
            raise IntegrationError(f"Something answered at {url}, but it isn't Home Assistant. Check the address.")
        saved = {"url": url, "token": token}
        if not cls(saved).poll():
            raise IntegrationError(
                "Home Assistant has no sensors measuring a single device's power or energy (those on the whole home, "
                "the grid, the solar or the battery are left out: the inverter measures those already)."
            )
        return saved

    def label(self) -> str:
        return urllib.parse.urlsplit(str(self.saved.get("url") or "")).hostname or ""

    def _states(self) -> list[Any]:
        states = self._call(str(self.saved.get("url") or ""), str(self.saved.get("token") or ""), "GET", "/api/states")
        if not isinstance(states, list):
            raise IntegrationError("Home Assistant answered strangely. It'll try again shortly.")
        return states

    def poll(self) -> list[Reading]:
        return [reading(d) for d in devices(self._states()).values()]

    def switch(self, key: str, on: bool) -> None:
        d = devices(self._states()).get(key)
        if d is None:
            raise IntegrationError("That device isn't in Home Assistant any more.")
        if d.switch is None:
            raise IntegrationError(f"{d.name} has no switch in Home Assistant, so it can't be switched from here.")
        service = "turn_on" if on else "turn_off"
        self._call(str(self.saved.get("url") or ""), str(self.saved.get("token") or ""), "POST",
                   f"/api/services/switch/{service}", {"entity_id": d.switch["entity_id"]})  # fmt: skip
