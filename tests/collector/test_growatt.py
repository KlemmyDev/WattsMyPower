"""Reading a Growatt: from Growatt's cloud (against a stand-in for its server), or through an RS485 adapter (against a
fake Modbus client); and connecting one through the collector's API."""

from __future__ import annotations

import json
import threading
import urllib.parse
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest
from fastapi.testclient import TestClient

from collector.config import Config
from collector.devices import DeviceConfig, Values
from collector.devices.growatt import cloud
from collector.devices.growatt.cloud import CloudDevice, hash_password
from collector.devices.growatt.inverter import TlDevice, TlxDevice
from collector.main import create_app
from tests.collector.test_devices import AUTH, fake

GOOD = hash_password("hunter2")
DETAIL = {"pac": "2412.5", "powerToday": "12.3", "powerTotal": "45678.9", "nominalPower": "5000", "junk": "x" * 100}


class Growatt:
    """A stand-in for Growatt's ShinePhone server: one account, one plant, a hybrid battery and a string inverter."""

    def __init__(self) -> None:
        self.asked: list[str] = []
        self.signed_in = False
        self.devices = [{"deviceSn": "BAT0000001", "deviceType": "storage"}, {"deviceSn": "AB12345678", "deviceType": "inverter"}]  # fmt: skip
        self.detail: dict[str, Any] = dict(DETAIL)

    def answer(self, method: str, path: str, form: dict[str, str]) -> Any:
        page, _, query = path.lstrip("/").partition("?")
        q = dict(urllib.parse.parse_qsl(query))
        self.asked.append(page if "op" not in q else f"{page}:{q['op']}")
        if page == "newTwoLoginAPI.do":
            self.signed_in = form == {"userName": "sam", "password": GOOD}
            return {
                "back": {"success": True, "user": {"id": 42}} if self.signed_in else {"success": False, "msg": "502"}
            }
        if not self.signed_in:
            return None  # the real one answers a signed-out request with its login page
        if page == "PlantListAPI.do" and q.get("userId") == "42":
            return {"back": {"data": [{"plantId": "7", "plantName": "Home"}]}}
        if page == "newTwoPlantAPI.do" and q.get("plantId") == "7":
            return {"deviceList": self.devices}
        if page == "newInverterAPI.do":
            return self.detail
        if page == "newTlxApi.do":
            return {"data": self.detail}
        return None


@pytest.fixture
def growatt(monkeypatch: pytest.MonkeyPatch) -> Iterator[Growatt]:
    server_state = Growatt()

    class Handler(BaseHTTPRequestHandler):
        def _reply(self, form: dict[str, str]) -> None:
            body = server_state.answer(self.command, self.path, form)
            raw = json.dumps(body).encode() if body is not None else b"<html>Please sign in</html>"
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self) -> None:
            self._reply({})

        def do_POST(self) -> None:
            n = int(self.headers.get("Content-Length") or 0)
            self._reply(dict(urllib.parse.parse_qsl(self.rfile.read(n).decode())))

        def log_message(self, *args: Any) -> None:
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}/"
    real = CloudDevice._url

    def local(self: CloudDevice, page: str, query: Any = None) -> str:
        return real(self, page, query).replace(
            f"https://{self.host}/", base
        )  # still refuses a host that isn't Growatt's

    monkeypatch.setattr(CloudDevice, "_url", local)
    yield server_state
    httpd.shutdown()


SIGN_IN = {"username": "sam", "password_hash": GOOD}


def test_it_signs_in_finds_the_string_inverter_and_keeps_the_figures_the_dashboard_reads(growatt: Growatt) -> None:
    device = CloudDevice("openapi-au.growatt.com", SIGN_IN)
    r = device.read(include_info=False)
    assert {k: v for k, v in r.input.items() if k != "fetched_at"} == {
        "pac": "2412.5", "powerToday": "12.3", "powerTotal": "45678.9", "nominalPower": "5000",
        "sn": "AB12345678", "type": "inverter",
    }  # fmt: skip
    assert growatt.asked == [
        "newTwoLoginAPI.do", "PlantListAPI.do", "newTwoPlantAPI.do:getAllDeviceList",
        "newInverterAPI.do:getInverterDetailData",
    ]  # fmt: skip


def test_growatt_is_asked_at_most_every_five_minutes(growatt: Growatt) -> None:
    device = CloudDevice("openapi-au.growatt.com", SIGN_IN)
    first = device.read(include_info=False)
    growatt.detail["pac"] = "100.0"
    assert device.read(include_info=False).input == first.input  # the last answer again, with when it was fetched
    assert growatt.asked.count("newInverterAPI.do:getInverterDetailData") == 1
    device._last = {**first.input, "fetched_at": int(first.input["fetched_at"]) - cloud.EVERY}  # five minutes on
    assert device.read(include_info=False).input["pac"] == "100.0"
    assert growatt.asked.count("newTwoLoginAPI.do") == 1  # still signed in


def test_a_lapsed_session_signs_in_again(growatt: Growatt) -> None:
    device = CloudDevice("openapi-au.growatt.com", SIGN_IN, every=0)
    device.read(include_info=False)
    growatt.signed_in = False  # Growatt dropped the session
    assert device.read(include_info=False).input["pac"] == "2412.5"
    assert growatt.asked.count("newTwoLoginAPI.do") == 2


