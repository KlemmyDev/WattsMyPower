"""
Reads an older Sungrow string inverter (SG-D series, e.g. SG5K-D) through its
Wi-Fi dongle, for a second, AC-coupled solar system alongside the hybrid.

These dongles accept Modbus TCP on port 502 but ignore plain requests: they
only answer Sungrow's encrypted variant (as implemented by the
SungrowModbusTcpClient library, which needs pymodbus 2.x, hence this small
socket client instead):

  1. Ask for a key with a special read on unit 0xF7. Bytes 9-24 of the reply are
     the dongle's key; XOR them with a fixed key to get the AES-128 key. A key
     of all 0x00 or all 0xFF means the dongle doesn't encrypt, so frames go plain.
  2. Every request is an ordinary Modbus TCP frame with its first two bytes
     replaced by 0x68 0x68, padded with 0xFF to 16 bytes, AES-ECB encrypted, and
     prefixed with [1, 0, length, padding]. Replies come back the same way.
  3. The key changes daily, so it's fetched again each new day (or after an error).

Registers are from Sungrow's protocol for residential grid-connected inverters
(protocol address = Modbus address + 1, 32-bit values low word first), checked
against a real SG5K-D.
"""

from __future__ import annotations

import socket
import struct
from contextlib import closing
from datetime import date
from typing import Any

from Cryptodome.Cipher import AES

FIXED_KEY = b"Grow#0*2Sun68CbE"
GET_KEY = b"\x68\x68\x00\x00\x00\x06\xf7\x04\x0a\xe7\x00\x08"
NO_KEY = {b"\x00" * 16, b"\xff" * 16}
SENTINELS = {0xFFFF, 0x7FFF, 0xFFFFFFFF, 0x7FFFFFFF}
# Device type codes seen on real hardware.
MODELS = {0x0126: "SG5K-D"}


def _recv(s: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


def _u32(lo: int, hi: int) -> int | None:
    v = (hi << 16) | lo
    return None if v in SENTINELS else v


def _u16(v: int, scale: float = 1.0) -> float | None:
    return None if v in SENTINELS else round(v * scale, 3)


class StringInverter:
    def __init__(self, host: str, port: int = 502, unit: int = 1, timeout: float = 6):
        self.host, self.port, self.unit, self.timeout = host, port, unit, timeout
        self._aes: Any = None  # an AES-ECB cipher, or None when the dongle doesn't encrypt
        self._key_day: date | None = None
        self._tid = 0
        self.info: dict[str, Any] = {}

    def _connect(self) -> socket.socket:
        return socket.create_connection((self.host, self.port), timeout=self.timeout)

    def _handshake(self) -> None:
        if self._key_day == date.today():
            return
        with closing(self._connect()) as s:
            s.sendall(GET_KEY)
            pkt = _recv(s, 25)
        if len(pkt) < 25:
            raise ConnectionError(f"{self.host} didn't send an encryption key")
        key = pkt[9:25]
        self._aes = (
            None if key in NO_KEY else AES.new(bytes(a ^ b for a, b in zip(key, FIXED_KEY, strict=False)), AES.MODE_ECB)
        )
        self._key_day = date.today()

    def _read(self, s: socket.socket, address: int, count: int) -> list[int] | None:
        """Input registers (function 0x04) at a protocol address. None if the inverter rejects the read."""
        self._tid = (self._tid + 1) & 0xFFFF
        req = struct.pack(">HHHBBHH", self._tid, 0, 6, self.unit, 4, address - 1, count)
        if self._aes is not None:
            pad = 16 - len(req) % 16
            s.sendall(bytes([1, 0, len(req), pad]) + self._aes.encrypt(b"\x68\x68" + req[2:] + b"\xff" * pad))
            hdr = _recv(s, 4)
            if len(hdr) < 4:
                raise ConnectionError(f"{self.host} didn't reply")
            n, pad = hdr[2], hdr[3]
            body = _recv(s, n + pad)
            if len(body) < n + pad:
                raise ConnectionError(f"{self.host} sent a short reply")
            raw: bytes = self._aes.decrypt(body)[:n]
        else:
            s.sendall(req)
            head = _recv(s, 7)
            if len(head) < 7:
                raise ConnectionError(f"{self.host} didn't reply")
            raw = head + _recv(s, struct.unpack(">H", head[4:6])[0] - 1)
        if len(raw) < 9 or raw[7] & 0x80:
            return None
        nbytes = raw[8]
        return list(struct.unpack(f">{nbytes // 2}H", raw[9 : 9 + nbytes]))

    def read_snapshot(self) -> dict[str, float | None]:
        """Current output and counters. Raises ConnectionError if the dongle can't be reached."""
        self._handshake()
        try:
            with closing(self._connect()) as s:
                # 5000 type, 5001 nominal, 5003 daily, 5004-05 total, 5006-07 hours, 5008 temp
                a = self._read(s, 5000, 9)
                b = self._read(s, 5011, 8)  # 5011-14 MPPT V/A, 5017-18 DC power
                c = self._read(s, 5031, 2)  # 5031-32 AC power
        except (OSError, ConnectionError):
            self._key_day = None  # the dongle may have restarted with a new key
            raise
        if a is None or c is None:
            self._key_day = None
            raise ConnectionError(f"{self.host} answered but returned no data")
        self.info = {
            "model": MODELS.get(a[0], f"Sungrow (type 0x{a[0]:04X})"),
            "nominal_kw": _u16(a[1], 0.1),
            "running_hours": _u32(a[6], a[7]),
        }
        temp = a[8] - 0x10000 if a[8] >= 0x8000 and a[8] not in SENTINELS else a[8]
        return {
            "pv2_power": _u32(c[0], c[1]),
            "pv2_dc_power": _u32(b[6], b[7]) if b else None,
            "daily_pv2": _u16(a[3], 0.1),
            "total_pv2": _u32(a[4], a[5]),
            "pv2_temp": None if a[8] in SENTINELS else round(temp * 0.1, 1),
        }
