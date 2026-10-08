"""
Talking to power stations over this server's Bluetooth, with bleak (BlueZ over D-Bus on Linux, CoreBluetooth on a
Mac). Everything here is blocking: each call runs its own event loop, so it can be called from the home service's
polling thread. One conversation at a time (RADIO_LOCK): a station takes one connection, and so does the adapter.

In Docker, the dashboard reaches the host's Bluetooth through the host's D-Bus socket (docker-compose.yml mounts
/run/dbus). A station also only takes one connection at a time, so it can't be read while the Bluetti app on a phone
is connected to it.

On a Mac, macOS ends any process that uses Bluetooth without the app it was started from being allowed to, so there
each conversation runs in a process of its own: refused, only that process ends, and the dashboard says why.
"""

from __future__ import annotations

import asyncio
import logging
import multiprocessing
import sys
import threading
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Any, Protocol

from app.features.home.integrations.bluetti.protocol import HANDSHAKE, NOTIFY, WRITE_CHAR, expected_length

log = logging.getLogger(__name__)

CONNECT_SECONDS = 20
ANSWER_SECONDS = 5
RADIO_LOCK = threading.Lock()
APART = sys.platform == "darwin"  # each conversation in a process of its own (see above)


class RadioError(Exception):
    """Bluetooth couldn't be used, or a station couldn't be reached, in words. `encrypted`: the station began the
    encrypted handshake, so it can't be read in the clear."""

    def __init__(self, message: str, *, encrypted: bool = False):
        super().__init__(message)
        self.encrypted = encrypted

    def __reduce__(self) -> tuple[Any, ...]:  # so it comes back from a process of its own as it was
        return _radio_error, (str(self), self.encrypted)


def _radio_error(message: str, encrypted: bool) -> RadioError:
    return RadioError(message, encrypted=encrypted)


class Radio(Protocol):
    def scan(self, seconds: float) -> list[tuple[str, str]]:
        """Every Bluetooth device heard over `seconds`, as (address, name). Raises RadioError."""
        ...

    def exchange(self, address: str, requests: list[bytes]) -> list[bytes]:
        """Connect to `address`, send each request and wait for its whole answer, then disconnect. Raises
        RadioError."""
        ...


def _unavailable(e: Exception) -> RadioError:
    return RadioError(
        f"This server's Bluetooth can't be used ({type(e).__name__}: {e}). It needs a Bluetooth adapter, switched on; "
        "in Docker, the host's /run/dbus mounted into the dashboard (see docker-compose.yml)."
    )


def _scan_now(seconds: float) -> list[tuple[str, str]]:
    return asyncio.run(Bleak._scan(seconds))


def _exchange_now(address: str, requests: list[bytes]) -> list[bytes]:
    return asyncio.run(Bleak._exchange(address, requests))


def _run[T](fn: Callable[..., T], *args: Any) -> T:
    """`fn(*args)`, one at a time: here, or on a Mac in a process of its own."""
    with RADIO_LOCK:
        if not APART:
            return fn(*args)
        with ProcessPoolExecutor(1, mp_context=multiprocessing.get_context("spawn")) as pool:
            try:
                return pool.submit(fn, *args).result()
            except BrokenProcessPool as e:
                raise RadioError(
                    "macOS stopped the dashboard using Bluetooth. Allow Bluetooth for the app it runs from (System "
                    "Settings → Privacy & Security → Bluetooth), or run it on a Linux server."
                ) from e


class Bleak:
    """The real radio."""

    def scan(self, seconds: float) -> list[tuple[str, str]]:
        return _run(_scan_now, seconds)

    def exchange(self, address: str, requests: list[bytes]) -> list[bytes]:
        return _run(_exchange_now, address, requests)

    @staticmethod
    async def _scan(seconds: float) -> list[tuple[str, str]]:
        from bleak import BleakScanner
        from bleak.exc import BleakError

        try:
            found = await BleakScanner.discover(timeout=seconds, return_adv=True)
        except (BleakError, OSError) as e:
            raise _unavailable(e) from e
        return [(d.address, adv.local_name or d.name or "") for d, adv in found.values()]

    @staticmethod
    async def _exchange(address: str, requests: list[bytes]) -> list[bytes]:
        from bleak import BleakClient, BleakScanner
        from bleak.exc import BleakError

        try:
            device = await BleakScanner.find_device_by_address(address, timeout=10)
        except (BleakError, OSError) as e:
            raise _unavailable(e) from e
        if device is None:
            raise RadioError("It wasn't heard over Bluetooth: check it's switched on and in range of this server.")

        buffer = bytearray()
        arrived = asyncio.Event()

        def notified(_: object, data: bytearray) -> None:
            buffer.extend(data)
            arrived.set()

        answers: list[bytes] = []
        try:
            async with BleakClient(device, timeout=CONNECT_SECONDS) as client:
                await client.start_notify(NOTIFY, notified)
                for request in requests:
                    if not buffer.startswith(HANDSHAKE):  # an encrypted station starts as soon as it's connected
                        buffer.clear()
                    await client.write_gatt_char(WRITE_CHAR, request, response=True)
                    answers.append(await _answer(request, buffer, arrived))
        except TimeoutError as e:
            raise RadioError("It didn't answer over Bluetooth in time. Is the Bluetti app connected to it?") from e
        except BleakError as e:
            raise RadioError(f"The Bluetooth connection failed ({e}). Is the Bluetti app connected to it?") from e
        return answers


async def _answer(request: bytes, buffer: bytearray, arrived: asyncio.Event) -> bytes:
    """The whole answer to `request`, from however many notifications it comes in."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + ANSWER_SECONDS
    while True:
        arrived.clear()
        if buffer.startswith(HANDSHAKE):
            raise RadioError("It encrypts its Bluetooth.", encrypted=True)
        size = expected_length(request, bytes(buffer))
        if size is not None and len(buffer) >= size:
            return bytes(buffer[:size])
        left = deadline - loop.time()
        if left <= 0:
            raise TimeoutError
        await asyncio.wait_for(arrived.wait(), timeout=left)
