"""
What a Bluetti power station says over Bluetooth: Modbus RTU frames (unit 1, CRC-16/Modbus) written to one GATT
characteristic, with the answers coming back as notifications on another, sometimes a few notifications to one answer.

There are two register layouts. The older stations (AC200M, AC300, EB3A…: "V1") keep their live figures low down
(36–43) and their outlet switches at 3007–3008; the newer ones (AC180, AC70, Elite V2…: "V2") keep the charge at 102,
power at 140–147 and the switches at 2011–2012. Which a station uses, what it holds and whether its outlets can be
switched is in MODELS, by the model its Bluetooth name starts with ("AC1802235000123456": an AC180, serial
2235000123456).

The register addresses come from bluetti-bt-lib (github.com/Patrick762/bluetti-bt-lib, MIT), whose contributors read
them off their own stations. Only stations that speak in the clear are read here: a station that starts the
encrypted handshake (its first notification starts with "**") says so, and is refused in words.
"""

from __future__ import annotations

import re
import struct
from dataclasses import dataclass

UNIT = 1
READ, WRITE = 0x03, 0x06
SERVICE = "0000ff00-0000-1000-8000-00805f9b34fb"
NOTIFY = "0000ff01-0000-1000-8000-00805f9b34fb"
WRITE_CHAR = "0000ff02-0000-1000-8000-00805f9b34fb"
HANDSHAKE = b"**"  # how an encrypted station's first message starts


class ProtocolError(Exception):
    """An answer that isn't what was asked for: cut short, corrupted, or refused by the station."""


@dataclass(frozen=True)
class Model:
    layout: int  # 1 or 2: where its registers are
    capacity_kwh: float | None  # what it holds full (None: it depends on the packs plugged in, or isn't known)
    outlets: bool = True  # its AC and DC outlets can be switched over Bluetooth


# Portable power stations, by the model their Bluetooth name starts with. The bigger home systems (EP600, EP760,
# EP2000…) keep their figures elsewhere, by phase, and aren't here yet.
MODELS: dict[str, Model] = {
    # V1
    "AC200M": Model(1, 2.048),
    "AC200L": Model(1, 2.048),
    "AC200PL": Model(1, 2.304),
    "AC300": Model(1, None),  # B300 packs
    "AC500": Model(1, None),  # B300S packs
    "EB3A": Model(1, 0.268),
    "EP500": Model(1, 5.1),
    "EP500P": Model(1, 5.1),
    # V2
    "AC2A": Model(2, 0.205, outlets=False),
    "AC2P": Model(2, None),
    "AC50B": Model(2, 0.448, outlets=False),
    "AC60": Model(2, 0.403),
    "AC60P": Model(2, 0.504),
    "AC70": Model(2, 0.768),
    "AC70P": Model(2, 0.864, outlets=False),
    "AC180": Model(2, 1.152),
    "AC180P": Model(2, 1.44),
    "AC180T": Model(2, None, outlets=False),
    "AP300": Model(2, 2.765, outlets=False),
    "EL10": Model(2, None),
    "EL30V2": Model(2, 0.288),
    "EL100V2": Model(2, 1.024),
    "PR30V2": Model(2, 0.288, outlets=False),
    "PR100V2": Model(2, 1.024, outlets=False),
}

# A station's Bluetooth name: its model, then its serial number. Longest models first, so AC180P isn't read as AC180.
NAME = re.compile(r"^(" + "|".join(sorted(MODELS, key=len, reverse=True)) + r")(\d{6,})$")
# Bluetti's other names, to say a station was seen but isn't one that can be read yet.
OTHER = re.compile(r"^(AC|EB|EP|EL|AP|PR|Handsfree)\s?\w*\d{6,}$")


def identify(name: str | None) -> tuple[str, str] | None:
    """The model and serial number in a station's Bluetooth name, if it's one that can be read."""
    m = NAME.match((name or "").strip())
    return (m[1], m[2]) if m else None


def crc(frame: bytes) -> bytes:
    """CRC-16/Modbus, low byte first, as it's sent."""
    value = 0xFFFF
    for b in frame:
        value ^= b
        for _ in range(8):
            value = (value >> 1) ^ 0xA001 if value & 1 else value >> 1
    return struct.pack("<H", value)


