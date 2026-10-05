"""Home Assistant through its REST API: signing in, which of its entities are a device (and which aren't), what each
is doing, switching, and connecting it through the dashboard. Home Assistant is a fake that answers as its API does:
nothing here touches the network."""

from __future__ import annotations

import json
import re
import ssl
import urllib.error
from email.message import Message
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.home.integrations.homeassistant import HomeAssistant, address
from app.features.home.integrations.homeassistant.entities import base, devices, kind, reading
from app.features.home.service import HomeService, HomeSetupError
from app.features.home.types import Hints, IntegrationError

URL, TOKEN = "http://homeassistant.local:8123", "eyJhbGciOiJIUzI1NiJ9.token"
FORM = {"url": URL, "token": TOKEN}


def sensor(object_id: str, state: Any, unit: str, device_class: str, name: str | None = None,
           state_class: str | None = None, **attrs: Any) -> dict[str, Any]:  # fmt: skip
    if state_class is None:
        state_class = "measurement" if device_class == "power" else "total_increasing"
    return {
        "entity_id": f"sensor.{object_id}",
        "state": str(state),
        "attributes": {
            "unit_of_measurement": unit,
            "device_class": device_class,
            "state_class": state_class,
            "friendly_name": name or object_id.replace("_", " ").title(),
            **attrs,
        },
    }


def switch(object_id: str, state: str, name: str | None = None) -> dict[str, Any]:
    return {"entity_id": f"switch.{object_id}", "state": state, "attributes": {"friendly_name": name or object_id}}


def states() -> list[dict[str, Any]]:
    return [
        # A TP-Link plug in Home Assistant: power, today's energy, a lifetime counter, and its switch.
        sensor("washing_machine_current_consumption", 512.3, "W", "power", "Washing Machine Current consumption"),
        sensor("washing_machine_today_s_consumption", 0.4, "kWh", "energy", "Washing Machine Today's consumption"),
        sensor("washing_machine_total_consumption", 321.5, "kWh", "energy", "Washing Machine Total consumption"),
        switch("washing_machine", "on", "Washing Machine"),
        # A fridge on a plug that only has energy, in Wh, and power in kW.
        sensor("kitchen_fridge_energy", 45_000, "Wh", "energy", "Kitchen Fridge Energy"),
        sensor("kitchen_fridge_power", 0.085, "kW", "power", "Kitchen Fridge Power"),
        # Only a daily counter, which starts over.
        sensor(
            "dishwasher_energy_today",
            1.2,
            "kWh",
            "energy",
            "Dishwasher energy today",
            state_class="total",
            last_reset="2026-10-05T00:00:00+10:00",
        ),
        # Gone from the network.
        sensor("garage_freezer_power", "unavailable", "W", "power", "Garage Freezer Power"),
        sensor("garage_freezer_energy", "unavailable", "kWh", "energy", "Garage Freezer Energy"),
        switch("garage_freezer", "unavailable"),
        # The whole home, the grid and the solar: the inverter measures those already.
        sensor("grid_import_power", 1200, "W", "power"),
        sensor("solar_production", 3.2, "kW", "power"),
        sensor("house_consumption_energy", 5000, "kWh", "energy"),
        sensor("home_power", 900, "W", "power"),
        sensor("sigen_pv_energy", 12, "MWh", "energy"),
        # Not power or energy, or not a counter.
        sensor("lounge_temperature", 21.5, "°C", "temperature"),
        sensor("heater_energy_rate", 3, "kWh", "energy", state_class="measurement"),
        switch("christmas_lights", "off"),
        {"entity_id": "light.lounge", "state": "on", "attributes": {}},
    ]


