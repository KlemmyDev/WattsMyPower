"""Alerts: the rules, their debounce, cooldown and resolve, delivery, masking, and the API. Nothing is
ever sent for real: every channel posts through a fake, and the network is blocked outright."""

from __future__ import annotations

import asyncio
import io
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from email.message import Message as Headers
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.alerts import sun
from app.features.alerts.channels import MASK
from app.features.alerts.rules import Facts
from app.features.alerts.service import RETRY, AlertsService
from app.features.live.service import LiveService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore
from app.main import create_app

T0 = time.mktime((2026, 10, 2, 11, 0, 0, 0, 0, -1))  # late morning, local time
MIN = 60
HOUR = 3600
NTFY = {"url": "https://ntfy.sh/klemm-solar", "token": "tk_abcdefghijklmnop1234"}


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Whatever happens, no test sends a real notification."""

    def refuse(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("a test tried to reach the network")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)


class FakeSend:
    """Stands in for app.core.http.post: records each request, and fails on cue."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.fail: dict[str, Exception] = {}  # host -> what to raise

    def __call__(self, url: str, body: bytes, content_type: str, headers: dict[str, str]) -> int:
        host = urllib.parse.urlsplit(url).netloc
        if host in self.fail:
            raise self.fail[host]
        decoded = (
            json.loads(body) if content_type == "application/json" else dict(urllib.parse.parse_qsl(body.decode()))
        )
        self.sent.append({"url": url, "body": decoded, "headers": headers})
        return 200

    def titles(self) -> list[str]:
        return [s["body"].get("title", "") for s in self.sent]


def http_error(url: str, code: int, body: dict[str, Any]) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(url, code, "nope", Headers(), io.BytesIO(json.dumps(body).encode()))


@pytest.fixture
def send() -> FakeSend:
    return FakeSend()


def make_service(db: Database, config: Config, send: FakeSend) -> AlertsService:
    settings = SettingsStore(db, config)
    settings.load()
    tariffs = TariffStore(db, config)
    tariffs.load()
    readings = ReadingsRepository(db, config.poll_interval, config.raw_retention_days)
    live = LiveService(config, settings, tariffs)
    return AlertsService(db, live, settings, readings, tariffs, None, send)  # type: ignore[arg-type]


@pytest.fixture
def alerts(db: Database, config: Config, send: FakeSend) -> AlertsService:
    return make_service(db, config, send)


@pytest.fixture
def on(alerts: AlertsService) -> AlertsService:
    """Alerts with an ntfy channel set up."""
    alerts.save_channel("ntfy", dict(NTFY))
    return alerts


def facts(now: float, **changes: Any) -> Facts:
    """A healthy system at `now`, with `changes`."""
    base: dict[str, Any] = {
        "now": now,
        "snapshot": {"ts": now, "battery_soc": 60.0, "grid_power": 100.0, "battery_power": 0.0},
        "hybrid_connected": True,
        "last_success": now,
        "error": None,
        "poll_interval": 60,
        "pv2": None,
        "reserve": 5.0,
        "sun": 40.0,
        "daylight_since": now - 4 * HOUR,
    }
    return Facts(**{**base, **changes})


def offline(now: float, since: float) -> Facts:
    return facts(now, last_success=since, snapshot={"ts": since, "battery_soc": 60.0})


def history(alerts: AlertsService) -> list[tuple[str, str, str]]:
    return [(e["rule"], e["kind"], e["status"]) for e in reversed(alerts.history())]


# -- the engine ------------------------------------------------------------------------
def test_nothing_is_evaluated_until_a_channel_is_set_up(alerts: AlertsService, send: FakeSend) -> None:
    for k in range(60):
        alerts.evaluate(offline(T0 + k * MIN, T0 - HOUR))
    assert send.sent == [] and alerts.history() == [] and alerts.repo.states() == {}
    assert alerts.overview()["enabled"] is False


