"""
This server's Bluetooth, shared by everything that talks over it (power stations, app.features.home.integrations.bluetti;
Teslas, app.features.tesla.bluetooth). One conversation at a time: the adapter takes one connection, and so do most
devices.

In Docker, the dashboard reaches the host's Bluetooth through the host's D-Bus socket (docker-compose.bluetooth.yml
mounts it at /run/dbus, which install.sh turns on).

In an unprivileged container (a Proxmox LXC), Bluetooth can't be used at all: the kernel only allows it outside
containers. There BlueZ runs on the Proxmox host instead, and the host's D-Bus is mounted in. The dashboard's root is
then someone else to the host (uid 100000, say), and D-Bus turns away a client that says it's uid 0 when the kernel
says otherwise, so in a user namespace the dashboard lets the kernel say who it is (fit_dbus_to_user_namespace).

On a Mac, macOS ends any process that uses Bluetooth without the app it was started from being allowed to, so there
each conversation runs in a process of its own: refused, only that process ends, and the dashboard says why. What's
run there must be a module-level function, and what it takes and gives back must pickle.
"""

from __future__ import annotations

import importlib
import multiprocessing
import sys
import threading
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from functools import partial
from pathlib import Path
from typing import Any

RADIO_LOCK = threading.Lock()
APART = sys.platform == "darwin"  # each conversation in a process of its own (see above)

REFUSED = (
    "macOS stopped the dashboard using Bluetooth. Allow Bluetooth for the app it runs from (System Settings → Privacy "
    "& Security → Bluetooth), or run it on a Linux server."
)


FIX_DOCKER = (
    "On the server, run bash install.sh again in the WattsMyPower folder: it connects Bluetooth through to the "
    "dashboard when it finds an adapter with BlueZ running (and says what's missing when it doesn't)."
)


def unavailable(e: BaseException) -> str:
    """Why this server's Bluetooth can't be used, in words."""
    if isinstance(e, FileNotFoundError):  # no D-Bus socket: in Docker, the host's isn't mounted in
        return f"The dashboard can't reach this server's Bluetooth (there's no D-Bus to talk to BlueZ). {FIX_DOCKER}"
    return (
        f"This server's Bluetooth can't be used ({type(e).__name__}: {e}). It needs a Bluetooth adapter, switched on, "
        f"with BlueZ running. {FIX_DOCKER}"
    )


def outer_root(uid_map: str) -> int | None:
    """Who root here is outside this user namespace, from /proc/self/uid_map ("0 100000 65536": uid 100000); None
    outside one (root is root)."""
    for line in uid_map.splitlines():
        inside, outside, *_ = [*line.split(), "", ""]
        if inside == "0" and outside.isdigit():
            return None if outside == "0" else int(outside)
    return None


def fit_dbus_to_user_namespace(uid_map: Path = Path("/proc/self/uid_map")) -> bool:
    """In a user namespace, have D-Bus clients (bleak's, through dbus-fast) let the kernel say who they are, rather
    than claim the uid they have here, which a D-Bus outside the namespace turns away. Whether it did."""
    try:
        if outer_root(uid_map.read_text()) is None:
            return False
        auth = importlib.import_module("dbus_fast.auth")
        message_bus = importlib.import_module("dbus_fast.aio.message_bus")
    except (OSError, ImportError):  # not Linux, or no dbus-fast (it's Linux-only)
        return False
    setattr(message_bus, "AuthExternal", partial(auth.AuthExternal, auth.UID_NOT_SPECIFIED))  # noqa: B010
    return True


fit_dbus_to_user_namespace()


def run_alone[T](fn: Callable[..., T], *args: Any, refused: Callable[[str], Exception]) -> T:
    """`fn(*args)`, one conversation at a time: here, or on a Mac in a process of its own. `refused` makes the error
    raised when macOS ends that process."""
    with RADIO_LOCK:
        if not APART:
            return fn(*args)
        with ProcessPoolExecutor(1, mp_context=multiprocessing.get_context("spawn")) as pool:
            try:
                return pool.submit(fn, *args).result()
            except BrokenProcessPool as e:
                raise refused(REFUSED) from e
