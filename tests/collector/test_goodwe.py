"""GoodWe's local protocol (Modbus RTU over UDP 8899, or Modbus TCP), against fake inverters on localhost."""

from __future__ import annotations

import asyncio
import socket
import struct
import threading
from collections.abc import Callable, Iterator

import pytest

from collector.devices.goodwe.dt import DtDevice
from collector.devices.goodwe.et import EtDevice
from collector.devices.goodwe.protocol import GoodWeClient, Rejected, crc16, parse_rtu, rtu_request
from collector.scan import udp_hello


def test_requests_match_the_goodwe_library() -> None:
    """Frames as the `goodwe` library builds them (CRC-16/Modbus, low byte first)."""
    assert rtu_request(0xF7, 35000, 33).hex(" ") == "f7 03 88 b8 00 21 3a c1"
    assert rtu_request(0xF7, 35100, 125).hex(" ") == "f7 03 89 1c 00 7d 7a e7"
    assert rtu_request(0x7F, 30001, 40).hex(" ") == "7f 03 75 31 00 28 04 09"
    assert rtu_request(0x7F, 30100, 73).hex(" ") == "7f 03 75 94 00 49 d5 c2"


def reply(unit: int, words: list[int] | None, code: int = 2) -> bytes:
    """An inverter's UDP reply: AA 55, then an RTU frame (words, or an exception) with its CRC."""
    body = (
        bytes([unit, 0x83, code])
        if words is None
        else bytes([unit, 0x03, 2 * len(words)]) + struct.pack(f">{len(words)}H", *words)
    )
    return b"\xaa\x55" + body + struct.pack("<H", crc16(body))


def test_replies_are_checked() -> None:
    assert parse_rtu(reply(0xF7, [1, 2, 0xFFFF]), 3) == [1, 2, 0xFFFF]
    with pytest.raises(Rejected) as e:
        parse_rtu(reply(0xF7, None), 3)
    assert e.value.code == 2
    good = reply(0xF7, [1, 2, 3])
    with pytest.raises(ValueError, match="CRC"):
        parse_rtu(good[:-1] + bytes([good[-1] ^ 1]), 3)
    with pytest.raises(ValueError):
        parse_rtu(good, 4)  # not the count asked for
    with pytest.raises(ValueError):
        parse_rtu(b"\x01\x02" + good[2:], 3)


Registers = dict[int, int]


@pytest.fixture
def udp_inverter() -> Iterator[Callable[..., tuple[int, list[bytes]]]]:
    """A fake GoodWe on a localhost UDP port: answers reads of the registers it has, rejects the rest."""
    socks: list[socket.socket] = []

    def start(unit: int, registers: Registers, drop_first: int = 0) -> tuple[int, list[bytes]]:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.bind(("127.0.0.1", 0))
        socks.append(s)
        seen: list[bytes] = []

        def serve() -> None:
            dropped = 0
            while True:
                try:
                    data, addr = s.recvfrom(64)
                except OSError:
                    return
                seen.append(data)
                if dropped < drop_first:
                    dropped += 1
                    continue
                if data[0] != unit:
                    continue  # another family's address: a real dongle stays quiet
                start_, count = struct.unpack(">HH", data[2:6])
                want = range(start_, start_ + count)
                words = [registers[a] for a in want] if all(a in registers for a in want) else None
                s.sendto(reply(unit, words), addr)

        threading.Thread(target=serve, daemon=True).start()
        return s.getsockname()[1], seen

    yield start
    for s in socks:
        s.close()


def et_registers() -> Registers:
    regs = dict.fromkeys(range(35000, 35033), 0)
    regs.update(dict.fromkeys(range(35100, 35225), 0))
    regs.update(dict.fromkeys(range(37000, 37024), 0))
    regs[35001] = 5000  # 5 kW
    regs[35140] = 1234
    return regs  # no meter block (36000): rejected


def test_an_et_hybrid_is_read_over_udp(udp_inverter: Callable[..., tuple[int, list[bytes]]]) -> None:
    port, seen = udp_inverter(0xF7, et_registers())
    device = EtDevice("127.0.0.1", port)
    assert device.unit == 0xF7  # its family's address, not Modbus' usual 1
    r = device.read(include_info=True)
    assert r.input[35001] == 5000 and r.info_input[35001] == 5000 and r.input[35140] == 1234
    assert 36000 not in r.input  # a range the model doesn't have is left out
    assert r.input[37007] == 0
    assert seen[0] == rtu_request(0xF7, 35000, 33)


def test_a_dropped_datagram_is_tried_again(udp_inverter: Callable[..., tuple[int, list[bytes]]]) -> None:
    port, _ = udp_inverter(0xF7, et_registers(), drop_first=1)
    client = GoodWeClient("127.0.0.1", port, 0xF7, timeout=0.3, retries=2)
    assert client.read(35140, 1) == [1234]


def test_nothing_there_is_a_connection_error() -> None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))  # bound, never answers
    try:
        client = GoodWeClient("127.0.0.1", s.getsockname()[1], 0xF7, timeout=0.1, retries=1)
        with pytest.raises(ConnectionError):
            client.read(35000, 33)
    finally:
        s.close()


def test_probes_tell_the_families_apart(udp_inverter: Callable[..., tuple[int, list[bytes]]]) -> None:
    port, _ = udp_inverter(0xF7, et_registers())
    assert EtDevice("127.0.0.1", port).probe() is not None
    assert DtDevice("127.0.0.1", port).probe() is None  # a DT's address gets no answer from an ET


def test_a_scan_says_hello_over_udp(udp_inverter: Callable[..., tuple[int, list[bytes]]]) -> None:
    port, _ = udp_inverter(0x7F, {a: 0 for a in range(30001, 30041)})
    hellos = [rtu_request(0xF7, 35000, 33), rtu_request(0x7F, 30001, 40)]
    assert asyncio.run(udp_hello("127.0.0.1", port, hellos)) is True
    assert asyncio.run(udp_hello("127.0.0.1", port, hellos[:1])) is False  # only an ET's hello: no answer


def test_a_newer_dongle_can_be_read_over_modbus_tcp(monkeypatch: pytest.MonkeyPatch) -> None:
    from collector.devices.goodwe import protocol

    srv = socket.create_server(("127.0.0.1", 0))
    port = srv.getsockname()[1]
    monkeypatch.setattr(protocol, "TCP_PORT", port)  # port 502, as far as the client's concerned

    def serve() -> None:
        conn, _ = srv.accept()
        with conn:
            req = conn.recv(12)
            tid, _, _, unit, fn, start, count = struct.unpack(">HHHBBHH", req)
            assert (unit, fn, start, count) == (0xF7, 3, 35140, 2)
            pdu = bytes([3, 4]) + struct.pack(">HH", 7, 8)
            conn.sendall(struct.pack(">HHHB", tid, 0, 99, unit) + pdu)  # GoodWe's MBAP length can be wrong

    threading.Thread(target=serve, daemon=True).start()
    try:
        assert GoodWeClient("127.0.0.1", port, 0xF7, timeout=2).read(35140, 2) == [7, 8]
    finally:
        srv.close()