def test_inverter_offline_waits_for_its_minutes_then_alerts_once_and_resolves(
    on: AlertsService, send: FakeSend
) -> None:
    down = T0 - 2 * MIN
    for k in range(0, 13):  # under 15 minutes without a reading: not yet
        on.evaluate(offline(T0 + k * MIN, down))
    assert send.sent == []
    on.evaluate(offline(T0 + 13 * MIN, down))  # 15 minutes since the last reading
    assert send.titles() == ["Your inverter isn't answering"]
    body = send.sent[0]["body"]
    assert body["priority"] == 4 and body["topic"] == "klemm-solar" and send.sent[0]["url"] == "https://ntfy.sh/"
    assert f"since {time.strftime('%H:%M', time.localtime(down))}" in body["message"]
    for k in range(14, 120):  # still down for hours: no repeats
        on.evaluate(offline(T0 + k * MIN, down))
    assert len(send.sent) == 1
    on.evaluate(facts(T0 + 2 * HOUR))
    assert send.titles()[-1] == "Your inverter is back"
    assert "after 1 hour 47 minutes" in send.sent[-1]["body"]["message"]
    assert history(on) == [("inverter_offline", "alert", "sent"), ("inverter_offline", "resolved", "sent")]
    assert on.history()[1]["resolved_at"] == int(T0 + 2 * HOUR)


def test_a_problem_must_persist_through_the_debounce(on: AlertsService, send: FakeSend) -> None:
    exporting = {"ts": T0, "battery_soc": 50.0, "grid_power": -2500.0, "battery_power": 0.0}
    cloud = {"battery_soc": 50.0, "grid_power": 200.0, "battery_power": 0.0}
    t = T0
    for _ in range(25):  # 25 minutes, then a cloud: not long enough, and it starts over
        on.evaluate(facts(t, snapshot={**exporting, "ts": t}))
        t += MIN
    on.evaluate(facts(t, snapshot={**cloud, "ts": t}))
    for _ in range(30):  # 29 minutes since it was seen again
        t += MIN
        on.evaluate(facts(t, snapshot={**exporting, "ts": t}))
    assert send.sent == []
    t += MIN
    on.evaluate(facts(t, snapshot={**exporting, "ts": t}))
    assert send.titles() == ["Battery isn't charging"]
    assert "sending 2.5 kW to the grid" in send.sent[0]["body"]["message"]
    on.evaluate(facts(t + MIN, snapshot={**exporting, "battery_power": -1800.0, "ts": t + MIN}))
    assert send.titles()[-1] == "Battery charging again"


def test_cooldown_holds_back_a_problem_that_comes_and_goes(on: AlertsService, send: FakeSend) -> None:
    on.evaluate(offline(T0, T0 - 20 * MIN))
    on.evaluate(facts(T0 + 5 * MIN))  # back: resolved
    on.evaluate(offline(T0 + 30 * MIN, T0 + 10 * MIN))  # down again, 20 minutes in, but within the hour
    assert send.titles() == ["Your inverter isn't answering", "Your inverter is back"]
    on.evaluate(offline(T0 + 61 * MIN, T0 + 10 * MIN))  # the hour's up and it's still down
    assert send.titles()[-1] == "Your inverter isn't answering" and len(send.sent) == 3


def test_alerts_survive_a_restart(db: Database, config: Config, send: FakeSend) -> None:
    first = make_service(db, config, send)
    first.save_channel("ntfy", dict(NTFY))
    first.evaluate(offline(T0, T0 - 20 * MIN))
    assert len(send.sent) == 1

    again = make_service(db, config, send)  # the API restarted
    for k in range(1, 30):
        again.evaluate(offline(T0 + k * MIN, T0 - 20 * MIN))
    assert len(send.sent) == 1  # not sent again
    assert again.overview()["rules"][0]["active_since"] == T0
    again.evaluate(facts(T0 + HOUR))
    assert send.titles()[-1] == "Your inverter is back"


def test_a_debounce_in_progress_survives_a_restart(db: Database, config: Config, send: FakeSend) -> None:
    exporting = {"battery_soc": 50.0, "grid_power": -1500.0, "battery_power": 0.0}
    first = make_service(db, config, send)
    first.save_channel("ntfy", dict(NTFY))
    first.evaluate(facts(T0, snapshot={**exporting, "ts": T0}))
    again = make_service(db, config, send)
    again.evaluate(facts(T0 + 30 * MIN, snapshot={**exporting, "ts": T0 + 30 * MIN}))
    assert send.titles() == ["Battery isn't charging"]


