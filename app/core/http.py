"""Outbound HTTP for the services the app calls (Open-Meteo, Energy Made Easy, OpenStreetMap, Amber,
alert channels, smart-home clouds)."""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Mapping
from typing import Any

USER_AGENT = "WattsMyPower/1.0 (self-hosted solar dashboard)"


def fetch_json(url: str, headers: dict[str, str] | None = None, timeout: float = 15) -> tuple[Any, Mapping[str, str]]:
    """GET a URL and decode its JSON body, with the response headers (for APIs that report rate limits
    in them). Raises on network errors and non-2xx responses (urllib.error.HTTPError carries the status)."""
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp), resp.headers


def get_json(url: str, headers: dict[str, str] | None = None, timeout: float = 15) -> Any:
    """GET a URL and decode its JSON body. Raises on network errors and non-2xx responses."""
    return fetch_json(url, headers, timeout)[0]


def get_text(url: str, headers: dict[str, str] | None = None, timeout: float = 15) -> str:
    """GET a URL's body as text (UTF-8). Raises as fetch_json does."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body: bytes = resp.read()
        return body.decode("utf-8")


def request_json(
    method: str, url: str, body: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 30
) -> Any:
    """Send a request (any method, any body) and decode its JSON answer. Raises as fetch_json does."""
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def post(url: str, body: bytes, content_type: str, headers: dict[str, str] | None = None, timeout: float = 10) -> int:
    """POST a body and return the response status. Raises urllib.error.HTTPError for non-2xx
    responses, and URLError or OSError (TimeoutError included) when the server can't be reached."""
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"User-Agent": USER_AGENT, "Content-Type": content_type, **(headers or {})},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status: int = resp.status
        return status
