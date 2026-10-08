"""The HTTP API end to end, through FastAPI's test client (no inverter: the poller isn't started)."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.version import COMMIT, RELEASE, VERSION
from app.main import create_app


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


@pytest.fixture
def secured(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(replace(config, auth=True), poll=False, serve_dashboard=False)) as c:
        yield c


def test_status_before_the_first_reading(client: TestClient) -> None:
    body = client.get("/api/live").json()
    assert body["snapshot"] is None and body["mock"] is True
    assert body["system"]["tariff"]["type"] == "flat"
    assert body["app"] == {"version": VERSION, "release": RELEASE, "commit": COMMIT}
    assert client.get("/healthz").json() == {"ok": True, "inverter_fresh": False, "error": None, "version": VERSION}


def test_tariff_errors_are_readable(client: TestClient) -> None:
    r = client.put("/api/tariff", json={"type": "monthly"})
    assert r.status_code == 422
    assert r.json() == {"detail": "Rate type must be single rate, time of use, or Amber."}


def test_saved_tariff_is_used_everywhere(client: TestClient) -> None:
    tariff = {"type": "flat", "flat_rate": 0.4, "feed_in_rate": 0.06, "supply_charge": 1.2, "bands": []}
    assert client.put("/api/tariff", json=tariff).json()["flat_rate"] == 0.4
    assert client.get("/api/tariff").json()["supply_charge"] == 1.2
    assert client.get("/api/live").json()["system"]["tariff"]["flat_rate"] == 0.4


def test_settings_reject_out_of_range_values(client: TestClient) -> None:
    r = client.put("/api/settings", json={"latitude": 120})
    assert r.status_code == 422 and r.json()["detail"] == "latitude must be between -90 and 90"
    assert client.put("/api/settings", json={"bill_months": 1}).json()["bill_months"] == 1


def test_history_of_an_empty_database(client: TestClient) -> None:
    body = client.get("/api/history?start=0&end=600&points=10").json()
    assert body["series"]["t"] == []


def test_unknown_api_paths_are_404(client: TestClient) -> None:
    assert client.get("/api/nope").status_code == 404


def test_everything_needs_signing_in_when_auth_is_on(secured: TestClient) -> None:
    assert secured.get("/api/live").status_code == 401
    assert secured.get("/healthz").status_code == 200
    assert secured.get("/api/auth/session").json() == {
        "authenticated": False,
        "setup_required": True,
        "username": None,
        "auth_enabled": True,
    }


def test_account_setup_sign_in_and_out(secured: TestClient) -> None:
    assert secured.post("/api/auth/setup", json={"username": "home", "password": "short"}).status_code == 422
    r = secured.post("/api/auth/setup", json={"username": "home", "password": "correct horse"})
    assert r.status_code == 200 and "wmp_session" in r.cookies
    assert secured.get("/api/live").status_code == 200  # the cookie is sent from now on
    assert secured.post("/api/auth/setup", json={"username": "x", "password": "another one"}).status_code == 409

    secured.post("/api/auth/logout")
    assert secured.get("/api/live").status_code == 401
    bad = secured.post("/api/auth/login", json={"username": "home", "password": "wrong password"})
    assert bad.status_code == 401 and bad.json()["detail"] == "That username and password don't match."
    assert secured.post("/api/auth/login", json={"username": "HOME", "password": "correct horse"}).status_code == 200
    assert secured.get("/api/auth/session").json()["username"] == "home"


def test_sign_in_pauses_after_repeated_failures(secured: TestClient) -> None:
    secured.post("/api/auth/setup", json={"username": "home", "password": "correct horse"})
    secured.post("/api/auth/logout")
    for _ in range(5):
        assert secured.post("/api/auth/login", json={"username": "home", "password": "nope nope"}).status_code == 401
    r = secured.post("/api/auth/login", json={"username": "home", "password": "correct horse"})
    assert r.status_code == 429
