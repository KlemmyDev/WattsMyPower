"""Talks to the collector (collector/PROTOCOL.md) over HTTP: its feed, and the devices it reads."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Protocol


class Feed(Protocol):
    """What the API needs from the collector (CollectorClient, or a fake in tests)."""

    def status(self) -> dict[str, Any]: ...

    def readings(self, since: int, limit: int = 1000, wait: int = 0) -> tuple[list[dict[str, Any]], bool]: ...


class Devices(Protocol):
    """The collector's devices and network scan (CollectorClient, or a fake in tests)."""

    def status(self) -> dict[str, Any]: ...

    def devices(self) -> dict[str, Any]: ...

    def put_device(self, role: str, body: dict[str, Any]) -> dict[str, Any]: ...

    def remove_device(self, role: str) -> dict[str, Any]: ...

    def scan(self) -> dict[str, Any]: ...

    def start_scan(self, network: str) -> dict[str, Any]: ...


class CollectorError(Exception):
    """The collector refused a request or couldn't be reached. `detail` is readable as it is."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


class CollectorClient:
    def __init__(self, url: str, token: str):
        self.url = url.rstrip("/")
        self.token = token

    def _get(self, path: str, params: dict[str, Any] | None = None, timeout: float = 15) -> Any:
        q = f"?{urllib.parse.urlencode(params)}" if params else ""
        req = urllib.request.Request(
            f"{self.url}{path}{q}", headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp)

    def _call(self, method: str, path: str, body: dict[str, Any] | None = None, timeout: float = 30) -> Any:
        """A request to the devices API, with its errors as CollectorError."""
        req = urllib.request.Request(
            f"{self.url}{path}",
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            try:
                detail = json.load(e).get("detail")
            except (ValueError, AttributeError):
                detail = None
            # A collector from before devices were managed here answers its framework's plain "Not Found".
            if e.code == 404 and path.startswith(("/v1/devices", "/v1/scan")) and detail in (None, "Not Found"):
                detail = "The collector is out of date and can't connect inverters yet. Update it with: bash install.sh"
            elif e.code == 401:
                detail = "The collector refused the dashboard's COLLECTOR_TOKEN. Check both use the same one."
            raise CollectorError(e.code, detail if isinstance(detail, str) else f"The collector said {e.code}.") from e
        except (urllib.error.URLError, OSError) as e:
            raise CollectorError(502, f"The collector couldn't be reached ({type(e).__name__}).") from e

    def status(self) -> dict[str, Any]:
        result: dict[str, Any] = self._get("/v1/status")
        return result

    def readings(self, since: int, limit: int = 1000, wait: int = 0) -> tuple[list[dict[str, Any]], bool]:
        """(rows after `since`, whether there are more). With `wait`, holds until the next poll lands."""
        body = self._get("/v1/readings", {"since": since, "limit": limit, "wait": wait}, timeout=wait + 15)
        return body["readings"], bool(body.get("more"))

    # -- devices --------------------------------------------------------------
    def devices(self) -> dict[str, Any]:
        result: dict[str, Any] = self._call("GET", "/v1/devices")
        return result

    def put_device(self, role: str, body: dict[str, Any]) -> dict[str, Any]:
        """Connect a device (the collector checks it answers first: an encrypted dongle takes a few seconds)."""
        result: dict[str, Any] = self._call("PUT", f"/v1/devices/{urllib.parse.quote(role)}", body, timeout=45)
        return result

    def remove_device(self, role: str) -> dict[str, Any]:
        result: dict[str, Any] = self._call("DELETE", f"/v1/devices/{urllib.parse.quote(role)}")
        return result

    def scan(self) -> dict[str, Any]:
        result: dict[str, Any] = self._call("GET", "/v1/scan")
        return result

    def start_scan(self, network: str) -> dict[str, Any]:
        result: dict[str, Any] = self._call("POST", "/v1/scan", {"network": network})
        return result
