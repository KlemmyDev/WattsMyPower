"""
Finding inverters on the home network, for connecting them in the dashboard (Manage → Integrations).

A scan checks every address in a private network (a /22 or smaller) for an open Modbus TCP port,
then asks each address that answers what it is, with every reader's probe in turn (drivers.READERS).
What a probe reads comes back as raw words, like every other reading: the API decodes them into a
model and serial number. Addresses of devices already connected aren't probed, as the WiNet-S2
copes badly with a second Modbus client while the poller is reading it.

One scan runs at a time, in the background; its progress is read with `state()`.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import time
from collections.abc import Awaitable, Callable, Collection
from contextlib import suppress
from typing import Any

from collector.devices import Words

log = logging.getLogger(__name__)

PORT = 502
CONNECT_TIMEOUT = 0.8  # a LAN device answers within milliseconds; this only bounds the empty addresses
CONCURRENCY = 64
MAX_HOSTS = 1024  # a /22: anything bigger isn't a home network

# (host, port) -> (driver, words) for the first reader whose probe recognised it, or None.
Probe = Callable[[str, int], tuple[str, Words] | None]


def parse_network(text: str) -> ipaddress.IPv4Network:
    """A private IPv4 network to scan, e.g. "192.168.0.0/24" (an address alone means its /24)."""
    raw = text.strip()
    if "/" not in raw:
        raw += "/24"
    try:
        net = ipaddress.ip_network(raw, strict=False)
    except ValueError as e:
        raise ValueError(f"{text.strip() or 'That'} isn't a network address, e.g. 192.168.1.0/24.") from e
    if not isinstance(net, ipaddress.IPv4Network) or not net.is_private:
        raise ValueError("Only your home network can be scanned: a private address range such as 192.168.1.0/24.")
    if net.num_addresses > MAX_HOSTS:
        raise ValueError(f"{net} is too big to scan. Use a /22 or smaller, such as {net.network_address}/24.")
    return net


async def _open(host: str, port: int) -> bool:
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), CONNECT_TIMEOUT)
    except (OSError, TimeoutError):
        return False
    writer.close()
    with suppress(OSError):
        await writer.wait_closed()
    return True


class Scanner:
    def __init__(self, probe: Probe, is_open: Callable[[str, int], Awaitable[bool]] = _open):
        self.probe = probe
        self.is_open = is_open
        self._state: dict[str, Any] = {"running": False, "network": None}
        self._task: asyncio.Task[None] | None = None

    def state(self) -> dict[str, Any]:
        return {**self._state, "found": list(self._state.get("found", []))}

    def start(self, network: str, connected: Collection[str]) -> dict[str, Any]:
        """Start scanning `network`. Raises ValueError for a network that can't be scanned, RuntimeError while one runs."""
        if self._state["running"]:
            raise RuntimeError("A scan is already running.")
        net = parse_network(network)
        hosts = [str(h) for h in (net.hosts() if net.num_addresses > 2 else net)]
        self._state = {
            "running": True,
            "network": str(net),
            "started_at": time.time(),
            "finished_at": None,
            "checked": 0,
            "total": len(hosts),
            "found": [],
            "error": None,
        }
        self._task = asyncio.create_task(self._run(hosts, set(connected)))
        return self.state()

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task

    async def _run(self, hosts: list[str], connected: set[str]) -> None:
        st = self._state
        try:
            gate = asyncio.Semaphore(CONCURRENCY)

            async def check(host: str) -> str | None:
                async with gate:
                    try:
                        return host if await self.is_open(host, PORT) else None
                    finally:
                        st["checked"] += 1

            answering = [h for h in await asyncio.gather(*(check(h) for h in hosts)) if h]
            # One at a time: each probe is a Modbus conversation, and inverters dislike company.
            for host in answering:
                entry: dict[str, Any] = {"host": host, "port": PORT, "driver": None, "input": {}}
                if host in connected:
                    entry["connected"] = True
                else:
                    try:
                        hit = await asyncio.to_thread(self.probe, host, PORT)
                    except Exception as e:  # one odd device mustn't end the scan
                        log.info("Probing %s failed: %s: %s", host, type(e).__name__, e)
                        hit = None
                    if hit:
                        entry["driver"] = hit[0]
                        entry["input"] = {str(a): w for a, w in sorted(hit[1].items())}
                st["found"].append(entry)
            log.info("Scanned %s: %d answering on port %d", st["network"], len(answering), PORT)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            st["error"] = f"{type(e).__name__}: {e}"
            log.warning("Scan of %s failed: %s", st["network"], st["error"])
        finally:
            st["running"] = False
            st["finished_at"] = time.time()
