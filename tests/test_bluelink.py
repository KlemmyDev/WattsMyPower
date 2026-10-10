"""Hyundai and Kia through their cloud: signing in, reading and commanding a car through hyundai_kia_connect_api
against a fake Australian Bluelink server (every request the library makes is answered here), the service that keeps
the account, its cars and their settings, charging from spare solar by starting and stopping (the Tesla controller,
with the car's charging power as its one step), and the made-up car in mock mode. Nothing here reaches Hyundai or Kia."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Collection
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from hyundai_kia_connect_api.ApiImpl import ApiImplSession

from app.core.config import DEMO_LOCATION, Config
from app.core.database import Database
from app.features.bluelink import mock
from app.features.bluelink.client import BluelinkAccount, BluelinkError, email_hint, model_name
from app.features.bluelink.service import (
    BACKOFF,
    CHARGE_W,
    FORCE_MIN,
    LIMITED,
    POLL,
    POLL_ACTIVE,
    REFUSALS,
    BluelinkService,
    BluelinkSetupError,
    car_state,
    charger,
)
from app.features.live.service import LiveService
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore
from app.features.tesla import control
from app.features.tesla.control import Memory
from app.main import create_app

VIN = "KMHKN81AFPU000009"
EMAIL = "someone@example.com"
PASSWORD = "correct horse"
HOME = DEMO_LOCATION

OK = {"retCode": "S", "resCode": "0000"}


# -- a fake Australian Bluelink server ------------------------------------------------------------------


class FakeResponse:
    def __init__(self, body: Any):
        self.body = body
        self.status_code = 200

    def json(self) -> Any:
        return self.body


class FakeBluelink:
    """Answers the requests the library makes of au-apigw.ccs.hyundai.com.au, as the real one does (as far as the
    library knows it): signing in, the account's cars, a car's state (cached or asked for), where it's parked, and
    charging commands and how they went."""

    def __init__(self) -> None:
        self.password = PASSWORD
        self.requests: list[tuple[str, str]] = []
        self.status: dict[str, Any] = {
            "time": "20261010120000",
            "odometer": {"value": 12345.6, "unit": 1},
            "evStatus": {
                "batteryStatus": 64,
                "batteryCharge": True,
                "batteryPlugin": 2,
                "drvDistance": [{"rangeByFuel": {"evModeRange": {"value": 310, "unit": 1}}}],
                "remainTime2": {"atc": {"value": 95}},
                "reservChargeInfos": {
                    "targetSOClist": [{"plugType": 0, "targetSOClevel": 90}, {"plugType": 1, "targetSOClevel": 80}]
                },
            },
        }
        self.location = {"coord": {"lat": HOME[0], "lon": HOME[1]}, "time": "20261010115500"}
        self.ccs2 = 0
        self.limited = False
        self.commands: list[dict[str, Any]] = []
        self.results: dict[str, str] = {}

    def __call__(self, method: str, url: str, **kw: Any) -> FakeResponse:
        path = urlparse(url).path
        self.requests.append((method, path))
        body = kw.get("json")
        if self.limited and "/spa/" in path:
            return FakeResponse({"retCode": "F", "resCode": "5091", "resMsg": "Exceeds number of requests"})
        if path.endswith("/user/oauth2/authorize"):
            return FakeResponse({})
        if path.endswith("/notifications/register"):
            return FakeResponse(OK | {"resMsg": {"deviceId": "DEVICE1"}})
        if path.endswith("/user/signin"):
            if body != {"email": EMAIL, "password": self.password}:
                return FakeResponse({"errId": "x", "errCode": "4010", "errMsg": "Unauthorized"})
            return FakeResponse({"redirectUrl": "https://au-apigw.ccs.hyundai.com.au/redirect?code=CODE1"})
        if path.endswith("/user/oauth2/token"):
            form = parse_qs(kw.get("data") or "")
            assert form.get("code") == ["CODE1"] or form.get("grant_type") == ["refresh_token"]
            return FakeResponse(
                {"token_type": "Bearer", "access_token": "AT", "refresh_token": "RT", "expires_in": 86400}
            )
        if path.endswith("/spa/vehicles"):
            return FakeResponse(OK | {"resMsg": {"vehicles": [
                {"vehicleId": "V1", "nickname": "Ioniq", "vehicleName": "IONIQ 5", "regDate": "2023-01-01",
                 "vin": VIN, "type": "EV", "ccuCCS2ProtocolSupport": self.ccs2},
                {"vehicleId": "V2", "nickname": "Ute", "vehicleName": "SANTA FE", "regDate": "2020-01-01",
                 "vin": "KMHS381AFLU000001", "type": "GN", "ccuCCS2ProtocolSupport": 0},
            ]}})  # fmt: skip
        if path.endswith("/vehicles/V1/status/latest") or path.endswith("/vehicles/V1/status"):
            return FakeResponse(OK | {"resMsg": self.status})
        if path.endswith("/vehicles/V1/location/park"):
            return FakeResponse(OK | {"resMsg": self.location})
        if path.endswith("/vehicles/V1/drvhistory"):
            return FakeResponse(OK | {"resMsg": {"drivingInfoDetail": [], "drivingInfo": []}})
        if path.endswith("/vehicles/V1/control/charge"):
            self.commands.append(body or {})
            msg = f"MSG{len(self.commands)}"
            self.results[msg] = "success"
            return FakeResponse(OK | {"msgId": msg})
        if path.endswith("/vehicles/V1/charge/target"):
            self.commands.append(body or {})
            return FakeResponse(OK | {"msgId": "LIMIT1"})
        if path.endswith("/notifications/V1/records"):
            return FakeResponse(OK | {"resMsg": [{"recordId": k, "result": v} for k, v in self.results.items()]})
        raise AssertionError(f"unexpected request {method} {path}")


@pytest.fixture
def cloud(monkeypatch: pytest.MonkeyPatch) -> FakeBluelink:
    fake = FakeBluelink()
    monkeypatch.setattr(ApiImplSession, "request", lambda self, method, url, **kw: fake(method, url, **kw))
    return fake


def account(pin: str = "") -> BluelinkAccount:
    return BluelinkAccount(EMAIL, PASSWORD, pin, "AU", "hyundai")


# -- reading a car ---------------------------------------------------------------------------------------


def test_models_are_named_as_theyre_said() -> None:
    assert model_name("IONIQ 5") == "Ioniq 5"
    assert model_name("KONA ELECTRIC") == "Kona Electric"
    assert model_name("EV9 GT-LINE") == "EV9 GT-Line"
    assert model_name("Niro EV") == "Niro EV"
    assert model_name(" ") is None and model_name(None) is None
    assert email_hint(EMAIL) == "so…@example.com"


def test_signing_in_and_reading_a_charging_car(cloud: FakeBluelink) -> None:
    cars = account().read()
    assert len(cars) == 1  # the petrol Santa Fe isn't one
    car = cars[0]
    assert car["vin"] == VIN and car["make"] == "Hyundai" and car["model"] == "Ioniq 5" and car["year"] == 2023
    assert car["name"] == "Ioniq" and not car["ccs2"] and not car["hybrid"]
    st = car["state"]
    assert st["soc"] == 64 and st["range_km"] == 310 and st["charging"] and st["plugged"] and not st["fast"]
    assert st["minutes_to_full"] == 95 and st["limit"] == 80 and st["limit_dc"] == 90
    assert st["odometer_km"] == 12346 and st["location"] == [HOME[0], HOME[1]]
    # The time is the car's, in Sydney's time zone (the library reads it so).
    assert st["as_of"] == int(datetime(2026, 10, 10, 12, tzinfo=ZoneInfo("Australia/Sydney")).timestamp())
    # A cached read doesn't ask the car itself.
    assert ("GET", "/api/v1/spa/vehicles/V1/status/latest") in cloud.requests
    assert ("GET", "/api/v1/spa/vehicles/V1/status") not in cloud.requests


def test_a_forced_read_asks_the_car_itself(cloud: FakeBluelink) -> None:
    acct = account()
    acct.read({VIN})
    assert ("GET", "/api/v1/spa/vehicles/V1/status") in cloud.requests
    signins = sum(1 for _, p in cloud.requests if p.endswith("/signin"))
    acct.read()
    assert sum(1 for _, p in cloud.requests if p.endswith("/signin")) == signins  # still signed in


def test_an_unplugged_car_and_one_on_a_fast_charger(cloud: FakeBluelink) -> None:
    cloud.status["evStatus"] |= {"batteryCharge": False, "batteryPlugin": 0}
    st = account().read()[0]["state"]
    assert st["plugged"] is False and not st["charging"] and st["minutes_to_full"] is None
    cloud.status["evStatus"] |= {"batteryCharge": True, "batteryPlugin": 1}
    assert account().read()[0]["state"]["fast"]


def test_a_wrong_password_is_turned_down(cloud: FakeBluelink) -> None:
    cloud.password = "something else"
    with pytest.raises(BluelinkError) as e:
        account().read()
    assert e.value.refused and "Bluelink didn't accept" in str(e.value)


def test_too_many_requests_is_told_apart(cloud: FakeBluelink) -> None:
    acct = account()
    acct.read()
    cloud.limited = True
    with pytest.raises(BluelinkError) as e:
        acct.read()
    assert e.value.limited and not e.value.refused


def test_starting_stopping_and_the_charge_limit(cloud: FakeBluelink) -> None:
    acct = account()
    acct.read()
    msg = acct.command(VIN, "start")
    assert cloud.commands[-1] == {"action": "start", "deviceId": "DEVICE1"} and acct.outcome(VIN, msg or "") == "done"
    acct.command(VIN, "stop")
    assert cloud.commands[-1]["action"] == "stop"
    cloud.results["MSG2"] = "fail"
    assert acct.outcome(VIN, "MSG2") == "failed"
    acct.command(VIN, "limit", percent=90)
    assert cloud.commands[-1] == {
        "targetSOClist": [{"plugType": 0, "targetSOClevel": 90}, {"plugType": 1, "targetSOClevel": 90}]
    }
    with pytest.raises(BluelinkError, match="isn't on the account"):
        acct.command("KMHKN81AFPU000000", "start")


def test_genesis_and_hyundai_nz_cant_be_reached() -> None:
    with pytest.raises(BluelinkError):
        BluelinkAccount(EMAIL, PASSWORD, "", "NZ", "hyundai")
    with pytest.raises(BluelinkError):
        BluelinkAccount(EMAIL, PASSWORD, "", "AU", "genesis")


# -- the controller's view of a car -----------------------------------------------------------------------


def state(**over: Any) -> dict[str, Any]:
    return {"as_of": 1000, "soc": 50.0, "range_km": 250, "plugged": True, "fast": False, "charging": False,
            "minutes_to_full": None, "limit": 80.0, "limit_dc": 90.0, "power_kw": None, "odometer_km": 12000,
            "location": list(HOME)} | over  # fmt: skip


def car(**over: Any) -> dict[str, Any]:
    return {"vin": VIN, "make": "Hyundai", "model": "Ioniq 5", "year": 2023, "name": "Ioniq", "hybrid": False,
            "ccs2": False, "state": state(**over)}  # fmt: skip


def test_the_controller_sees_charging_states_and_home() -> None:
    def cs(**over: Any) -> str:
        s = car_state(VIN, car(**over), HOME)
        assert s is not None
        return s.charging_state

    assert cs() == "Stopped" and cs(charging=True) == "Charging" and cs(plugged=False) == "Disconnected"
    assert cs(soc=80.0) == "Complete" and cs(plugged=None) == ""
    s = car_state(VIN, car(), HOME)
    assert s is not None and s.at_home and s.plugged and not s.charging
    away = car_state(VIN, car(location=[HOME[0] + 0.1, HOME[1]]), HOME)
    assert away is not None and away.at_home is False
    assert car_state(VIN, car(location=None), HOME).at_home is None  # type: ignore[union-attr]


def test_with_one_step_it_starts_and_stops_but_never_changes_speed() -> None:
    timing = control.Timing()
    spec = charger(2400)
    mem = Memory()
    s = car_state(VIN, car(), HOME)
    assert s is not None
    # Not enough for its whole charging power: nothing.
    assert control.decide("solar", s, spec, 2000, 300, mem, 1000, timing) is None
    # Enough, but not for long enough yet.
    assert control.decide("solar", s, spec, 2600, 300, mem, 1100, timing) is None
    d = control.decide("solar", s, spec, 2600, 300, mem, 1100 + timing.start_after, timing)
    assert d is not None and d.action == "start"
    mem.command, mem.command_at, mem.amps, mem.amps_at = "start", 1300, 1, 1300
    on = car_state(VIN, car(charging=True), HOME)
    assert on is not None
    # Charging with more sun than it needs: it's left alone (there's no faster).
    assert control.decide("solar", on, spec, 5000, 300, mem, 1400, timing) is None
    # A little short, within what it may borrow: it keeps going.
    assert control.decide("solar", on, spec, 2200, 300, mem, 2000, timing) is None
    # Short by more than that, for long enough (and long enough since starting): it stops.
    assert control.decide("solar", on, spec, 1500, 300, mem, 2100, timing) is None
    d = control.decide("solar", on, spec, 1500, 300, mem, 2100 + timing.stop_after, timing)
    assert d is not None and d.action == "stop"


# -- the service -------------------------------------------------------------------------------------------


class FakeAccount:
    def __init__(self, cars: list[dict[str, Any]] | None = None):
        self.cars = cars if cars is not None else [car()]
        self.fail: BluelinkError | None = None
        self.reads: list[set[str]] = []
        self.commands: list[tuple[str, str, dict[str, Any]]] = []
        self.outcomes: dict[str, str] = {}
        self.closed = False

    def read(self, force: Collection[str] = ()) -> list[dict[str, Any]]:
        self.reads.append(set(force))
        if self.fail:
            raise self.fail
        return json.loads(json.dumps(self.cars))

    def command(self, vin: str, action: str, **params: Any) -> str | None:
        self.commands.append((vin, action, params))
        msg = f"M{len(self.commands)}"
        self.outcomes.setdefault(msg, "pending")
        return msg

    def outcome(self, vin: str, action_id: str) -> str:
        return self.outcomes.get(action_id, "unknown")

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def settings(config: Config, db: Database) -> SettingsStore:
    return SettingsStore(db, config)


@pytest.fixture
def live(config: Config, db: Database, settings: SettingsStore) -> LiveService:
    return LiveService(config, settings, TariffStore(db, config))


# 10:00 on a day in Brisbane, wherever the tests run: the sun's up at home.
DAY = datetime(2026, 10, 7, 10, tzinfo=ZoneInfo("Australia/Brisbane")).timestamp()


def service(
    config: Config, db: Database, live: LiveService, settings: SettingsStore, acct: FakeAccount, clock: list[float]
) -> BluelinkService:
    return BluelinkService(config, db, live, settings, clock=lambda: clock[0], account=lambda *_: acct)


def connect(svc: BluelinkService, **body: Any) -> dict[str, Any]:
    return asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD, "brand": "hyundai"} | body))


def test_connecting_reads_the_cars_and_never_shows_the_password_or_pin(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    clock = [DAY]
    svc = service(config, db, live, settings, FakeAccount(), clock)
    status = connect(svc, pin="1234", region="au")
    assert status["connected"] and status["account"] == "so…@example.com" and status["region"] == "AU"
    assert status["brand"] == "hyundai" and status["pin"] is True
    assert PASSWORD not in json.dumps(status) and "1234" not in json.dumps(status)
    v = status["vehicles"][0]
    assert v["status"] == "stopped" and v["control"]["mode"] == "off" and v["min_w"] == CHARGE_W[2]
    assert v["charge_from"] == "default" and v["can_command"] and v["state"]["at_home"]
    # Beside any Teslas, on every page.
    assert live.ev is not None and live.ev[0]["make"] == "Hyundai" and live.ev[0]["soc"] == 50.0
    assert status["next_read"] == int(DAY) + POLL


def test_connecting_checks_what_its_given(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    svc = service(config, db, live, settings, FakeAccount(), [DAY])
    for body in (
        {"password": ""},
        {"brand": "genesis"},
        {"brand": "hyundai", "region": "NZ"},
        {"pin": "12"},
    ):
        with pytest.raises(BluelinkSetupError):
            connect(svc, **body)
    acct = FakeAccount()
    acct.fail = BluelinkError("Bluelink didn't accept the email and password.", refused=True)
    with pytest.raises(BluelinkSetupError) as e:
        connect(service(config, db, live, settings, acct, [DAY]))
    assert e.value.status == 400 and acct.closed
    with pytest.raises(BluelinkSetupError, match="no electric car"):
        connect(service(config, db, live, settings, FakeAccount([]), [DAY]))
    assert not svc.status()["connected"] and live.ev is None


def test_a_failed_read_keeps_the_cars_and_backs_off(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    clock = [DAY]
    acct = FakeAccount()
    svc = service(config, db, live, settings, acct, clock)
    connect(svc)
    acct.fail = BluelinkError("Bluelink's servers couldn't be reached.")
    clock[0] += 1000
    asyncio.run(svc.read())
    status = svc.status()
    assert status["error"] and status["vehicles"][0]["state"]["soc"] == 50.0
    assert status["next_read"] == int(clock[0]) + BACKOFF[0]
    asyncio.run(svc.tick())  # not due yet: nothing read, and the backoff stands
    assert len(acct.reads) == 2 and svc.status()["next_read"] == int(clock[0]) + BACKOFF[0]
    acct.fail = BluelinkError("Too many requests.", limited=True)
    asyncio.run(svc.read())
    assert svc.status()["next_read"] == int(clock[0]) + LIMITED
    acct.fail = None
    asyncio.run(svc.read())
    assert svc.status()["error"] is None


def test_turned_down_a_few_times_it_waits_to_be_signed_in_again(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    acct = FakeAccount()
    svc = service(config, db, live, settings, acct, [DAY])
    connect(svc)
    acct.fail = BluelinkError("Bluelink didn't accept the email and password.", refused=True)
    for _ in range(REFUSALS - 1):
        asyncio.run(svc.read())
    assert not svc.status()["signed_out"]
    asyncio.run(svc.read())
    status = svc.status()
    assert status["signed_out"] and status["next_read"] is None and status["vehicles"]


def test_a_car_that_could_charge_from_solar_is_read_more_often(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    clock = [DAY]
    svc = service(config, db, live, settings, FakeAccount(), clock)
    connect(svc)
    assert asyncio.run(svc.configure(VIN, {"mode": "solar", "force_every": 0}))["next_read"] == int(DAY) + 1
    asyncio.run(svc.read())
    assert svc.status()["next_read"] == int(DAY) + POLL_ACTIVE


def test_the_car_itself_is_asked_rarely(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    clock = [DAY]
    acct = FakeAccount([car(as_of=int(DAY) - 3 * 3600)])  # the cloud's copy is three hours old
    svc = service(config, db, live, settings, acct, clock)
    connect(svc)
    asyncio.run(svc.read())
    assert acct.reads[-1] == set()  # Off: never asked
    asyncio.run(svc.configure(VIN, {"mode": "solar"}))
    asyncio.run(svc.read())
    assert acct.reads[-1] == {VIN}  # Spare solar, by day, and what the cloud has is over two hours old
    clock[0] += 300
    asyncio.run(svc.read())
    assert acct.reads[-1] == set()  # not again for two hours
    # From the page, at most every 10 minutes.
    with pytest.raises(BluelinkSetupError) as e:
        asyncio.run(svc.refresh({"force": VIN}))
    assert e.value.status == 429
    clock[0] += FORCE_MIN
    asyncio.run(svc.refresh({"force": VIN}))
    assert acct.reads[-1] == {VIN}
    # Never at night.
    clock[0] = DAY + 12 * 3600
    asyncio.run(svc.read())
    assert acct.reads[-1] == set()


def solar(live: LiveService, ts: float, export_w: float) -> None:
    """An inverter reading: exporting `export_w`, the home battery idle (none here)."""
    live.latest = {"ts": int(ts), "grid_power": -export_w, "battery_power": 0, "pv_power": export_w + 500}  # type: ignore[assignment]


def run(svc: BluelinkService, live: LiveService, clock: list[float], export_w: float, seconds: int) -> None:
    """The loop's turns over `seconds`, with that much going to the grid."""
    end = clock[0] + seconds
    while clock[0] < end:
        solar(live, clock[0], export_w)
        asyncio.run(svc.tick())
        clock[0] += 20


