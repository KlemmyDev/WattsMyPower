"""EcoFlow power stations through the Developer API: signing, finding the keys' region, the three generations' keys,
switching outlets, and connecting through the dashboard. EcoFlow is a fake that checks every signature as the real API
does: nothing here touches the network."""

from __future__ import annotations

import hashlib
import hmac
import json
import urllib.error
import urllib.parse
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.home.integrations.ecoflow import EcoFlow
from app.features.home.integrations.ecoflow.client import flatten, signature
from app.features.home.integrations.ecoflow.models import MODELS, ac_command, model, station
from app.features.home.service import HomeService, HomeSetupError
from app.features.home.types import Hints, IntegrationError

KEY, SECRET = "Kabc123", "Sdef456"
FORM = {"access_key": KEY, "secret_key": SECRET}

RIVER2 = {"bms_bmsStatus.soc": 71, "pd.soc": 71, "inv.inputWatts": 0, "mppt.inWatts": 85, "pd.wattsInSum": 85,
          "pd.wattsOutSum": 60, "inv.outputWatts": 55, "mppt.cfgAcEnabled": 1, "pd.carState": 0}  # fmt: skip
DELTA_PRO = {"bmsMaster.soc": 40, "pd.soc": 40, "inv.inputWatts": 1200, "mppt.inWatts": 3000, "pd.wattsOutSum": 0,
             "inv.cfgAcEnabled": 0}  # fmt: skip
RIVER3 = {"bmsBattSoc": 55, "cmsBattSoc": 55, "powGetAcIn": 300, "powGetPv": 40, "powOutSumW": 20,
          "powGetAcOut": -20, "cfgAcOutOpen": True, "cfgDc12vOutOpen": False}  # fmt: skip


