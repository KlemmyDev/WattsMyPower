"""
Finding Tapo devices on the home network, as the Tapo app does: a probe on UDP port 20002, which every newer TP-Link
device answers with what it is (model, id, address, and how it's spoken to: KLAP, or AES on older firmware).

The probe is a 16-byte header (version 2, a probe, the payload's length, flags 17, a random serial, then a CRC-32 over
the whole packet written into its last 4 bytes) followed by {"params": {"rsa_key": <a public key>}}; the answer's JSON
starts 16 bytes in. The key is only for parts of the answer this doesn't use.

Broadcasts don't leave a Docker container's network, so the probe goes to every address in the network one at a
time, twice (UDP can drop one), and the broadcast address as well.
"""

from __future__ import annotations

import binascii
import contextlib
import ipaddress
import json
import secrets
import socket
import struct
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache
from typing import Any, Protocol

from Cryptodome.PublicKey import RSA

PORT = 20002
WAIT = 3.0  # seconds to listen for answers
MAX_HOSTS = 1024  # the largest network looked through (a /22)


class Socket(Protocol):
    def sendto(self, data: bytes, address: tuple[str, int], /) -> int: ...
    def recvfrom(self, size: int, /) -> tuple[bytes, Any]: ...
    def settimeout(self, value: float | None, /) -> None: ...
    def close(self) -> None: ...


def _socket() -> Socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    return s


@dataclass(frozen=True)
class Found:
    host: str
    device_id: str
    model: str
    device_type: str  # "SMART.TAPOPLUG", "SMART.TAPOBULB"…
    encrypt_type: str  # "KLAP", or "AES" on older firmware
    port: int  # its HTTP port


class WhereError(ValueError):
    """Where to look, in words that say what's wrong with it."""


def addresses(where: str) -> tuple[list[str], list[str]]:
    """What "where to look" says: every address to probe, and those given one by one (tried directly, even if they
    don't answer the probe). A network ("192.168.1.0/24") or addresses, separated by commas or spaces."""
    hosts: list[str] = []
    named: list[str] = []
    for part in where.replace(",", " ").split():
        try:
            if "/" in part:
                net = ipaddress.ip_network(part, strict=False)
                if not isinstance(net, ipaddress.IPv4Network) or not net.is_private:
                    raise WhereError(f"{part} isn't a home network.")
                if net.num_addresses > MAX_HOSTS + 2:
                    raise WhereError(f"{part} is bigger than a home network: give a /22 or smaller.")
                hosts += [str(h) for h in net.hosts()]
            else:
                ip = ipaddress.ip_address(part)
                if not isinstance(ip, ipaddress.IPv4Address) or not ip.is_private:
                    raise WhereError(f"{part} isn't an address on a home network.")
                hosts.append(part)
                named.append(part)
        except ValueError as e:
            if isinstance(e, WhereError):
                raise
            raise WhereError(f"{part} isn't a network or an address.") from e
    return list(dict.fromkeys(hosts)), named


@cache
def _key_pem() -> str:
    return RSA.generate(2048).publickey().export_key().decode()


def probe() -> bytes:
    payload = json.dumps({"params": {"rsa_key": _key_pem()}}).encode()
    serial = int.from_bytes(secrets.token_bytes(4), "big")
    packet = bytearray(struct.pack(">BBHHBBII", 2, 0, 1, len(payload), 17, 0, serial, 0x5A6B7C8D) + payload)
    packet[12:16] = binascii.crc32(packet).to_bytes(4, "big")
    return bytes(packet)


def parse(data: bytes, host: str) -> Found | None:
    """A probe's answer, or None for one that isn't."""
    try:
        info = json.loads(data[16:])
    except ValueError:
        return None
    r = info.get("result") if isinstance(info, dict) else None
    if not isinstance(r, dict) or not r.get("device_id"):
        return None
    got = r.get("mgt_encrypt_schm")
    scheme: dict[str, Any] = got if isinstance(got, dict) else {}
    return Found(
        host=str(r.get("ip") or host),
        device_id=str(r["device_id"]),
        model=str(r.get("device_model") or ""),
        device_type=str(r.get("device_type") or ""),
        encrypt_type=str(scheme.get("encrypt_type") or r.get("encrypt_type") or ""),
        port=int(scheme.get("http_port") or 80),
    )


def discover(
    hosts: list[str],
    wait: float = WAIT,
    sock: Callable[[], Socket] = _socket,
    clock: Callable[[], float] = time.monotonic,
) -> list[Found]:
    """Every TP-Link device among `hosts` that answers the probe, by address."""
    s = sock()
    s.settimeout(0.2)
    packet = probe()
    found: dict[str, Found] = {}
    try:
        for attempt in range(2):
            for h in hosts:
                try:
                    s.sendto(packet, (h, PORT))
                except OSError:  # an address the server can't send to: skip it
                    continue
            if attempt == 0:
                with contextlib.suppress(OSError):
                    s.sendto(packet, ("255.255.255.255", PORT))
            end = clock() + wait / 2
            while clock() < end:
                try:
                    data, (host, _) = s.recvfrom(4096)
                except (TimeoutError, OSError):
                    continue
                if (f := parse(data, host)) is not None:
                    found[f.host] = f
    finally:
        s.close()
    return sorted(found.values(), key=lambda f: ipaddress.ip_address(f.host))
