"""Reads the collector's feed (collector/PROTOCOL.md) over HTTP."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any, Protocol


class Feed(Protocol):
    """What the API needs from the collector (CollectorClient, or a fake in tests)."""

    def status(self) -> dict[str, Any]: ...

    def readings(self, since: int, limit: int = 1000, wait: int = 0) -> tuple[list[dict[str, Any]], bool]: ...


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

    def status(self) -> dict[str, Any]:
        result: dict[str, Any] = self._get("/v1/status")
        return result

    def readings(self, since: int, limit: int = 1000, wait: int = 0) -> tuple[list[dict[str, Any]], bool]:
        """(rows after `since`, whether there are more). With `wait`, holds until the next poll lands."""
        body = self._get("/v1/readings", {"since": since, "limit": limit, "wait": wait}, timeout=wait + 15)
        return body["readings"], bool(body.get("more"))
