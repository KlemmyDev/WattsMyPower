"""This server's Bluetooth: in a user namespace (an unprivileged Proxmox LXC), D-Bus clients let the kernel say who
they are, so the host's D-Bus doesn't turn them away. dbus-fast is Linux-only, so stand-ins take its place here."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

from app.core.bluetooth import fit_dbus_to_user_namespace, outer_root


def test_root_outside_a_user_namespace() -> None:
    assert outer_root("         0          0 4294967295\n") is None  # not in one
    assert outer_root("         0     100000      65536\n") == 100000  # an unprivileged LXC
    assert outer_root("") is None


@pytest.fixture
def dbus_fast(monkeypatch: pytest.MonkeyPatch) -> types.ModuleType:
    """Stand-ins for dbus_fast.auth and dbus_fast.aio.message_bus."""
    auth = types.ModuleType("dbus_fast.auth")

    class AuthExternal:
        def __init__(self, uid: int | None = None) -> None:
            self.uid = uid

    auth.AuthExternal = AuthExternal  # type: ignore[attr-defined]
    auth.UID_NOT_SPECIFIED = -1  # type: ignore[attr-defined]
    bus = types.ModuleType("dbus_fast.aio.message_bus")
    bus.AuthExternal = AuthExternal  # type: ignore[attr-defined]
    for name, mod in {
        "dbus_fast": types.ModuleType("dbus_fast"),
        "dbus_fast.aio": types.ModuleType("dbus_fast.aio"),
        "dbus_fast.auth": auth,
        "dbus_fast.aio.message_bus": bus,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)
    return bus


def test_in_a_user_namespace_the_kernel_says_who_it_is(tmp_path: Path, dbus_fast: types.ModuleType) -> None:
    uid_map = tmp_path / "uid_map"
    uid_map.write_text("0 0 4294967295\n")
    assert not fit_dbus_to_user_namespace(uid_map)
    assert dbus_fast.AuthExternal().uid is None  # as it was: it says the uid it has
    uid_map.write_text("0 100000 65536\n")
    assert fit_dbus_to_user_namespace(uid_map)
    assert dbus_fast.AuthExternal().uid == -1  # the kernel says


def test_without_a_uid_map_nothing_changes(tmp_path: Path) -> None:
    assert not fit_dbus_to_user_namespace(tmp_path / "missing")
