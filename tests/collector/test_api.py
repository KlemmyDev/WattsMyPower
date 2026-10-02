"""The collector's HTTP feed end to end, through FastAPI's test client (polls are driven by hand)."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from dataclasses import replace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from collector.config import Config
from collector.main import create_app
from collector.poller import Poller
from collector.store import Store
from tests.collector.conftest import FakeDevice

AUTH = {"Authorization": "Bearer secret"}


@pytest.fixture
def app(cfg: Config) -> FastAPI:
    return create_app(cfg, hybrid=FakeDevice(), poll=False)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def poll(client: TestClient) -> None:
    poller: Poller = client.app.state.poller  # type: ignore[attr-defined]
    client.portal.call(poller.poll_once)  # type: ignore[union-attr]


def store_of(client: TestClient) -> Store:
    store: Store = client.app.state.store  # type: ignore[attr-defined]
    return store


@pytest.mark.parametrize("header", [None, "Bearer wrong", "Basic secret", "secret"])
def test_the_feed_needs_the_token(client: TestClient, header: str | None) -> None:
    r = client.get("/v1/readings", headers={"Authorization": header} if header else {})
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"
    assert client.get("/v1/status", headers={"Authorization": header} if header else {}).status_code == 401


def test_the_right_token_is_let_in(client: TestClient) -> None:
    assert client.get("/v1/readings", headers=AUTH).status_code == 200
    assert client.get("/v1/status", headers={"Authorization": "bearer secret"}).status_code == 200


def test_without_a_configured_token_the_feed_is_off(cfg: Config) -> None:
    with TestClient(create_app(replace(cfg, token=""), hybrid=FakeDevice(), poll=False)) as c:
        r = c.get("/v1/readings", headers={"Authorization": "Bearer "})
        assert r.status_code == 503 and "COLLECTOR_TOKEN" in r.json()["detail"]
        assert c.get("/healthz").status_code == 200


def test_readings_after_a_poll(client: TestClient) -> None:
    poll(client)
    body = client.get("/v1/readings?since=0", headers=AUTH).json()
    assert body["more"] is False
    [row] = body["readings"]
    assert row["device"] == "hybrid" and row["driver"] == "sungrow.sh_rs" and isinstance(row["ts"], int)
    assert row["input"] == {"4990": 16691, "5000": 3597, "5008": 312, "5017": 4120, "5018": 0}
    assert row["holding"] == {"13059": 50}


def test_since_limit_and_more(client: TestClient) -> None:
    store = store_of(client)
    for ts in (100, 160, 220):
        store.write_poll(ts, [("hybrid", "sungrow.sh_rs", {5008: ts}, {}), ("pv2", "sungrow.sg_d", {5000: ts}, {})])
    body = client.get("/v1/readings?since=0&limit=3", headers=AUTH).json()
    assert [(r["ts"], r["device"]) for r in body["readings"]] == [(100, "hybrid"), (100, "pv2")]
    assert body["more"] is True
    assert "holding" not in body["readings"][0]
    body = client.get("/v1/readings?since=100&limit=99999", headers=AUTH).json()  # limit is capped, not refused
    assert [r["ts"] for r in body["readings"]] == [160, 160, 220, 220] and body["more"] is False


def test_long_poll_returns_when_a_poll_lands(client: TestClient) -> None:
    result: dict[str, object] = {}

    def wait() -> None:
        started = time.monotonic()
        result["body"] = client.get("/v1/readings?since=0&wait=10", headers=AUTH).json()
        result["took"] = time.monotonic() - started

    t = threading.Thread(target=wait)
    t.start()
    time.sleep(0.3)
    poll(client)
    t.join(5)
    assert not t.is_alive()
    assert len(result["body"]["readings"]) == 1  # type: ignore[index]
    assert result["took"] < 5  # type: ignore[operator]


def test_long_poll_times_out_empty(client: TestClient) -> None:
    started = time.monotonic()
    body = client.get("/v1/readings?since=0&wait=0.3", headers=AUTH).json()
    assert body == {"readings": [], "more": False}
    assert 0.25 < time.monotonic() - started < 3


def test_without_wait_an_empty_feed_answers_at_once(client: TestClient) -> None:
    started = time.monotonic()
    assert client.get("/v1/readings?since=0", headers=AUTH).json() == {"readings": [], "more": False}
    assert time.monotonic() - started < 1


def test_status_shape(client: TestClient) -> None:
    body = client.get("/v1/status", headers=AUTH).json()
    assert body["version"] == 1 and body["poll_interval"] == 60 and isinstance(body["started_at"], int)
    assert body["oldest_ts"] is None and body["latest_ts"] is None
    assert body["devices"] == {
        "hybrid": {
            "host": "10.0.0.1",
            "port": 502,
            "unit": 1,
            "driver": "sungrow.sh_rs",
            "settings": {},
            "last_success": None,
            "error": None,
            "info": {"input": {}},
        }
    }
    poll(client)
    body = client.get("/v1/status", headers=AUTH).json()
    assert body["oldest_ts"] == body["latest_ts"] is not None
    hybrid = body["devices"]["hybrid"]
    assert hybrid["error"] is None and isinstance(hybrid["last_success"], float)
    assert hybrid["info"] == {"input": {"4990": 16691, "5000": 3597}, "holding": {"13059": 50}}


def test_status_includes_pv2_when_configured(cfg: Config) -> None:
    pv2 = FakeDevice("pv2", "10.0.0.2", {5000: 294})
    pv2.info, pv2.info_holding = {}, {}
    pv2.fail = True
    with TestClient(create_app(cfg, hybrid=FakeDevice(), pv2=pv2, poll=False)) as c:
        poll(c)
        devices = c.get("/v1/status", headers=AUTH).json()["devices"]
        assert devices["pv2"] == {"host": "10.0.0.2", "port": 502, "unit": 1, "driver": "sungrow.sg_d", "settings": {},
                                  "last_success": None, "error": "ConnectionError: pv2 down", "info": {"input": {}}}  # fmt: skip
        assert devices["hybrid"]["error"] is None


def test_healthz(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"ok": True, "fresh": False}
    poll(client)
    assert client.get("/healthz").json() == {"ok": True, "fresh": True}


def test_config_from_env() -> None:
    c = Config.from_env({"POLL_INTERVAL": "10", "COLLECTOR_MOCK": "1", "COLLECTOR_TOKEN": " t ", "PV2_HOST": "x"})
    assert c.poll_interval == 60 and c.mock and c.token == "t" and c.pv2_host == "x"
    assert c.db_path == "/data/collector.db" and c.retention_days == 365 and c.port == 8081


def test_mock_mode_backfills_an_empty_database(cfg: Config) -> None:
    with TestClient(create_app(replace(cfg, mock=True), poll=False)) as c:
        status = c.get("/v1/status", headers=AUTH).json()
        assert status["latest_ts"] - status["oldest_ts"] > 6 * 86400
        assert set(status["devices"]) == {"hybrid", "pv2"}
        poll(c)
        body = c.get(f"/v1/readings?since={status['latest_ts']}", headers=AUTH).json()
        assert body["readings"][0]["device"] == "hybrid" and "13045" in body["readings"][0]["input"]
