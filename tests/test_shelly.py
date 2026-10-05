"""Shelly plugs and relays on the home network: finding them, reading Gen1 and Gen2 devices, their passwords (Basic and
Digest), switching, and connecting them through the dashboard. The Shellys are fakes that answer as the devices do:
nothing here touches the network."""

from __future__ import annotations

import base64
import hashlib
import json
import urllib.error
import urllib.parse
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.home.integrations.shelly import Shelly
from app.features.home.integrations.shelly.channels import gen2
from app.features.home.integrations.shelly.client import challenge, digest
from app.features.home.integrations.shelly.discovery import parse
from app.features.home.service import HomeService, HomeSetupError
from app.features.home.types import Hints, IntegrationError

NET = Hints(network="192.168.0.0/24")
FORM = {"where": "", "password": ""}

Answer = tuple[int, dict[str, str], bytes]


def _json(status: int, body: Any, headers: dict[str, str] | None = None) -> Answer:
    return status, headers or {}, json.dumps(body).encode()


class Gen2:
    """A fake Plus or Pro: /shelly, Shelly.GetStatus and GetConfig, Switch.Set, and Digest auth when it has a
    password."""

    def __init__(self, host: str, mac: str, app: str = "Plus2PM", name: str | None = "Laundry",
                 switches: int = 2, password: str | None = None, measures: bool = True):  # fmt: skip
        self.host, self.mac, self.app, self.name, self.password = host, mac, app, name, password
        self.on = [True] * switches
        self.power = [480.5, 0.0][:switches] + [0.0] * max(0, switches - 2)
        self.wh = [123_456.0] * switches
        self.channel_names: dict[int, str | None] = {0: "Washer"}
        self.measures = measures
        self.realm = f"shelly{app.lower()}-{mac.lower()}"

    def __call__(self, path: str, headers: dict[str, str]) -> Answer:
        if path == "/shelly":
            return _json(200, {"name": self.name, "id": self.realm, "mac": self.mac, "model": "SNSW-102P16EU",
                               "gen": 2, "app": self.app, "auth_en": self.password is not None})  # fmt: skip
        if self.password is not None and not self._authorised(path, headers.get("Authorization", "")):
            return _json(401, {"code": 401, "message": "Unauthorized"}, {"www-authenticate": (
                f'Digest qop="auth", realm="{self.realm}", nonce="1700000000", algorithm=SHA-256')})  # fmt: skip
        url = urllib.parse.urlsplit(path)
        q = dict(urllib.parse.parse_qsl(url.query))
        if url.path == "/rpc/Shelly.GetStatus":
            status: dict[str, Any] = {"sys": {"uptime": 100}, "wifi": {"rssi": -60}}
            for n, on in enumerate(self.on):
                status[f"switch:{n}"] = {"id": n, "output": on, "temperature": {"tC": 40}} | (
                    {"apower": self.power[n], "aenergy": {"total": self.wh[n], "by_minute": [0, 0, 0]}}
                    if self.measures else {}
                )  # fmt: skip
            return _json(200, status)
        if url.path == "/rpc/Shelly.GetConfig":
            config: dict[str, Any] = {"sys": {"device": {"name": self.name, "mac": self.mac}}}
            for n in range(len(self.on)):
                config[f"switch:{n}"] = {"id": n, "name": self.channel_names.get(n)}
            return _json(200, config)
        if url.path == "/rpc/Switch.Set":
            n = int(q["id"])
            if n >= len(self.on):
                return _json(404, {"code": -105, "message": f"Argument 'id', value {n} not found!"})
            was, self.on[n] = self.on[n], q["on"] == "true"
            return _json(200, {"was_on": was})
        return _json(404, {"code": 404, "message": "No handler"})

    def _authorised(self, path: str, header: str) -> bool:
        scheme, p = challenge(header)
        if (
            scheme != "digest"
            or p.get("username") != "admin"
            or p.get("uri") != path
            or p.get("algorithm") != "SHA-256"
        ):
            return False

        def h(s: str) -> str:
            return hashlib.sha256(s.encode()).hexdigest()

        ha1, ha2 = h(f"admin:{self.realm}:{self.password}"), h(f"GET:{path}")
        return p.get("response") == h(f"{ha1}:1700000000:{p.get('nc')}:{p.get('cnonce')}:auth:{ha2}")


