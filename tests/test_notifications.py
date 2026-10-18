"""Notifications: a problem has to last before it's reported, a cooldown keeps one rule from repeating itself, quiet
hours and the day's limit hold the rest back (the urgent get through), every rule can be switched off, and what was
sent and how each channel took it is kept."""

from __future__ import annotations

import json
import time
import urllib.error
from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.live.service import LiveService
from app.features.notifications.service import Notifier, in_quiet, minutes_of
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore
from app.main import create_app

T0 = time.mktime((2026, 10, 2, 11, 0, 0, 0, 0, -1))
NTFY = {"url": "https://ntfy.sh/klemm-solar", "token": ""}
MIN = 60


class Net:
    """Stands in for the network: records what was sent (ntfy and webhook post JSON), and fails on cue."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.fail: Exception | None = None

    def __call__(self, url: str, body: bytes, content_type: str, headers: dict[str, str]) -> int:
        if self.fail:
            raise self.fail
        self.sent.append({"url": url, "body": json.loads(body) if content_type == "application/json" else body})
        return 200

    def titles(self) -> list[str]:
        return [s["body"].get("title") for s in self.sent]


def make(db: Database, config: Config) -> tuple[Notifier, Net, LiveService]:
    settings = SettingsStore(db, config)
    live = LiveService(config, settings, TariffStore(db, config))
    net = Net()
    notifier = Notifier(db, live, net)
    notifier.repo.save_channel("ntfy", True, NTFY)
    return notifier, net, live


def battery(live: LiveService, soc: float, ts: float) -> None:
    live.latest = {"ts": int(ts), "battery_soc": soc}
    live.last_success = ts
    live.inverter = True


def history(n: Notifier) -> list[tuple[str, str]]:
    return [(h["event"], h["title"]) for h in reversed(n.repo.history())]


def test_a_problem_is_reported_once_it_has_lasted_and_followed_by_an_all_clear(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    battery(live, 10, T0)
    n.evaluate(T0)  # first seen: not yet
    assert net.sent == []
    battery(live, 10, T0 + 3 * MIN)
    n.evaluate(T0 + 3 * MIN)  # three minutes, of the five it has to last
    assert net.sent == []
    battery(live, 9, T0 + 6 * MIN)
    n.evaluate(T0 + 6 * MIN)
    assert net.titles() == ["Battery at 9%"]
    assert net.sent[0]["body"]["priority"] == 3  # not urgent
    battery(live, 9, T0 + 8 * MIN)
    n.evaluate(T0 + 8 * MIN)  # still low: said once
    assert len(net.sent) == 1
    battery(live, 40, T0 + 60 * MIN)
    n.evaluate(T0 + 60 * MIN)
    assert net.titles()[-1] == "Battery recovering"
    assert "It lasted 1 hour." in net.sent[-1]["body"]["message"]
    assert history(n) == [("alert", "Battery at 9%"), ("resolved", "Battery recovering")]


def test_a_blip_shorter_than_the_wait_says_nothing(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    battery(live, 10, T0)
    n.evaluate(T0)
    battery(live, 50, T0 + 2 * MIN)
    n.evaluate(T0 + 2 * MIN)
    battery(live, 10, T0 + 4 * MIN)
    n.evaluate(T0 + 4 * MIN)  # the wait starts again
    battery(live, 10, T0 + 8 * MIN)
    n.evaluate(T0 + 8 * MIN)
    assert net.sent == [] and n.repo.history() == []


def test_the_cooldown_holds_back_a_repeat_and_its_all_clear(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    for m in (0, 6):
        battery(live, 10, T0 + m * MIN)
        n.evaluate(T0 + m * MIN)
    battery(live, 40, T0 + 30 * MIN)
    n.evaluate(T0 + 30 * MIN)
    assert len(net.sent) == 2  # told, and the all-clear
    for m in (60, 67):  # low again an hour later: inside its six hours
        battery(live, 10, T0 + m * MIN)
        n.evaluate(T0 + m * MIN)
    battery(live, 40, T0 + 90 * MIN)
    n.evaluate(T0 + 90 * MIN)
    assert len(net.sent) == 2  # said nothing, and no all-clear for what wasn't said
    assert ("held", "Battery at 10%") in history(n)
    held = next(h for h in n.repo.history() if h["event"] == "held")
    assert held["results"] == {"held": "Told you recently (cooldown)"}


def test_a_rule_can_be_switched_off_and_one_that_is_off_by_default_says_nothing(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    live.latest = {"ts": int(T0), "battery_soc": 10, "grid_power": 6000}
    live.last_success, live.inverter = T0, True
    n.save_rule("low_battery", {"enabled": False})
    for m in (0, 20):  # heavy grid import is off until you turn it on
        live.latest = {"ts": int(T0 + m * MIN), "battery_soc": 10, "grid_power": 6000}
        live.last_success = T0 + m * MIN
        n.evaluate(T0 + m * MIN)
    assert net.sent == []
    n.save_rule("grid_import", {"enabled": True, "values": {"kw": 2, "minutes": 5}})
    for m in (30, 36):
        live.latest = {"ts": int(T0 + m * MIN), "battery_soc": 10, "grid_power": 6000}
        live.last_success = T0 + m * MIN
        n.evaluate(T0 + m * MIN)
    assert net.titles() == ["Buying 6.0 kW from the grid"]


def test_the_grid_going_down_is_urgent_and_the_return_is_reported(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    live.off_grid_known, live.last_success = True, time.time()
    live.off_grid_since = int(T0)
    n.evaluate(T0)
    n.evaluate(T0 + 2 * MIN)  # a minute's wait, then it's out
    assert net.titles() == ["The grid's down"]
    assert net.sent[0]["body"]["priority"] == 4  # urgent
    live.off_grid_since = None
    n.evaluate(T0 + 47 * MIN)
    assert net.titles() == ["The grid's down", "The grid's back"]
    assert "It lasted 47 minutes." in net.sent[-1]["body"]["message"]


def test_quiet_hours_hold_back_all_but_the_urgent(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    n.save_options({"quiet": {"enabled": True, "start": "22:00", "end": "07:00"}})
    night = time.mktime((2026, 10, 2, 23, 0, 0, 0, 0, -1))
    for m in (0, 6):
        battery(live, 10, night + m * MIN)
        n.evaluate(night + m * MIN)
    assert net.sent == []
    assert [h["results"] for h in n.repo.history()] == [{"held": "Quiet hours"}]
    live.off_grid_known, live.last_success, live.off_grid_since = True, time.time(), int(night)
    n.evaluate(night + 7 * MIN)
    n.evaluate(night + 9 * MIN)
    assert net.titles() == ["The grid's down"]  # urgent: through the quiet


def test_the_days_limit_holds_back_the_rest_but_not_the_urgent(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    n.save_options({"daily_cap": 1})
    for m in (0, 6):
        battery(live, 10, T0 + m * MIN)
        n.evaluate(T0 + m * MIN)
    assert net.titles() == ["Battery at 10%"]
    live.hybrid = None
    live.last_success = None  # now the inverter stops answering
    for m in (20, 31):
        n.evaluate(T0 + m * MIN)
    assert net.titles() == ["Battery at 10%"]
    assert n.repo.history()[0]["results"] == {"held": "Daily limit reached"}
    live.off_grid_known, live.last_success, live.off_grid_since = True, time.time(), int(T0)
    n.evaluate(T0 + 40 * MIN)
    n.evaluate(T0 + 42 * MIN)
    assert net.titles()[-1] == "The grid's down"


def test_a_channel_that_fails_says_why_and_the_others_still_get_it(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    n.repo.save_channel("webhook", True, {"url": "https://hooks.example.com/abc", "token": ""})
    net.fail = urllib.error.URLError("no route")
    battery(live, 10, T0)
    n.evaluate(T0)
    battery(live, 10, T0 + 6 * MIN)
    n.evaluate(T0 + 6 * MIN)
    [entry] = n.repo.history()
    assert entry["event"] == "alert" and set(entry["results"]) == {"ntfy", "webhook"}
    assert all(v.startswith("Couldn't reach") for v in entry["results"].values())


def test_a_rule_can_use_only_some_channels(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    n.repo.save_channel("webhook", True, {"url": "https://hooks.example.com/abc", "token": ""})
    n.save_rule("low_battery", {"channels": ["webhook"]})
    battery(live, 10, T0)
    n.evaluate(T0)
    battery(live, 10, T0 + 6 * MIN)
    n.evaluate(T0 + 6 * MIN)
    assert [s["url"] for s in net.sent] == ["https://hooks.example.com/abc"]


def test_nowhere_to_send_is_recorded_not_lost(db: Database, config: Config) -> None:
    n, _net, live = make(db, config)
    n.repo.delete_channel("ntfy")
    battery(live, 10, T0)
    n.evaluate(T0)
    battery(live, 10, T0 + 6 * MIN)
    n.evaluate(T0 + 6 * MIN)
    assert n.repo.history()[0]["results"] == {"none": "No channel is set up to receive it."}


def test_the_inverter_not_answering_is_reported(db: Database, config: Config) -> None:
    n, net, live = make(db, config)
    live.inverter, live.last_success = True, T0 - 30 * MIN
    n.evaluate(T0)
    n.evaluate(T0 + 11 * MIN)
    assert net.titles() == ["The inverter isn't answering"]
    live.last_success = T0 + 12 * MIN
    n.evaluate(T0 + 12 * MIN)
    assert net.titles()[-1] == "The inverter's answering again"


def test_progress_survives_a_restart(db: Database, config: Config) -> None:
    n, _net, live = make(db, config)
    battery(live, 10, T0)
    n.evaluate(T0)
    again, net2, live2 = make(db, config)  # the dashboard restarted: it remembers the wait began
    battery(live2, 10, T0 + 6 * MIN)
    again.evaluate(T0 + 6 * MIN)
    assert net2.titles() == ["Battery at 10%"]


def test_quiet_hours_may_run_past_midnight() -> None:
    quiet = {"enabled": True, "start": "22:00", "end": "07:00"}
    at = lambda h, m: time.mktime((2026, 10, 2, h, m, 0, 0, 0, -1))  # noqa: E731
    assert in_quiet(quiet, at(23, 0)) and in_quiet(quiet, at(6, 59)) and in_quiet(quiet, at(22, 0))
    assert not in_quiet(quiet, at(7, 0)) and not in_quiet(quiet, at(12, 0)) and not in_quiet(quiet, at(21, 59))
    assert not in_quiet({**quiet, "enabled": False}, at(23, 0))
    assert in_quiet({"enabled": True, "start": "13:00", "end": "14:00"}, at(13, 30))
    assert minutes_of("07:30") == 450 and minutes_of("24:00") is None and minutes_of("soon") is None


# -- the page's API ----------------------------------------------------------------


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(replace(config, auth=False), poll=False, serve_dashboard=False)) as c:
        c.app.state.services.notifications.send = Net()  # type: ignore[attr-defined]
        yield c


def test_the_overview_lists_every_rule_with_its_numbers(client: TestClient) -> None:
    out = client.get("/api/notifications").json()
    assert [r["id"] for r in out["rules"]] == ["off_grid", "low_battery", "grid_import", "inverter_offline"]
    battery_rule = out["rules"][1]
    assert battery_rule["enabled"] and battery_rule["values"] == {
        "percent": 20.0,
        "minutes": 5.0,
        "cooldown_hours": 6.0,
    }
    assert not out["rules"][2]["enabled"]  # heavy grid import: off until asked for
    assert out["options"]["daily_cap"] == 20 and out["options"]["quiet"]["enabled"] is False
    assert len(out["push"]["public_key"]) > 60 and out["push"]["devices"] == []
    assert out["channels"]["ntfy"] == {"enabled": False, "config": {}}


def test_rules_are_changed_and_checked(client: TestClient) -> None:
    r = client.put("/api/notifications/rules/low_battery", json={"enabled": False, "values": {"percent": 30}})
    rule = r.json()["rules"][1]
    assert rule["enabled"] is False and rule["values"]["percent"] == 30
    assert client.put("/api/notifications/rules/low_battery", json={"values": {"percent": 500}}).status_code == 422
    assert client.put("/api/notifications/rules/low_battery", json={"values": {"percent": "lots"}}).status_code == 422
    assert client.put("/api/notifications/rules/low_battery", json={"channels": ["fax"]}).status_code == 422
    assert client.put("/api/notifications/rules/nope", json={}).status_code == 422


def test_options_are_changed_and_checked(client: TestClient) -> None:
    ok = client.put("/api/notifications/options", json={"quiet": {"enabled": True, "start": "21:30"}, "daily_cap": 5})
    assert ok.json()["options"] == {"quiet": {"enabled": True, "start": "21:30", "end": "07:00"}, "daily_cap": 5}
    assert client.put("/api/notifications/options", json={"quiet": {"start": "late"}}).status_code == 422
    assert client.put("/api/notifications/options", json={"daily_cap": 0}).status_code == 422


def test_a_channel_is_set_up_tested_and_its_secret_kept_masked(client: TestClient) -> None:
    assert client.put("/api/notifications/channels/ntfy", json={"url": "not a url"}).status_code == 422
    assert client.put("/api/notifications/channels/fax", json={}).status_code == 404
    out = client.put("/api/notifications/channels/ntfy", json={**NTFY, "token": "tk_secret1234"}).json()
    assert out["channels"]["ntfy"]["enabled"] and out["channels"]["ntfy"]["config"]["token"].startswith("••••")
    assert "secret" not in json.dumps(out)
    # Sending the masked value back keeps the saved one.
    again = client.put(
        "/api/notifications/channels/ntfy", json={**NTFY, "token": out["channels"]["ntfy"]["config"]["token"]}
    )
    assert again.status_code == 200
    sent = client.post("/api/notifications/test", json={"target": "ntfy"}).json()
    assert sent["result"] == "ok" and sent["history"][0]["event"] == "test"
    assert client.post("/api/notifications/test", json={"target": "webhook"}).status_code == 502  # not set up
    assert client.post("/api/notifications/test", json={"target": "push"}).status_code == 502  # no browser yet
    removed = client.delete("/api/notifications/channels/ntfy").json()
    assert removed["channels"]["ntfy"] == {"enabled": False, "config": {}}
