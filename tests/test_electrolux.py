"""Electrolux Group appliances through the Developer API: tokens refreshed and rotated, a refused token refreshed and
asked again, rate limits waited out, the hourly list and five-minutely states, and what a fridge's, a washer's and an
air conditioner's state means. Electrolux is a fake that checks the key and tokens as the real API does: nothing here
touches the network."""

from __future__ import annotations

import base64
import json
import urllib.error
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.home.integrations.electrolux import LIST_EVERY, Electrolux
from app.features.home.integrations.electrolux.appliances import kind_of, program, reading
from app.features.home.integrations.electrolux.client import BASE, ElectroluxClient, token_expiry
from app.features.home.service import HomeService, HomeSetupError
from app.features.home.types import IntegrationError

NOW = 1_790_000_000.0
KEY = "ek-0123456789abcdef"


def jwt(exp: float | None, n: int = 0) -> str:
    """An access token as Electrolux makes them: a JWT (unsigned here: only the payload's read)."""
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")  # noqa: E731
    claims: dict[str, Any] = {"sub": "user-1", "n": n}
    if exp is not None:
        claims["exp"] = int(exp)
    return f"{part({'alg': 'RS256'})}.{part(claims)}.c2lnbmF0dXJl"


# An AEG fridge-freezer (RCB732E9MX), as its state comes from the API.
FRIDGE_STATE: dict[str, Any] = {
    "applianceId": "925058000_00:31862190-443E07363DAB",
    "connectionState": "connected",
    "status": "enabled",
    "properties": {
        "reported": {
            "fridge": {"applianceState": "ON", "fanState": "OFF", "doorState": "CLOSED", "targetTemperatureC": 4.0,
                       "sensorTemperatureC": 3.6, "fastMode": "OFF", "alerts": []},
            "freezer": {"applianceState": "ON", "fanState": "ON", "doorState": "OPEN", "targetTemperatureC": -18.0,
                        "fastMode": "ON", "alerts": [{"severity": "ALERT", "code": "DOOR_OPEN",
                                                      "acknowledgeStatus": "NOT_NEEDED"}]},
            "vacationHolidayMode": "OFF",
            "energySavingMode": "ON",
            "applianceMode": "NORMAL",
            "alerts": [{"severity": "WARNING", "code": "TEMPERATURE_TOO_HIGH", "acknowledgeStatus": "NOT_NEEDED"}],
            "networkInterface": {"linkQualityIndicator": "VERY_GOOD"},
            "connectivityState": "connected",
            "compressorState": "ON",
            "waterFilterState": "GOOD",
        }
    },
}  # fmt: skip
WASHER_STATE: dict[str, Any] = {
    "connectionState": "connected",
    "properties": {
        "reported": {"applianceState": "RUNNING", "timeToEnd": 2700, "cyclePhase": "SPIN", "doorState": "CLOSED",
                     "userSelections": {"programUID": "COTTON_PR_COTTONS"}, "alerts": []}
    },
}  # fmt: skip