class Gen1:
    """A fake Gen1 device (a Plug S, or an EM with clamps): /shelly, /status, /settings, /relay/N, and Basic auth
    when it has a password."""

    def __init__(self, host: str, mac: str, type: str = "SHPLG-S", name: str | None = "Fridge plug",
                 password: str | None = None, emeters: bool = False):  # fmt: skip
        self.host, self.mac, self.type, self.name, self.password = host, mac, type, name, password
        self.on = True
        self.watt_minutes = 600_000  # 10 kWh
        self.emeters = emeters

    def __call__(self, path: str, headers: dict[str, str]) -> Answer:
        if path == "/shelly":
            return _json(200, {"type": self.type, "mac": self.mac, "auth": self.password is not None, "fw": "x"})
        if self.password is not None:
            expected = "Basic " + base64.b64encode(f"admin:{self.password}".encode()).decode()
            if headers.get("Authorization") != expected:
                return 401, {"www-authenticate": 'Basic realm="Shelly"'}, b"401 Unauthorized"
        url = urllib.parse.urlsplit(path)
        if url.path == "/status":
            if self.emeters:
                return _json(200, {"relays": [{"ison": self.on}], "emeters": [
                    {"power": 1500.0, "total": 2_500_000.0, "is_valid": True},
                    {"power": 0, "total": 0, "is_valid": False},
                ]})  # fmt: skip
            return _json(200, {"relays": [{"ison": self.on}],
                               "meters": [{"power": 85.25 if self.on else 0, "total": self.watt_minutes, "is_valid": True}]})  # fmt: skip
        if url.path == "/settings":
            return _json(200, {"name": self.name, "relays": [{"name": None}], "emeters": [{"name": "Hot water"}]})
        if url.path == "/relay/0":
            self.on = dict(urllib.parse.parse_qsl(url.query))["turn"] == "on"
            return _json(200, {"ison": self.on})
        return 404, {}, b"Not Found"


class Network:
    """The home network: Shellys by address, and every request made of it."""

    def __init__(self, *devices: Gen1 | Gen2):
        self.devices: dict[str, Gen1 | Gen2] = {d.host: d for d in devices}
        self.asked: list[str] = []

    def get(self, url: str, headers: dict[str, str], timeout: float) -> Answer:
        parts = urllib.parse.urlsplit(url)
        device = self.devices.get(parts.hostname or "")
        if device is None:
            raise urllib.error.URLError("timed out")
        path = parts.path + (f"?{parts.query}" if parts.query else "")
        self.asked.append(f"{parts.hostname}{path}")
        return device(path, headers)


@pytest.fixture
def lan(monkeypatch: pytest.MonkeyPatch) -> Network:
    net = Network(Gen2("192.168.0.31", "A8032AB10001"), Gen1("192.168.0.32", "C45BBE000002"))
    monkeypatch.setattr(Shelly, "get", staticmethod(net.get))
    return net


# -- the protocol ------------------------------------------------------------------------------------------
def test_digest_answers_as_rfc_7616_says() -> None:
    # RFC 7616 section 3.9.1, SHA-256.
    params = {"realm": "http-auth@example.org", "qop": "auth, auth-int", "algorithm": "SHA-256",
              "nonce": "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
              "opaque": "FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"}  # fmt: skip
    header = digest(params, "Circle of Life", "GET", "/dir/index.html",
                    "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ", user="Mufasa")  # fmt: skip
    _, answer = challenge(header)
    assert answer["response"] == "753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"
    assert answer["qop"] == "auth" and answer["nc"] == "00000001" and answer["opaque"] == params["opaque"]


