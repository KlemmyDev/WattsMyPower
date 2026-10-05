"""
Finding Shellys on the home network. Every Shelly answers GET /shelly, without a password, with what it is:

  - Gen1 (Plug S, 1PM, 2.5, EM…): {"type": "SHPLG-S", "mac": …, "auth": true|false}, and no `gen`.
  - Gen2 and later (Plus, Pro, Gen3, Gen4): {"gen": 2, "app": "PlugS", "model": "SNPL-00112EU", "id": …, "mac": …,
    "auth_en": true|false, "name": …}.

There's no broadcast to listen for that works from inside a Docker container (mDNS doesn't leave its network either),
so every address is asked in turn, many at once and with a short wait: a /24 takes a few seconds. A Shelly is known by
its MAC, since the router may give it a new address.
"""

from __future__ import annotations

import ipaddress
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from app.features.home.integrations.shelly.client import Get, ShellyClient, ShellyError, _get

WAIT = 1.5  # seconds to wait for each address to answer
WORKERS = 64  # addresses asked at once


@dataclass(frozen=True)
class Found:
    host: str
    mac: str  # upper case, without separators: "A8032AB12345"
    gen: int  # 1, or 2 and later (all spoken to alike)
    model: str  # "PlugS", "Plus1PM" (the app's name for it), or a Gen1 type ("SHPLG-S")
    name: str | None  # the device's name, when /shelly gives it
    auth: bool  # protected by a password


def parse(info: Any, host: str) -> Found | None:
    """An answer to /shelly, or None for one that isn't a Shelly's."""
    if not isinstance(info, dict) or not info.get("mac"):
        return None
    mac = str(info["mac"]).upper().replace(":", "").replace("-", "")
    name = str(info["name"]).strip() if info.get("name") else None
    if "gen" in info:
        try:
            gen = int(info["gen"])
        except (TypeError, ValueError):
            return None
        return Found(host, mac, gen, str(info.get("app") or info.get("model") or ""), name, bool(info.get("auth_en")))
    if "type" in info:
        return Found(host, mac, 1, str(info["type"]), name, bool(info.get("auth")))
    return None


def identify(host: str, get: Get = _get, wait: float = WAIT) -> Found | None:
    """The Shelly at an address, or None when nothing (or something else) answers there."""
    try:
        return parse(ShellyClient(host, None, get, wait).request("/shelly"), host)
    except ShellyError:
        return None


def scan(hosts: list[str], get: Get = _get, wait: float = WAIT) -> list[Found]:
    """Every Shelly among `hosts`, by address."""
    if not hosts:
        return []
    with ThreadPoolExecutor(min(WORKERS, len(hosts))) as pool:
        answers = list(pool.map(lambda h: identify(h, get, wait), hosts))
    found = {f.mac: f for f in answers if f is not None}
    return sorted(found.values(), key=lambda f: ipaddress.ip_address(f.host))
