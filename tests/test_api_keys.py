"""API keys for other apps: made and removed by the signed-in household, and each one opens only the read-only /api/v1
routes for the things it was given."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.features.keys.service import DEFAULT_SCOPES, MAX_KEYS, SCOPES
from app.main import create_app
from tests.test_security import ACCOUNT, code_of


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(replace(config, auth=True), poll=False, serve_dashboard=False)) as c:
        assert c.post("/api/auth/setup", json={**ACCOUNT, "code": code_of(c)}).status_code == 200
        yield c


def make(c: TestClient, name: str = "Home Hub", scopes: Any = ...) -> Any:
    body: dict[str, Any] = {"name": name}
    if scopes is not ...:
        body["scopes"] = scopes
    return c.post("/api/keys", json=body)


def bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def another_app(c: TestClient) -> TestClient:
    """The same server, as an app with no session cookie: it can only send a key."""
    c.cookies.clear()
    return c


def test_only_the_signed_in_household_can_make_list_or_remove_keys(client: TestClient) -> None:
    key_id = make(client).json()["id"]
    another_app(client)
    assert client.get("/api/keys").status_code == 401
    assert client.post("/api/keys", json={"name": "Sneaky"}).status_code == 401
    assert client.delete(f"/api/keys/{key_id}").status_code == 401


def test_without_a_key_or_with_a_wrong_one_the_api_is_closed(client: TestClient) -> None:
    another_app(client)
    for headers in ({}, bearer("wmp_nope"), {"Authorization": "Basic abc"}, {"Authorization": "Bearer"}):
        assert client.get("/api/v1/live", headers=headers).status_code == 401
    # The dashboard's own routes still need the session, whatever key is sent.
    assert client.get("/api/live", headers=bearer("wmp_nope")).status_code == 401


def test_a_key_reads_only_what_it_was_given(client: TestClient) -> None:
    made = make(client, "Widgets", ["live:read", "costs:read"])
    assert made.status_code == 200 and made.headers["cache-control"] == "no-store"
    key = made.json()["key"]
    assert key.startswith("wmp_") and made.json()["scopes"] == ["live:read", "costs:read"]
    another_app(client)
    h = bearer(key)
    assert client.get("/api/v1/ping", headers=h).json()["key"] == {
        "name": "Widgets",
        "scopes": ["live:read", "costs:read"],
    }
    live = client.get("/api/v1/live", headers=h).json()
    assert "snapshot" in live and not {"system", "app", "ev"} & set(live), "those are other permissions"
    for ok in ("costs", "tariff", "bills"):
        assert client.get(f"/api/v1/{ok}", headers=h).status_code == 200, ok
    today = client.get("/api/v1/today", headers=h).json()
    assert "live" in today and "costs" in today
    for no in ("history", "daily", "export.csv", "forecast", "insights", "system"):
        r = client.get(f"/api/v1/{no}", headers=h)
        assert r.status_code == 403 and "can't read" in r.json()["detail"], no


def test_the_today_answer_leaves_out_costs_when_the_key_may_not_read_them(client: TestClient) -> None:
    key = make(client, "Live only", ["live:read"]).json()["key"]
    another_app(client)
    assert "costs" not in client.get("/api/v1/today", headers=bearer(key)).json()


def test_a_key_given_everything_reads_everything_and_the_default_leaves_out_the_system(client: TestClient) -> None:
    default = make(client, "Defaults").json()
    assert default["scopes"] == list(DEFAULT_SCOPES) and "system:read" not in default["scopes"]
    listed = {s["id"]: s for s in client.get("/api/keys").json()["scopes"]}
    assert (
        set(listed) == set(SCOPES)
        and listed["system:read"]["default"] is False
        and listed["live:read"]["default"] is True
    )
    key = make(client, "Everything", list(SCOPES)).json()["key"]
    another_app(client)
    h = bearer(key)
    for path in ("history", "daily", "export.csv", "forecast", "insights", "system"):
        assert client.get(f"/api/v1/{path}", headers=h).status_code == 200, path
    system = client.get("/api/v1/system", headers=h).json()
    assert {"system", "settings", "storage"} <= set(system)


def test_only_a_hash_is_kept_and_removing_a_key_stops_it_at_once(client: TestClient, config: Config) -> None:
    made = make(client, "Temp", ["live:read"]).json()
    key = made["key"]
    with sqlite3.connect(config.db_path) as conn:
        stored = " ".join(str(v) for row in conn.execute("SELECT * FROM api_keys") for v in row)
    assert key not in stored and made["prefix"] == key[:8], "the whole key is never kept"
    assert made["last_used"] is None
    h = bearer(key)
    assert client.get("/api/v1/live", headers=h).status_code == 200  # it needs no session
    listed = {k["id"]: k for k in client.get("/api/keys").json()["keys"]}
    assert listed[made["id"]]["last_used"] is not None and "key" not in listed[made["id"]]
    assert client.delete(f"/api/keys/{made['id']}").status_code == 200
    assert client.get("/api/v1/live", headers=h).status_code == 401
    assert client.delete(f"/api/keys/{made['id']}").status_code == 404


def test_bad_requests_are_explained(client: TestClient) -> None:
    assert make(client, "   ").status_code == 422
    assert make(client, "x" * 41).status_code == 422
    assert make(client, "Nothing", []).status_code == 422
    odd = make(client, "Odd", ["live:write"])
    assert odd.status_code == 422 and "permission" in odd.json()["detail"]
    assert make(client, "A", "live:read").status_code == 422, "a list of permissions, not a word"


def test_there_is_a_limit_on_keys(client: TestClient) -> None:
    for n in range(MAX_KEYS):
        assert make(client, f"k{n}", ["live:read"]).status_code == 200
    over = make(client, "one too many", ["live:read"])
    assert over.status_code == 422 and "lot of keys" in over.json()["detail"]


def test_a_key_works_when_sign_in_is_off_too(config: Config) -> None:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        key = make(c, "Open", ["live:read"]).json()["key"]
        assert c.get("/api/v1/live").status_code == 401, "the read-only API always wants a key"
        assert c.get("/api/v1/live", headers=bearer(key)).status_code == 200
