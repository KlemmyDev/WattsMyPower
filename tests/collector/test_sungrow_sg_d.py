"""The second inverter's encrypted dongle protocol, against fake sockets."""

from __future__ import annotations

import struct

import pytest
from Cryptodome.Cipher import AES

from collector.devices.sungrow.dongle import FIXED_KEY, GET_KEY
from collector.devices.sungrow.sg_d import SgDDevice

PUBKEY = bytes.fromhex("00112233445566778899aabbccddeeff")
AES_KEY = AES.new(bytes(a ^ b for a, b in zip(PUBKEY, FIXED_KEY, strict=True)), AES.MODE_ECB)

# Recorded from the original StringInverter (verified against a real SG5K-D) with the key above:
# its three requests (tid 1-3: 5000+9, 5011+8, 5031+2, unit 1) and a reply carrying words 1..9.
GOLDEN_REQUESTS = [
    "01000c04ae756fd369ff0ad4507b1a1a97663e1a",
    "01000c048f82413bdc03a1f1baf447f7204f2943",
    "01000c04d1479f26d6d69d65569b7ec165234937",
]
GOLDEN_REPLY = "01001b0538383b88cde6aef4d9ed7b0586158fb0ba121420083fddb554f97aceec9d8a74"


class FakeSocket:
    """Replies with the bytes queued for it; `respond` (if given) queues a reply for each request."""

    def __init__(self, replies: bytes = b"", respond: object = None):
        self.buf = replies
        self.sent: list[bytes] = []
        self.respond = respond
        self.closed = False

    def sendall(self, data: bytes) -> None:
        self.sent.append(data)
        if callable(self.respond):
            self.buf += self.respond(data)

    def recv(self, n: int) -> bytes:
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def close(self) -> None:
        self.closed = True


def key_reply(key: bytes = PUBKEY) -> bytes:
    return b"\x00" * 9 + key


def encrypted_reply(words: list[int] | None, fc: int = 4) -> bytes:
    """A dongle reply: words, or a Modbus exception (illegal address) when None."""
    pdu = (
        bytes([fc | 0x80, 2]) if words is None else bytes([fc, 2 * len(words)]) + struct.pack(f">{len(words)}H", *words)
    )
    raw = struct.pack(">HHHB", 0x6868, 0, len(pdu) + 1, 1) + pdu
    pad = 16 - len(raw) % 16
    return bytes([1, 0, len(raw), pad]) + AES_KEY.encrypt(raw + b"\xff" * pad)


class Dongle:
    """An encrypting dongle answering every register with its protocol address, except `rejected`
    multi-register reads and `missing` addresses. Hands out a socket per connection."""

    def __init__(self, rejected: set[int] | None = None, missing: set[int] | None = None):
        self.rejected, self.missing = rejected or set(), missing or set()
        self.connections: list[FakeSocket] = []
        self.requests: list[tuple[int, int]] = []

    def respond(self, data: bytes) -> bytes:
        if data == GET_KEY:
            return key_reply()
        plain = AES_KEY.decrypt(data[4:])[: data[2]]
        assert plain[:2] == b"\x68\x68" and plain[7] == 4
        address, count = struct.unpack(">HH", plain[8:12])
        protocol = address + 1
        self.requests.append((protocol, count))
        span = range(protocol, protocol + count)
        if (count > 1 and protocol in self.rejected) or any(a in self.missing for a in span):
            return encrypted_reply(None)
        return encrypted_reply(list(span))

    def connect(self) -> FakeSocket:
        s = FakeSocket(respond=self.respond)
        self.connections.append(s)
        return s


def device_on(dongle: Dongle) -> SgDDevice:
    device = SgDDevice("10.0.0.2")
    device._connect = dongle.connect  # type: ignore[assignment, method-assign]
    return device


def test_requests_match_the_verified_implementation() -> None:
    sockets = [FakeSocket(key_reply()), FakeSocket(bytes.fromhex(GOLDEN_REPLY) + encrypted_reply([0] * 8)
                                                   + encrypted_reply([0] * 2))]  # fmt: skip
    device = SgDDevice("10.0.0.2")
    device._connect = lambda: sockets.pop(0)  # type: ignore[assignment, method-assign, return-value]
    handshake, conn = sockets
    device.read(include_info=False)
    assert handshake.sent == [GET_KEY] and handshake.closed
    assert [b.hex() for b in conn.sent] == GOLDEN_REQUESTS and conn.closed


