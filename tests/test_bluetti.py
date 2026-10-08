"""Bluetti power stations over Bluetooth: the Modbus frames, both register layouts, finding stations, reading them as
portable batteries, switching their outlets, and connecting them through the dashboard. The stations are fakes that
answer frames as the real ones do: nothing here touches Bluetooth."""

from __future__ import annotations

import asyncio
import struct

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.home.integrations.bluetti import Bluetti
from app.features.home.integrations.bluetti.protocol import (
    MODELS,
    ProtocolError,
    crc,
    identify,
    parse,
    read_request,
    write_request,
)
from app.features.home.integrations.bluetti.radio import RadioError, _answer
from app.features.home.service import HomeService, HomeSetupError
from app.features.home.types import Hints, IntegrationError

AC180 = "AC1802235000123456"
EB3A = "EB3A2237000654321"


class Station:
    """A fake station: registers it answers reads from, and writes into. An encrypted one only ever starts its
    handshake."""

    def __init__(self, registers: dict[int, int], encrypted: bool = False):
        self.registers = registers
        self.encrypted = encrypted
        self.asked: list[bytes] = []

    def answer(self, request: bytes) -> bytes:
        self.asked.append(request)
        if self.encrypted:
            return b"**" + bytes(8)
        assert request[-2:] == crc(request[:-2])
        unit, fn, address, n = struct.unpack(">BBHH", request[:6])
        if fn == 0x06:
            self.registers[address] = n
            return request
        if fn != 0x03 or address not in self.registers:  # an address it doesn't have: Modbus exception 2
            body = bytes([unit, fn | 0x80, 2])
            return body + crc(body)
        values = [self.registers.get(address + i, 0) for i in range(n)]
        body = struct.pack(f">BBB{n}H", unit, fn, 2 * n, *values)
        return body + crc(body)


def v2(soc: int = 64, ac_in: int = 0, dc_in: int = 120, ac_out: int = 85, dc_out: int = 5,
       ac: int = 1, dc: int = 0) -> dict[int, int]:  # fmt: skip
    return {102: soc, 140: dc_out, 142: ac_out, 144: dc_in, 146: ac_in, 2011: ac, 2012: dc}


def v1(soc: int = 90, ac_in: int = 300, dc_in: int = 0, ac_out: int = 0, dc_out: int = 0,
       ac: int = 0, dc: int = 1) -> dict[int, int]:  # fmt: skip
    return {36: dc_in, 37: ac_in, 38: ac_out, 39: dc_out, 43: soc, 3007: ac, 3008: dc}


class Air:
    """What this server's Bluetooth hears: stations by address, and other devices that only advertise."""

    def __init__(self) -> None:
        self.stations: dict[str, tuple[str, Station]] = {}
        self.others: list[tuple[str, str]] = []
        self.broken: str | None = None  # Bluetooth itself can't be used, and why

    def scan(self, seconds: float) -> list[tuple[str, str]]:
        if self.broken:
            raise RadioError(self.broken)
        return [(a, name) for a, (name, _) in self.stations.items()] + self.others

    def exchange(self, address: str, requests: list[bytes]) -> list[bytes]:
        if address not in self.stations:
            raise RadioError("It wasn't heard over Bluetooth: check it's switched on and in range of this server.")
        station = self.stations[address][1]
        answers = [station.answer(r) for r in requests]
        if answers and answers[0].startswith(b"**"):
            raise RadioError("It encrypts its Bluetooth.", encrypted=True)
        return answers


@pytest.fixture
def air(monkeypatch: pytest.MonkeyPatch) -> Air:
    a = Air()
    monkeypatch.setattr(Bluetti, "radio", a)
    return a


# -- the frames ----------------------------------------------------------------------------------------
def test_frames_carry_a_modbus_crc() -> None:
    assert read_request(0, 10).hex() == "01030000000ac5cd"  # the textbook example
    request = write_request(2011, 1)
    assert request[:6] == bytes([1, 6, 0x07, 0xDB, 0, 1]) and request[-2:] == crc(request[:-2])


