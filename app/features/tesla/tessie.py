"""
The Tessie API (https://api.tessie.com, documented at developer.tessie.com): a Tesla account, read and commanded
through Tessie's servers.

The household creates an access token at dash.tessie.com/settings/api and pastes it in Manage → Integrations →
Tesla; it's sent as a Bearer token. Nothing reaches in from outside: every request goes out from this server.

Tessie keeps each car's latest state itself (from Tesla's telemetry), so reading it doesn't wake the car. A command
does: Tessie wakes it first, retries, and answers once it has run (`result`: whether it worked).

Endpoints used:
    GET  /vehicles                                   every car on the account, each with its latest state
    GET  /{vin}/state                                one car's latest state (Tessie's copy: never wakes it)
    POST /{vin}/wake                                 wake it, answering once it's awake (up to 90 s)
    POST /{vin}/command/start_charging               start charging
    POST /{vin}/command/stop_charging                stop charging
    POST /{vin}/command/set_charging_amps?amps=      the current to charge at
    POST /{vin}/command/set_charge_limit?percent=    the level to charge to
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
from collections.abc import Callable
from typing import Any

from app.core.http import request_json
from app.features.tesla import details
from app.features.tesla.client import COMMANDS, VIN, CarAsleep, TeslaError

BASE = "https://api.tessie.com"
TIMEOUT = 100  # seconds: a command waits for the car to wake (up to 90 s) before Tessie answers
TOKEN = re.compile(r"^[A-Za-z0-9._~+/=-]{8,4096}$")

Request = Callable[..., Any]


def _message(status: int) -> str:
    if status in (401, 403):
        return "Tessie didn't accept the access token. Check it in Tessie (Settings → API) and paste it again."
    if status == 404:
        return "Tessie doesn't know that car. It may have been removed from the account."
    if status == 429:
        return "Tessie is asking for fewer requests. Trying again shortly."
    if status >= 500:
        return "Tessie is having trouble. Trying again shortly."
    return f"Tessie answered with an error ({status})."


class TessieClient:
    def __init__(self, token: str, request: Request = request_json):
        self._token = token
        self._request = request

    def _call(self, method: str, path: str, params: dict[str, Any] | None = None) -> Any:
        query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
        url = f"{BASE}{path}{'?' + query if query else ''}"
        try:
            post = method == "POST"
            # An empty body on a POST, so it goes with a Content-Length: the command's parameters are in the query.
            return self._request(
                method, url, b"" if post else None, {"Authorization": f"Bearer {self._token}"}, TIMEOUT if post else 20
            )
        except urllib.error.HTTPError as e:
            raise TeslaError(_message(e.code), e.code) from e
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as e:
            raise TeslaError("Tessie could not be reached. Check the server's internet connection.") from e

    def vehicles(self, want: dict[str, str] | None = None) -> list[dict[str, Any]]:
        """Every car on the account: {vin, is_active, last_state}. Tessie knows where each is, not whether it's in
        reach of this server, so there's no `in_range`. Reading Tessie's copy never wakes a car, so `want` changes
        nothing."""
        body = self._call("GET", "/vehicles")
        rows = body.get("results") if isinstance(body, dict) else None
        cars = [r for r in rows or [] if isinstance(r, dict) and VIN.match(str(r.get("vin") or ""))]
        for r in cars:
            r["details"] = details.from_fleet(r.get("last_state") or {})
        return cars

    def refresh_details(self, vin: str, wake: bool) -> dict[str, Any]:
        """The car's latest state from Tessie. Tessie's copy is current while the car is awake and from when it fell
        asleep otherwise, so an asleep car is woken first, but only with `wake` (else CarAsleep)."""
        if not VIN.match(vin):
            raise ValueError("Not a VIN")
        if wake:
            body = self._call("POST", f"/{vin}/wake")
            if isinstance(body, dict) and body.get("result") is False:
                raise TeslaError("The car didn't wake up within 90 seconds. It may be out of mobile coverage.")
        last = self._call("GET", f"/{vin}/state")
        last = last if isinstance(last, dict) else {}
        row = {"vin": vin, "last_state": last, "details": details.from_fleet(last)}
        if str(last.get("state") or "") == "asleep" and not wake:
            raise CarAsleep(row)
        return row

    def command(self, vin: str, name: str, **params: Any) -> bool:
        """Run a command on the car (waking it first); whether it worked."""
        if name not in COMMANDS or not VIN.match(vin):
            raise ValueError(f"Unknown command: {name}")
        body = self._call("POST", f"/{vin}/command/{name}", params)
        return bool(body.get("result")) if isinstance(body, dict) else False