def test_second_inverter_is_left_alone_after_dark(on: AlertsService, send: FakeSend) -> None:
    pv2 = {"host": "192.168.0.10", "brand": "Sungrow", "model": "SG5K-D", "last_success": None}
    dusk = T0 + 7 * HOUR
    pv2["last_success"] = dusk
    night = [dusk + k * 10 * MIN for k in range(1, 70)]  # all night, asleep
    for t in night:
        on.evaluate(facts(t, pv2=pv2, sun=-20.0, daylight_since=None))
    assert send.sent == []

    sunrise = dusk + 12 * HOUR
    for k in range(0, 30):  # the sun's up, but it's allowed half an hour to wake
        on.evaluate(facts(sunrise + k * MIN, pv2=pv2, sun=15.0, daylight_since=sunrise))
    assert send.sent == []
    on.evaluate(facts(sunrise + 30 * MIN, pv2=pv2, sun=18.0, daylight_since=sunrise))
    assert send.titles() == ["Your second inverter isn't answering"]
    assert "Your Sungrow SG5K-D hasn't answered since" in send.sent[0]["body"]["message"]

    # Still out at dusk: it isn't called resolved just because it's dark again.
    for k in range(1, 40):
        on.evaluate(facts(sunrise + 12 * HOUR + k * 10 * MIN, pv2=pv2, sun=-10.0, daylight_since=None))
    assert len(send.sent) == 1
    on.evaluate(facts(sunrise + 25 * HOUR, pv2={**pv2, "last_success": sunrise + 25 * HOUR}))
    assert send.titles()[-1] == "Your second inverter is back"


def test_second_inverter_alert_waits_while_the_main_one_is_down(on: AlertsService, send: FakeSend) -> None:
    pv2 = {"host": "192.168.0.10", "last_success": T0 - 2 * HOUR}
    for k in range(0, 90):
        on.evaluate(facts(T0 + k * MIN, pv2=pv2, last_success=T0 - 2 * HOUR))
    assert send.titles() == ["Your inverter isn't answering"]


def test_battery_low_with_hysteresis(on: AlertsService, send: FakeSend) -> None:
    def soc(t: float, v: float) -> Facts:
        return facts(t, snapshot={"ts": t, "battery_soc": v})

    on.evaluate(soc(T0, 9))
    on.evaluate(soc(T0 + 4 * MIN, 9))
    assert send.sent == []
    on.evaluate(soc(T0 + 5 * MIN, 8))
    assert send.titles() == ["Battery down to 8%"]
    assert "backup reserve is 5%" in send.sent[0]["body"]["message"]
    on.evaluate(soc(T0 + 60 * MIN, 12))  # just above the line: not resolved yet
    assert len(send.sent) == 1
    on.evaluate(soc(T0 + 90 * MIN, 16))
    assert send.titles()[-1] == "Battery charging again"


def test_stale_readings_say_nothing_about_the_battery(on: AlertsService, send: FakeSend) -> None:
    for k in range(30):
        t = T0 + k * MIN
        on.evaluate(facts(t, snapshot={"ts": T0 - HOUR, "battery_soc": 3.0}, last_success=t))
    assert send.sent == []


def test_solar_underperforming_uses_the_insights_figures(on: AlertsService, send: FakeSend) -> None:
    def day(date: str, ratio: float, clear: bool = True) -> dict[str, Any]:
        return {"date": date, "ratio": ratio, "clear": clear, "actual_kwh": 20 * ratio, "expected_kwh": 20.0}

    today = time.strftime("%Y-%m-%d", time.localtime(T0))
    days = [day("2026-09-28", 0.98), day("2026-09-29", 0.5, clear=False), day("2026-09-30", 0.6), day("2026-10-01", 0.62)]  # fmt: skip
    perf = {"days": [*days, day(today, 0.1)]}  # today is judged on the hours so far: left out
    on.evaluate(facts(T0, performance=lambda: perf))
    assert send.titles() == ["Solar is underperforming"]
    assert "Over your last 2 clear days, your solar made about 61%" in send.sent[0]["body"]["message"]
    assert "Thursday 1 October: 12.4 kWh of an expected 20.0 kWh" in send.sent[0]["body"]["message"]
    perf = {"days": [*days, day("2026-10-02", 0.97)]}
    on.evaluate(facts(T0 + 1 * 86400, performance=lambda: perf))
    assert send.titles()[-1] == "Solar back to normal"


