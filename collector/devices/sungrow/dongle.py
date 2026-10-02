"""
Older Sungrow inverters' Wi-Fi dongles (e.g. on an SG5K-D), which only speak an encrypted Modbus.
A model's reader subclasses DongleDevice and says which ranges to read (see sg_d.py).

These dongles accept Modbus TCP on port 502 but ignore plain requests: they only answer Sungrow's
encrypted variant (as implemented by the SungrowModbusTcpClient library, which needs pymodbus 2.x,
hence this small socket client instead):

  1. Ask for a key with a special read on unit 0xF7. Bytes 9-24 of the reply are the dongle's key;
     XOR them with a fixed key to get the AES-128 key. A key of all 0x00 or all 0xFF means the
     dongle doesn't encrypt, so frames go plain.
  2. Every request is an ordinary Modbus TCP frame with its first two bytes replaced by 0x68 0x68,
     padded with 0xFF to 16 bytes, AES-ECB encrypted, and prefixed with [1, 0, length, padding].
     Replies come back the same way.
  3. The key changes daily, so it's fetched again each new day (or after an error).
"""

from __future__ import annotations

import socket
import struct
from contextlib import closing
from datetime import date
from typing import Any

from Cryptodome.Cipher import AES

from collector.devices import RawReading
from collector.devices.modbus import Range, read_ranges

FIXED_KEY = b"Grow#0*2Sun68CbE"
GET_KEY = b"\x68\x68\x00\x00\x00\x06\xf7\x04\x0a\xe7\x00\x08"
NO_KEY = {b"\x00" * 16, b"\xff" * 16}


def _recv(s: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


class DongleDevice:
    """Input registers in `ranges`, every poll, through an encrypted dongle (there is no separate info)."""

    name: str
    driver: str
    ranges: tuple[Range, ...]

    def __init__(self, host: str, port: int = 502, unit: int = 1, timeout: float = 6):
        self.host, self.port, self.unit, self.timeout = host, port, unit, timeout
        self._aes: Any = None  # an AES-ECB cipher, or None when the dongle doesn't encrypt
        self._key_day: date | None = None
        self._tid = 0
        self._bad: set[int] = set()

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
        if nbytes != 2 * count or len(raw) < 9 + nbytes:
            # Usually a stale key: the reply decrypts to garbage. Raising makes read() fetch a new one.
            raise ConnectionError(f"{self.host} sent a garbled reply")
        return list(struct.unpack(f">{count}H", raw[9 : 9 + nbytes]))

    def read(self, include_info: bool) -> RawReading:
        """The words in `ranges`. Raises ConnectionError if unreachable."""
        try:
            self._handshake()
            with closing(self._connect()) as s:
                words = read_ranges(lambda a, c: self._read(s, a, c), self.ranges, self._bad, self.name)
        except OSError as e:
            self._key_day = None  # the dongle may have restarted with a new key
            if isinstance(e, ConnectionError):
                raise
            raise ConnectionError(f"{self.host}: {e}") from e
        if not words:
            self._key_day = None
            raise ConnectionError(f"{self.host} answered but returned no data")
        return RawReading(input=words)