def test_a_newer_inverters_figures_come_from_its_own_page(growatt: Growatt) -> None:
    growatt.devices = [{"deviceSn": "MIN0000001", "deviceType": "tlx"}]
    r = CloudDevice("openapi-au.growatt.com", SIGN_IN).read(include_info=False)
    assert r.input["sn"] == "MIN0000001" and r.input["type"] == "tlx" and r.input["pac"] == "2412.5"


def test_the_inverter_asked_for_by_its_serial(growatt: Growatt) -> None:
    growatt.devices.insert(0, {"deviceSn": "OTHER00001", "deviceType": "inverter"})
    r = CloudDevice("openapi-au.growatt.com", {**SIGN_IN, "serial": "AB12345678"}).read(include_info=False)
    assert r.input["sn"] == "AB12345678"


def test_a_wrong_password_isnt_connected_and_isnt_tried_again_straight_away(growatt: Growatt) -> None:
    bad = {"username": "sam", "password_hash": hash_password("nope")}
    assert CloudDevice("openapi-au.growatt.com", bad).probe() is None
    device = CloudDevice("openapi-au.growatt.com", bad)
    with pytest.raises(cloud.SignInFailed):
        device.read(include_info=False)
    asked = len(growatt.asked)
    with pytest.raises(ConnectionError, match="Waiting"):
        device.read(include_info=False)  # the next poll leaves Growatt alone
    assert len(growatt.asked) == asked


def test_only_growatts_own_servers_are_asked() -> None:
    with pytest.raises(ConnectionError, match="isn't one of Growatt's servers"):
        CloudDevice("evil.example.com", SIGN_IN).read(include_info=False)


# -- through an RS485 adapter ----------------------------------------------------------------------------------------


class Result:
    def __init__(self, registers: list[int] | None):
        self.registers = registers or []

    def isError(self) -> bool:
        return not self.registers


def modbus_client(input_limit: int, made: list[dict[str, Any]]) -> type:
    """A fake pymodbus client for a Growatt that answers input registers below `input_limit` and its identity."""
    serial = b"AB12345678"

    class Client:
        def __init__(self, host: str, *, port: int, framer: Any, timeout: float, retries: int):
            made.append({"port": port, "framer": framer})

        def connect(self) -> bool:
            return True

        def close(self) -> None:
            pass

        def read_input_registers(self, address: int, *, count: int = 1, slave: int = 1) -> Result:
            return Result([a % 7 for a in range(address, address + count)] if address + count <= input_limit else None)

        def read_holding_registers(self, address: int, *, count: int = 1, slave: int = 1) -> Result:
            words = [0] * 30
            words[23:28] = [int.from_bytes(serial[i : i + 2], "big") for i in range(0, 10, 2)]
            return Result(words[address : address + count])

    return Client


def test_an_adapter_on_502_takes_modbus_tcp_and_any_other_port_rtu_frames() -> None:
    made: list[dict[str, Any]] = []
    TlDevice("192.168.0.60", 502, 1, client_cls=modbus_client(45, made)).read(include_info=False)
    TlDevice("192.168.0.60", 8899, 1, client_cls=modbus_client(45, made)).read(include_info=False)
    assert [m["framer"].value for m in made] == ["socket", "rtu"]


def test_a_probe_tells_the_older_and_newer_growatts_apart() -> None:
    older, newer = modbus_client(45, []), modbus_client(125, [])
    assert TlxDevice("192.168.0.60", client_cls=older).probe() is None  # it doesn't answer past 44
    assert TlDevice("192.168.0.60", client_cls=older).probe() is not None
    found = TlxDevice("192.168.0.60", client_cls=newer).probe()
    assert found is not None and found[23] == int.from_bytes(b"AB", "big")


def test_each_poll_reads_its_readings_and_identity() -> None:
    r = TlxDevice("192.168.0.60", client_cls=modbus_client(125, [])).read(include_info=False)
    assert set(r.input) == set(range(125)) and set(r.holding) == set(range(30))


# -- connecting through the collector's API --------------------------------------------------------------------------


@pytest.fixture
def client(cfg: Config) -> Iterator[TestClient]:
    def check(d: DeviceConfig) -> Values | None:
        return {"sn": "AB12345678"} if d.settings.get("password_hash") == GOOD else None

    with TestClient(create_app(cfg, poll=False, build=fake, check=check)) as c:
        yield c


def test_a_cloud_inverter_connects_to_growatts_server_not_the_home_network(client: TestClient) -> None:
    body = {"driver": "growatt.cloud", "host": "openapi-au.growatt.com", "port": 443, "settings": SIGN_IN}
    r = client.put("/v1/devices/pv2", json=body, headers=AUTH)
    assert r.status_code == 200, r.text  # a public server, but the one it's meant to be
    r = client.put("/v1/devices/pv2", json={**body, "settings": {**SIGN_IN, "password_hash": "x"}}, headers=AUTH)
    assert r.status_code == 422 and "sign in" in r.json()["detail"]  # a changed sign-in is checked again
    r = client.put("/v1/devices/pv2", json={**body, "host": "192.168.0.10"}, headers=AUTH)
    assert r.status_code == 422 and "isn't one of the servers" in r.json()["detail"]


def test_a_scan_never_looks_for_a_cloud_inverter(cfg: Config) -> None:
    with TestClient(create_app(cfg, poll=False, build=fake)) as c:
        assert 443 not in c.app.state.scanner.ports  # type: ignore[attr-defined]