def test_it_charges_from_spare_solar_by_starting_and_stopping(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    clock = [DAY]
    acct = FakeAccount()
    svc = service(config, db, live, settings, acct, clock)
    connect(svc)
    asyncio.run(svc.configure(VIN, {"mode": "solar", "force_every": 0, "first": "car", "grid_w": 300}))
    run(svc, live, clock, 2000, 600)  # less than its 2.4 kW
    assert acct.commands == []
    run(svc, live, clock, 3000, 400)  # enough, for over three minutes
    assert [a for _, a, _ in acct.commands] == ["start"]
    v = svc.status()["vehicles"][0]
    assert v["state"]["charging"] and v["status"] == "charging" and v["pending"]["action"] == "start"
    assert v["events"][0]["text"] == "Started charging: spare solar"
    acct.outcomes["M1"] = "done"
    # The cloud still has the state from before the start: it's taken to be charging until the car says otherwise.
    run(svc, live, clock, 600, 120)  # charging: 2.4 kW of its own plus 600 W going out
    assert svc.status()["vehicles"][0]["state"]["charging"] and svc.status()["vehicles"][0]["pending"] is None
    assert [a for _, a, _ in acct.commands] == ["start"]
    # The sun goes: it's going out at nothing, so the car's 2.4 kW is all there is (less than it may borrow covers).
    run(svc, live, clock, -1500, 900)
    assert [a for _, a, _ in acct.commands] == ["start", "stop"]
    assert not svc.status()["vehicles"][0]["state"]["charging"]


def test_a_start_the_car_turns_down_is_undone_and_tried_later(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    clock = [DAY]
    acct = FakeAccount()
    svc = service(config, db, live, settings, acct, clock)
    connect(svc)
    asyncio.run(svc.configure(VIN, {"mode": "solar", "force_every": 0, "first": "car"}))
    run(svc, live, clock, 3000, 200)  # started at the last turn: three minutes of enough
    assert len(acct.commands) == 1
    acct.outcomes["M1"] = "failed"
    run(svc, live, clock, 3000, 60)
    v = svc.status()["vehicles"][0]
    assert not v["state"]["charging"] and v["hold"] is None
    assert v["events"][0]["text"] == "The car didn't start charging: it said no"
    run(svc, live, clock, 3000, 120)
    assert len(acct.commands) == 1  # not straight away
    run(svc, live, clock, 3000, 600)
    assert len(acct.commands) == 2


def test_starting_by_hand_puts_solar_charging_on_hold_until_unplugged(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    clock = [DAY]
    acct = FakeAccount()
    svc = service(config, db, live, settings, acct, clock)
    connect(svc)
    asyncio.run(svc.configure(VIN, {"mode": "solar", "force_every": 0}))
    status = asyncio.run(svc.command(VIN, {"action": "start"}))
    v = status["vehicles"][0]
    assert v["hold"] == "Charging now, started here" and v["state"]["charging"] and v["status"] == "charging"
    run(svc, live, clock, 0, 900)  # no sun: it's left charging, as asked
    assert [a for _, a, _ in acct.commands] == ["start"]
    acct.cars = [car(plugged=False, as_of=int(clock[0]))]
    asyncio.run(svc.read())
    asyncio.run(svc.tick())
    assert svc.status()["vehicles"][0]["hold"] is None


def test_the_charge_limit_is_in_tens(config: Config, db: Database, live: LiveService, settings: SettingsStore) -> None:
    acct = FakeAccount()
    svc = service(config, db, live, settings, acct, [DAY])
    connect(svc)
    with pytest.raises(BluelinkSetupError):
        asyncio.run(svc.command(VIN, {"action": "limit", "percent": 85}))
    status = asyncio.run(svc.command(VIN, {"action": "limit", "percent": 90}))
    assert acct.commands[-1] == (VIN, "limit", {"percent": 90}) and status["vehicles"][0]["state"]["limit"] == 90


def test_a_ccs2_car_needs_the_pin_to_be_commanded(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    acct = FakeAccount([car() | {"ccs2": True}])
    svc = service(config, db, live, settings, acct, [DAY])
    status = connect(svc)
    assert not status["vehicles"][0]["can_command"]
    with pytest.raises(BluelinkSetupError, match="PIN"):
        asyncio.run(svc.command(VIN, {"action": "start"}))
    status = asyncio.run(svc.set_pin({"pin": "4321"}))
    assert status["pin"] and status["vehicles"][0]["can_command"]
    assert acct.closed  # signed in afresh, with the PIN


def test_a_ccs2_cars_charging_power_is_learnt_at_home(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    acct = FakeAccount([car(charging=True, power_kw=7.1) | {"ccs2": True}])
    svc = service(config, db, live, settings, acct, [DAY])
    v = connect(svc)["vehicles"][0]
    assert v["min_w"] == 7100 and v["charge_from"] == "measured" and v["state"]["power_kw"] == 7.1
    v = asyncio.run(svc.configure(VIN, {"charge_w": 3600}))["vehicles"][0]
    assert v["min_w"] == 3600 and v["charge_from"] == "set"
    with pytest.raises(BluelinkSetupError):
        asyncio.run(svc.configure(VIN, {"charge_w": 50_000}))
    with pytest.raises(BluelinkSetupError):
        asyncio.run(svc.configure(VIN, {"force_every": 60}))


def test_after_a_restart_the_cars_and_their_settings_stay(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    svc = service(config, db, live, settings, FakeAccount(), [DAY])
    connect(svc)
    asyncio.run(svc.configure(VIN, {"mode": "solar", "grid_w": 800}))
    made: list[tuple[str, ...]] = []

    def make(*args: str) -> FakeAccount:
        made.append(args)
        return FakeAccount([car(soc=70.0)])

    again = BluelinkService(config, db, live, settings, clock=lambda: DAY + 60, account=make)
    assert again.status()["vehicles"][0]["control"]["grid_w"] == 800
    asyncio.run(again.read())
    assert made == [(EMAIL, PASSWORD, "", "AU", "hyundai")] and again.status()["vehicles"][0]["state"]["soc"] == 70.0


def test_disconnecting_forgets_the_account_and_its_cars(
    config: Config, db: Database, live: LiveService, settings: SettingsStore
) -> None:
    acct = FakeAccount()
    svc = service(config, db, live, settings, acct, [DAY])
    connect(svc)
    status = asyncio.run(svc.disconnect())
    assert not status["connected"] and status["vehicles"] == [] and acct.closed and live.ev is None


# -- mock mode ---------------------------------------------------------------------------------------------


def test_the_made_up_ioniq_charges_when_its_told() -> None:
    t = [time.mktime((2026, 10, 7, 10, 0, 0, 0, 0, -1))]  # its day is in local time
    demo = mock.DemoBluelink(lambda: HOME, lambda: t[0])
    st = demo.read()[0]["state"]
    assert st["plugged"] and not st["charging"] and st["soc"] == round(mock.START_SOC)
    assert demo.outcome(mock.VIN, demo.command(mock.VIN, "start") or "") == "done"
    t[0] += 1200
    assert demo.read()[0]["state"]["soc"] == round(mock.START_SOC)  # the cloud's copy is from when it started
    assert demo.read({mock.VIN})[0]["state"]["soc"] == round(mock.START_SOC + mock.PCT_S * 1200)
    demo.command(mock.VIN, "stop")
    assert not demo.read()[0]["state"]["charging"]
    t[0] = time.mktime((2026, 10, 7, 18, 0, 0, 0, 0, -1))  # out
    st = demo.read()[0]["state"]
    assert not st["plugged"] and st["location"] != list(HOME)
    assert demo.outcome(mock.VIN, demo.command(mock.VIN, "start") or "") == "failed"


def test_in_mock_mode_any_sign_in_brings_the_made_up_car(config: Config) -> None:
    app = create_app(config, poll=False, serve_dashboard=False)
    with TestClient(app) as client:
        assert client.get("/api/bluelink").json()["connected"] is False
        status = client.put("/api/bluelink", json={"username": "demo@example.com", "password": "demo"}).json()
        assert status["connected"] and status["mock"] and status["vehicles"][0]["model"] == "Ioniq 5"
        assert client.post("/api/bluelink/refresh").json()["vehicles"][0]["vin"] == mock.VIN
        assert client.get("/api/live").json()["ev"][0]["make"] == "Hyundai"
        status = client.put(f"/api/bluelink/vehicles/{mock.VIN}", json={"mode": "solar"}).json()
        assert status["vehicles"][0]["control"]["mode"] == "solar"
        status = client.post(f"/api/bluelink/vehicles/{mock.VIN}/command", json={"action": "start"}).json()
        assert status["vehicles"][0]["state"]["charging"] and status["vehicles"][0]["hold"]
        assert client.post(f"/api/bluelink/vehicles/{mock.VIN}/command", json={"action": "x"}).status_code == 400
        assert client.put("/api/bluelink", json={"username": "", "password": ""}).status_code == 400
        assert client.delete("/api/bluelink").json()["connected"] is False
        assert client.post("/api/bluelink/refresh").status_code == 409