def read_request(address: int, count: int) -> bytes:
    body = struct.pack(">BBHH", UNIT, READ, address, count)
    return body + crc(body)


def write_request(address: int, value: int) -> bytes:
    body = struct.pack(">BBHH", UNIT, WRITE, address, value)
    return body + crc(body)


def expected_length(request: bytes, received: bytes) -> int | None:
    """How long the answer to `request` will be, once enough of it has arrived to tell (None: not yet)."""
    if len(received) < 3:
        return None
    if received[1] & 0x80:  # an exception: unit, function | 0x80, code, CRC
        return 5
    if request[1] == READ:
        return 3 + received[2] + 2
    return 8  # a write is echoed back


def parse(request: bytes, answer: bytes) -> list[int]:
    """The registers a read answered with, or the value a write set (one). Raises ProtocolError."""
    if answer.startswith(HANDSHAKE):
        raise ProtocolError("encrypted")
    if len(answer) < 5 or answer[-2:] != crc(answer[:-2]):
        raise ProtocolError(f"a corrupted answer ({answer.hex()})")
    if answer[1] == request[1] | 0x80:
        raise ProtocolError(f"refused with Modbus exception {answer[2]}")
    if answer[:2] != request[:2]:
        raise ProtocolError(f"an answer to something else ({answer.hex()})")
    if request[1] == READ:
        size = answer[2]
        count = struct.unpack(">H", request[4:6])[0]
        if size != 2 * count or len(answer) != 3 + size + 2:
            raise ProtocolError(f"{size // 2} registers where {count} were asked for")
        return list(struct.unpack(f">{count}H", answer[3 : 3 + size]))
    if answer[:6] != request[:6]:
        raise ProtocolError("the write wasn't echoed back as sent")
    return [struct.unpack(">H", answer[4:6])[0]]


@dataclass(frozen=True)
class Layout:
    """Where a layout keeps what's read: each as (first register, how many), and each figure's register."""

    blocks: tuple[tuple[int, int], ...]
    soc: int
    dc_in: int
    ac_in: int
    ac_out: int
    dc_out: int
    ac_switch: int
    dc_switch: int


LAYOUTS = {
    1: Layout(blocks=((36, 8),), soc=43, dc_in=36, ac_in=37, ac_out=38, dc_out=39, ac_switch=3007, dc_switch=3008),
    2: Layout(
        blocks=((102, 1), (140, 8)),
        soc=102,
        dc_out=140,
        ac_out=142,
        dc_in=144,
        ac_in=146,
        ac_switch=2011,
        dc_switch=2012,
    ),
}


@dataclass(frozen=True)
class Status:
    """A station now."""

    soc: float  # % charged
    ac_in_w: float  # from the wall: what it takes from the house
    dc_in_w: float  # from its own solar panels (or a car's socket)
    ac_out_w: float
    dc_out_w: float
    ac_on: bool | None  # its AC outlets are on (None: it can't say)
    dc_on: bool | None
    registers: dict[int, int]


def requests(model: Model) -> list[bytes]:
    """What to ask a station of this model for, each poll."""
    layout = LAYOUTS[model.layout]
    asks = [read_request(a, n) for a, n in layout.blocks]
    if model.outlets:
        asks.append(read_request(layout.ac_switch, 2))
    return asks


def status(model: Model, asked: list[bytes], answers: list[bytes]) -> Status:
    """What the station is doing, from its answers to `requests(model)`. Raises ProtocolError."""
    registers: dict[int, int] = {}
    for request, answer in zip(asked, answers, strict=True):
        start = struct.unpack(">H", request[2:4])[0]
        for n, value in enumerate(parse(request, answer)):
            registers[start + n] = value
    layout = LAYOUTS[model.layout]
    soc = registers[layout.soc]
    if soc > 100:
        raise ProtocolError(f"a charge of {soc}%")
    switch = lambda r: bool(registers[r]) if r in registers else None  # noqa: E731
    return Status(
        soc=float(soc),
        ac_in_w=float(registers[layout.ac_in]),
        dc_in_w=float(registers[layout.dc_in]),
        ac_out_w=float(registers[layout.ac_out]),
        dc_out_w=float(registers[layout.dc_out]),
        ac_on=switch(layout.ac_switch),
        dc_on=switch(layout.dc_switch),
        registers=registers,
    )