def test_answers_are_checked_before_theyre_read() -> None:
    request = read_request(140, 2)
    good = Station({140: 5, 141: 7}).answer(request)
    assert parse(request, good) == [5, 7]
    with pytest.raises(ProtocolError, match="corrupted"):
        parse(request, good[:-1] + bytes([good[-1] ^ 1]))
    with pytest.raises(ProtocolError, match="exception 2"):
        parse(read_request(9999, 1), Station({}).answer(read_request(9999, 1)))
    with pytest.raises(ProtocolError, match="encrypted"):
        parse(request, b"**" + bytes(8))


def test_a_stations_name_says_its_model_and_serial() -> None:
    assert identify(AC180) == ("AC180", "2235000123456")
    assert identify("AC180P2235000123456") == ("AC180P", "2235000123456")  # not an AC180
    assert identify("EL100V22340000111222") == ("EL100V2", "2340000111222")
    assert identify("EP6002240000111222") is None  # a home system: not read yet
    assert identify("Living room speaker") is None and identify(None) is None


def test_an_answer_in_pieces_is_put_back_together() -> None:
    request = read_request(140, 8)
    whole = Station(v2()).answer(request)

    async def arrive(pieces: list[bytes]) -> bytes:
        buffer, arrived = bytearray(), asyncio.Event()
        loop = asyncio.get_running_loop()
        for n, piece in enumerate(pieces):
            loop.call_later(0.01 * (n + 1), lambda p=piece: (buffer.extend(p), arrived.set()))
        return await _answer(request, buffer, arrived)

    assert asyncio.run(arrive([whole[:20], whole[20:]])) == whole
    with pytest.raises(RadioError) as e:
        asyncio.run(arrive([b"**\x01\x02", bytes(10)]))
    assert e.value.encrypted


# -- connecting and reading ----------------------------------------------------------------------------
def test_connecting_keeps_every_station_that_answers(air: Air) -> None:
    air.stations["AA:01"] = (AC180, Station(v2()))
    air.stations["AA:02"] = (EB3A, Station(v1()))
    air.others = [("AA:03", "Living room speaker"), ("AA:04", "EP6002240000111222")]
    saved = Bluetti.sign_in({"address": ""}, Hints())
    assert set(saved["stations"]) == {AC180, EB3A}
    assert saved["stations"][AC180] == {"address": "AA:01", "model": "AC180", "serial": "2235000123456"}
    assert Bluetti(saved).label() == "2 stations over Bluetooth"
    just_one = Bluetti.sign_in({"address": "aa:02"}, Hints())  # an address given: only that one
    assert list(just_one["stations"]) == [EB3A]


def test_connecting_says_why_nothing_was_found(air: Air) -> None:
    with pytest.raises(IntegrationError, match="No Bluetti was heard nearby"):
        Bluetti.sign_in({}, Hints())
    air.others = [("AA:04", "EP6002240000111222")]
    with pytest.raises(IntegrationError, match="can't be read yet"):
        Bluetti.sign_in({}, Hints())
    air.broken = "This server's Bluetooth can't be used (no adapter)."
    with pytest.raises(IntegrationError, match="no adapter"):
        Bluetti.sign_in({}, Hints())


def test_an_encrypted_station_is_refused_in_words(air: Air) -> None:
    air.stations["AA:01"] = (AC180, Station(v2(), encrypted=True))
    with pytest.raises(IntegrationError, match=r"encrypts its Bluetooth.*Bluetooth password"):
        Bluetti.sign_in({}, Hints())
    air.stations["AA:02"] = (EB3A, Station(v1()))  # one that can be read is kept; the encrypted one isn't
    assert list(Bluetti.sign_in({}, Hints())["stations"]) == [EB3A]


def test_a_station_reads_as_a_portable_battery(air: Air) -> None:
    air.stations["AA:01"] = (AC180, Station(v2(soc=64, ac_in=0, dc_in=120, ac_out=85, dc_out=5, ac=1, dc=0)))
    air.stations["AA:02"] = (EB3A, Station(v1(soc=90, ac_in=300, ac=0, dc=1)))
    by_key = {r.key: r for r in Bluetti(Bluetti.sign_in({}, Hints())).poll()}
    ac180, eb3a = by_key[AC180], by_key[EB3A]
    assert (ac180.kind, ac180.model, ac180.name) == ("power_station", "AC180", "Bluetti AC180")
    assert ac180.power_w == 0 and ac180.switched_on is True  # not charging from the house; its AC outlets on
    assert ac180.battery is not None
    assert (ac180.battery.soc, ac180.battery.capacity_kwh, ac180.battery.solar_w, ac180.battery.output_w) == (
        64, 1.152, 120, 90)  # fmt: skip
    assert ac180.details == {"Battery": "64%", "Powering": "90 W", "Solar in": "120 W", "DC outlets": "Off"}
    assert ac180.info["Register layout"] == "V2" and ac180.raw["2011"] == 1
    # The older layout: charging from the wall at 300 W, which is its use.
    assert eb3a.power_w == 300 and eb3a.switched_on is False and eb3a.battery and eb3a.battery.soc == 90
    assert eb3a.battery.capacity_kwh == 0.268


