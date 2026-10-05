"""Hisense appliances through ConnectLife: signing in, keeping tokens fresh, the gateway's signature and retries, and
what a washer's and dryer's properties mean. Every request is answered by a fake: nothing here touches the network."""

from __future__ import annotations

import base64
import hashlib
import json
import urllib.error
import urllib.parse
from collections.abc import Iterator
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.home.integrations import connectlife as cl
from app.features.home.integrations.connectlife import ConnectLife, appliances
from app.features.home.integrations.connectlife import client as cl_client
from app.features.home.integrations.connectlife.client import (
    DEVICE_LIST,
    GIGYA_JWT,
    GIGYA_LOGIN,
    OAUTH_AUTHORIZE,
    OAUTH_TOKEN,
    SIGN_SUFFIX,
    ConnectLifeClient,
    sign,
)
from app.features.home.service import HomeService, HomeSetupError
from app.features.home.types import IntegrationError

NOW = 1_790_000_000.0
FORM = {"email": "me@example.com", "password": "hunter22"}


def washer(**status: Any) -> dict[str, Any]:
    """A Hisense front-loader as the device list has it (an Australian Series 8i)."""
    return {
        "puid": "pu0000washer",
        "deviceId": "dev-w",
        "deviceNickName": "Washer",
        "deviceTypeCode": "025",
        "deviceTypeName": "Washing machine",
        "deviceFeatureCode": "1wfj1000018v",
        "deviceFeatureName": "WF5i1015-QVB002-000",
        "offlineState": 1,
        "statusList": {"machine_status": "1", "Current_program_phase": "0", "Electricit_consumption_int": "0",
                       "Electricit_consumption_decimal": "0", **status},
    }  # fmt: skip