class Cloud:
    """A fake Electrolux: one API key, the one access token and one refresh token that work now (a refresh swaps
    both), the account's appliances, and answers to fail with."""

    def __init__(self) -> None:
        self.time = lambda: NOW  # when it is, for the tokens it makes
        self.n = 0
        self.access = jwt(NOW + 43200)
        self.refresh = "refresh-0"
        self.list: list[dict[str, Any]] = [
            {"applianceId": "925058000_00:31862190-443E07363DAB", "applianceName": "Kitchen fridge",
             "applianceType": "CR", "created": "2026-01-02T03:04:05Z"},
        ]  # fmt: skip
        self.infos: dict[str, dict[str, Any]] = {
            "925058000_00:31862190-443E07363DAB": {
                "applianceInfo": {"brand": "AEG", "model": "RCB732E9MX", "pnc": "925058000", "deviceType": "CR"},
                "capabilities": {},
            }
        }
        self.states: dict[str, dict[str, Any]] = {"925058000_00:31862190-443E07363DAB": FRIDGE_STATE}
        self.fail: list[tuple[str, int, dict[str, str]]] = []  # (path suffix, status, headers) to answer next
        self.calls: list[tuple[str, str]] = []
        self.refresh_headers: list[dict[str, str]] = []

    def hits(self, suffix: str) -> int:
        return sum(path.endswith(suffix) for _, path in self.calls)

    def _error(self, url: str, status: int, headers: dict[str, str] | None = None) -> urllib.error.HTTPError:
        return urllib.error.HTTPError(url, status, "error", headers or {}, None)  # type: ignore[arg-type]

    def __call__(self, method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Any:
        assert url.startswith(BASE)
        path = url.removeprefix(BASE)
        self.calls.append((method, path))
        for i, (suffix, status, extra) in enumerate(self.fail):
            if path.endswith(suffix):
                del self.fail[i]
                raise self._error(url, status, extra)
        if path == "/api/v1/token/refresh":
            self.refresh_headers.append(headers)
            given = json.loads(body or b"{}").get("refreshToken")
            if method != "POST" or given != self.refresh:
                raise self._error(url, 401)
            self.n += 1
            self.access, self.refresh = jwt(self.time() + 43200, self.n), f"refresh-{self.n}"
            return {"accessToken": self.access, "expiresIn": 43200, "tokenType": "Bearer",
                    "refreshToken": self.refresh, "scope": "email offline_access"}  # fmt: skip
        if headers.get("x-api-key") != KEY:
            raise self._error(url, 403)
        if headers.get("Authorization") != f"Bearer {self.access}":
            raise self._error(url, 401)
        if path == "/api/v1/appliances":
            return self.list
        for aid in self.infos | self.states:
            if path == f"/api/v1/appliances/{aid}/info" and aid in self.infos:
                return self.infos[aid]
            if path == f"/api/v1/appliances/{aid}/state" and aid in self.states:
                return self.states[aid]
        raise self._error(url, 404)


@pytest.fixture
def cloud(monkeypatch: pytest.MonkeyPatch) -> Cloud:
    c = Cloud()
    monkeypatch.setattr(Electrolux, "transport", staticmethod(c))
    return c


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch, cloud: Cloud) -> dict[str, float]:
    t = {"t": NOW}
    monkeypatch.setattr(Electrolux, "clock", staticmethod(lambda: t["t"]))
    cloud.time = lambda: t["t"]
    return t


def form(cloud: Cloud, access: bool = True) -> dict[str, str]:
    return {"api_key": KEY, "refresh_token": cloud.refresh, "access_token": f"Bearer {cloud.access}" if access else ""}


# -- tokens ------------------------------------------------------------------------------------------------------
def test_an_access_tokens_expiry_is_read_from_it() -> None:
    assert token_expiry(jwt(NOW + 100)) == int(NOW + 100)
    assert token_expiry(jwt(None)) is None
    assert token_expiry("not-a-jwt") is None and token_expiry("a.%%%.c") is None


def test_an_expiring_token_is_refreshed_and_the_new_pair_kept(cloud: Cloud) -> None:
    old_refresh = cloud.refresh
    cloud.access = jwt(NOW + 30)  # less than a minute left
    client = ElectroluxClient(KEY, {"access_token": cloud.access, "refresh_token": old_refresh}, cloud, lambda: NOW)
    assert client.appliances()[0]["applianceName"] == "Kitchen fridge"
    assert cloud.hits("/token/refresh") == 1 and cloud.refresh_headers[0]["x-api-key"] == KEY
    assert client.tokens == {"access_token": cloud.access, "refresh_token": "refresh-1", "expires_at": NOW + 43200}
    # The old refresh token stops working once it's been swapped.
    stale = ElectroluxClient(KEY, {"refresh_token": old_refresh}, cloud, lambda: NOW)
    with pytest.raises(IntegrationError, match="didn't accept the refresh token") as e:
        stale.appliances()
    assert e.value.signed_out


def test_a_refused_access_token_is_refreshed_and_asked_again_once(cloud: Cloud) -> None:
    client = ElectroluxClient(KEY, {"access_token": cloud.access, "refresh_token": cloud.refresh}, cloud, lambda: NOW)
    cloud.access = jwt(NOW + 43200, 99)  # revoked early: the kept one is refused
    assert client.appliances()
    assert cloud.hits("/token/refresh") == 1 and cloud.hits("/appliances") == 2
    assert client.tokens["refresh_token"] == "refresh-1"
    # Refused again even when fresh: the key and tokens need looking at, not retrying forever.
    cloud.fail = [("/appliances", 401, {}), ("/appliances", 401, {})]
    with pytest.raises(IntegrationError, match="didn't accept the API key and access token") as e:
        client.appliances()
    assert e.value.signed_out and cloud.hits("/token/refresh") == 2


