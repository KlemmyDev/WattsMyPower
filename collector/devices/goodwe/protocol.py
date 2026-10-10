"""
GoodWe's local protocol: Modbus over UDP port 8899 through the inverter's Wi-Fi/LAN dongle (every GoodWe kit
answers it), or plain Modbus TCP on port 502 (newer LAN dongles listen there too).

GoodWe answers only function 0x03 (read holding registers), on its own unit address: 0xF7 for the ET family of
hybrids, 0x7F for the DT family of string inverters.

Over UDP, a request is a Modbus RTU frame: [unit, 0x03, start, count, CRC-16 low byte first]. The reply is
[0xAA, 0x55, unit, 0x03, byte count, data..., CRC]; the CRC covers everything after AA 55. An exception reply has
0x83 as its function and the error code next (2: illegal address, a range the model doesn't have). Over TCP, frames
are ordinary Modbus TCP (MBAP header, no CRC); GoodWe's MBAP length can be wrong, so the byte count is what counts.

As documented by the MIT-licensed `goodwe` library (github.com/marcelblijleven/goodwe: protocol.py, modbus.py),
the reference used for Home Assistant's GoodWe integration.
"""

from __future__ import annotations

import socket
import struct
import threading
from contextlib import closing

UDP_PORT = 8899
TCP_PORT = 502
ET_UNIT = 0xF7
DT_UNIT = 0x7F


class Rejected(Exception):
    """The inverter answered with a Modbus exception (e.g. 2: a range this model doesn't have)."""

    def __init__(self, code: int):
        super().__init__(f"Modbus exception {code}")
        self.code = code


def crc16(data: bytes) -> int:
    """Modbus CRC-16 (initial 0xFFFF, reflected polynomial 0xA001)."""
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def rtu_request(unit: int, start: int, count: int) -> bytes:
    frame = struct.pack(">BBHH", unit, 0x03, start, count)
    return frame + struct.pack("<H", crc16(frame))


def parse_rtu(reply: bytes, count: int) -> list[int]:
    """The words from a UDP reply. Raises Rejected for an exception reply, ValueError for anything malformed."""
    if len(reply) < 5 or reply[:2] != b"\xaa\x55":
        raise ValueError("not a GoodWe reply")
    if reply[3] != 0x03:
        if len(reply) >= 7 and crc16(reply[2:5]) == struct.unpack("<H", reply[5:7])[0]:
            raise Rejected(reply[4])
        raise ValueError("garbled exception reply")
    n = reply[4]
    if n != 2 * count or len(reply) < 7 + n:
        raise ValueError("short or mismatched reply")
    if crc16(reply[2 : 5 + n]) != struct.unpack("<H", reply[5 + n : 7 + n])[0]:
        raise ValueError("bad CRC")
    return list(struct.unpack(f">{count}H", reply[5 : 5 + n]))


def _recv(s: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


class GoodWeClient:
    """Reads holding registers from one inverter: Modbus TCP on port 502, UDP on any other (8899, normally)."""

    def __init__(self, host: str, port: int, unit: int, timeout: float = 2.0, retries: int = 2):
        self.host, self.port, self.unit = host, port, unit
        self.timeout, self.retries = timeout, retries
        self._tid = 0
        self._lock = threading.Lock()  # one conversation at a time: the dongle can't tell two apart

    @property
    def udp(self) -> bool:
        return self.port != TCP_PORT

    def read(self, start: int, count: int) -> list[int] | None:
        """`count` words from `start`, or None if the inverter rejects the range. Raises ConnectionError when it
        doesn't answer (after the retries: UDP drops a datagram now and then)."""
        with self._lock:
            last: Exception | None = None
            for _ in range(self.retries + 1):
                try:
                    return self._udp(start, count) if self.udp else self._tcp(start, count)
                except Rejected:
                    return None
                except (OSError, ValueError) as e:  # a timeout, or a reply garbled on the way
                    last = e
            raise ConnectionError(f"{self.host}:{self.port} didn't answer ({last})")

    def _udp(self, start: int, count: int) -> list[int]:
        with closing(socket.socket(socket.AF_INET, socket.SOCK_DGRAM)) as s:
            s.settimeout(self.timeout)
            s.connect((self.host, self.port))
            s.send(rtu_request(self.unit, start, count))
            reply = s.recv(512)
            # A reply too big for one datagram arrives in two.
            while len(reply) >= 5 and reply[:2] == b"\xaa\x55" and reply[3] == 0x03 and len(reply) < 7 + reply[4]:
                reply += s.recv(512)
        return parse_rtu(reply, count)

    def _tcp(self, start: int, count: int) -> list[int]:
        self._tid = (self._tid + 1) & 0xFFFF
        with closing(socket.create_connection((self.host, self.port), timeout=self.timeout)) as s:
            s.sendall(struct.pack(">HHHBBHH", self._tid, 0, 6, self.unit, 0x03, start, count))
            head = _recv(s, 9)
            if len(head) < 9:
                raise ValueError("short reply")
            if head[7] & 0x80:
                raise Rejected(head[8])
            n = head[8]
            if n != 2 * count:
                raise ValueError("mismatched reply")
            body = _recv(s, n)
            if len(body) < n:
                raise ValueError("short reply")
        return list(struct.unpack(f">{count}H", body))