def test_what_answers_to_shelly_is_told_apart() -> None:
    gen2_answer = {"id": "shellyplugsg3-x", "mac": "a8:03:2a:b1:00:01", "gen": 3, "app": "PlugSG3", "auth_en": True,
                   "name": None}  # fmt: skip
    found = parse(gen2_answer, "192.168.0.5")
    assert found is not None and (found.mac, found.gen, found.model, found.auth, found.name) == (
        "A8032AB10001", 3, "PlugSG3", True, None)  # fmt: skip
    found = parse({"type": "SHSW-25", "mac": "C45BBE000002", "auth": False}, "192.168.0.6")
    assert found is not None and (found.gen, found.model) == (1, "SHSW-25")
    assert parse({"mac": "x"}, "h") is None and parse("<html>", "h") is None and parse({"gen": 2}, "h") is None


def test_gen2_channels_include_meters_and_clamps_but_not_a_switch_that_doesnt_measure() -> None:
    status = {
        "switch:0": {"output": True},  # a Pro EM's contactor relay: no power of its own
        "em1:0": {"act_power": 2210.4},
        "em1data:0": {"total_act_energy": 5_000_000.0},
        "em1:1": {"act_power": 12.0},
        "em1data:1": {"total_act_energy": 1000.0},
        "pm1:0": {"apower": 3.5, "aenergy": {"total": 50.0}},
    }
    name, channels = gen2(status, {"sys": {"device": {"name": "Meter box"}}, "em1:0": {"name": "Hot water"}})
    assert name == "Meter box"
    assert [(c.id, c.name, c.power_w, c.energy_kwh, c.switch) for c in channels] == [
        ("pm0", None, 3.5, 0.05, False),
        ("em0", "Hot water", 2210.4, 5000.0, False),
        ("em1", None, 12.0, 1.0, False),
    ]


# -- finding and connecting ----------------------------------------------------------------------------------
def test_connecting_finds_every_shelly_that_measures(lan: Network) -> None:
    lan.devices["192.168.0.40"] = Gen2("192.168.0.40", "A8032AB10003", app="Plus1", measures=False, switches=1)
    saved = Shelly.sign_in(FORM, NET)
    assert set(saved["devices"]) == {"A8032AB10001", "C45BBE000002"}  # the Plus 1 doesn't measure
    assert saved["devices"]["A8032AB10001"] == {
        "host": "192.168.0.31",
        "gen": 2,
        "model": "Plus2PM",
        "name": "Laundry",
        "channels": {"0": {"name": "Washer", "switch": True}, "1": {"name": "Laundry (2)", "switch": True}},
    }
    assert saved["where"] == "192.168.0.0/24" and "password" not in saved
    assert Shelly(saved).label() == "2 Shellys on 192.168.0.0/24"


def test_addresses_given_by_hand_are_where_it_looks(lan: Network) -> None:
    saved = Shelly.sign_in({**FORM, "where": "192.168.0.32"}, NET)
    assert set(saved["devices"]) == {"C45BBE000002"}
    assert all(a.startswith("192.168.0.32/") for a in lan.asked)


@pytest.mark.parametrize(
    ("setup", "says"),
    [
        ("nothing", "No Shellys answered on 192.168.0.0/24"),
        ("no_power", "don't measure power"),
    ],
)
def test_when_no_shellys_can_be_read_it_says_why(lan: Network, setup: str, says: str) -> None:
    lan.devices.clear()
    if setup == "no_power":
        lan.devices["192.168.0.40"] = Gen2("192.168.0.40", "A8032AB10003", app="Plus1", measures=False, switches=1)
    with pytest.raises(IntegrationError, match=says) as e:
        Shelly.sign_in(FORM, NET)
    assert not e.value.signed_out
    with pytest.raises(IntegrationError, match="isn't a network"):
        Shelly.sign_in({**FORM, "where": "kitchen"}, NET)