class Cloud:
    """A fake EcoFlow: one region where the keys work, the account's devices, what each reports, and the commands
    sent."""

    def __init__(self, region: str = "api-e.ecoflow.com"):
        self.region = region
        self.devices: list[dict[str, Any]] = []
        self.quotas: dict[str, dict[str, Any]] = {}
        self.commands: list[dict[str, Any]] = []
        self.down = False

    def add(self, sn: str, product: str, quota: dict[str, Any], online: bool = True, name: str | None = None) -> None:
        self.devices.append({"sn": sn, "deviceName": name or f"{product} {sn[-4:]}", "productName": product,
                             "online": int(online)})  # fmt: skip
        self.quotas[sn] = quota

    def __call__(self, method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Any:
        if self.down:
            raise urllib.error.URLError("unreachable")
        u = urllib.parse.urlsplit(url)
        query = dict(urllib.parse.parse_qsl(u.query))
        fields = sorted(query.items()) if body is None else flatten(json.loads(body))
        expected = signature(fields, KEY, SECRET, headers["nonce"], headers["timestamp"])
        if u.hostname != self.region or headers["accessKey"] != KEY or headers["sign"] != expected:
            return {"code": "8513", "message": "accessKey is invalid"}
        path = u.path.removeprefix("/iot-open/sign")
        if method == "GET" and path == "/device/list":
            return {"code": "0", "message": "Success", "data": self.devices}
        if method == "GET" and path == "/device/quota/all":
            if query["sn"] not in self.quotas:
                return {"code": "1006", "message": "device not found"}
            return {"code": "0", "message": "Success", "data": self.quotas[query["sn"]]}
        if method == "PUT" and path == "/device/quota":
            command = json.loads(body or b"{}")
            self.commands.append(command)
            return {"code": "0", "message": "Success"}
        return {"code": "404", "message": "no such endpoint"}


@pytest.fixture
def cloud(monkeypatch: pytest.MonkeyPatch) -> Cloud:
    c = Cloud()
    monkeypatch.setattr(EcoFlow, "transport", staticmethod(c))
    return c


# -- signing -------------------------------------------------------------------------------------------
def test_requests_are_signed_over_their_flattened_sorted_fields() -> None:
    body = {"sn": "R1", "params": {"enabled": 1, "list": [3, True]}, "id": 7}
    assert flatten(body) == [("sn", "R1"), ("params.enabled", "1"), ("params.list[0]", "3"),
                             ("params.list[1]", "true"), ("id", "7")]  # fmt: skip
    message = "id=7&params.enabled=1&params.list[0]=3&params.list[1]=true&sn=R1&accessKey=K&nonce=123456&timestamp=1"
    assert (
        signature(flatten(body), "K", "S", "123456", "1")
        == hmac.new(b"S", message.encode(), hashlib.sha256).hexdigest()
    )
    bare = "accessKey=K&nonce=1&timestamp=2"  # nothing to sign but who's asking
    assert signature([], "K", "S", "1", "2") == hmac.new(b"S", bare.encode(), hashlib.sha256).hexdigest()


# -- what each generation reports ----------------------------------------------------------------------
def test_each_generation_reads_as_a_portable_battery() -> None:
    river2 = station(MODELS["RIVER 2"], RIVER2)
    assert river2 is not None
    assert (river2.soc, river2.house_w, river2.solar_w, river2.output_w, river2.ac_on, river2.dc_on) == (
        71, 0, 85, 60, True, False)  # fmt: skip
    assert river2.capacity_kwh == 0.256
    pro = station(MODELS["DELTA Pro"], DELTA_PRO)
    assert pro is not None and pro.solar_w == 300 and pro.house_w == 1200 and pro.ac_on is False  # tenths of a watt
    river3 = station(MODELS["RIVER 3"], RIVER3)
    assert river3 is not None and (river3.soc, river3.house_w, river3.solar_w, river3.output_w) == (55, 300, 40, 20)
    assert river3.ac_on is True and river3.dc_on is False


def test_an_unlisted_product_is_read_by_its_keys_but_not_switched() -> None:
    m = model("RIVER 9 Turbo", RIVER3)
    assert m is not None and m.generation == 3 and m.capacity_kwh is None and m.outlets is None
    s = station(m, RIVER3)
    assert s is not None and s.soc == 55 and s.ac_on is None  # it can't be switched, so it doesn't say
    assert model("Smart Plug", {"2_1.watts": 120}) is None  # no charge: not a power station
    assert model("river 2", {}) == MODELS["RIVER 2"]  # names as EcoFlow writes them, whatever the capitals


def test_each_generation_switches_its_outlets_its_own_way() -> None:
    tcp = ac_command(MODELS["DELTA Pro"], "DP1", True)
    assert tcp and tcp["operateType"] == "TCP" and tcp["params"] == {"cmdSet": 32, "id": 66, "enabled": 1}
    gen2 = ac_command(MODELS["DELTA 2 Max"], "D2M", False)
    assert gen2 and (gen2["moduleType"], gen2["operateType"], gen2["params"]["enabled"]) == (3, "acOutCfg", 0)
    gen3 = ac_command(MODELS["RIVER 3"], "R3", True)
    assert gen3 and gen3["cmdId"] == 17 and gen3["params"] == {"cfgAcOutOpen": True}
    assert ac_command(MODELS["Delta Pro 3"], "DP3", True) is None


# -- connecting and reading ----------------------------------------------------------------------------
def test_connecting_finds_the_keys_region_and_the_power_stations(cloud: Cloud) -> None:
    cloud.add("R2A", "RIVER 2", RIVER2, name="Bedroom")
    cloud.add("R3B", "RIVER 9 Turbo", RIVER3)  # unlisted, but reports a charge
    cloud.add("SP1", "Smart Plug", {"2_1.watts": 12})
    cloud.add("D2C", "DELTA 2", {}, online=False)  # offline, but named as a station
    saved = EcoFlow.sign_in(FORM, Hints())
    assert saved["host"] == "api-e.ecoflow.com"  # tried the others first: the keys only work in Europe
    assert set(saved["stations"]) == {"R2A", "R3B", "D2C"}
    assert saved["stations"]["R2A"] == {"name": "Bedroom", "product": "RIVER 2"}
    assert EcoFlow(saved).label() == "3 stations · key ••••"


def test_connecting_says_what_went_wrong(cloud: Cloud) -> None:
    with pytest.raises(IntegrationError, match="didn't accept") as e:
        EcoFlow.sign_in({**FORM, "secret_key": "wrong"}, Hints())
    assert e.value.signed_out
    cloud.add("SP1", "Smart Plug", {"2_1.watts": 12})
    with pytest.raises(IntegrationError, match="no power stations"):
        EcoFlow.sign_in(FORM, Hints())
    cloud.down = True
    with pytest.raises(IntegrationError, match="couldn't be reached"):
        EcoFlow.sign_in(FORM, Hints())


def test_stations_are_read_and_an_offline_one_says_so(cloud: Cloud) -> None:
    cloud.add("R2A", "RIVER 2", RIVER2, name="Bedroom")
    cloud.add("DP1", "DELTA Pro", DELTA_PRO)
    ecoflow = EcoFlow(EcoFlow.sign_in(FORM, Hints()))
    cloud.quotas["DP1"] = {}  # offline: it reports nothing
    by_key = {r.key: r for r in ecoflow.poll()}
    bedroom = by_key["R2A"]
    assert (bedroom.name, bedroom.kind, bedroom.model, bedroom.power_w, bedroom.switched_on) == (
        "Bedroom", "power_station", "RIVER 2", 0, True)  # fmt: skip
    assert bedroom.battery and (bedroom.battery.soc, bedroom.battery.output_w) == (71, 60)
    assert bedroom.details == {"Battery": "71%", "Powering": "60 W", "Solar in": "85 W", "DC outlets": "Off"}
    assert bedroom.info["Region"] == "api-e.ecoflow.com" and bedroom.raw["pd.soc"] == 71
    assert not by_key["DP1"].online
    cloud.down = True
    with pytest.raises(IntegrationError, match="couldn't be reached"):
        ecoflow.poll()


def test_looking_again_adds_stations_new_to_the_account(cloud: Cloud) -> None:
    cloud.add("R2A", "RIVER 2", RIVER2)
    ecoflow = EcoFlow(EcoFlow.sign_in(FORM, Hints()))
    cloud.add("R3B", "RIVER 3", RIVER3)
    assert ecoflow.find() == (1, 2)
    assert {r.key for r in ecoflow.poll()} == {"R2A", "R3B"}


def test_switching_sends_the_models_command(cloud: Cloud) -> None:
    cloud.add("R3B", "RIVER 3", RIVER3)
    cloud.add("DP3", "Delta Pro 3", {"cmsBattSoc": 80, "powOutSumW": 0})
    ecoflow = EcoFlow(EcoFlow.sign_in(FORM, Hints()))
    ecoflow.switch("R3B", False)
    assert cloud.commands == [{"sn": "R3B", "cmdId": 17, "dirDest": 1, "dirSrc": 1, "cmdFunc": 254, "dest": 2,
                               "params": {"cfgAcOutOpen": False}}]  # fmt: skip
    with pytest.raises(IntegrationError, match="can't be switched from here yet"):
        ecoflow.switch("DP3", True)
    with pytest.raises(IntegrationError, match="isn't on the EcoFlow account"):
        ecoflow.switch("NOPE", True)


# -- through the dashboard -----------------------------------------------------------------------------
def test_a_connected_station_is_on_the_home_page_like_a_bluetti(cloud: Cloud, db: Database, config: Config) -> None:
    cloud.add("R2A", "RIVER 2", {**RIVER2, "inv.inputWatts": 250}, name="Bedroom")
    home = HomeService(config, db, {"ecoflow": EcoFlow})
    home.connect("ecoflow", FORM)
    home.poll_due()
    (device,) = home.overview()["devices"]
    assert device["kind"] == "power_station" and device["name"] == "Bedroom"
    assert device["now"]["power_w"] == 250  # charging from the house: its use
    assert device["now"]["battery"] == {"soc": 71, "capacity_kwh": 0.256, "solar_w": 85, "output_w": 60}
    with pytest.raises(HomeSetupError, match="smart plug"):
        home.set_rule(device["id"], {"start_w": 1000})
    home.switch(device["id"], False)
    assert cloud.commands[-1]["operateType"] == "acOutCfg" and cloud.commands[-1]["params"]["enabled"] == 0
