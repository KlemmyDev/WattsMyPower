"""The first-run guide's progress, and that installs already in use never see it after upgrading."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.live.client import CollectorError
from app.features.live.ingest import save_cursor
from app.features.onboarding.service import ENTERED
from app.features.settings.router import name_location
from app.features.settings.store import SYSTEM, SYSTEM_SEEDED
from app.main import create_app
from tests.test_integrations import FakeCollector

HYBRID = {"role": "hybrid", "driver": "sungrow.sh_rs", "host": "192.168.0.244", "port": 502, "unit": 1, "settings": {}}
TARIFF = json.dumps({"type": "flat", "flat_rate": 0.3, "feed_in_rate": 0.05, "supply_charge": 1.1, "bands": []})
PV2 = {"role": "pv2", "driver": "sungrow.sg_d", "host": "192.168.0.10", "port": 502, "unit": 1, "settings": {}}


@pytest.fixture
def collector() -> FakeCollector:
    return FakeCollector()


@pytest.fixture
def open_app(config: Config, db: Database, collector: FakeCollector) -> Iterator[Callable[..., TestClient]]:
    """A signed-in client for the dashboard as installed (not the demo), reading `collector`. Each call
    is a fresh start of the app on the same database."""
    clients: list[TestClient] = []

    def make(**changes: Any) -> TestClient:
        app = create_app(replace(config, mock=False, auth=True, **changes), poll=False, serve_dashboard=False)
        app.state.services.integrations.collector = collector
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        account = {"username": "home", "password": "a-long-password"}
        code = app.state.services.auth.prepare_setup_code() or ""  # None once there's an account
        first = client.post("/api/auth/setup", json={**account, "code": code})  # later starts sign in instead
        assert first.is_success or client.post("/api/auth/login", json=account).is_success
        return client

    yield make
    for c in clients:
        c.__exit__(None, None, None)


def stored(db: Database) -> dict[str, Any] | None:
    with db.reading() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key = 'onboarding'").fetchone()
    return json.loads(row[0]) if row else None


def test_an_existing_install_never_sees_the_guide_after_upgrading(
    db: Database, collector: FakeCollector, open_app: Callable[..., TestClient]
) -> None:
    """The hosted install: inverters connected, months of readings, a saved tariff and location."""
    collector.stored = {"hybrid": HYBRID, "pv2": PV2}
    with db.writing() as conn:
        conn.executemany("INSERT INTO samples (ts, pv_power, battery_soc) VALUES (?, ?, ?)", [(1_750_000_000 + i * 60, 3200, 80) for i in range(5)])  # fmt: skip
        conn.execute("INSERT INTO kv (key, value) VALUES ('tariff', ?)", (TARIFF,))
        conn.executemany("INSERT INTO settings (key, value) VALUES (?, ?)", [("latitude", -27.47), ("longitude", 153.03)])  # fmt: skip

    client = open_app()
    assert client.get("/api/onboarding").json() == {"complete": True, "dismissed": False, "show": False, "steps": {}}
    assert stored(db) == {"complete": True, "dismissed": False, "steps": {}, "existing": True}

    # Settled once: it stays finished whatever changes later, even across restarts.
    collector.stored = {}
    with db.writing() as conn:
        conn.execute("DELETE FROM samples")
    assert open_app().get("/api/onboarding").json()["show"] is False


@pytest.mark.parametrize(
    "sign",
    [
        "inverter connected",  # set up on #15, before any reading arrived
        "readings recorded",
        "readings rolled up",  # raw readings pruned past retention
        "rates saved",
        "location saved",
        "billing period saved",
        "rates saved by an older version",
    ],
)
def test_any_sign_of_use_counts_as_set_up(
    sign: str, db: Database, collector: FakeCollector, open_app: Callable[..., TestClient]
) -> None:
    if sign == "inverter connected":
        collector.stored = {"hybrid": HYBRID}
    else:

        def down() -> dict[str, Any]:  # and the collector being down doesn't matter
            raise CollectorError(502, "The collector couldn't be reached (URLError).")

        collector.devices = down  # type: ignore[method-assign]
    with db.writing() as conn:
        if sign == "readings recorded":
            conn.execute("INSERT INTO samples (ts, pv_power) VALUES (1750000000, 100)")
        elif sign == "readings rolled up":
            conn.execute("INSERT INTO samples_5m (ts, pv_power) VALUES (1750000000, 100)")
        elif sign == "rates saved":
            conn.execute("INSERT INTO kv (key, value) VALUES ('tariff', ?)", (TARIFF,))
        elif sign == "location saved":
            conn.execute("INSERT INTO settings (key, value) VALUES ('latitude', -33.87)")
        elif sign == "billing period saved":
            conn.execute("INSERT INTO settings (key, value) VALUES ('bill_day', 15)")
        elif sign == "rates saved by an older version":
            conn.execute("INSERT INTO settings (key, value) VALUES ('import_rate', 0.29)")
    assert open_app().get("/api/onboarding").json()["complete"] is True


def test_what_startup_writes_by_itself_doesnt_count(db: Database, open_app: Callable[..., TestClient]) -> None:
    """A new install, after startup has run: the system details seeded from the environment into
    settings (with their kv marker), the default location's place name looked up, and the collector's
    cursor. None of it was entered by a person, so the guide still shows."""
    client = open_app()  # startup runs SettingsStore.seed_system
    svc = client.app.state.services  # type: ignore[attr-defined]
    with db.reading() as conn:
        seeded = {k for (k,) in conn.execute("SELECT key FROM settings")}
        assert conn.execute("SELECT 1 FROM kv WHERE key = ?", (SYSTEM_SEEDED,)).fetchone()
    assert seeded == set(SYSTEM) and not seeded & set(ENTERED)
    # What starting to poll adds, without the network: the place name lookup and the feed's cursor.
    svc.geocoder.reverse = lambda lat, lon: "Brisbane City, QLD"
    assert name_location(svc)
    with db.writing() as conn:
        save_cursor(conn, 1_760_000_000)
    assert client.get("/api/onboarding").json()["show"] is True


def test_a_fresh_install_is_guided_until_it_finishes(
    db: Database, collector: FakeCollector, open_app: Callable[..., TestClient]
) -> None:
    client = open_app()
    assert client.get("/api/onboarding").json() == {"complete": False, "dismissed": False, "show": True, "steps": {}}

    # Connecting the inverter in the guide's first step doesn't end it.
    assert client.put("/api/integrations/hybrid", json={"driver": "sungrow.sh_rs", "host": "192.168.0.244"}).is_success
    body = client.patch("/api/onboarding", json={"steps": {"inverter": "done"}}).json()
    assert body["show"] is True and body["steps"] == {"inverter": "done"}

    # The system step saves the array size; that doesn't end the guide either.
    assert client.put("/api/settings", json={"pv_kw": 13.2}).is_success
    body = client.patch("/api/onboarding", json={"steps": {"system": "done"}}).json()
    assert body["show"] is True and body["steps"] == {"inverter": "done", "system": "done"}

    client.patch("/api/onboarding", json={"steps": {"plan": "skipped", "location": "done"}})
    body = client.patch("/api/onboarding", json={"steps": {"billing": "done"}, "complete": True}).json()
    assert body == {
        "complete": True,
        "dismissed": False,
        "show": False,
        "steps": {"inverter": "done", "system": "done", "plan": "skipped", "location": "done", "billing": "done"},
    }
    assert open_app().get("/api/onboarding").json()["show"] is False


def test_putting_it_off_stops_the_redirect_but_keeps_progress(open_app: Callable[..., TestClient]) -> None:
    client = open_app()
    client.patch("/api/onboarding", json={"steps": {"inverter": "skipped"}})
    body = client.patch("/api/onboarding", json={"dismissed": True}).json()
    assert body == {"complete": False, "dismissed": True, "show": False, "steps": {"inverter": "skipped"}}
    # Unmarking a step (to do it again) is a null.
    assert client.patch("/api/onboarding", json={"steps": {"inverter": None}}).json()["steps"] == {}


def test_with_the_collector_down_a_fresh_install_is_asked_again_later(
    db: Database, collector: FakeCollector, open_app: Callable[..., TestClient]
) -> None:
    devices = collector.devices

    def down() -> dict[str, Any]:
        raise CollectorError(502, "The collector couldn't be reached (URLError).")

    collector.devices = down  # type: ignore[method-assign]
    client = open_app()
    assert client.get("/api/onboarding").json()["show"] is True
    assert stored(db) is None  # not settled: it may have an inverter that can't be asked about yet

    collector.devices = devices  # type: ignore[method-assign]
    collector.stored = {"hybrid": HYBRID}
    assert client.get("/api/onboarding").json()["complete"] is True


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"steps": {"cost": "done"}}, "No step 'cost'"),
        ({"steps": {"plan": "maybe"}}, "done or skipped"),
        ({"steps": ["plan"]}, "steps must be an object"),
        ({"complete": "yes"}, "complete must be true or false"),
    ],
)
def test_bad_marks_are_refused(open_app: Callable[..., TestClient], changes: dict[str, Any], message: str) -> None:
    r = open_app().patch("/api/onboarding", json=changes)
    assert r.status_code == 422 and message in r.json()["detail"]


def test_it_needs_signing_in(config: Config) -> None:
    with TestClient(create_app(replace(config, auth=True), poll=False, serve_dashboard=False)) as c:
        assert c.get("/api/onboarding").status_code == 401


def test_the_demo_skips_it(config: Config) -> None:
    """MOCK=1 makes up its readings, so there's nothing to set up (/welcome can still be opened to see it)."""
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        assert c.get("/api/onboarding").json()["show"] is False