# -- reading ---------------------------------------------------------------------------------------------
def test_a_gen2_shelly_is_read_channel_by_channel(lan: Network) -> None:
    shelly = Shelly(Shelly.sign_in(FORM, NET))
    by_key = {r.key: r for r in shelly.poll()}
    washer, second = by_key["A8032AB10001:0"], by_key["A8032AB10001:1"]
    assert (washer.name, washer.kind, washer.model, washer.power_w, washer.energy_kwh, washer.counter) == (
        "Washer", "plug", "Plus2PM", 480.5, pytest.approx(123.456), "total")  # fmt: skip
    assert washer.switched_on is True and second.name == "Laundry (2)" and second.power_w == 0.0
    assert washer.raw["switch:0"]["apower"] == 480.5


def test_a_gen1_shelly_counts_in_watt_minutes(lan: Network) -> None:
    shelly = Shelly(Shelly.sign_in(FORM, NET))
    plug = {r.key: r for r in shelly.poll()}["C45BBE000002:0"]
    assert (plug.name, plug.model, plug.power_w, plug.switched_on) == ("Fridge plug", "SHPLG-S", 85.25, True)
    assert plug.energy_kwh == pytest.approx(10.0) and plug.counter == "total"  # 600,000 watt-minutes


def test_a_gen1_em_reads_its_clamps_in_wh(lan: Network) -> None:
    lan.devices = {"192.168.0.50": Gen1("192.168.0.50", "C45BBE000050", type="SHEM", name="Meter box", emeters=True)}
    shelly = Shelly(Shelly.sign_in(FORM, NET))
    [clamp] = shelly.poll()  # the second clamp isn't connected (is_valid false)
    assert (clamp.key, clamp.name, clamp.power_w, clamp.energy_kwh) == ("C45BBE000050:em0", "Hot water", 1500.0, 2500.0)
    with pytest.raises(IntegrationError, match="only measures"):
        shelly.switch("C45BBE000050:em0", False)


def test_a_shelly_that_moved_is_found_again_and_one_gone_is_offline(lan: Network) -> None:
    shelly = Shelly(Shelly.sign_in(FORM, NET))
    moved = lan.devices.pop("192.168.0.32")
    moved.host = "192.168.0.77"
    lan.devices[moved.host] = moved
    # Too soon after finding them to look again: it's offline.
    assert {r.key: r.online for r in shelly.poll()}["C45BBE000002:0"] is False
    shelly.saved = {**shelly.saved, "found_at": 0}
    readings = {r.key: r for r in shelly.poll()}
    assert readings["C45BBE000002:0"].online and readings["C45BBE000002:0"].power_w == 85.25
    assert shelly.saved["devices"]["C45BBE000002"]["host"] == "192.168.0.77"


# -- passwords -----------------------------------------------------------------------------------------------
def test_a_gen2_shelly_with_a_password_is_read_with_digest(lan: Network) -> None:
    lan.devices = {"192.168.0.31": Gen2("192.168.0.31", "A8032AB10001", password="s3cret")}
    with pytest.raises(IntegrationError, match="protected by a password") as e:
        Shelly.sign_in(FORM, NET)
    assert e.value.signed_out
    with pytest.raises(IntegrationError, match="not to that password") as e:
        Shelly.sign_in({**FORM, "password": "wrong"}, NET)
    assert e.value.signed_out
    saved = Shelly.sign_in({**FORM, "password": "s3cret"}, NET)
    assert saved["password"] == "s3cret"
    assert {r.key: r.power_w for r in Shelly(saved).poll()}["A8032AB10001:0"] == 480.5


def test_a_gen1_shelly_with_a_password_is_read_with_basic_auth(lan: Network) -> None:
    lan.devices = {"192.168.0.32": Gen1("192.168.0.32", "C45BBE000002", password="s3cret")}
    shelly = Shelly(Shelly.sign_in({**FORM, "password": "s3cret"}, NET))
    assert shelly.poll()[0].power_w == 85.25
    shelly.switch("C45BBE000002:0", False)
    assert lan.devices["192.168.0.32"].on is False


