"""The hybrid's Modbus reads, against a fake pymodbus client."""

from __future__ import annotations

from typing import Any

import pytest
from pymodbus.exceptions import ModbusIOException

from collector.devices.sungrow.sh_rs import BLOCKS, ShRsDevice


class Result:
    def __init__(self, registers: list[int] | None):
        self.registers = registers or []
        self._error = registers is None

    def isError(self) -> bool:
        return self._error


class FakeClient:
    """Answers every register with (communication address + 1) % 65536, i.e. its protocol address.

    `rejected`: communication addresses whose multi-register reads are refused (as a block holding
    an illegal address is). `missing`: addresses refused even one at a time.
    """

    requests: list[tuple[str, int, int, int]]
    rejected: set[int]
    missing: set[int]
    connects = True
    raise_on: int | None = None
    closed = 0

    def __init__(self, host: str, *, port: int, timeout: float, retries: int):
        self.host, self.port = host, port

    def connect(self) -> bool:
        return self.connects

    def close(self) -> None:
        type(self).closed += 1

    def _answer(self, kind: str, address: int, count: int, unit: int) -> Result:
        self.requests.append((kind, address, count, unit))
        if address == self.raise_on:
            raise ModbusIOException("no response")
        span = range(address, address + count)
        if (count > 1 and address in self.rejected) or any(a in self.missing for a in span):
            return Result(None)
        return Result([(a + 1) % 65536 for a in span])

    def read_input_registers(self, address: int, *, count: int = 1, slave: int = 1) -> Result:
        return self._answer("input", address, count, slave)

    def read_holding_registers(self, address: int, *, count: int = 1, slave: int = 1) -> Result:
        return self._answer("holding", address, count, slave)


def fake_client(**attrs: Any) -> type[FakeClient]:
    defaults: dict[str, Any] = {"requests": [], "rejected": set(), "missing": set(), "closed": 0}
    return type("Client", (FakeClient,), {**defaults, **attrs})


def test_blocks_are_read_at_the_address_minus_one() -> None:
    client = fake_client()
    reading = ShRsDevice("10.0.0.1", unit=3, client_cls=client).read(include_info=False)
    assert client.requests == [("input", 5007, 29, 3), ("input", 12999, 41, 3), ("input", 13040, 2, 3),
                               ("input", 13044, 3, 3)]  # fmt: skip
    expected = {a for start, count in BLOCKS for a in range(start, start + count)}
    assert set(reading.input) == expected
    assert all(w == a for a, w in reading.input.items())  # keyed by protocol address
    assert reading.holding == {} and reading.info_input == {} and client.closed == 1


def test_info_reads_input_and_holding_registers() -> None:
    client = fake_client()
    reading = ShRsDevice("10.0.0.1", client_cls=client).read(include_info=True)
    assert client.requests[:4] == [("input", 4989, 10, 1), ("input", 4999, 3, 1), ("input", 5638, 1, 1),
                                   ("holding", 13058, 1, 1)]  # fmt: skip
    assert set(reading.info_input) == {*range(4990, 5000), 5000, 5001, 5002, 5639}
    assert reading.holding == reading.info_holding == {13059: 13059}
    assert reading.input[4990] == 4990 and reading.input[13045] == 13045  # info words are part of the row


def test_a_rejected_block_falls_back_to_single_reads_and_is_remembered() -> None:
    client = fake_client(rejected={5007}, missing={5014})  # 5015 can't be read at all
    device = ShRsDevice("10.0.0.1", client_cls=client)
    reading = device.read(include_info=False)
    singles = [r for r in client.requests if r[1] < 5100 and r[2] == 1]
    assert client.requests[0] == ("input", 5007, 29, 1)
    assert [r[1] for r in singles] == list(range(5007, 5036))
    assert 5015 not in reading.input and reading.input[5016] == 5016 and reading.input[5036] == 5036

    client.requests.clear()
    device.read(include_info=False)
    assert ("input", 5007, 29, 1) not in client.requests  # straight to single reads
    assert ("input", 12999, 41, 1) in client.requests


def test_the_unit_id_kwarg_follows_the_pymodbus_version() -> None:
    class NewClient(fake_client()):  # type: ignore[misc]
        def read_input_registers(self, address: int, *, count: int = 1, device_id: int = 1) -> Result:
            return self._answer("input", address, count, device_id)

    reading = ShRsDevice("10.0.0.1", unit=7, client_cls=NewClient).read(include_info=False)
    assert NewClient.requests[0] == ("input", 5007, 29, 7) and reading.input


def test_no_host_is_a_connection_error() -> None:
    with pytest.raises(ConnectionError, match="Settings → Integrations"):
        ShRsDevice("", client_cls=fake_client()).read(include_info=False)


def test_an_unreachable_inverter_is_a_connection_error() -> None:
    with pytest.raises(ConnectionError, match="Could not connect"):
        ShRsDevice("10.0.0.1", client_cls=fake_client(connects=False)).read(include_info=False)


def test_a_timeout_mid_read_is_a_connection_error_and_closes_the_client() -> None:
    client = fake_client(raise_on=12999)
    with pytest.raises(ConnectionError, match="no response"):
        ShRsDevice("10.0.0.1", client_cls=client).read(include_info=False)
    assert client.closed == 1


def test_no_words_at_all_is_a_connection_error() -> None:
    client = fake_client(missing=set(range(4000, 14000)))
    with pytest.raises(ConnectionError, match="no data"):
        ShRsDevice("10.0.0.1", client_cls=client).read(include_info=False)