def test_a_station_that_doesnt_answer_is_offline_and_all_of_them_is_an_error(air: Air) -> None:
    air.stations["AA:01"] = (AC180, Station(v2()))
    air.stations["AA:02"] = (EB3A, Station(v1()))
    bluetti = Bluetti(Bluetti.sign_in({}, Hints()))
    del air.stations["AA:02"]
    by_key = {r.key: r for r in bluetti.poll()}
    assert by_key[AC180].online and not by_key[EB3A].online
    del air.stations["AA:01"]
    with pytest.raises(IntegrationError, match="couldn't be read: It wasn't heard"):
        bluetti.poll()


def test_looking_again_adds_new_stations_and_follows_moved_ones(air: Air) -> None:
    air.stations["AA:01"] = (AC180, Station(v2()))
    bluetti = Bluetti(Bluetti.sign_in({}, Hints()))
    air.stations = {"BB:01": (AC180, air.stations["AA:01"][1]), "AA:02": (EB3A, Station(v1()))}
    assert bluetti.find() == (1, 2)
    assert bluetti.saved["stations"][AC180]["address"] == "BB:01"
    assert {r.key for r in bluetti.poll() if r.online} == {AC180, EB3A}


def test_switching_a_station_switches_its_ac_outlets(air: Air) -> None:
    ac180, eb3a = Station(v2(ac=1)), Station(v1(ac=0))
    air.stations = {"AA:01": (AC180, ac180), "AA:02": (EB3A, eb3a)}
    bluetti = Bluetti(Bluetti.sign_in({}, Hints()))
    bluetti.switch(AC180, False)
    bluetti.switch(EB3A, True)
    assert ac180.registers[2011] == 0 and eb3a.registers[3007] == 1
    assert ac180.asked[-1] == write_request(2011, 0)
    with pytest.raises(IntegrationError, match="isn't connected"):
        bluetti.switch("AC1809999999999", True)


def test_a_station_whose_outlets_cant_be_switched_says_so(air: Air) -> None:
    assert not MODELS["AP300"].outlets
    air.stations["AA:01"] = ("AP3002300000111222", Station({102: 50, 140: 0, 141: 0, 142: 0, 143: 0, 144: 0,
                                                            145: 0, 146: 0}))  # fmt: skip
    bluetti = Bluetti(Bluetti.sign_in({}, Hints()))
    (reading,) = bluetti.poll()
    assert reading.switched_on is None and reading.battery and reading.battery.capacity_kwh == 2.765
    with pytest.raises(IntegrationError, match="can't be switched over Bluetooth yet"):
        bluetti.switch("AP3002300000111222", False)


# -- through the dashboard -----------------------------------------------------------------------------
def test_a_connected_station_is_on_the_home_page_with_its_battery(air: Air, db: Database, config: Config) -> None:
    air.stations["AA:01"] = (AC180, Station(v2(soc=64, ac_in=410)))
    home = HomeService(config, db, {"bluetti": Bluetti})
    home.connect("bluetti", {})
    home.poll_due()
    (device,) = home.overview()["devices"]
    assert device["kind"] == "power_station" and device["can_switch"]
    assert device["now"]["power_w"] == 410  # charging from the house: its use
    assert device["now"]["battery"] == {"soc": 64, "capacity_kwh": 1.152, "solar_w": 120, "output_w": 90}
    with pytest.raises(HomeSetupError, match="smart plug"):  # its switch is its outlets: no spare-solar rule
        home.set_rule(device["id"], {"start_w": 1000})
    home.switch(device["id"], False)
    assert air.stations["AA:01"][1].registers[2011] == 0
    assert home.overview()["devices"][0]["now"]["switched_on"] is False
