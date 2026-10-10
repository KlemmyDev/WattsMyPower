"""Fronius' Solar API, read from a fake inverter on localhost serving real responses (tests/fixtures/fronius)."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from collector.devices.fronius import solar_api
from collector.devices.fronius.solar_api import InverterDevice, SiteDevice

FIXTURES = Path(__file__).parent.parent / "fixtures" / "fronius"


@pytest.fixture(autouse=True)
def no_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(solar_api, "GAP", 0.0)


Serve = Callable[[str], tuple[int, list[str]]]


@pytest.fixture
def fronius() -> Iterator[Serve]:
    """A fake Fronius answering from one fixture folder: (port, the paths asked for)."""
    servers: list[ThreadingHTTPServer] = []

    def start(site: str, missing: tuple[str, ...] = ()) -> tuple[int, list[str]]:
        asked: list[str] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                asked.append(self.path)
                name = self.path.split("/")[-1].split(".")[0]
                if "GetInverterRealtimeData" in self.path:
                    name = "GetInverterRealtimeData_Device_1"
                file = FIXTURES / site / f"{name}.json"
                if name in missing or not file.exists():
                    self.send_response(404)
                    self.end_headers()
                    return
                body = file.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript")  # as a Datamanager labels it
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: object) -> None:
                pass

        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        servers.append(srv)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv.server_address[1], asked

    yield start
    for s in servers:
        s.shutdown()
        s.server_close()


def test_a_gen24_with_a_battery_is_read(fronius: Serve) -> None:
    port, _ = fronius("gen24_storage")
    r = SiteDevice("127.0.0.1", port).read(include_info=True)
    v = r.input
    assert v["flow.P_Grid"] == 2274.9 and v["flow.P_Akku"] == pytest.approx(0.159, abs=1e-3)
    assert v["flow.inverter.SOC"] == 4.6 and "flow.E_Day" not in v  # null on a GEN24: left out
    assert v["meter.EnergyReal_WAC_Plus_Absolute"] == 1247204.0
    assert v["inverter.UDC_2"] == pytest.approx(318.81, abs=0.01) and "inverter.UDC_3" not in v
    assert v["inverter.DeviceStatus.StatusCode"] == 7
    assert v["storage.Capacity_Maximum"] == 16588 and v["storage.Temperature_Cell"] == 21.5
    assert r.info_input == {"info.DT": 1, "info.PVPower": 13930, "info.UniqueID": "12345678", "info.CustomName": "Gen24 Storage"}  # fmt: skip
    assert len(json.dumps(v)) < 1500  # about a Sungrow row's size, info included


def test_a_symo_without_a_battery_stops_asking_for_one(fronius: Serve) -> None:
    port, asked = fronius("symo")
    device = SiteDevice("127.0.0.1", port)
    first = device.read(include_info=False)
    assert first.input["flow.P_PV"] == 1111 and first.input["flow.E_Day"] == pytest.approx(1101.7, abs=0.01)
    assert not any(k.startswith("storage.") for k in first.input)  # it says "not supported" (code 255)
    asked.clear()
    device.read(include_info=False)
    assert not any("Storage" in p for p in asked)


def test_probes(fronius: Serve) -> None:
    port, _ = fronius("gen24_storage")
    found = SiteDevice("127.0.0.1", port).probe()
    assert found is not None and found["info.DT"] == 1 and found["flow.Mode"] == "bidirectional"
    assert InverterDevice("127.0.0.1", port).probe() == {
        "info.DT": 1, "info.PVPower": 13930, "info.UniqueID": "12345678", "info.CustomName": "Gen24 Storage",
    }  # fmt: skip
    off, _ = fronius("gen24_storage", missing=("GetAPIVersion",))  # its Solar API turned off
    assert SiteDevice("127.0.0.1", off).probe() is None


def test_a_second_fronius_comes_with_its_info(fronius: Serve) -> None:
    port, _ = fronius("symo")
    r = InverterDevice("127.0.0.1", port).read(include_info=False)
    assert r.input["inverter.PAC"] == 1190 and r.input["inverter.DAY_ENERGY"] == 1113 and r.input["info.DT"] == 121


def test_nothing_there() -> None:
    with pytest.raises(ConnectionError):
        SiteDevice("127.0.0.1", 9, timeout=0.5).read(include_info=False)