def test_a_reply_decodes_to_raw_words() -> None:
    sockets = [FakeSocket(key_reply()), FakeSocket(bytes.fromhex(GOLDEN_REPLY) + encrypted_reply([10, 11] * 4)
                                                   + encrypted_reply([1234, 0]))]  # fmt: skip
    device = SgDDevice("10.0.0.2")
    device._connect = lambda: sockets.pop(0)  # type: ignore[assignment, method-assign, return-value]
    reading = device.read(include_info=False)
    assert [reading.input[a] for a in range(5000, 5009)] == list(range(1, 10))
    assert reading.input[5011] == 10 and reading.input[5018] == 11
    assert reading.input[5031] == 1234 and reading.input[5032] == 0
    assert reading.holding == {} and reading.info_input == {}


def test_every_range_is_read_by_protocol_address() -> None:
    dongle = Dongle()
    reading = device_on(dongle).read(include_info=False)
    assert dongle.requests == [(5000, 9), (5011, 8), (5031, 2)]
    assert set(reading.input) == {*range(5000, 5009), *range(5011, 5019), 5031, 5032}
    assert all(w == a for a, w in reading.input.items())


def test_the_key_is_fetched_once_a_day() -> None:
    dongle = Dongle()
    device = device_on(dongle)
    device.read(include_info=False)
    device.read(include_info=False)
    assert sum(GET_KEY in s.sent for s in dongle.connections) == 1


def test_a_rejected_range_falls_back_to_single_reads() -> None:
    dongle = Dongle(rejected={5011}, missing={5015})
    device = device_on(dongle)
    reading = device.read(include_info=False)
    assert dongle.requests == [(5000, 9), (5011, 8), *((a, 1) for a in range(5011, 5019)), (5031, 2)]
    assert 5015 not in reading.input and reading.input[5017] == 5017
    dongle.requests.clear()
    device.read(include_info=False)
    assert (5011, 8) not in dongle.requests  # remembered


def test_an_unencrypted_dongle_gets_plain_frames() -> None:
    def plain(data: bytes) -> bytes:
        if data == GET_KEY:
            return key_reply(b"\x00" * 16)
        tid, _, _, unit, fc, address, count = struct.unpack(">HHHBBHH", data)
        pdu = bytes([fc, 2 * count]) + struct.pack(f">{count}H", *range(address + 1, address + 1 + count))
        return struct.pack(">HHHB", tid, 0, len(pdu) + 1, unit) + pdu

    conns: list[FakeSocket] = []

    def connect() -> FakeSocket:
        conns.append(FakeSocket(respond=plain))
        return conns[-1]

    device = SgDDevice("10.0.0.2", unit=2)
    device._connect = connect  # type: ignore[assignment, method-assign]
    reading = device.read(include_info=False)
    assert conns[1].sent[0] == struct.pack(">HHHBBHH", 1, 0, 6, 2, 4, 4999, 9)
    assert reading.input[5000] == 5000 and reading.input[5032] == 5032


def test_an_error_forgets_the_key() -> None:
    sockets = [FakeSocket(key_reply()), FakeSocket(b"")]  # connected, then silence
    device = SgDDevice("10.0.0.2")
    device._connect = lambda: sockets.pop(0)  # type: ignore[assignment, method-assign, return-value]
    with pytest.raises(ConnectionError, match="didn't reply"):
        device.read(include_info=False)
    assert device._key_day is None


def test_a_garbled_reply_forgets_the_key() -> None:
    other = AES.new(b"0" * 16, AES.MODE_ECB)  # the dongle restarted with a new key
    reply = bytes([1, 0, 21, 11]) + other.encrypt(bytes(range(32)))
    sockets = [FakeSocket(key_reply()), FakeSocket(reply)]
    device = SgDDevice("10.0.0.2")
    device._connect = lambda: sockets.pop(0)  # type: ignore[assignment, method-assign, return-value]
    with pytest.raises(ConnectionError):
        device.read(include_info=False)
    assert device._key_day is None


def test_an_unreachable_dongle_is_a_connection_error() -> None:
    def refuse() -> FakeSocket:
        raise TimeoutError("timed out")

    device = SgDDevice("10.0.0.2")
    device._connect = refuse  # type: ignore[assignment, method-assign]
    with pytest.raises(ConnectionError, match="timed out"):
        device.read(include_info=False)