def test_a_wrong_api_key_signs_out(cloud: Cloud) -> None:
    client = ElectroluxClient("wrong", {"access_token": cloud.access, "refresh_token": cloud.refresh}, cloud)
    with pytest.raises(IntegrationError, match="didn't accept the API key") as e:
        client.appliances()
    assert e.value.signed_out


def test_rate_limits_and_outages_wait_rather_than_sign_out(cloud: Cloud) -> None:
    client = ElectroluxClient(KEY, {"access_token": cloud.access, "refresh_token": cloud.refresh}, cloud, lambda: NOW)
    cloud.fail = [("/appliances", 429, {"Retry-After": "120"})]
    with pytest.raises(IntegrationError, match="limiting") as e:
        client.appliances()
    assert e.value.retry_after == 120 and not e.value.signed_out
    cloud.fail = [("/appliances", 429, {})]
    with pytest.raises(IntegrationError) as e:
        client.appliances()
    assert e.value.retry_after == 600
    cloud.fail = [("/appliances", 503, {})]
    with pytest.raises(IntegrationError, match=r"problem \(503\)") as e:
        client.appliances()
    assert not e.value.signed_out and e.value.retry_after is None

    def down(*_: Any) -> Any:
        raise urllib.error.URLError("unreachable")

    with pytest.raises(IntegrationError, match="couldn't be reached") as e:
        ElectroluxClient(KEY, {"access_token": cloud.access}, down, lambda: NOW).appliances()
    assert not e.value.signed_out


# -- what appliances report ------------------------------------------------------------------------------------------
ENTRY = {"name": "Kitchen fridge", "type": "CR", "brand": "AEG", "model": "RCB732E9MX", "pnc": "925058000"}


def test_a_fridge_freezer_shows_its_temperatures_doors_and_alerts() -> None:
    r = reading("f1", ENTRY, FRIDGE_STATE)
    assert (r.kind, r.name, r.model, r.online) == ("fridge", "Kitchen fridge", "RCB732E9MX", True)
    assert r.power_w is None and r.energy_kwh is None and r.running is None  # it doesn't report its power
    assert r.details == {
        "Fridge": "3.6 °C (set to 4 °C)",
        "Freezer": "Set to -18 °C",
        "Fast freeze": "On",
        "Door": "Freezer open",
        "Eco mode": "On",
        "Alerts": "Temperature too high, Freezer: door open",
    }
    assert r.info == {"Brand": "AEG", "Product number": "925058000", "Signal": "Very good",
                      "Compressor": "On", "Water filter": "Good"}  # fmt: skip
    assert r.raw["reported"]["fridge"]["targetTemperatureC"] == 4.0


def test_a_closed_fridge_on_holiday_and_one_thats_offline() -> None:
    reported = json.loads(json.dumps(FRIDGE_STATE["properties"]["reported"]))
    reported["freezer"].update(doorState="CLOSED", alerts=[], fastMode="OFF")
    reported.update(alerts=[], vacationHolidayMode="ON", energySavingMode="OFF", defrostRoutineState="DEFROSTING")
    r = reading("f1", ENTRY, {"connectionState": "connected", "properties": {"reported": reported}})
    assert r.details["Door"] == "Closed" and r.details["Holiday mode"] == "On" and r.details["Defrost"] == "Defrosting"
    assert "Alerts" not in r.details and "Eco mode" not in r.details
    offline = reading("f1", ENTRY, {**FRIDGE_STATE, "connectionState": "disconnected"})
    assert not offline.online
    unread = reading("f1", ENTRY, None)
    assert not unread.online and unread.details == {} and unread.info["Brand"] == "AEG"


def test_appliance_types_and_unknown_ones() -> None:
    assert kind_of("CR") == "fridge" and kind_of("CR", None, {"freezer": {}}) == "freezer"
    assert [kind_of(t) for t in ("WM", "TD", "WD", "DW", "OV", "Azul", "DAM_AC")] == [
        "washer", "dryer", "washer_dryer", "dishwasher", "oven", "air_conditioner", "air_conditioner"]  # fmt: skip
    assert kind_of("NEW", {"applianceInfo": {"deviceType": "WASHING_MACHINE"}}) == "washer"
    assert kind_of("PUREA9") == "other" and kind_of("") == "other"
    purifier = reading("p1", {"name": "Purifier", "type": "PUREA9"},
                       {"connectionState": "connected", "properties": {"reported": {"applianceState": "RUNNING",
                                                                                    "Workmode": "Auto"}}})  # fmt: skip
    assert (purifier.kind, purifier.details) == ("other", {"Status": "Running"})
    empty = reading("x1", {}, {"connectionState": "connected"})  # no properties at all
    assert empty.kind == "other" and empty.online and empty.details == {}