def test_daily_summary_is_off_by_default_then_sent_once_a_morning(on: AlertsService, send: FakeSend) -> None:
    calls = []

    def yesterday() -> dict[str, Any]:
        calls.append(1)
        return {"pv": 24.1, "home": 18.3, "imp": 3.2, "exp": 9.8, "cost": 1.42, "credit": 0.49, "supply": 1.05}

    seven = time.mktime((2026, 10, 3, 7, 0, 0, 0, 0, -1))
    on.evaluate(facts(seven, yesterday=yesterday))
    assert send.sent == [] and calls == []
    on.save_rule("daily_summary", {"enabled": True})
    on.evaluate(facts(seven - 30 * MIN, yesterday=yesterday))  # 06:30: not yet
    assert send.sent == []
    for k in range(10):
        on.evaluate(facts(seven + k * MIN, yesterday=yesterday))
    assert send.titles() == ["Yesterday: 24.1 kWh of solar"]
    message = send.sent[0]["body"]["message"]
    assert message.startswith("Friday 2 October\nSolar: 24.1 kWh\nHome use: 18.3 kWh")
    assert "Cost: $1.42, including the $1.05 supply charge, after $0.49 of feed-in credit" in message
    on.evaluate(facts(seven + 86400, yesterday=yesterday))  # the next morning
    assert len(send.sent) == 2


def test_an_alert_that_reaches_no_one_is_retried(on: AlertsService, send: FakeSend) -> None:
    send.fail["ntfy.sh"] = urllib.error.URLError(socket.gaierror(8, "nodename nor servname provided"))
    on.evaluate(offline(T0, T0 - 20 * MIN))
    [event] = on.history()
    assert event["status"] == "failed" and event["error"] == "ntfy: Couldn't reach ntfy.sh (address not found)."
    on.evaluate(offline(T0 + RETRY - MIN, T0 - 20 * MIN))
    assert send.sent == []
    del send.fail["ntfy.sh"]
    on.evaluate(offline(T0 + RETRY, T0 - 20 * MIN))
    assert send.titles() == ["Your inverter isn't answering"]
    [event] = on.history()
    assert event["status"] == "sent" and event["error"] is None


def test_an_alert_no_one_heard_about_resolves_quietly(on: AlertsService, send: FakeSend) -> None:
    send.fail["ntfy.sh"] = TimeoutError()
    on.evaluate(offline(T0, T0 - 20 * MIN))
    del send.fail["ntfy.sh"]
    on.evaluate(facts(T0 + MIN))
    assert send.sent == [] and history(on) == [("inverter_offline", "alert", "failed")]


def test_one_channel_failing_doesnt_stop_the_others(on: AlertsService, send: FakeSend) -> None:
    on.save_channel("webhook", {"url": "https://hooks.example.com/abc123456789", "token": ""})
    send.fail["ntfy.sh"] = http_error("https://ntfy.sh/", 429, {"error": "limit reached"})
    on.evaluate(offline(T0, T0 - 20 * MIN))
    [event] = on.history()
    assert event["status"] == "partial" and event["error"] == "ntfy: ntfy.sh refused it (429: limit reached)."
    [hook] = send.sent
    assert hook["url"] == "https://hooks.example.com/abc123456789"
    assert hook["body"]["event"] == "alert" and hook["body"]["rule"] == "inverter_offline"


def test_switching_a_rule_off_forgets_its_progress(on: AlertsService, send: FakeSend) -> None:
    on.evaluate(offline(T0, T0 - 20 * MIN))
    on.save_rule("inverter_offline", {"enabled": False})
    on.evaluate(facts(T0 + MIN))
    assert "inverter_offline" not in on.repo.states() and len(send.sent) == 1


