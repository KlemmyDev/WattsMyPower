"""TP-Link Tapo plugs on the home network: KLAP (checked against python-kasa's), finding plugs, reading them, and
connecting them through the dashboard. The plugs are fakes that speak the device's side of KLAP: nothing here touches
the network."""

from __future__ import annotations

import base64
import binascii
import json
import secrets
import struct
import urllib.error
from collections.abc import Iterator
from typing import Any

import pytest
from Cryptodome.Cipher import AES
from Cryptodome.Util.Padding import pad

from app.core.config import Config
from app.core.database import Database
from app.features.home.integrations.tapo import Tapo, discovery
from app.features.home.integrations.tapo.discovery import Found, WhereError, addresses, parse, probe
from app.features.home.integrations.tapo.klap import (
    FALLBACK_HASHES,
    KlapClient,
    KlapError,
    Session,
    _cookies,
    _sha256,
    auth_hash,
    forget_sessions,
)
from app.features.home.service import HomeService, HomeSetupError
from app.features.home.types import Hints, IntegrationError

EMAIL, PASSWORD = "Me@Example.com", "hunter22"
MINE = auth_hash(EMAIL, PASSWORD)
FORM = {"email": EMAIL, "password": PASSWORD, "where": ""}
NET = Hints(network="192.168.0.0/24")


