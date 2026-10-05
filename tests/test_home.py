"""Smart-home devices: turning readings into energy and runs, connecting and polling accounts, the home's breakdown,
and the API. Integrations are faked: nothing here touches the network."""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.core.schema import ROLLUP
from app.features.home import usage
from app.features.home.energy import GAP, QUIET, TAIL, Meter, spread, step
from app.features.home.integrations.demo import Demo
from app.features.home.service import BACKOFF_MAX, HomeService, HomeSetupError
from app.features.home.types import Field, Hints, Integration, IntegrationError, Reading
from app.features.readings.repository import ReadingsRepository
from app.main import create_app

T0 = 1_790_000_100  # the start of a 5-minute bucket
MIN = 60


def washer(**kw: Any) -> Reading:
    return Reading(key="w1", name="Washer", kind="washer", **kw)


def run_through(readings: list[tuple[int, Reading]], kind: str = "washer") -> tuple[Meter, dict[int, float], list]:
    """Step a meter through readings; its energy by bucket and every run it saved (latest version of each)."""
    meter: Meter = {}
    energy: dict[int, float] = {}
    runs: dict[int, dict[str, Any]] = {}
    for n, (ts, r) in enumerate(readings):
        s = step(meter, r, ts, kind)
        for b, kwh in s.energy:
            energy[b] = energy.get(b, 0.0) + kwh
        for run in s.runs:
            run.setdefault("id", None)
            if run["id"] is None:
                run["id"] = n + 1  # as the repository does: set on the run, so the meter keeps it
            runs[run["id"]] = dict(run)
        meter = s.meter
    return meter, energy, list(runs.values())