# -- channels -------------------------------------------------------------------------
def test_secrets_are_masked_and_kept_when_sent_back(on: AlertsService, send: FakeSend) -> None:
    on.save_channel(
        "webhook", {"url": "https://hooks.example.com/services/T000/B000/XXXXsecret", "token": "s3cretT0ken!"}
    )
    on.save_channel("pushover", {"user_key": "u" * 30, "app_token": "a" * 26 + "WXYZ"})
    shown = {c["kind"]: c for c in on.overview()["channels"]}
    assert shown["ntfy"]["config"] == {"url": NTFY["url"], "token": f"{MASK}1234"}
    assert shown["webhook"]["config"] == {"url": f"https://hooks.example.com/{MASK}cret", "token": f"{MASK}ken!"}
    assert shown["pushover"]["config"]["app_token"] == f"{MASK}WXYZ"
    assert "s3cretT0ken!" not in json.dumps(on.overview())

    # Saved again as shown (masks and all): the real secrets stay.
    on.save_channel("ntfy", {**shown["ntfy"]["config"], "url": "https://ntfy.example.com/solar"})
    on.test_channel("ntfy", {})
    assert send.sent[-1]["headers"] == {"Authorization": f"Bearer {NTFY['token']}"}
    assert send.sent[-1]["url"] == "https://ntfy.example.com/"
    # Cleared: gone.
    on.save_channel("ntfy", {"url": "https://ntfy.example.com/solar", "token": ""})
    on.test_channel("ntfy", {})
    assert send.sent[-1]["headers"] == {}


def test_channel_settings_are_checked(alerts: AlertsService) -> None:
    for kind, body, message in [
        ("ntfy", {"url": "ntfy.sh/solar"}, "must be a web address"),
        ("ntfy", {"url": "https://ntfy.sh/"}, "End the topic address with a topic name"),
        ("pushover", {"user_key": "short", "app_token": "a" * 30}, "That user key doesn't look right"),
        ("webhook", {}, "Enter the address."),
        ("sms", {}, "There's no alert channel called 'sms'."),
    ]:
        with pytest.raises(ValueError, match=message):
            alerts.save_channel(kind, body)


def test_ntfy_signs_in_with_a_username_and_password(alerts: AlertsService, send: FakeSend) -> None:
    alerts.test_channel("ntfy", {"url": "https://push.example.com/ntfy/solar", "token": "me:pw"})
    assert send.sent[0]["url"] == "https://push.example.com/ntfy"
    assert send.sent[0]["body"]["topic"] == "solar"
    assert send.sent[0]["headers"] == {"Authorization": "Basic bWU6cHc="}


def test_pushover_is_a_form_post(alerts: AlertsService, send: FakeSend) -> None:
    alerts.test_channel("pushover", {"user_key": "u" * 30, "app_token": "a" * 30})
    [req] = send.sent
    assert req["url"] == "https://api.pushover.net/1/messages.json"
    assert req["body"]["user"] == "u" * 30 and req["body"]["title"] == "WattsMyPower test"


# -- the API --------------------------------------------------------------------------
@pytest.fixture
def client(config: Config, send: FakeSend) -> Iterator[TestClient]:
    app = create_app(config, poll=False, serve_dashboard=False)
    app.state.services.alerts.send = send
    with TestClient(app) as c:
        yield c


def test_test_send_reports_what_went_wrong(client: TestClient, send: FakeSend) -> None:
    r = client.post("/api/alerts/channels/ntfy/test", json={})
    assert r.status_code == 422 and r.json()["detail"] == "Set up ntfy first."

    send.fail["ntfy.sh"] = http_error("https://ntfy.sh/", 403, {"error": "forbidden", "http": 403})
    r = client.post("/api/alerts/channels/ntfy/test", json=NTFY)
    assert r.status_code == 502
    assert r.json()["detail"] == (
        "The test didn't go through: ntfy.sh refused it (403: forbidden). Check the token or keys."
    )
    send.fail["ntfy.sh"] = urllib.error.URLError(TimeoutError())
    r = client.post("/api/alerts/channels/ntfy/test", json=NTFY)
    assert r.json()["detail"] == "The test didn't go through: ntfy.sh didn't answer in time."

    del send.fail["ntfy.sh"]
    assert client.post("/api/alerts/channels/ntfy/test", json=NTFY).json() == {"ok": True}
    assert send.titles() == ["WattsMyPower test"]
    assert client.get("/api/alerts").json()["history"] == []  # tests aren't alerts