class Plug:
    """A fake Tapo device: the device's side of KLAP, and enough of its methods."""

    def __init__(
        self,
        host: str,
        device_id: str,
        owner: bytes = MINE,
        name: str = "Lounge TV",
        model: str = "P110",
        power_mw: int | None = 110_000,
        today_wh: int = 420,
        on: bool = True,
        energy: bool = True,
        current_power_w: int | None = None,
    ):
        self.host, self.device_id, self.owner = host, device_id, owner
        self.name, self.model, self.on, self.energy = name, model, on, energy
        self.power_mw, self.today_wh, self.current_power_w = power_mw, today_wh, current_power_w
        self.pending: dict[str, tuple[bytes, bytes]] = {}
        self.sessions: dict[str, Session] = {}
        self.handshakes = 0
        self.calls: list[str] = []

    def restart(self) -> None:
        """Forget every session, as a device does when it restarts."""
        self.sessions.clear()

    def __call__(self, path: str, body: bytes, headers: dict[str, str]) -> tuple[int, list[str], bytes]:
        if not path.startswith("/app/"):
            return 404, [], b""  # KLAP firmware doesn't speak TPAP
        path = path.removeprefix("/app/")
        cookie = headers.get("Cookie", "").removeprefix("TP_SESSIONID=")
        if path == "handshake1":
            self.handshakes += 1
            remote, cookie = secrets.token_bytes(16), secrets.token_hex(8)
            self.pending[cookie] = (body, remote)
            return 200, [f"TP_SESSIONID={cookie};TIMEOUT=86400"], remote + _sha256(body, remote, self.owner)
        if path == "handshake2":
            local, remote = self.pending.pop(cookie)
            if body != _sha256(remote, local, self.owner):
                return 403, [], b""
            self.sessions[cookie] = Session.derive(local, remote, self.owner, cookie, 0)
            return 200, [], b""
        seq = int(path.split("seq=")[1])
        s = self.sessions.get(cookie)
        if s is None:
            return 403, [], b""
        assert body[:32] == _sha256(s.sig, seq.to_bytes(4, "big", signed=True), body[32:]), "bad signature"
        request = json.loads(s.decrypt(body, seq))
        self.calls.append(request["method"])
        reply = json.dumps(self.answer(request["method"], request.get("params"))).encode()
        cipher = AES.new(s.key, AES.MODE_CBC, s._iv(seq)).encrypt(pad(reply, 16))
        return 200, [], _sha256(s.sig, cipher) + cipher

    def answer(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if method == "set_device_info" and params and isinstance(params.get("device_on"), bool):
            self.on = params["device_on"]
            return {"error_code": 0}
        if method == "get_device_info":
            return {"error_code": 0, "result": {"device_id": self.device_id, "model": self.model, "device_on": self.on,
                    "nickname": base64.b64encode(self.name.encode()).decode(), "type": "SMART.TAPOPLUG"}}  # fmt: skip
        if method == "get_energy_usage" and self.energy:
            result: dict[str, Any] = {"today_energy": self.today_wh, "month_energy": 9000, "today_runtime": 60}
            if self.power_mw is not None:
                result["current_power"] = self.power_mw
            return {"error_code": 0, "result": result}
        if method == "get_current_power" and self.current_power_w is not None:
            return {"error_code": 0, "result": {"current_power": self.current_power_w}}
        return {"error_code": -1, "result": {}}

    def found(self, encrypt_type: str = "KLAP") -> Found:
        return Found(self.host, self.device_id, self.model, "SMART.TAPOPLUG", encrypt_type, 80)


class Network:
    """The home network: plugs by address, and what answers the discovery probe."""

    def __init__(self, *plugs: Plug):
        self.plugs = {p.host: p for p in plugs}
        self.old_firmware: list[Found] = []
        self.probed: list[list[str]] = []
        self.hidden: set[str] = set()  # plugs that don't answer the probe

    def post(self, url: str, body: bytes, headers: dict[str, str], timeout: float) -> tuple[int, list[str], bytes]:
        host = url.split("/")[2].split(":")[0]
        if host not in self.plugs:
            raise urllib.error.URLError("timed out")
        return self.plugs[host]("/" + url.split("/", 3)[3], body, headers)

    def find(self, hosts: list[str]) -> list[Found]:
        self.probed.append(hosts)
        return [p.found() for h, p in self.plugs.items() if h in hosts and h not in self.hidden] + [
            f for f in self.old_firmware if f.host in hosts
        ]


@pytest.fixture(autouse=True)
def fresh_sessions() -> Iterator[None]:
    forget_sessions()
    yield
    forget_sessions()


@pytest.fixture
def lan(monkeypatch: pytest.MonkeyPatch) -> Network:
    net = Network(Plug("192.168.0.21", "dev-tv"), Plug("192.168.0.22", "dev-fridge", name="Fridge", power_mw=95_500))
    monkeypatch.setattr(Tapo, "post", staticmethod(net.post))
    monkeypatch.setattr(Tapo, "finder", staticmethod(net.find))
    return net


# -- KLAP ------------------------------------------------------------------------------------------------
def test_klap_encrypts_exactly_as_python_kasa_does() -> None:
    # From python-kasa 0.11's KlapEncryptionSession, with these seeds and this account.
    s = Session.derive(bytes(range(16)), bytes(range(100, 116)), auth_hash("me@example.com", "hunter22"), "", 0)
    body, seq = s.encrypt(b'{"method":"get_device_info"}')
    assert seq == -293838618
    assert body.hex() == (
        "62314c8ef8fc003086a33e88f0f286456d84d6e2928e4eda32d5f847f27d53119231a5082c6175aa0323f97d1ddf8671"
        "510c4dcee2ff5a9a2fd9d2f44d6692db"
    )
    assert s.decrypt(body, seq) == b'{"method":"get_device_info"}'


def test_the_klap_hash_is_of_the_email_as_typed() -> None:
    assert len(MINE) == 32 and auth_hash(EMAIL.lower(), PASSWORD) != MINE  # the email is case-sensitive
    assert _cookies(["TP_SESSIONID=abc123;TIMEOUT=86400"]) == {"TP_SESSIONID": "abc123", "TIMEOUT": "86400"}
    assert _cookies(["TP_SESSIONID=abc", "TIMEOUT=3600; Path=/"]) == {"TP_SESSIONID": "abc", "TIMEOUT": "3600"}


def test_a_session_is_made_once_and_reused(lan: Network) -> None:
    plug = lan.plugs["192.168.0.21"]
    client = KlapClient(plug.host, [MINE], post=lan.post)
    assert client.request("get_device_info")["device_id"] == "dev-tv"
    KlapClient(plug.host, [MINE], post=lan.post).request("get_energy_usage")  # another client, the next poll
    assert plug.handshakes == 1 and plug.calls == ["get_device_info", "get_energy_usage"]


def test_a_lost_session_is_made_again_once(lan: Network) -> None:
    plug = lan.plugs["192.168.0.21"]
    KlapClient(plug.host, [MINE], post=lan.post).request("get_device_info")
    plug.restart()
    assert KlapClient(plug.host, [MINE], post=lan.post).request("get_device_info")["model"] == "P110"
    assert plug.handshakes == 2


def test_someone_elses_plug_is_refused_and_an_unclaimed_one_answers_to_the_fallback(lan: Network) -> None:
    lan.plugs["192.168.0.30"] = Plug("192.168.0.30", "dev-x", owner=auth_hash("them@example.com", "x"))
    with pytest.raises(KlapError) as e:
        KlapClient("192.168.0.30", [MINE], post=lan.post).request("get_device_info")
    assert e.value.refused
    lan.plugs["192.168.0.31"] = Plug("192.168.0.31", "dev-new", owner=FALLBACK_HASHES[0])  # not on any account yet
    assert KlapClient("192.168.0.31", [MINE], post=lan.post).request("get_device_info")["device_id"] == "dev-new"
    with pytest.raises(KlapError, match="didn't answer") as e:
        KlapClient("192.168.0.99", [MINE], post=lan.post).request("get_device_info")
    assert not e.value.refused


# -- finding plugs ---------------------------------------------------------------------------------------
def test_the_probe_is_a_valid_tdp_packet() -> None:
    packet = probe()
    version, kind, op, size, flags, _, _, crc = struct.unpack(">BBHHBBII", packet[:16])
    assert (version, kind, op, flags, size) == (2, 0, 1, 17, len(packet) - 16)
    assert "BEGIN PUBLIC KEY" in json.loads(packet[16:])["params"]["rsa_key"]
    unsigned = bytearray(packet)
    unsigned[12:16] = (0x5A6B7C8D).to_bytes(4, "big")
    assert binascii.crc32(unsigned) == crc


def test_an_answer_says_what_the_device_is() -> None:
    answer = {"error_code": 0, "result": {"device_id": "abc", "device_type": "SMART.TAPOPLUG", "device_model": "P110(AU)",
              "ip": "192.168.0.21", "mgt_encrypt_schm": {"encrypt_type": "KLAP", "http_port": 80}}}  # fmt: skip
    found = parse(b"\x02" * 16 + json.dumps(answer).encode(), "192.168.0.21")
    assert found == Found("192.168.0.21", "abc", "P110(AU)", "SMART.TAPOPLUG", "KLAP", 80)
    assert parse(b"\x02" * 16 + b"not json", "x") is None and parse(b"\x02" * 16 + b"{}", "x") is None


def test_where_to_look() -> None:
    hosts, named = addresses("192.168.1.0/24")
    assert len(hosts) == 254 and hosts[0] == "192.168.1.1" and named == []
    assert addresses("192.168.0.42, 192.168.0.43 192.168.0.42") == (["192.168.0.42", "192.168.0.43"],
                                                                  ["192.168.0.42", "192.168.0.43", "192.168.0.42"])  # fmt: skip
    for bad, says in [("8.8.8.0/24", "isn't a home network"), ("10.0.0.0/8", "bigger than a home network"),
                      ("1.1.1.1", "isn't an address on a home network"), ("plug", "isn't a network")]:  # fmt: skip
        with pytest.raises(WhereError, match=says):
            addresses(bad)


def test_discovery_probes_every_address_and_collects_the_answers() -> None:
    class Sock:
        def __init__(self) -> None:
            self.sent: list[tuple[str, int]] = []
            self.inbox = [(b"\x02" * 16 + json.dumps({"result": {"device_id": "a", "ip": "192.168.0.5",
                           "mgt_encrypt_schm": {"encrypt_type": "KLAP"}}}).encode(), ("192.168.0.5", 20002))]  # fmt: skip

        def sendto(self, data: bytes, address: tuple[str, int]) -> int:
            self.sent.append(address)
            return len(data)

        def recvfrom(self, size: int) -> tuple[bytes, Any]:
            if self.inbox:
                return self.inbox.pop()
            raise TimeoutError

        def settimeout(self, value: float | None) -> None: ...
        def close(self) -> None: ...

    sock = Sock()
    ticks = iter(range(100))
    found = discovery.discover(["192.168.0.5", "192.168.0.6"], wait=4, sock=lambda: sock, clock=lambda: next(ticks))
    assert [f.host for f in found] == ["192.168.0.5"]
    assert sock.sent.count(("192.168.0.5", 20002)) == 2 and ("255.255.255.255", 20002) in sock.sent


# -- connecting ------------------------------------------------------------------------------------------
def test_connecting_finds_the_plugs_that_are_yours_and_measure_energy(lan: Network) -> None:
    lan.plugs["192.168.0.30"] = Plug("192.168.0.30", "dev-x", owner=auth_hash("them@example.com", "x"))
    lan.plugs["192.168.0.40"] = Plug("192.168.0.40", "dev-p100", model="P100", energy=False)
    saved = Tapo.sign_in(FORM, NET)
    assert lan.probed[0][0] == "192.168.0.1" and len(lan.probed[0]) == 254  # the network it was given
    assert set(saved["plugs"]) == {"dev-tv", "dev-fridge"}
    assert saved["plugs"]["dev-tv"] == {"host": "192.168.0.21", "port": 80, "protocol": "klap", "model": "P110",
                                        "name": "Lounge TV"}  # fmt: skip
    assert saved["hash"] == base64.b64encode(MINE).decode() and saved["email"] == EMAIL
    assert saved["password"] == PASSWORD  # kept on the server: TPAP needs it


def test_addresses_given_by_hand_are_tried_even_without_answering_the_probe(lan: Network) -> None:
    lan.hidden = {"192.168.0.21", "192.168.0.22"}
    saved = Tapo.sign_in({**FORM, "where": "192.168.0.21"}, NET)
    assert set(saved["plugs"]) == {"dev-tv"} and lan.probed == [["192.168.0.21"]]


@pytest.mark.parametrize(
    ("setup", "says", "signed_out"),
    [
        ("nothing", "No Tapo plugs answered on 192.168.0.0/24", False),
        ("theirs", "not to that TP-Link ID and password", True),
        ("p100", "don't measure energy", False),
        ("old", "older firmware", False),
    ],
)
def test_when_no_plugs_can_be_read_it_says_why(lan: Network, setup: str, says: str, signed_out: bool) -> None:
    lan.plugs.clear()
    if setup == "theirs":
        lan.plugs["192.168.0.30"] = Plug("192.168.0.30", "dev-x", owner=auth_hash("them@example.com", "x"))
    if setup == "p100":
        lan.plugs["192.168.0.40"] = Plug("192.168.0.40", "dev-p100", model="P100", energy=False)
    if setup == "old":
        lan.old_firmware = [Found("192.168.0.50", "dev-old", "P110", "SMART.TAPOPLUG", "AES", 80)]
    with pytest.raises(IntegrationError, match=says) as e:
        Tapo.sign_in(FORM, NET)
    assert e.value.signed_out is signed_out
    with pytest.raises(IntegrationError, match="isn't a network"):
        Tapo.sign_in({**FORM, "where": "kitchen"}, NET)


# -- reading ---------------------------------------------------------------------------------------------
def test_a_poll_reads_each_plugs_power_and_todays_energy(lan: Network) -> None:
    lan.plugs["192.168.0.22"].on = False
    tapo = Tapo(Tapo.sign_in(FORM, NET))
    by_key = {r.key: r for r in tapo.poll()}
    tv, fridge = by_key["dev-tv"], by_key["dev-fridge"]
    assert (tv.name, tv.kind, tv.model, tv.power_w, tv.energy_kwh, tv.counter) == ("Lounge TV", "plug", "P110", 110.0,
                                                                                    0.42, "cycle")  # fmt: skip
    assert fridge.power_w == 0 and fridge.switched_on is False and tv.switched_on is True
    assert tv.raw["energy"]["current_power"] == 110_000


def test_firmware_without_current_power_in_the_energy_usage_asks_for_it(lan: Network) -> None:
    plug = lan.plugs["192.168.0.21"]
    plug.power_mw, plug.current_power_w = None, 37
    tapo = Tapo(Tapo.sign_in(FORM, NET))
    assert {r.key: r.power_w for r in tapo.poll()}["dev-tv"] == 37.0


def test_a_plug_that_moved_is_found_again_and_one_gone_is_offline(lan: Network) -> None:
    tapo = Tapo(Tapo.sign_in(FORM, NET))
    moved = lan.plugs.pop("192.168.0.21")
    moved.host = "192.168.0.77"
    lan.plugs[moved.host] = moved
    # Too soon after finding them to look again: it's offline.
    assert {r.key: r.online for r in tapo.poll()} == {"dev-tv": False, "dev-fridge": True}
    tapo.saved = {**tapo.saved, "found_at": 0}
    readings = {r.key: r for r in tapo.poll()}
    assert readings["dev-tv"].online and readings["dev-tv"].power_w == 110.0
    assert tapo.saved["plugs"]["dev-tv"]["host"] == "192.168.0.77" and tapo.saved["found_at"] > 0


def test_plugs_that_stop_accepting_the_account_ask_to_sign_in_again(lan: Network) -> None:
    tapo = Tapo(Tapo.sign_in(FORM, NET))
    for p in lan.plugs.values():
        p.owner = auth_hash(EMAIL, "a new password")
        p.restart()
    forget_sessions()
    with pytest.raises(IntegrationError, match="Sign in again") as e:
        tapo.poll()
    assert e.value.signed_out


# -- through the dashboard -------------------------------------------------------------------------------
def test_plugs_through_the_dashboard(lan: Network, db: Database, config: Config) -> None:
    clock = {"t": 1_790_000_000.0}
    home = HomeService(config, db, {"tapo": Tapo}, clock=lambda: clock["t"])
    with pytest.raises(HomeSetupError, match="Enter your password"):
        home.connect("tapo", {"email": EMAIL}, NET)
    view = home.connect("tapo", FORM, NET)  # "where" left empty: it looks where it's told the home network is
    account = view["integrations"][0]["account"]
    assert account["label"] == f"{EMAIL} · 2 plugs"
    assert PASSWORD not in json.dumps(view)  # kept on the server, never sent to the browser
    for n, wh in enumerate([420, 430, 445]):  # every 15 seconds
        clock["t"] = 1_790_000_000 + n * 15
        lan.plugs["192.168.0.21"].today_wh = wh
        home.poll(home.repo.accounts()[0].id)
    devices = {d["name"]: d for d in home.overview()["devices"]}
    assert devices["Lounge TV"]["kind"] == "plug" and devices["Lounge TV"]["now"]["power_w"] == 110.0
    tv = devices["Lounge TV"]["id"]
    assert sum(kwh for _, d, kwh in home.repo.energy(0, 2**40) if d == tv) == pytest.approx(0.025)


# -- looking for new plugs ---------------------------------------------------------------------------------
def test_looking_for_new_plugs_adds_one_set_up_since(lan: Network, db: Database, config: Config) -> None:
    home = HomeService(config, db, {"tapo": Tapo}, clock=lambda: 1_790_000_000.0)
    home.connect("tapo", FORM, NET)
    home.poll(home.repo.accounts()[0].id)
    assert len(home.overview()["devices"]) == 2
    # Every plug is answering, so a poll alone doesn't look for more.
    lan.plugs["192.168.0.23"] = Plug("192.168.0.23", "dev-kettle", name="Kettle", power_mw=2_000_000)
    home.poll(home.repo.accounts()[0].id)
    assert len(home.overview()["devices"]) == 2
    view = home.find("tapo")
    assert view["found"] == {"new": 1, "answered": 3, "message": "Found 1 new device."}
    kettle = next(d for d in view["devices"] if d["name"] == "Kettle")
    assert kettle["now"]["power_w"] == 2000.0  # read straight away
    assert home.find("tapo")["found"]["message"] == "No new devices: 3 answered, all already here."


def test_looking_for_new_plugs_needs_a_working_sign_in(lan: Network, db: Database, config: Config) -> None:
    home = HomeService(config, db, {"tapo": Tapo}, clock=lambda: 1_790_000_000.0)
    with pytest.raises(HomeSetupError) as e:
        home.find("tapo")
    assert e.value.status == 404
    home.connect("tapo", FORM, NET)
    for p in lan.plugs.values():
        p.owner = auth_hash(EMAIL, "a new password")
        p.restart()
    forget_sessions()
    with pytest.raises(HomeSetupError, match="Sign in again") as e:
        home.find("tapo")
    assert e.value.status == 422


# -- switching -------------------------------------------------------------------------------------------
def test_a_plug_is_switched_off_and_on(lan: Network, db: Database, config: Config) -> None:
    home = HomeService(config, db, {"tapo": Tapo}, clock=lambda: 1_790_000_000.0)
    home.connect("tapo", FORM, NET)
    home.poll(home.repo.accounts()[0].id)
    tv = next(d for d in home.overview()["devices"] if d["name"] == "Lounge TV")
    assert tv["can_switch"] and tv["now"]["switched_on"] is True
    view = home.switch(tv["id"], False)
    assert lan.plugs["192.168.0.21"].on is False
    assert next(d for d in view["devices"] if d["id"] == tv["id"])["now"]["switched_on"] is False  # read again
    home.switch(tv["id"], True)
    assert lan.plugs["192.168.0.21"].on is True
    with pytest.raises(HomeSetupError, match="on or off"):
        home.switch(tv["id"], "off")
    with pytest.raises(HomeSetupError) as e:
        home.switch(999, True)
    assert e.value.status == 404


def test_a_fridge_is_only_switched_off_when_thats_confirmed(lan: Network, db: Database, config: Config) -> None:
    home = HomeService(config, db, {"tapo": Tapo}, clock=lambda: 1_790_000_000.0)
    home.connect("tapo", FORM, NET)
    home.poll(home.repo.accounts()[0].id)
    fridge = next(d for d in home.overview()["devices"] if d["name"] == "Fridge")
    home.update_device(fridge["id"], {"kind": "fridge"})
    with pytest.raises(HomeSetupError, match="stops keeping food cold") as e:
        home.switch(fridge["id"], False)
    assert e.value.status == 409 and lan.plugs["192.168.0.22"].on is True
    home.switch(fridge["id"], False, confirm=True)
    assert lan.plugs["192.168.0.22"].on is False
    home.switch(fridge["id"], True)  # on needs no confirming
    assert lan.plugs["192.168.0.22"].on is True


def test_a_plug_that_cant_be_reached_says_so(lan: Network, db: Database, config: Config) -> None:
    home = HomeService(config, db, {"tapo": Tapo}, clock=lambda: 1_790_000_000.0)
    home.connect("tapo", FORM, NET)
    home.poll(home.repo.accounts()[0].id)
    tv = next(d for d in home.overview()["devices"] if d["name"] == "Lounge TV")
    lan.plugs.pop("192.168.0.21")
    with pytest.raises(HomeSetupError, match="couldn't be switched off") as e:
        home.switch(tv["id"], False)
    assert e.value.status == 502