# -- energy --------------------------------------------------------------------------------------------
def test_energy_is_spread_over_the_buckets_it_was_used_in() -> None:
    parts = spread(1000 * ROLLUP + 150, 1000 * ROLLUP + 750, 0.6)
    assert parts == [(1000 * ROLLUP, pytest.approx(0.15)), (1001 * ROLLUP, pytest.approx(0.3)),
                     (1002 * ROLLUP, pytest.approx(0.15))]  # fmt: skip
    assert spread(5000, 5000, 0.2) == [(5000 // ROLLUP * ROLLUP, 0.2)]


def test_a_counter_step_is_spread_back_to_when_it_last_moved() -> None:
    # A fridge on a lifetime counter that only ticks every 0.1 kWh: each tick spreads over the time since the last.
    readings = [(T0 + n * MIN, Reading("f", "Fridge", "fridge", energy_kwh=e)) for n, e in
                [(0, 100.0), (5, 100.0), (10, 100.0), (20, 100.1), (30, 100.2)]]  # fmt: skip
    _, energy, runs = run_through(readings, "fridge")
    assert not runs
    # The first tick's 0.1 kWh covers the 20 minutes since the counter was first read, not just the last 10.
    assert energy == pytest.approx({T0: 0.025, T0 + 300: 0.025, T0 + 600: 0.025, T0 + 900: 0.025,
                                    T0 + 1200: 0.05, T0 + 1500: 0.05})  # fmt: skip


def test_a_cycle_counter_starting_over_counts_the_new_cycle_and_a_reset_total_counter_counts_nothing() -> None:
    cycle = [(T0, washer(energy_kwh=0.8, counter="cycle")), (T0 + MIN, washer(energy_kwh=0.1, counter="cycle"))]
    assert sum(run_through(cycle)[1].values()) == pytest.approx(0.1)
    total = [(T0, washer(energy_kwh=500.0)), (T0 + MIN, washer(energy_kwh=0.0)), (T0 + 2 * MIN, washer(energy_kwh=0.2))]
    assert sum(run_through(total)[1].values()) == pytest.approx(0.2)  # the reset isn't a step; the next one is


def test_without_a_counter_power_is_averaged_but_not_across_a_long_gap() -> None:
    plug = lambda w: Reading("p", "TV", "plug", power_w=w)  # noqa: E731
    _, energy, _ = run_through([(T0, plug(100.0)), (T0 + 12 * MIN, plug(300.0))], "plug")
    assert sum(energy.values()) == pytest.approx(0.04)  # 200 W for a fifth of an hour
    _, energy, _ = run_through([(T0, plug(100.0)), (T0 + GAP + MIN, plug(300.0))], "plug")
    assert energy == {}  # what happened in between isn't known


def test_impossible_steps_are_skipped() -> None:
    # 20 kWh in a minute is a garbled reading, not a washer. The counter carries on from the new value.
    readings = [
        (T0, washer(energy_kwh=1.0)),
        (T0 + MIN, washer(energy_kwh=21.0)),
        (T0 + 2 * MIN, washer(energy_kwh=21.05)),
    ]
    assert sum(run_through(readings)[1].values()) == pytest.approx(0.05)


def test_a_run_the_appliance_reports_has_its_times_program_peak_and_energy() -> None:
    readings = [
        (T0, washer(running=False, energy_kwh=0.0, counter="cycle", power_w=1)),
        (T0 + MIN, washer(running=True, program="Cotton 40°", energy_kwh=0.0, counter="cycle", power_w=2000)),
        (T0 + 15 * MIN, washer(running=True, program="Cotton 40°", energy_kwh=0.4, counter="cycle", power_w=150)),
        (T0 + 30 * MIN, washer(running=True, program="Cotton 40°", energy_kwh=0.5, counter="cycle", power_w=150)),
        (T0 + 45 * MIN, washer(running=True, program="Cotton 40°", energy_kwh=0.6, counter="cycle", power_w=400)),
        (T0 + 60 * MIN, washer(running=False, energy_kwh=0.7, counter="cycle", power_w=1)),
        # Some appliances finish counting a cycle once it's over: that still belongs to it, and to its time.
        (T0 + 60 * MIN + TAIL - 1, washer(running=False, energy_kwh=0.75, counter="cycle", power_w=1)),
        (T0 + 70 * MIN + TAIL, washer(running=False, energy_kwh=0.8, counter="cycle", power_w=1)),  # too late: not
    ]
    meter, energy, runs = run_through(readings)
    assert len(runs) == 1 and meter["run"] is None
    run = runs[0]
    assert (run["start"], run["end"]) == (T0 + MIN, T0 + 60 * MIN)
    assert run["program"] == "Cotton 40°" and run["peak_w"] == 2000 and run["kwh"] == pytest.approx(0.75)
    assert sum(energy.values()) == pytest.approx(0.8)
    # The tail lands within the run; the late 0.05 at its own time, after it.
    assert sum(v for b, v in energy.items() if b >= T0 + 65 * MIN) == pytest.approx(0.05, abs=0.001)


def test_a_run_judged_by_power_waits_out_a_pause() -> None:
    # A smart plug on a washer: no word from the washer, so drawing over 5 W is running. A soak isn't the end.
    plug = lambda w: Reading("p", "Plug", "plug", power_w=w)  # noqa: E731
    readings = [(T0, plug(1)), (T0 + MIN, plug(500)), (T0 + 5 * MIN, plug(400)), (T0 + 12 * MIN, plug(2)),
                (T0 + 14 * MIN, plug(300)), (T0 + 20 * MIN, plug(1)), (T0 + 20 * MIN + QUIET, plug(1))]  # fmt: skip
    meter, _, runs = run_through(readings, "washer")  # set as the washer it powers
    assert meter["run"] is None and len(runs) == 1
    assert (runs[0]["start"], runs[0]["end"]) == (T0 + MIN, T0 + 14 * MIN)
    # Set as a plug, it doesn't run in cycles.
    assert run_through(readings, "plug")[2] == []


def test_an_appliance_offline_for_a_moment_keeps_its_run_but_not_for_long() -> None:
    on = washer(running=True)
    gone = washer(online=False)
    _, _, runs = run_through([(T0, on), (T0 + MIN, gone), (T0 + 2 * MIN, on), (T0 + 3 * MIN, washer(running=False))])
    assert len(runs) == 1 and runs[0]["end"] == T0 + 3 * MIN
    meter, _, runs = run_through([(T0, on), (T0 + MIN, gone), (T0 + GAP + 2 * MIN, gone)])
    assert meter["run"] is None and runs[0]["end"] == T0  # over, at the last reading it was running


def test_a_stop_seen_after_a_gap_ends_the_run_when_it_was_last_seen_running() -> None:
    _, _, runs = run_through([(T0, washer(running=True)), (T0 + 3 * 3600, washer(running=False))])
    assert runs[0]["end"] == T0


# -- connecting and polling --------------------------------------------------------------------------
class Fake(Integration):
    id = "fake"
    name = "Fakebrand"
    via = "the tests"
    about = "Made up."
    kinds = ("washer",)
    fields = (Field("email", "Email", "email"), Field("password", "Password", "password", secret=True))
    poll_seconds = 60
    script: ClassVar[list[Any]] = []  # what each poll returns (or raises), in turn

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        if form["password"] != "right":
            raise IntegrationError("Fakebrand didn't accept that email and password.", signed_out=True)
        return {"email": form["email"], "password": form["password"], "token": "t"}

    def label(self) -> str:
        return self.saved["email"]

    def poll(self) -> list[Reading]:
        item = Fake.script.pop(0)
        if isinstance(item, Exception):
            raise item
        self.saved = {**self.saved, "token": self.saved["token"] + "+"}  # refreshed as it goes
        return item


class Clock:
    def __init__(self, t: float = T0):
        self.t = t

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def home(db: Database, config: Config, clock: Clock) -> HomeService:
    Fake.script = []
    return HomeService(config, db, {"fake": Fake, "demo": Demo}, clock=clock)


FORM = {"email": "me@example.com", "password": "right"}


def test_connecting_checks_the_form_and_the_sign_in(home: HomeService) -> None:
    with pytest.raises(HomeSetupError, match="Enter your password"):
        home.connect("fake", {"email": "me@example.com"})
    with pytest.raises(HomeSetupError, match="didn't accept") as e:
        home.connect("fake", {**FORM, "password": "wrong"})
    assert e.value.status == 422
    with pytest.raises(HomeSetupError) as e:
        home.connect("nothing", FORM)
    assert e.value.status == 404
    account = next(i for i in home.connect("fake", FORM)["integrations"] if i["id"] == "fake")["account"]
    assert account["label"] == "me@example.com" and account["devices"] == 0
    with pytest.raises(HomeSetupError, match="already connected") as e:  # its devices would count twice
        home.connect("fake", FORM)
    assert e.value.status == 409


def test_what_an_account_keeps_to_sign_in_never_leaves(home: HomeService) -> None:
    home.connect("fake", FORM)
    text = json.dumps(home.overview())
    assert "right" not in text and '"token"' not in text and "me@example.com" in text


def test_polls_add_devices_record_what_they_use_and_keep_refreshed_tokens(home: HomeService, clock: Clock) -> None:
    home.connect("fake", FORM)
    Fake.script = [[washer(energy_kwh=10.0, running=False)], [washer(energy_kwh=10.1, running=True, program="Eco")]]
    home.poll_due()
    clock.t += 60
    home.poll_due()
    view = home.overview()
    (device,) = view["devices"]
    assert (device["name"], device["kind"], device["integration"]) == ("Washer", "washer", "fake")
    assert device["now"]["running"] and device["now"]["program"] == "Eco"
    # Used since the last poll: the run began some time after it.
    assert sum(kwh for _, _, kwh in home.repo.energy(0, 2**40)) == pytest.approx(0.1)
    assert home.repo.runs(0, 2**40)[0]["kwh"] == pytest.approx(0.1)
    (account,) = home.repo.accounts()
    assert account.saved["token"] == "t++" and account.state["last_poll"] == T0 + 60


def test_polls_wait_their_interval(home: HomeService, clock: Clock) -> None:
    home.connect("fake", FORM)
    Fake.script = [[], []]
    home.poll_due()
    clock.t += 30
    home.poll_due()  # not due yet
    assert len(Fake.script) == 1
    clock.t += 30
    home.poll_due()
    assert Fake.script == []


def test_a_failing_account_backs_off_and_a_signed_out_one_waits_to_be_signed_in_again(
    home: HomeService, clock: Clock
) -> None:
    home.connect("fake", FORM)
    Fake.script = [IntegrationError("Fakebrand is down."), RuntimeError("boom")]
    home.poll_due()
    clock.t += 60
    home.poll_due()  # backing off: not yet
    assert len(Fake.script) == 1
    clock.t += 60
    home.poll_due()
    (account,) = home.repo.accounts()
    assert "couldn't be read (RuntimeError)" in account.state["error"]
    clock.t += BACKOFF_MAX
    Fake.script = [IntegrationError("Sign in again.", signed_out=True)]
    home.poll_due()
    clock.t += 3600
    home.poll_due()  # signed out: not polled again
    fake = next(i for i in home.overview()["integrations"] if i["id"] == "fake")
    assert fake["account"]["signed_out"] and fake["account"]["error"] == "Sign in again."
    Fake.script = [[]]
    home.sign_in_again("fake", FORM)
    home.poll_due()
    assert Fake.script == [] and home.repo.accounts()[0].state["error"] is None


def test_signing_in_again_keeps_the_devices_and_wins_over_a_poll_under_way(home: HomeService) -> None:
    home.connect("fake", FORM)
    Fake.script = [[washer(energy_kwh=1.0)]]
    home.poll_due()

    class Racing(Fake):
        def poll(self) -> list[Reading]:
            home.sign_in_again("fake", {**FORM, "email": "new@example.com"})  # while this poll is reading
            return super().poll()

    home.integrations["fake"] = Racing
    Fake.script = [[washer(energy_kwh=1.1)]]
    home.poll(home.repo.accounts()[0].id)
    (account,) = home.repo.accounts()
    assert account.saved == {"email": "new@example.com", "password": "right", "token": "t"}
    assert len(home.repo.devices()) == 1


def test_disconnecting_forgets_the_devices_and_what_they_used(home: HomeService, clock: Clock) -> None:
    home.connect("fake", FORM)
    Fake.script = [[washer(energy_kwh=1.0, running=True)], [washer(energy_kwh=1.5, running=False)]]
    home.poll_due()
    clock.t += 60
    home.poll_due()
    assert home.repo.runs(0, 2**40)
    assert home.disconnect("fake")["devices"] == []
    assert home.repo.energy(0, 2**40) == [] and home.repo.runs(0, 2**40) == []
    with pytest.raises(HomeSetupError):
        home.disconnect("fake")


def test_devices_can_be_renamed_set_as_what_they_power_and_hidden(home: HomeService) -> None:
    home.connect("fake", FORM)
    Fake.script = [[Reading("p", "Plug 3", "plug", power_w=1)]]
    home.poll_due()
    (d,) = home.repo.devices()
    view = home.update_device(d.id, {"name": " Old washer ", "kind": "washer", "hidden": True})["devices"][0]
    assert (view["name"], view["kind"], view["hidden"]) == ("Old washer", "washer", True)
    for bad, message in [({"name": ""}, "name"), ({"kind": "toaster"}, "kind"), ({"hidden": "yes"}, "breakdown")]:
        with pytest.raises(HomeSetupError, match=message):
            home.update_device(d.id, bad)
    with pytest.raises(HomeSetupError) as e:
        home.update_device(999, {"name": "x"})
    assert e.value.status == 404


def test_devices_can_be_grouped_and_a_group_is_named_as_it_was_first(home: HomeService) -> None:
    home.connect("fake", FORM)
    Fake.script = [[Reading("l", "Study (Left)", "plug"), Reading("r", "Study (Right)", "plug")]]
    home.poll_due()
    left, right = home.repo.devices()
    assert home.overview()["devices"][0]["group"] is None
    home.update_device(left.id, {"group": "  Study  "})
    groups = [d["group"] for d in home.update_device(right.id, {"group": "study"})["devices"]]
    assert groups == ["Study", "Study"]
    assert home.update_device(right.id, {"group": ""})["devices"][1]["group"] is None
    assert home.update_device(left.id, {"group": None})["devices"][0]["group"] is None
    for bad in ({"group": 3}, {"group": "x" * 61}):
        with pytest.raises(HomeSetupError, match="group"):
            home.update_device(left.id, bad)


def test_the_demo_is_only_offered_in_mock_mode(db: Database, config: Config) -> None:
    live = Config(db_path=config.db_path, mock=False, auth=False)
    assert "demo" not in HomeService(live, db).available()
    assert "demo" in HomeService(config, db).available()


def test_the_demo_looks_back_four_weeks_when_connected(home: HomeService, clock: Clock) -> None:
    clock.t = time.time()
    view = home.connect("demo", {})
    assert {d["kind"] for d in view["devices"]} == {"washer", "dryer", "fridge", "plug"}
    runs = home.repo.runs(0, 2**40)
    washes = [r for r in runs if r["device"] == view["devices"][0]["id"]]
    assert 10 <= len(washes) <= 14  # three a week: Wednesdays and weekends
    assert all(0.6 < r["kwh"] < 0.75 and 70 * MIN <= r["end"] - r["start"] <= 80 * MIN for r in washes)


# -- where the power went ------------------------------------------------------------------------------
def _rollups(db: Database, rows: list[tuple[int, float]]) -> None:
    """5-minute readings where the home used `load` W (all from the grid)."""
    with db.writing() as conn:
        conn.executemany("INSERT INTO samples_5m (ts, pv_power, grid_power, battery_power) VALUES (?, 0, ?, 0)", rows)


def test_the_breakdown_splits_the_homes_use_between_devices_and_everything_else(
    home: HomeService, db: Database, readings: ReadingsRepository
) -> None:
    hour = usage.bucket_start(T0, "hour") + 3600
    _rollups(db, [(hour + i * ROLLUP, 2400.0) for i in range(12)])  # 2.4 kWh in the hour
    home.connect("fake", FORM)
    with db.writing() as conn:
        a = home.repo.add_device(conn, 1, "a", "Washer", "washer", None, T0)
        b = home.repo.add_device(conn, 1, "b", "Fridge", "fridge", None, T0)
        c = home.repo.add_device(conn, 1, "c", "Hidden", "plug", None, T0)
        home.repo.add_energy(conn, a.id, [(hour, 0.5), (hour + 600, 0.3)])
        home.repo.add_energy(conn, b.id, [(hour + 1200, 0.1)])
        home.repo.add_energy(conn, c.id, [(hour, 1.0)])
        home.repo.update_device(conn, c.id, hidden=1)
        home.repo.save_run(conn, a.id, {"start": hour, "end": hour + 1800, "kwh": 0.8})
    out = usage.breakdown(home.repo, readings, hour, hour + 7200, "hour")
    assert out["t"] == [hour, hour + 3600]
    assert out["home"] == [pytest.approx(2.4), None]  # nothing read in the second hour
    assert out["other"] == [pytest.approx(1.5), None]
    by_name = {d["name"]: d for d in out["devices"]}
    assert set(by_name) == {"Washer", "Fridge"}
    assert by_name["Washer"]["kwh"] == [pytest.approx(0.8), 0] and by_name["Washer"]["runs"] == 1
    assert by_name["Washer"]["run_minutes"] == 30
    assert out["total"] == {"home": pytest.approx(2.4), "measured": pytest.approx(0.9), "other": pytest.approx(1.5)}


def test_by_the_day_the_home_is_what_the_inverters_counted(db: Database, readings: ReadingsRepository) -> None:
    day = usage.bucket_start(T0, "day")
    noon = day + 12 * 3600
    with db.writing() as conn:
        conn.execute(
            "INSERT INTO samples_5m (ts, pv_power, grid_power, battery_power, daily_pv, daily_import, daily_export,"
            " daily_charge, daily_discharge, total_pv_export) VALUES (?, 0, 500, 0, 20, 5, 8, 6, 4, 1)",
            (noon,),
        )
    assert usage.home_use(readings, day, day + 86400, "day") == {day: pytest.approx(15.0)}  # 20 + 5 − 8 + 4 − 6


def test_by_the_hour_the_days_hours_add_up_to_what_the_inverters_counted_and_devices_arent_added(
    home: HomeService, db: Database, readings: ReadingsRepository
) -> None:
    """The readings say 2.4 kWh between 9 and 10 and 1.2 between 10 and 11; the counters say the day used 6.8 (solar 4,
    3.6 from the grid by the meter, none sent to it, 1.2 from the battery, 2 into it). The hours keep their shape (2 to
    1) and add up to the counters, as History and the Overview count the day. What the devices measured is part of
    that, not added to it."""
    day = usage.bucket_start(T0, "day")
    nine = day + 9 * 3600
    _rollups(
        db, [(nine + i * ROLLUP, 2400.0) for i in range(12)] + [(nine + 3600 + i * ROLLUP, 1200.0) for i in range(12)]
    )
    with db.writing() as conn:
        conn.execute(
            "UPDATE samples_5m SET daily_pv = 4, daily_import = 5, daily_export = 1, daily_charge = 2,"
            " daily_discharge = 1.2 WHERE ts = ?",
            (nine + 3600 + 11 * ROLLUP,),
        )
    home.connect("fake", FORM)
    with db.writing() as conn:
        plug = home.repo.add_device(conn, 1, "p", "Plug", "plug", None, T0)
        home.repo.add_energy(conn, plug.id, [(nine, 1.0)])
    out = usage.breakdown(home.repo, readings, day, day + 86400, "hour")
    i = out["t"].index(nine)
    assert out["home"][i : i + 2] == [pytest.approx(4.533, abs=0.001), pytest.approx(2.267, abs=0.001)]
    assert out["total"]["home"] == pytest.approx(6.8)
    assert out["total"]["measured"] == pytest.approx(1.0) and out["total"]["other"] == pytest.approx(5.8)
    by_day = usage.breakdown(home.repo, readings, day, day + 86400, "day")
    assert by_day["total"]["home"] == pytest.approx(6.8)


def test_patterns_say_which_days_an_appliance_usually_runs(home: HomeService, clock: Clock) -> None:
    clock.t = time.time()
    view = home.connect("demo", {})
    found = {p["id"]: p for p in usage.patterns(home.repo, int(time.time()))}
    wash = found[view["devices"][0]["id"]]
    assert [n > 0 for n in wash["run_days"]] == [False, False, True, False, False, True, True]
    assert wash["run_minutes"] in range(74, 78) and wash["days"] >= 27
    tv = found[view["devices"][3]["id"]]
    assert tv["runs"] == 0 and tv["by_hour"][20] > tv["by_hour"][3]  # it's on in the evenings
    assert tv["by_weekday"][1] < tv["by_weekday"][2]  # and not on Tuesdays


def test_buckets_follow_the_local_calendar() -> None:
    day = usage.bucket_start(T0, "day")
    days = usage.buckets(day + 3600, day + 3 * 86400, "day")
    assert len(days) == 3 and days[0] == day and all(time.localtime(d).tm_hour == 0 for d in days)


# -- the API ------------------------------------------------------------------------------------------
@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def test_home_through_the_api(client: TestClient) -> None:
    assert [i["id"] for i in client.get("/api/home").json()["integrations"]] == [
        "tapo",
        "shelly",
        "connectlife",
        "homeassistant",
        "demo",
    ]
    assert client.post("/api/home/integrations/nothing", json={}).status_code == 404
    view = client.post("/api/home/integrations/demo", json={}).json()
    demo = next(i for i in view["integrations"] if i["id"] == "demo")
    assert len(view["devices"]) == 4 and demo["account"]["devices"] == 4
    washer_id = view["devices"][0]["id"]
    assert client.post("/api/home/integrations/demo", json={}).status_code == 409
    usage_ = client.get("/api/home/usage", params={"bucket": "day"}).json()
    assert len(usage_["t"]) in (7, 8) and len(usage_["devices"]) == 4
    assert client.get("/api/home/usage", params={"bucket": "hour", "start": 0, "end": 10 * 86400}).status_code == 422
    assert len(client.get("/api/home/patterns").json()) == 4
    runs = client.get("/api/home/runs", params={"device": washer_id}).json()
    assert runs and runs[0]["start"] > runs[-1]["start"]  # newest first
    curve = client.get(f"/api/home/runs/{runs[0]['id']}/curve").json()
    assert curve["run"]["id"] == runs[0]["id"] and len(curve["t"]) == len(curve["w"]) and max(curve["w"]) > 100
    assert client.get("/api/home/runs/999999/curve").status_code == 404
    assert set(usage_["total"]["cost"]) == {"import", "supply", "credit", "devices", "car", "other"}
    assert usage_["car"] is None  # no car connected
    assert all("cost" in d and "solar_share" in d for d in usage_["devices"])
    found = client.get("/api/home/insights").json()
    assert set(found) == {"standby", "unexplained", "best_times", "changes", "savings"}
    assert {s["id"] for s in found["savings"]} <= {d["id"] for d in view["devices"][:2]}
    assert {b["id"] for b in found["best_times"]} <= {d["id"] for d in view["devices"][:2]}  # the washer and dryer
    assert client.patch(f"/api/home/devices/{washer_id}", json={"kind": "toaster"}).status_code == 422
    assert client.get("/api/home/devices/999/raw").status_code == 404
    assert client.delete("/api/home/integrations/demo").json()["devices"] == []


def test_devices_that_cant_be_switched_say_so_and_the_demo_tv_can(client: TestClient) -> None:
    view = client.post("/api/home/integrations/demo", json={}).json()
    by_name = {d["name"]: d for d in view["devices"]}
    assert by_name["TV"]["can_switch"]
    switched = client.post(f"/api/home/devices/{by_name['TV']['id']}/switch", json={"on": False}).json()
    tv = next(d for d in switched["devices"] if d["name"] == "TV")
    assert tv["now"]["switched_on"] is False and tv["now"]["power_w"] == 0
    washer = client.post(f"/api/home/devices/{by_name['Laundry washer']['id']}/switch", json={"on": False})
    assert washer.status_code == 502 and "Only the demo TV" in washer.json()["detail"]
    fridge = client.post(f"/api/home/devices/{by_name['Kitchen fridge']['id']}/switch", json={"on": False})
    assert fridge.status_code == 409 and "food cold" in fridge.json()["detail"]
    # The TV, read now, can run on spare solar; the fridge can't, and the washer doesn't say whether it's on.
    tv_id = by_name["TV"]["id"]
    ruled = client.put(f"/api/home/devices/{tv_id}/rule", json={"start_w": 1200, "from": "09:00", "until": "15:00"})
    rule = next(d for d in ruled.json()["devices"] if d["id"] == tv_id)["rule"]
    assert (rule["start_w"], rule["stop_w"], rule["until"], rule["enabled"]) == (1200, 300, "15:00", True)
    fridge_rule = client.put(f"/api/home/devices/{by_name['Kitchen fridge']['id']}/rule", json={})
    assert fridge_rule.status_code == 422 and "food cold" in fridge_rule.json()["detail"]
    assert client.put(f"/api/home/devices/{by_name['Laundry washer']['id']}/rule", json={}).status_code == 409
    # Switched by hand, its rule waits until tomorrow.
    paused = client.post(f"/api/home/devices/{tv_id}/switch", json={"on": True}).json()
    assert next(d for d in paused["devices"] if d["id"] == tv_id)["rule"]["paused_until"] > time.time()
    cleared = client.delete(f"/api/home/devices/{tv_id}/rule").json()
    assert next(d for d in cleared["devices"] if d["id"] == tv_id)["rule"] is None
