"""Outbound HTTP for the services the app calls (Open-Meteo, Energy Made Easy, OpenStreetMap, Amber)."""

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