def test_alerts_api_round_trip(client: TestClient) -> None:
    body = client.get("/api/alerts").json()
    assert body["enabled"] is False
    assert [c["kind"] for c in body["channels"]] == ["ntfy", "pushover", "webhook"]
    rules = {r["id"]: r for r in body["rules"]}
    assert rules["daily_summary"]["enabled"] is False and rules["battery_low"]["enabled"] is True
    assert rules["battery_low"]["settings"][0] | {"value": 10.0} == rules["battery_low"]["settings"][0]

    saved = client.put("/api/alerts/channels/ntfy", json=NTFY).json()
    assert saved["enabled"] is True and saved["config"]["token"] == f"{MASK}1234"
    assert client.get("/api/alerts").json()["enabled"] is True

    r = client.put("/api/alerts/rules/battery_low", json={"settings": {"percent": 95}})
    assert r.status_code == 422 and r.json()["detail"] == "At or below must be a whole number from 1 to 80 %."
    rule = client.put("/api/alerts/rules/battery_low", json={"enabled": False, "settings": {"percent": 15}}).json()
    assert rule["enabled"] is False and rule["settings"][0]["value"] == 15
    assert client.put("/api/alerts/rules/nope", json={}).status_code == 404

    assert client.delete("/api/alerts/channels/ntfy").json() == {"removed": True}
    assert client.get("/api/alerts").json()["enabled"] is False


def test_the_background_task_evaluates_each_published_status(alerts: AlertsService) -> None:
    seen: list[Facts] = []
    alerts.evaluate = seen.append  # type: ignore[method-assign]

    async def run() -> None:
        await alerts.start()
        alerts.live.last_success = time.time()
        alerts.live.publish()
        for _ in range(100):
            if seen:
                break
            await asyncio.sleep(0.01)
        await alerts.stop()

    asyncio.run(run())
    assert seen and seen[0].hybrid_connected and seen[0].last_success == alerts.live.last_success


# -- the sun --------------------------------------------------------------------------
def test_the_sun_over_brisbane() -> None:
    brisbane = (-27.47, 153.03)
    noon = 1759456800  # 2025-10-03 12:00 AEST
    assert sun.elevation(*brisbane, noon) > 60
    assert sun.elevation(*brisbane, noon + 12 * HOUR) < -50
    assert sun.daylight_since(*brisbane, noon + 12 * HOUR) is None
    rose = sun.daylight_since(*brisbane, noon)
    assert rose is not None and 5 * HOUR + 30 * MIN <= noon - rose <= 6 * HOUR  # 10° up at about 06:15 AEST


def test_yesterdays_figures_for_the_summary(alerts: AlertsService, db: Database) -> None:
    start = int(time.mktime((2026, 10, 2, 0, 0, 0, 0, 0, -1)))
    rows = [
        (ts, {"pv_power": 2000.0, "grid_power": -500.0, "battery_power": 0.0, "load_power": 1500.0,
              "daily_pv": round((ts - start) / 86400 * 24, 2), "daily_import": 0.0, "daily_export": 0.0})
        for ts in range(start + 900, start + 86400, 300)
    ]  # fmt: skip
    with db.writing() as conn:
        alerts.readings.insert_many(conn, rows)
    y = alerts._yesterday(start + 86400 + 8 * HOUR)
    assert y is not None and y["date"] == "2026-10-02"
    assert y["pv"] == pytest.approx(24, abs=0.1) and y["supply"] == 1.05
    assert alerts._yesterday(start + 3 * 86400) is None  # nothing recorded that day