def test_a_changed_password_asks_to_sign_in_again(lan: Network) -> None:
    lan.devices = {"192.168.0.31": Gen2("192.168.0.31", "A8032AB10001", password="s3cret")}
    shelly = Shelly(Shelly.sign_in({**FORM, "password": "s3cret"}, NET))
    lan.devices["192.168.0.31"].password = "changed"
    with pytest.raises(IntegrationError, match="Sign in again") as e:
        shelly.poll()
    assert e.value.signed_out


# -- switching -------------------------------------------------------------------------------------------
def test_both_generations_are_switched(lan: Network) -> None:
    shelly = Shelly(Shelly.sign_in(FORM, NET))
    shelly.switch("A8032AB10001:1", False)
    gen2_device, gen1_device = lan.devices["192.168.0.31"], lan.devices["192.168.0.32"]
    assert isinstance(gen2_device, Gen2) and gen2_device.on == [True, False]
    assert "192.168.0.31/rpc/Switch.Set?id=1&on=false" in lan.asked
    shelly.switch("C45BBE000002:0", False)
    assert gen1_device.on is False and "192.168.0.32/relay/0?turn=off" in lan.asked
    shelly.switch("C45BBE000002:0", True)
    assert gen1_device.on is True
    with pytest.raises(IntegrationError, match="isn't on this account"):
        shelly.switch("FFFFFFFFFFFF:0", True)
    lan.devices.pop("192.168.0.31")
    with pytest.raises(IntegrationError, match="Washer couldn't be switched on"):
        shelly.switch("A8032AB10001:0", True)


# -- through the dashboard -------------------------------------------------------------------------------
def test_shellys_through_the_dashboard(lan: Network, db: Database, config: Config) -> None:
    clock = {"t": 1_790_000_000.0}
    home = HomeService(config, db, {"shelly": Shelly}, clock=lambda: clock["t"])
    view = home.connect("shelly", {}, NET)  # nothing entered: it looks on the home network, without a password
    assert view["integrations"][0]["account"]["label"] == "2 Shellys on 192.168.0.0/24"
    washer = lan.devices["192.168.0.31"]
    assert isinstance(washer, Gen2)
    for n in range(3):  # every 20 seconds, 10 Wh each time
        clock["t"] = 1_790_000_000 + n * 20
        washer.wh[0] = 123_456.0 + n * 10
        home.poll(home.repo.accounts()[0].id)
    devices = {d["name"]: d for d in home.overview()["devices"]}
    assert set(devices) == {"Washer", "Laundry (2)", "Fridge plug"}
    assert devices["Washer"]["now"]["power_w"] == 480.5 and devices["Washer"]["can_switch"]
    assert sum(kwh for _, d, kwh in home.repo.energy(0, 2**40) if d == devices["Washer"]["id"]) == pytest.approx(0.02)
    home.switch(devices["Fridge plug"]["id"], False)
    assert next(d for d in home.overview()["devices"] if d["name"] == "Fridge plug")["now"]["switched_on"] is False

    lan.devices["192.168.0.33"] = Gen1("192.168.0.33", "C45BBE000003", name="Kettle")
    found = home.find("shelly")["found"]
    assert found == {"new": 1, "answered": 3, "message": "Found 1 new device."}


def test_a_shelly_that_cant_be_switched_says_so(lan: Network, db: Database, config: Config) -> None:
    home = HomeService(config, db, {"shelly": Shelly}, clock=lambda: 1_790_000_000.0)
    home.connect("shelly", FORM, NET)
    home.poll(home.repo.accounts()[0].id)
    washer = next(d for d in home.overview()["devices"] if d["name"] == "Washer")
    lan.devices.pop("192.168.0.31")
    with pytest.raises(HomeSetupError, match="couldn't be switched off") as e:
        home.switch(washer["id"], False)
    assert e.value.status == 502