class FakeHA:
    """Home Assistant's REST API, as far as this uses it."""

    def __init__(self) -> None:
        self.states = states()
        self.token = TOKEN
        self.calls: list[tuple[str, str, Any]] = []

    def __call__(self, method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Any:
        if not url.startswith(URL):
            raise urllib.error.URLError(OSError("Name or service not known"))
        path = url.removeprefix(URL)
        self.calls.append((method, path, json.loads(body) if body else None))
        if headers.get("Authorization") != f"Bearer {self.token}":
            raise urllib.error.HTTPError(url, 401, "Unauthorized", Message(), None)
        if (method, path) == ("GET", "/api/"):
            return {"message": "API running."}
        if (method, path) == ("GET", "/api/states"):
            return self.states
        if method == "POST" and path.startswith("/api/services/switch/"):
            entity = next(s for s in self.states if s["entity_id"] == json.loads(body or b"{}")["entity_id"])
            entity["state"] = "on" if path.endswith("turn_on") else "off"
            return [entity]
        raise urllib.error.HTTPError(url, 404, "Not Found", Message(), None)


@pytest.fixture
def ha(monkeypatch: pytest.MonkeyPatch) -> FakeHA:
    fake = FakeHA()
    monkeypatch.setattr(HomeAssistant, "transport", staticmethod(fake))
    return fake


# -- signing in ------------------------------------------------------------------------------------------
def test_signing_in_checks_the_address_and_token(ha: FakeHA) -> None:
    saved = HomeAssistant.sign_in(FORM, Hints())
    assert saved == {"url": URL, "token": TOKEN}
    assert ha.calls[0] == ("GET", "/api/", None)
    assert HomeAssistant(saved).label() == "homeassistant.local"


def test_a_wrong_token_asks_for_a_new_one(ha: FakeHA) -> None:
    with pytest.raises(IntegrationError, match="didn't accept the access token") as e:
        HomeAssistant.sign_in({**FORM, "token": "nope"}, Hints())
    assert e.value.signed_out


def test_an_address_that_isnt_home_assistant_says_so(ha: FakeHA, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(IntegrationError, match=re.escape("didn't answer at http://nas.local:8123")) as e:
        HomeAssistant.sign_in({**FORM, "url": "nas.local:8123"}, Hints())
    assert not e.value.signed_out
    with pytest.raises(IntegrationError, match="isn't an address"):
        HomeAssistant.sign_in({**FORM, "url": "http://"}, Hints())

    def not_json(*_: Any) -> Any:
        raise json.JSONDecodeError("Expecting value", "<html>", 0)

    monkeypatch.setattr(HomeAssistant, "transport", staticmethod(not_json))
    with pytest.raises(IntegrationError, match="isn't Home Assistant"):
        HomeAssistant.sign_in(FORM, Hints())

    def untrusted(*_: Any) -> Any:
        raise urllib.error.URLError(ssl.SSLCertVerificationError("self-signed certificate"))

    monkeypatch.setattr(HomeAssistant, "transport", staticmethod(untrusted))
    with pytest.raises(IntegrationError, match="certificate"):
        HomeAssistant.sign_in({**FORM, "url": "https://ha.local"}, Hints())


def test_addresses_are_tidied() -> None:
    assert address("homeassistant.local:8123") == URL
    assert address(" http://192.168.0.5:8123/api/ ") == "http://192.168.0.5:8123"
    assert address("https://ha.example.com/") == "https://ha.example.com"
    for bad in ("", "ftp://ha.local", "http://ha.local:port"):
        with pytest.raises(IntegrationError, match="isn't an address"):
            address(bad)


def test_signing_in_with_nothing_to_read_says_so(ha: FakeHA) -> None:
    ha.states = [s for s in ha.states if "grid" in s["entity_id"] or s["entity_id"].startswith("switch.")]
    with pytest.raises(IntegrationError, match="no sensors measuring a single device"):
        HomeAssistant.sign_in(FORM, Hints())


# -- which entities are a device -----------------------------------------------------------------------------
def test_entities_are_put_together_by_name() -> None:
    assert base("washing_machine_current_consumption") == "washing_machine"
    assert base("washer_energy_total") == "washer"
    assert base("power") == "power"
    found = devices(states())
    assert set(found) == {"washing_machine", "kitchen_fridge", "dishwasher_energy_today", "garage_freezer"}
    washer = found["washing_machine"]
    assert washer.power is not None and washer.power["entity_id"] == "sensor.washing_machine_current_consumption"
    assert washer.switch is not None and washer.switch["entity_id"] == "switch.washing_machine"
    assert washer.energy is not None and washer.energy["entity_id"] == "sensor.washing_machine_total_consumption"


def test_what_each_device_is_doing() -> None:
    by_key = {r.key: r for r in map(reading, devices(states()).values())}
    washer = by_key["washing_machine"]
    assert (washer.name, washer.kind, washer.power_w, washer.energy_kwh, washer.counter, washer.switched_on) == (
        "Washing Machine", "washer", 512.3, 321.5, "total", True)  # fmt: skip
    assert washer.raw["sensor.washing_machine_total_consumption"]["unit_of_measurement"] == "kWh"
    fridge = by_key["kitchen_fridge"]  # Wh and kW, converted
    assert (fridge.name, fridge.kind, fridge.power_w, fridge.energy_kwh, fridge.switched_on) == (
        "Kitchen Fridge", "fridge", pytest.approx(85.0), 45.0, None)  # fmt: skip
    dishwasher = by_key["dishwasher_energy_today"]  # only a daily counter: it starts over
    assert (dishwasher.kind, dishwasher.energy_kwh, dishwasher.counter) == ("dishwasher", 1.2, "cycle")
    freezer = by_key["garage_freezer"]
    assert not freezer.online and freezer.power_w is None and freezer.energy_kwh is None
    assert freezer.kind == "freezer"


def test_a_sensor_without_a_value_isnt_offline_unless_all_are() -> None:
    found = devices([sensor("kettle_power", "unknown", "W", "power"), sensor("kettle_energy", 2000, "Wh", "energy")])
    r = reading(found["kettle"])
    assert r.online and r.power_w is None and r.energy_kwh == 2.0 and r.name == "Kettle"


def test_mwh_is_converted() -> None:
    [r] = map(reading, devices([sensor("pool_pump_energy", 1.5, "MWh", "energy", "Pool Pump Energy")]).values())
    assert (r.energy_kwh, r.kind, r.power_w) == (1500.0, "pool_pump", None)


def test_kinds_are_guessed_from_names() -> None:
    guesses = {
        "Washer Dryer": "washer_dryer",
        "Bosch Dishwasher": "dishwasher",
        "Tumble dryer": "dryer",
        "Fridge Freezer": "fridge",
        "Chest freezer": "freezer",
        "Oven": "oven",
        "Bedroom Aircon": "air_conditioner",
        "Hot Water": "hot_water",
        "Whirlpool": "plug",  # a brand, not a pool
        "TV": "plug",
    }
    assert {n: kind(n) for n in guesses} == guesses


# -- reading and switching -------------------------------------------------------------------------------
def test_a_poll_reads_every_device(ha: FakeHA) -> None:
    readings = HomeAssistant(HomeAssistant.sign_in(FORM, Hints())).poll()
    assert {r.key for r in readings} == {
        "washing_machine",
        "kitchen_fridge",
        "dishwasher_energy_today",
        "garage_freezer",
    }


def test_a_device_is_switched_by_its_switch(ha: FakeHA) -> None:
    hass = HomeAssistant(HomeAssistant.sign_in(FORM, Hints()))
    hass.switch("washing_machine", False)
    assert ha.calls[-1] == ("POST", "/api/services/switch/turn_off", {"entity_id": "switch.washing_machine"})
    hass.switch("washing_machine", True)
    assert ha.calls[-1] == ("POST", "/api/services/switch/turn_on", {"entity_id": "switch.washing_machine"})
    with pytest.raises(IntegrationError, match="Kitchen Fridge has no switch"):
        hass.switch("kitchen_fridge", False)
    with pytest.raises(IntegrationError, match="isn't in Home Assistant any more"):
        hass.switch("gone", True)


def test_a_revoked_token_asks_to_sign_in_again(ha: FakeHA) -> None:
    hass = HomeAssistant(HomeAssistant.sign_in(FORM, Hints()))
    ha.token = "a new one"
    with pytest.raises(IntegrationError, match="sign in again") as e:
        hass.poll()
    assert e.value.signed_out


# -- through the dashboard -------------------------------------------------------------------------------
def test_home_assistant_through_the_dashboard(ha: FakeHA, db: Database, config: Config) -> None:
    clock = {"t": 1_790_000_000.0}
    home = HomeService(config, db, {"homeassistant": HomeAssistant}, clock=lambda: clock["t"])
    with pytest.raises(HomeSetupError, match="Enter your long-lived access token"):
        home.connect("homeassistant", {"url": URL}, Hints())
    view = home.connect("homeassistant", FORM, Hints())
    assert view["integrations"][0]["account"]["label"] == "homeassistant.local"
    assert TOKEN not in json.dumps(view)  # kept on the server, never sent to the browser
    total = next(s for s in ha.states if s["entity_id"] == "sensor.washing_machine_total_consumption")
    for n in range(3):  # every 30 seconds, 0.01 kWh each time
        clock["t"] = 1_790_000_000 + n * 30
        total["state"] = str(321.5 + n * 0.01)
        home.poll(home.repo.accounts()[0].id)
    devices_ = {d["name"]: d for d in home.overview()["devices"]}
    washer = devices_["Washing Machine"]
    assert washer["kind"] == "washer" and washer["can_switch"] and washer["now"]["power_w"] == 512.3
    assert sum(kwh for _, d, kwh in home.repo.energy(0, 2**40) if d == washer["id"]) == pytest.approx(0.02)
    home.switch(washer["id"], False)
    assert next(d for d in home.overview()["devices"] if d["id"] == washer["id"])["now"]["switched_on"] is False
    with pytest.raises(HomeSetupError, match="has no switch") as e:
        home.switch(devices_["Kitchen Fridge"]["id"], True)
    assert e.value.status == 502