def test_a_washer_mid_cycle_and_finished() -> None:
    r = reading("w1", {"name": "Washer", "type": "WM"}, WASHER_STATE)
    assert (r.kind, r.running, r.program, r.phase, r.remaining_min) == ("washer", True, "Cotton", "Spin", 45)
    done = {"connectionState": "connected", "properties": {"reported": {"applianceState": "END_OF_CYCLE",
                                                                        "timeToEnd": 0, "doorState": "OPEN"}}}  # fmt: skip
    r = reading("w1", {"name": "Washer", "type": "WM"}, done)
    assert (r.running, r.program, r.remaining_min) == (False, None, None)
    assert r.details == {"Status": "Finished", "Door": "Open"}
    assert program({"program": "CONVENTIONAL_COOKING"}) == "Conventional cooking" and program({}) is None


def test_an_air_conditioner_on_and_off() -> None:
    on = {"connectionState": "connected", "properties": {"reported": {"applianceState": "RUNNING", "mode": "COOL",
          "targetTemperatureC": 23, "ambientTemperatureC": 26.5, "fanSpeedSetting": "AUTO"}}}  # fmt: skip
    r = reading("a1", {"name": "Lounge", "type": "AC", "brand": "Westinghouse"}, on)
    assert r.kind == "air_conditioner"
    assert r.details == {"Status": "On", "Mode": "Cool", "Set to": "23 °C", "Room": "26.5 °C", "Fan": "Auto"}
    off = {"connectionState": "connected", "properties": {"reported": {"applianceState": "OFF",
           "ambientTemperatureC": 21}}}  # fmt: skip
    assert reading("a1", {"type": "AC"}, off).details == {"Status": "Off", "Room": "21 °C"}


# -- connecting and polling --------------------------------------------------------------------------------------
@pytest.fixture
def home(db: Database, config: Config, clock: dict[str, float]) -> HomeService:
    return HomeService(config, db, {"electrolux": Electrolux}, clock=lambda: clock["t"])


def test_connecting_keeps_the_key_and_tokens_but_never_shows_them(cloud: Cloud, home: HomeService) -> None:
    with pytest.raises(HomeSetupError, match="Enter your refresh token"):
        home.connect("electrolux", {"api_key": KEY})
    view = home.connect("electrolux", form(cloud))
    (account,) = home.repo.accounts()
    assert account.saved["api_key"] == KEY and account.saved["access_token"] == cloud.access  # "Bearer " dropped
    fridge = account.saved["appliances"]["925058000_00:31862190-443E07363DAB"]
    assert (fridge["model"], fridge["brand"], fridge["name"]) == ("RCB732E9MX", "AEG", "Kitchen fridge")
    shown = json.dumps(view)
    assert KEY not in shown and cloud.access not in shown and cloud.refresh not in shown
    integration = view["integrations"][0]
    assert integration["account"]["label"] == "1 appliance · key ek…ef"
    assert [f["key"] for f in integration["fields"] if f["secret"]] == ["api_key", "refresh_token", "access_token"]
    assert cloud.hits("/token/refresh") == 0  # the access token given was current


def test_connecting_with_just_the_refresh_token_and_refusals(cloud: Cloud, home: HomeService) -> None:
    cloud.list = []
    with pytest.raises(HomeSetupError, match=r"no appliances.*swapped for others") as e:
        home.connect("electrolux", form(cloud, access=False))
    assert e.value.status == 502
    cloud.list = Cloud().list
    with pytest.raises(HomeSetupError, match="didn't accept the API key") as e:
        home.connect("electrolux", {**form(cloud), "api_key": "wrong"})
    assert e.value.status == 422
    home.connect("electrolux", form(cloud, access=False))
    assert home.repo.accounts()[0].saved["refresh_token"] == cloud.refresh == "refresh-2"