class Cloud:
    """A fake ConnectLife: answers each request by its URL, and keeps what it was asked."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, Any]] = []
        self.login: dict[str, Any] = {"UID": "uid-1", "sessionInfo": {"cookieValue": "cookie-1"}}
        self.issued = 0
        self.refresh_ok = True
        self.devices: list[dict[str, Any]] = [washer()]
        self.gateway_errors: list[int] = []  # errorCodes to answer the next device-list requests with

    def __call__(self, method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Any:
        base, _, query = url.partition("?")
        if headers.get("Content-Type") == "application/json":
            sent: Any = json.loads(body or b"{}")
        else:
            sent = dict(urllib.parse.parse_qsl((body or b"").decode() or query))
        self.calls.append((method, base, sent))
        if base == GIGYA_LOGIN:
            return self.login
        if base == GIGYA_JWT:
            return {"id_token": "jwt-1"}
        if base == OAUTH_AUTHORIZE:
            return {"code": "code-1"}
        if base == OAUTH_TOKEN:
            if sent["grant_type"] == "refresh_token" and not self.refresh_ok:
                raise urllib.error.HTTPError(url, 401, "Unauthorized", {}, None)  # type: ignore[arg-type]
            self.issued += 1
            return {"access_token": f"access-{self.issued}", "expires_in": 1440, "refresh_token": f"refresh-{self.issued}",
                    "refreshTokenExpiredTime": int((NOW + 30 * 86400) * 1000)}  # fmt: skip
        if base == DEVICE_LIST:
            if self.gateway_errors:
                return {"response": {"resultCode": 1, "errorCode": self.gateway_errors.pop(0), "errorDesc": "no"}}
            return {"response": {"resultCode": 0, "deviceList": self.devices}}
        raise AssertionError(f"unexpected request to {url}")

    def hits(self, url: str) -> list[Any]:
        return [sent for _, base, sent in self.calls if base == url]


@pytest.fixture
def cloud(monkeypatch: pytest.MonkeyPatch) -> Iterator[Cloud]:
    fake = Cloud()
    monkeypatch.setattr(ConnectLife, "transport", staticmethod(fake))
    yield fake


def client(cloud: Cloud, tokens: dict[str, Any] | None = None) -> ConnectLifeClient:
    return ConnectLifeClient(FORM["email"], FORM["password"], tokens, transport=cloud, clock=lambda: NOW)


# -- signing in ------------------------------------------------------------------------------------------
def test_signing_in_goes_through_gigya_then_oauth(cloud: Cloud) -> None:
    c = client(cloud)
    c.sign_in()
    (login,) = cloud.hits(GIGYA_LOGIN)
    assert login == {"loginID": "me@example.com", "password": "hunter22", "APIKey": cl_client.GIGYA_KEY}
    assert cloud.hits(GIGYA_JWT) == [{"APIKey": cl_client.GIGYA_KEY, "login_token": "cookie-1"}]
    (authorize,) = cloud.hits(OAUTH_AUTHORIZE)
    assert authorize["idToken"] == "jwt-1" and authorize["thirdClientId"] == "uid-1" and authorize["thirdType"] == "CDC"
    (token,) = cloud.hits(OAUTH_TOKEN)
    assert token["grant_type"] == "authorization_code" and token["code"] == "code-1"
    assert c.tokens == {"access_token": "access-1", "expires_at": NOW + 1440, "refresh_token": "refresh-1",
                        "refresh_expires_at": NOW + 30 * 86400}  # fmt: skip


@pytest.mark.parametrize(
    ("answer", "says", "signed_out"),
    [
        ({"errorCode": 403042, "errorMessage": "Invalid LoginID"}, "didn't accept that email and password", True),
        ({"errorCode": 206001, "errorMessage": "Account Pending Registration"}, "accept its updated terms", True),
        ({"errorCode": 403048, "errorMessage": "Api rate limit exceeded"}, "limiting sign-ins", False),
    ],
)
def test_a_refused_sign_in_says_why(cloud: Cloud, answer: dict[str, Any], says: str, signed_out: bool) -> None:
    cloud.login = answer
    with pytest.raises(IntegrationError, match=says) as e:
        client(cloud).sign_in()
    assert e.value.signed_out is signed_out


def test_an_unreachable_cloud_isnt_a_bad_password() -> None:
    def down(*_: Any) -> Any:
        raise urllib.error.URLError("no route")

    with pytest.raises(IntegrationError, match="couldn't be reached") as e:
        ConnectLifeClient("a", "b", transport=down).sign_in()
    assert not e.value.signed_out


# -- tokens ---------------------------------------------------------------------------------------------
FRESH = {"access_token": "kept", "expires_at": NOW + 600, "refresh_token": "r", "refresh_expires_at": NOW + 86400}


def test_a_current_token_is_used_as_it_is(cloud: Cloud) -> None:
    client(cloud, FRESH).appliances()
    assert [base for _, base, _ in cloud.calls] == [DEVICE_LIST]
    assert cloud.hits(DEVICE_LIST)[0]["accessToken"] == "kept"


def test_an_expiring_token_is_refreshed_and_a_refused_refresh_signs_in_again(cloud: Cloud) -> None:
    c = client(cloud, {**FRESH, "expires_at": NOW + 30})  # within RENEW_EARLY of expiring
    c.appliances()
    assert [t["grant_type"] for t in cloud.hits(OAUTH_TOKEN)] == ["refresh_token"] and not cloud.hits(GIGYA_LOGIN)
    cloud.refresh_ok = False
    c = client(cloud, {**FRESH, "expires_at": NOW - 1})
    c.appliances()
    assert len(cloud.hits(GIGYA_LOGIN)) == 1 and c.tokens["access_token"] == "access-2"
    # A refresh token past its time isn't tried.
    cloud.calls.clear()
    client(cloud, {**FRESH, "expires_at": NOW - 1, "refresh_expires_at": NOW - 1}).appliances()
    assert [t["grant_type"] for t in cloud.hits(OAUTH_TOKEN)] == ["authorization_code"]


def test_the_gateway_refusing_the_token_signs_in_again_once(cloud: Cloud) -> None:
    cloud.gateway_errors = [cl_client.TOKEN_REFUSED]
    assert len(client(cloud, FRESH).appliances()) == 1
    assert len(cloud.hits(GIGYA_LOGIN)) == 1 and len(cloud.hits(DEVICE_LIST)) == 2
    cloud.gateway_errors = [cl_client.TOKEN_REFUSED, cl_client.TOKEN_REFUSED]
    with pytest.raises(IntegrationError, match="100026"):
        client(cloud, FRESH).appliances()


def test_a_refused_random_string_is_retried_with_a_fresh_one(cloud: Cloud) -> None:
    cloud.gateway_errors = [cl_client.RANDSTR_REFUSED]
    client(cloud, FRESH).appliances()
    first, second = cloud.hits(DEVICE_LIST)
    assert first["randStr"] != second["randStr"] and not cloud.hits(GIGYA_LOGIN)


# -- the gateway's signature ----------------------------------------------------------------------------
def test_gateway_requests_are_signed_over_their_sorted_fields(cloud: Cloud, monkeypatch: pytest.MonkeyPatch) -> None:
    client(cloud, FRESH).appliances()
    (sent,) = cloud.hits(DEVICE_LIST)
    assert {"accessToken", "appId", "appSecret", "languageId", "randStr", "timeStamp", "timezone", "version",
            "sign"} == set(sent)  # fmt: skip
    assert len(sent["randStr"]) == 32 and sent["timeStamp"] == str(int(NOW * 1000))
    assert len(base64.b64decode(sent["sign"])) == 256  # RSA-2048, encrypted to the gateway's key

    class Clear:  # what's encrypted, unencrypted, to check it
        @staticmethod
        def new(_: Any) -> Any:
            return Clear()

        def encrypt(self, data: bytes) -> bytes:
            return data

    monkeypatch.setattr(cl_client, "PKCS1_v1_5", Clear)
    expected = hashlib.sha256(f'a=1&b={{"x":[1,2]}}&c=z{SIGN_SUFFIX}'.encode()).digest()
    assert base64.b64decode(sign({"c": "z", "a": 1, "b": {"x": [1, 2]}, "sign": "old"})) == expected


# -- what the properties mean ---------------------------------------------------------------------------
def test_a_washer_mid_cycle() -> None:
    r = appliances.reading(washer(machine_status="2", Current_program_phase="3", Selected_program_ID="9",
                                  Remaining_time_of_selected_program="42"))  # fmt: skip
    assert r is not None
    assert (r.key, r.kind, r.model, r.online) == ("pu0000washer", "washer", "WF5i1015-QVB002-000", True)
    assert r.running and r.phase == "Washing" and r.remaining_min == 42 and r.energy_kwh == 0
    assert r.counter == "cycle" and r.power_w is None and r.details == {"Program": "No. 9"}
    assert r.raw["statusList"]["Current_program_phase"] == "3" and r.raw["deviceTypeCode"] == "025"


def test_a_finished_wash_reports_its_energy_and_water() -> None:
    r = appliances.reading(washer(machine_status="2", Current_program_phase="10", Electricit_consumption_int="0",
                                  Electricit_consumption_decimal="54", Water_consumption_int="48",
                                  Water_consumption_decimal="50"))  # fmt: skip
    assert r is not None and r.running is False and r.energy_kwh == 0.54 and r.phase is None
    assert r.details == {"Water last cycle": "48.5 L"}


@pytest.mark.parametrize(
    ("status", "running"),
    [
        ({"machine_status": "3", "Current_program_phase": "4"}, True),  # paused part-way
        ({"machine_status": "2", "Current_program_phase": "11"}, False),  # waiting for a delayed start
        ({"machine_status": "1", "Current_program_phase": "0"}, False),
        ({"Current_program_phase": "3"}, None),  # no machine status: it can't be told
    ],
)
def test_when_a_washer_counts_as_running(status: dict[str, str], running: bool | None) -> None:
    d = washer()
    d["statusList"] = status
    r = appliances.reading(d)
    assert r is not None and r.running is running


def test_a_dryer_keeps_running_through_anti_crease_until_its_finished() -> None:
    dryer = {**washer(), "puid": "pu0000dryer", "deviceTypeCode": "030", "deviceNickName": "Dryer"}
    for phase, running, name in [("2", True, "Drying"), ("4", True, "Anti-crease"), ("5", False, None)]:
        dryer["statusList"] = {"machine_status": "2", "Current_program_phase": phase}
        r = appliances.reading(dryer)
        assert r is not None and (r.kind, r.running, r.phase) == ("dryer", running, name)


def test_other_appliances_offline_ones_and_odd_entries() -> None:
    fridge = {"puid": "pu0000fridge", "deviceTypeCode": "019", "deviceTypeName": "Refrigerator", "offlineState": 0,
              "statusList": {" Fridge_temp ": "3"}}  # fmt: skip
    r = appliances.reading(fridge)
    assert r is not None and (r.kind, r.online, r.running, r.energy_kwh) == ("fridge", False, None, None)
    assert r.raw["statusList"] == {"Fridge_temp": "3"}  # keys trimmed
    no_status = {k: v for k, v in washer().items() if k != "statusList"}
    r = appliances.reading(no_status)
    assert r is not None and r.running is None and r.energy_kwh is None
    assert appliances.reading({"deviceTypeName": "Washing machine"}) is None  # no id to know it by again
    assert appliances.kind_of({"deviceTypeName": "Dishwasher"}) == "dishwasher"
    assert appliances.kind_of({"deviceTypeName": "Split air conditioner"}) == "air_conditioner"
    errored = washer(error_code="100", machine_status="4")
    r = appliances.reading(errored)
    assert r is not None and r.details == {"Status": "Alarm", "Error": "Unbalanced load"}


# -- through the dashboard ------------------------------------------------------------------------------
@pytest.fixture
def home(db: Database, config: Config) -> HomeService:
    return HomeService(config, db, {"connectlife": ConnectLife}, clock=lambda: NOW)


def test_connecting_keeps_the_tokens_and_password_but_never_shows_them(cloud: Cloud, home: HomeService) -> None:
    with pytest.raises(HomeSetupError, match="Enter your password"):
        home.connect("connectlife", {"email": "me@example.com"})
    cloud.login = {"errorCode": 403042, "errorMessage": "Invalid LoginID"}
    with pytest.raises(HomeSetupError, match="didn't accept") as e:
        home.connect("connectlife", FORM)
    assert e.value.status == 422
    cloud.login = {"UID": "uid-1", "sessionInfo": {"cookieValue": "cookie-1"}}
    view = home.connect("connectlife", FORM)
    (account,) = home.repo.accounts()
    assert account.saved["password"] == "hunter22" and account.saved["access_token"] == "access-1"
    shown = json.dumps(view)
    assert "hunter22" not in shown and "access-1" not in shown and "refresh-1" not in shown
    assert view["integrations"][0]["account"]["label"] == "me@example.com"


def test_a_wash_through_the_dashboard(cloud: Cloud, db: Database, config: Config) -> None:
    clock = {"t": NOW}
    home = HomeService(config, db, {"connectlife": ConnectLife}, clock=lambda: clock["t"])
    home.connect("connectlife", FORM)
    cycle = [
        {"machine_status": "1", "Current_program_phase": "0"},
        {"machine_status": "2", "Current_program_phase": "1"},
        {"machine_status": "2", "Current_program_phase": "3", "Remaining_time_of_selected_program": "50"},
        {"machine_status": "2", "Current_program_phase": "4"},
        {"machine_status": "2", "Current_program_phase": "7"},
        # Finished: the energy shows now (on some models a poll later), then goes back to 0.
        {"machine_status": "2", "Current_program_phase": "10"},
        {"machine_status": "2", "Current_program_phase": "10", "Electricit_consumption_decimal": "54"},
        {"machine_status": "1", "Current_program_phase": "0"},
    ]
    for n, status in enumerate(cycle):
        clock["t"] = NOW + n * 600  # every 10 minutes
        cloud.devices = [washer(**status)]
        home.poll(home.repo.accounts()[0].id)
    (run,) = home.repo.runs(0, 2**40)
    assert (run["start"], run["end"], run["kwh"]) == (NOW + 600, NOW + 5 * 600, pytest.approx(0.54))
    energy = home.repo.energy(0, 2**40)
    assert sum(kwh for _, _, kwh in energy) == pytest.approx(0.54)
    # Spread across the wash (since the reading before it started, to when it finished), not dumped at the end.
    assert min(ts for ts, _, _ in energy) <= NOW + 300 and max(ts for ts, _, _ in energy) < NOW + 5 * 600
    # Polls kept the tokens they were given, and only signed in once.
    assert len(cloud.hits(GIGYA_LOGIN)) == 1
    assert home.repo.accounts()[0].saved["access_token"] == "access-1"
    assert cl.ConnectLife.poll_seconds == 60
