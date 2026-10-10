"""BYD through BYD's cloud: reading a car's state, signing in and reading the account through pyBYD against a fake BYD
server (its requests and answers encrypted as the real one's are), the service that keeps the account and its cars,
and the made-up car in mock mode. Nothing here reaches BYD."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient
from pybyd._crypto.aes import aes_decrypt_utf8, aes_encrypt_hex
from pybyd._crypto.bangcle import BangcleCodec
from pybyd._crypto.hashing import md5_hex, pwd_login_key
from pybyd.models.realtime import VehicleRealtimeData
from pybyd.models.vehicle import Vehicle

from app.core.config import Config
from app.core.database import Database
from app.features.byd import mock
from app.features.byd.client import BydAccount, BydError, email_hint, model_name, parse
from app.features.byd.service import BACKOFF, POLL, POLL_CHARGING, BydService, BydSetupError, car_status
from app.features.live.service import LiveService
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore
from app.main import create_app

VIN = "LGXC74C40R0000009"
EMAIL = "someone@example.com"
PASSWORD = "correct horse"
ENCRY_TOKEN = "ENCRYTOKEN0123"

REALTIME = {
    "vin": VIN,
    "elecPercent": 64,
    "enduranceMileage": 271,
    "totalMileage": 12345.6,
    "chargeState": 1,
    "fullHour": 1,
    "fullMinute": 20,
    "onlineState": 1,
    "time": 1_800_000_000,
}


def vehicle(**over: Any) -> Vehicle:
    return Vehicle.model_validate({"vin": VIN, "modelName": "ATTO 3", "autoAlias": "Atto", "energyType": "0"} | over)


# -- reading a car ---------------------------------------------------------------------------------


def test_models_are_named_as_theyre_said() -> None:
    assert model_name("ATTO 3") == "Atto 3"
    assert model_name("SEALION 7") == "Sealion 7"
    assert model_name("SEAL") == "Seal"
    assert model_name("  ") is None


def test_a_charging_car_is_read_with_its_charge_range_and_time_to_full() -> None:
    car = parse(vehicle(), VehicleRealtimeData.model_validate(REALTIME))
    assert car["make"] == "BYD" and car["model"] == "Atto 3" and car["name"] == "Atto" and car["year"] == 2024
    assert car["state"] == {
        "as_of": 1_800_000_000,
        "soc": 64.0,
        "range_km": 271,
        "charging": True,
        "minutes_to_full": 80,
        "odometer_km": 12346,
        "online": True,
    }
    assert car_status(car) == ("charging", "Charging, full in 1 h 20 min.")


def test_a_car_not_charging_says_nothing_of_time_to_full_or_its_plug() -> None:
    # 15 ("connected") stays put when the cable's pulled out, so it isn't taken to mean plugged in.
    rt = VehicleRealtimeData.model_validate(REALTIME | {"chargeState": 15})
    car = parse(vehicle(), rt)
    assert car["state"]["charging"] is False and car["state"]["minutes_to_full"] is None
    assert car_status(car) == ("stopped", "Not charging.")


def test_a_car_that_didnt_answer_has_no_state() -> None:
    # BYD's "no reading" values (-1) aren't a flat battery.
    rt = VehicleRealtimeData.model_validate({"vin": VIN, "elecPercent": -1, "enduranceMileage": -1})
    assert parse(vehicle(), rt)["state"] is None
    assert parse(vehicle(), None)["state"] is None
    assert car_status(parse(vehicle(), None))[0] == "unknown"


def test_a_plug_in_hybrid_is_marked() -> None:
    assert parse(vehicle(modelName="SHARK 6", energyType="2"), None)["hybrid"] is True


def test_an_email_is_shown_only_enough_to_recognise() -> None:
    assert email_hint(EMAIL) == "so…@example.com"
    assert PASSWORD not in email_hint(EMAIL)


# -- signing in and reading, through pyBYD, against a fake BYD ---------------------------------------


class _Response:
    def __init__(self, body: str):
        self.status = 200
        self._body = body

    async def text(self) -> str:
        return self._body

    async def __aenter__(self) -> _Response:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        pass


class FakeByd:
    """BYD's servers, as pyBYD sees them through its HTTP session: each request's envelope opened, answered as BYD
    answers (the inner data encrypted with the password's key at sign-in, and the session's key after)."""

    def __init__(self, password: str = PASSWORD, realtime: dict[str, Any] | None = None):
        self.password = password
        self.realtime = REALTIME if realtime is None else realtime
        self.codec = BangcleCodec()
        self.calls: list[str] = []
        self.hosts: set[str] = set()

    def post(self, url: str, data: str, headers: dict[str, str]) -> _Response:
        path, outer = urlparse(url).path, json.loads(self.codec.decode_envelope(json.loads(data)["request"]))
        self.calls.append(path)
        self.hosts.add(urlparse(url).netloc)
        answer = self.answer(path, outer)
        return _Response(json.dumps({"response": self.codec.encode_envelope(json.dumps(answer))}))

    def answer(self, path: str, outer: dict[str, Any]) -> dict[str, Any]:
        if path == "/app/account/login":
            if outer["identifier"] != EMAIL or outer["signKey"] != self.password:
                return {"code": "1001", "message": "Incorrect account or password"}
            token = {"userId": "42", "signToken": "SIGNTOKEN", "encryToken": ENCRY_TOKEN}
            return {"code": "0", "respondData": aes_encrypt_hex(json.dumps({"token": token}), pwd_login_key(PASSWORD))}
        key = md5_hex(ENCRY_TOKEN)
        inner = json.loads(aes_decrypt_utf8(outer["encryData"], key))  # sent encrypted with the session's key
        if path == "/app/account/getAllListByUserId":
            cars = [{"vin": VIN, "modelName": "ATTO 3", "autoAlias": "Atto", "energyType": "0"}]
            return {"code": "0", "respondData": aes_encrypt_hex(json.dumps(cars), key)}
        if path == "/vehicleInfo/vehicle/vehicleRealTimeRequest":
            assert inner["vin"] == VIN
            return {"code": "0", "respondData": aes_encrypt_hex(json.dumps(self.realtime), key)}
        return {"code": "1001", "message": "not faked"}


def test_signing_in_and_reading_the_account_goes_through_byds_australian_servers() -> None:
    server = FakeByd()
    account = BydAccount(EMAIL, PASSWORD, "AU", "Australia/Brisbane", session=server)
    cars = asyncio.run(account.read())
    assert server.calls == [
        "/app/account/login",
        "/app/account/getAllListByUserId",
        "/vehicleInfo/vehicle/vehicleRealTimeRequest",
    ]
    assert server.hosts == {"dilinkappoversea-au.byd.auto"}
    assert len(cars) == 1 and cars[0]["vin"] == VIN and cars[0]["state"]["soc"] == 64.0


def test_it_stays_signed_in_between_reads() -> None:
    server = FakeByd()
    account = BydAccount(EMAIL, PASSWORD, "AU", "Australia/Brisbane", session=server)

    async def twice() -> None:
        await account.read()
        await account.read()

    asyncio.run(twice())
    assert server.calls.count("/app/account/login") == 1


def test_a_wrong_password_is_refused_in_words() -> None:
    account = BydAccount(EMAIL, PASSWORD, "AU", "Australia/Brisbane", session=FakeByd(password="something else"))
    with pytest.raises(BydError) as e:
        asyncio.run(account.read())
    assert e.value.refused and "email and password" in str(e.value)


def test_a_car_that_doesnt_answer_in_time_is_read_without_a_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.features.byd.client.POLL_GAP", 0)
    account = BydAccount(EMAIL, PASSWORD, "AU", "Australia/Brisbane", session=FakeByd(realtime={}))
    cars = asyncio.run(account.read())
    assert cars[0]["vin"] == VIN and cars[0]["state"] is None


def test_only_the_regions_offered_can_be_chosen() -> None:
    with pytest.raises(BydError):
        BydAccount(EMAIL, PASSWORD, "XX", "Australia/Brisbane")


# -- the service -------------------------------------------------------------------------------------


class FakeAccount:
    def __init__(self, cars: list[dict[str, Any]] | None = None):
        self.cars = cars if cars is not None else [car()]
        self.fail: BydError | None = None
        self.reads = 0
        self.closed = False

    async def read(self) -> list[dict[str, Any]]:
        self.reads += 1
        if self.fail:
            raise self.fail
        return [dict(c) for c in self.cars]

    async def close(self) -> None:
        self.closed = True


def car(**state: Any) -> dict[str, Any]:
    st = {"as_of": 1000, "soc": 50.0, "range_km": 210, "charging": False, "minutes_to_full": None} | state
    return {"vin": VIN, "make": "BYD", "model": "Atto 3", "year": 2024, "name": "Atto", "plate": None,
            "hybrid": False, "state": st}  # fmt: skip


@pytest.fixture
def live(config: Config, db: Database) -> LiveService:
    return LiveService(config, SettingsStore(db, config), TariffStore(db, config))


def service(config: Config, db: Database, live: LiveService, account: FakeAccount, clock: list[float]) -> BydService:
    return BydService(config, db, live, clock=lambda: clock[0], account=lambda *_: account)


def test_connecting_reads_the_cars_and_never_shows_the_password(
    config: Config, db: Database, live: LiveService
) -> None:
    clock = [1000.0]
    svc = service(config, db, live, FakeAccount(), clock)
    status = asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD, "region": "au"}))
    assert status["connected"] and status["account"] == "so…@example.com" and status["region"] == "AU"
    assert PASSWORD not in json.dumps(status)
    assert status["vehicles"][0]["status"] == "stopped" and status["next_read"] == 1000 + POLL
    # Beside any Teslas, on every page.
    assert live.ev is not None and live.ev[0]["make"] == "BYD" and live.ev[0]["soc"] == 50.0
    assert live.status()["system"]["ev_connected"] is True


def test_connecting_needs_an_email_password_and_a_known_region(config: Config, db: Database, live: LiveService) -> None:
    svc = service(config, db, live, FakeAccount(), [0.0])
    with pytest.raises(BydSetupError):
        asyncio.run(svc.connect({"username": EMAIL, "password": ""}))
    with pytest.raises(BydSetupError):
        asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD, "region": "US"}))


def test_a_refused_sign_in_or_an_empty_account_isnt_kept(config: Config, db: Database, live: LiveService) -> None:
    account = FakeAccount()
    account.fail = BydError("BYD didn't accept the email and password.", refused=True)
    svc = service(config, db, live, account, [0.0])
    with pytest.raises(BydSetupError) as e:
        asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD}))
    assert e.value.status == 400 and account.closed
    with pytest.raises(BydSetupError, match="no electric car"):
        asyncio.run(service(config, db, live, FakeAccount([]), [0.0]).connect({"username": EMAIL, "password": "x"}))
    assert not svc.status()["connected"] and live.ev is None


def test_a_charging_car_is_read_more_often(config: Config, db: Database, live: LiveService) -> None:
    clock = [1000.0]
    svc = service(config, db, live, FakeAccount([car(charging=True, minutes_to_full=45)]), clock)
    status = asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD}))
    assert status["next_read"] == 1000 + POLL_CHARGING
    assert status["vehicles"][0]["doing"] == "Charging, full in 45 min."


def test_a_failed_read_keeps_the_cars_and_backs_off(config: Config, db: Database, live: LiveService) -> None:
    clock = [1000.0]
    account = FakeAccount()
    svc = service(config, db, live, account, clock)
    asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD}))
    account.fail = BydError("BYD's servers couldn't be reached.")
    clock[0] = 2000.0
    asyncio.run(svc.read())
    status = svc.status()
    assert status["error"] == "BYD's servers couldn't be reached." and not status["signed_out"]
    assert status["vehicles"][0]["state"]["soc"] == 50.0 and status["next_read"] == 2000 + BACKOFF[0]
    asyncio.run(svc.read())
    assert svc.status()["next_read"] == 2000 + BACKOFF[1]
    account.fail = None
    asyncio.run(svc.read())
    assert svc.status()["error"] is None


def test_turned_down_it_waits_to_be_signed_in_again(config: Config, db: Database, live: LiveService) -> None:
    account = FakeAccount()
    svc = service(config, db, live, account, [1000.0])
    asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD}))
    account.fail = BydError("BYD didn't accept the email and password.", refused=True)
    asyncio.run(svc.read())
    status = svc.status()
    assert status["signed_out"] and status["next_read"] is None and status["vehicles"]


def test_a_car_that_didnt_answer_keeps_what_it_said_last(config: Config, db: Database, live: LiveService) -> None:
    account = FakeAccount()
    svc = service(config, db, live, account, [1000.0])
    asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD}))
    account.cars = [car() | {"state": None}]
    asyncio.run(svc.read())
    assert svc.status()["vehicles"][0]["state"]["soc"] == 50.0


def test_after_a_restart_the_cars_show_and_are_read_again(config: Config, db: Database, live: LiveService) -> None:
    asyncio.run(service(config, db, live, FakeAccount(), [1000.0]).connect({"username": EMAIL, "password": PASSWORD}))
    made: list[tuple[str, ...]] = []
    again = FakeAccount([car(soc=70.0)])

    def make(*args: str) -> FakeAccount:
        made.append(args)
        return again

    svc = BydService(config, db, live, clock=lambda: 5000.0, account=make)
    assert svc.status()["vehicles"][0]["state"]["soc"] == 50.0
    asyncio.run(svc.read())
    assert made == [(EMAIL, PASSWORD, "AU")] and svc.status()["vehicles"][0]["state"]["soc"] == 70.0


def test_disconnecting_forgets_the_account_and_its_cars(config: Config, db: Database, live: LiveService) -> None:
    account = FakeAccount()
    svc = service(config, db, live, account, [1000.0])
    asyncio.run(svc.connect({"username": EMAIL, "password": PASSWORD}))
    status = asyncio.run(svc.disconnect())
    assert not status["connected"] and status["vehicles"] == [] and account.closed and live.ev is None


def test_teslas_come_first_in_the_live_list(config: Config, db: Database, live: LiveService) -> None:
    asyncio.run(service(config, db, live, FakeAccount(), [1000.0]).connect({"username": EMAIL, "password": "x"}))
    assert live.set_ev("tesla", [{"vin": "7SAYGDEF1PA000001", "make": "Tesla"}])
    assert [c["make"] for c in live.ev or []] == ["Tesla", "BYD"]
    assert not live.set_ev("tesla", [{"vin": "7SAYGDEF1PA000001", "make": "Tesla"}])  # unchanged: nothing to publish


# -- mock mode ---------------------------------------------------------------------------------------


def test_the_made_up_byd_charges_by_day() -> None:
    def at(hour: float) -> float:  # on a day in local time, as the car's day is
        return time.mktime((2026, 10, 7, 0, 0, 0, 0, 0, -1)) + hour * 3600

    assert mock.DemoByd(lambda: at(3)).state() == (mock.NIGHT, False)
    soc, charging = mock.DemoByd(lambda: at(11)).state()
    assert charging and mock.ARRIVES < soc < mock.TARGET
    assert mock.DemoByd(lambda: at(15)).state() == (mock.TARGET, False)


def test_in_mock_mode_any_sign_in_brings_the_made_up_car(config: Config) -> None:
    app = create_app(config, poll=False, serve_dashboard=False)
    with TestClient(app) as client:
        assert client.get("/api/byd").json()["connected"] is False
        status = client.put("/api/byd", json={"username": "demo@example.com", "password": "demo"}).json()
        assert status["connected"] and status["mock"] and status["vehicles"][0]["model"] == "Atto 3"
        assert client.post("/api/byd/refresh").json()["vehicles"][0]["vin"] == mock.VIN
        assert client.get("/api/live").json()["ev"][0]["make"] == "BYD"
        assert client.put("/api/byd", json={"username": "", "password": ""}).status_code == 400
        assert client.delete("/api/byd").json()["connected"] is False
        assert client.post("/api/byd/refresh").status_code == 409