def test_polls_rotate_tokens_list_hourly_and_read_states_every_poll(
    cloud: Cloud, home: HomeService, clock: dict[str, float]
) -> None:
    home.connect("electrolux", form(cloud))
    account_id = home.repo.accounts()[0].id
    assert cloud.hits("/appliances") == 1 and cloud.hits("/info") == 1
    home.poll(account_id)
    (device,) = home.repo.devices()
    assert (device.kind, device.name, device.model) == ("fridge", "Kitchen fridge", "RCB732E9MX")
    assert home.now()[device.id]["details"]["Door"] == "Freezer open"
    assert home.now()[device.id]["info"]["Signal"] == "Very good"

    # Half a day on, the access token's expiring: it's refreshed, and the new pair is what's saved.
    clock["t"] = NOW + 43200 - 30
    home.poll(account_id)
    saved = home.repo.accounts()[0].saved
    assert saved["refresh_token"] == "refresh-1" and saved["access_token"] == cloud.access
    # The list was asked for again (it's been over an hour); the fridge's info wasn't (it's known).
    assert cloud.hits("/appliances") == 2 and cloud.hits("/info") == 1
    clock["t"] += Electrolux.poll_seconds
    home.poll(account_id)
    assert cloud.hits("/appliances") == 2 and cloud.hits("/state") == 3  # not within the hour
    assert Electrolux.poll_seconds == 300 and LIST_EVERY == 3600
    # A day of polls stays well inside the free tier's 5,000 requests for a handful of appliances.
    assert 86400 / Electrolux.poll_seconds * 10 + 24 < 5000


def test_tokens_refreshed_by_a_poll_that_then_fails_are_still_kept(
    cloud: Cloud, home: HomeService, clock: dict[str, float]
) -> None:
    home.connect("electrolux", form(cloud))
    account_id = home.repo.accounts()[0].id
    clock["t"] = NOW + 43200  # expired: refreshed first, then the state fails
    cloud.fail = [("/appliances", 503, {}), ("/state", 503, {})]
    home.poll(account_id)
    account = home.repo.accounts()[0]
    assert account.state["error"] and not account.state["signed_out"]
    assert account.saved["refresh_token"] == cloud.refresh == "refresh-1"  # else the next poll would be signed out
    home.poll(account_id)
    assert home.repo.accounts()[0].state["error"] is None


def test_a_rate_limit_waits_as_long_as_it_says(cloud: Cloud, home: HomeService, clock: dict[str, float]) -> None:
    home.connect("electrolux", form(cloud))
    account_id = home.repo.accounts()[0].id
    cloud.fail = [("/state", 429, {"Retry-After": "900"})]
    home.poll(account_id)
    state = home.repo.accounts()[0].state
    assert state["retry_at"] == int(NOW) + 900 and "limiting" in state["error"]
    calls = len(cloud.calls)
    clock["t"] = NOW + 600
    home.poll_due()
    assert len(cloud.calls) == calls  # still waiting
    clock["t"] = NOW + 901
    home.poll_due()
    assert home.repo.accounts()[0].state["error"] is None


def test_one_appliance_that_cant_be_read_is_offline_the_rest_carry_on(
    cloud: Cloud, home: HomeService, clock: dict[str, float]
) -> None:
    cloud.list.append({"applianceId": "914501000_00:1-AB", "applianceName": "Washer", "applianceType": "WM"})
    cloud.states["914501000_00:1-AB"] = WASHER_STATE
    home.connect("electrolux", form(cloud))
    account_id = home.repo.accounts()[0].id
    cloud.fail = [("925058000_00:31862190-443E07363DAB/state", 404, {})]
    home.poll(account_id)
    now = {d.name: home.now()[d.id] for d in home.repo.devices()}
    assert not now["Kitchen fridge"]["online"] and now["Washer"]["running"]
    assert now["Washer"]["remaining_min"] == 45
    assert home.repo.accounts()[0].state["error"] is None
    # The washer's info failed when it was listed: it's asked again at the next listing.
    assert home.repo.accounts()[0].saved["appliances"]["914501000_00:1-AB"].get("described") is None
    clock["t"] = NOW + LIST_EVERY
    cloud.infos["914501000_00:1-AB"] = {"applianceInfo": {"brand": "ELECTROLUX", "model": "EWF9042Q7WB"}}
    home.poll(account_id)
    assert home.repo.accounts()[0].saved["appliances"]["914501000_00:1-AB"]["brand"] == "Electrolux"
    # When none can be read, the poll fails and says why.
    cloud.fail = [("/state", 503, {}), ("/state", 503, {})]
    home.poll(account_id)
    assert "problem (503)" in home.repo.accounts()[0].state["error"]
