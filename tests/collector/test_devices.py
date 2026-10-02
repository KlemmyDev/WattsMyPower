"""Connecting inverters from the dashboard: the devices table, seeding from the environment, the API, scanning."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from collector.config import Config
from collector.devices import Device, DeviceConfig, Words
from collector.devices.drivers import env_devices
from collector.main import create_app
from collector.poller import Poller
from collector.scan import Scanner, parse_network
from collector.store import Store
from tests.collector.conftest import FakeDevice

AUTH = {"Authorization": "Bearer secret"}
SH = {"driver": "sungrow.sh_rs", "host": "192.168.0.244"}


class Probed:
    """A stand-in for the inverters on the network: which hosts answer, and what each probe was asked."""

    def __init__(self, answering: dict[str, Words] | None = None):
        self.answering = answering if answering is not None else {"192.168.0.244": {5000: 0x0D0F}}
        self.checked: list[DeviceConfig] = []

    def check(self, d: DeviceConfig) -> Words | None:
        self.checked.append(d)
        return self.answering.get(d.host)


def fake(d: DeviceConfig) -> Device:
    return FakeDevice(d.role, d.host)


@pytest.fixture
def probed() -> Probed:
    return Probed()


@pytest.fixture
def app(cfg: Config, probed: Probed) -> FastAPI:
    return create_app(cfg, poll=False, build=fake, check=probed.check)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def poller_of(client: TestClient) -> Poller:
    poller: Poller = client.app.state.poller  # type: ignore[attr-defined]
    return poller


# ---------------------------------------------------------------------------------------- store


def test_devices_are_stored_one_per_role(store: Store) -> None:
    store.put_device(DeviceConfig("pv2", "sungrow.sg_d", "192.168.0.10", settings={"behind_meter": False}))
    store.put_device(DeviceConfig("hybrid", "sungrow.sh_rs", "192.168.0.244"))
    store.put_device(DeviceConfig("hybrid", "sungrow.sh_rs", "192.168.0.245"))
    devices = store.devices()
    assert [(d.role, d.host) for d in devices] == [("hybrid", "192.168.0.245"), ("pv2", "192.168.0.10")]
    assert devices[1].settings == {"behind_meter": False} and devices[0].added_at > 0
    assert store.remove_device("pv2") and not store.remove_device("pv2")


def test_the_environment_seeds_the_devices_once(store: Store, cfg: Config) -> None:
    env = replace(cfg, inverter_host="192.168.0.244", pv2_host="192.168.0.10", pv2_behind_meter=True)
    assert store.seed_devices(env_devices(env))
    assert [(d.role, d.driver, d.host) for d in store.devices()] == [
        ("hybrid", "sungrow.sh_rs", "192.168.0.244"),
        ("pv2", "sungrow.sg_d", "192.168.0.10"),
    ]
    assert store.devices()[1].settings == {"behind_meter": True}
    # Removed in the dashboard: the environment doesn't bring them back.
    store.remove_device("hybrid")
    store.remove_device("pv2")
    assert not store.seed_devices(env_devices(env))
    assert store.devices() == []


def test_a_fresh_install_seeds_nothing(store: Store, cfg: Config) -> None:
    assert env_devices(cfg) == []
    assert store.seed_devices([]) and store.devices() == []


# ---------------------------------------------------------------------------------------- the api


def test_an_existing_install_keeps_reading_its_inverters_after_upgrading(cfg: Config, probed: Probed) -> None:
    env = replace(cfg, inverter_host="192.168.0.244", pv2_host="192.168.0.10")
    with TestClient(create_app(env, poll=False, build=fake, check=probed.check)) as c:
        assert [d.host for d in poller_of(c).devices] == ["192.168.0.244", "192.168.0.10"]
        status = c.get("/v1/status", headers=AUTH).json()["devices"]
        assert status["pv2"]["settings"] == {"behind_meter": True}


def test_without_devices_nothing_is_read(client: TestClient) -> None:
    poller = poller_of(client)
    assert poller.devices == [] and poller.hybrid is None
    assert client.portal.call(poller.poll_once) is False  # type: ignore[union-attr]
    assert client.get("/v1/status", headers=AUTH).json()["devices"] == {}
    assert client.get("/healthz").json() == {"ok": True, "fresh": False}
    body = client.get("/v1/devices", headers=AUTH).json()
    assert body == {"devices": [], "drivers": {"sungrow.sh_rs": "hybrid", "sungrow.sg_d": "pv2"}}


def test_connecting_a_device_checks_it_and_reads_it_from_the_next_poll(client: TestClient, probed: Probed) -> None:
    r = client.put("/v1/devices/hybrid", json=SH, headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["device"]["host"] == "192.168.0.244" and r.json()["input"] == {"5000": 0x0D0F}
    poller = poller_of(client)
    assert poller.hybrid is not None and poller.hybrid.host == "192.168.0.244"
    assert client.portal.call(poller.poll_once) is True  # type: ignore[union-attr]
    [listed] = client.get("/v1/devices", headers=AUTH).json()["devices"]
    assert listed["role"] == "hybrid" and listed["port"] == 502 and listed["unit"] == 1


def test_a_device_that_doesnt_answer_isnt_connected_unless_asked(client: TestClient, probed: Probed) -> None:
    pv2 = {"driver": "sungrow.sg_d", "host": "192.168.0.10"}
    r = client.put("/v1/devices/pv2", json=pv2, headers=AUTH)
    assert r.status_code == 422 and "192.168.0.10:502" in r.json()["detail"]
    assert client.get("/v1/devices", headers=AUTH).json()["devices"] == []
    # It sleeps after dark: connect it anyway.
    r = client.put("/v1/devices/pv2", json={**pv2, "check": False, "settings": {"behind_meter": True}}, headers=AUTH)
    assert r.status_code == 200 and r.json()["input"] == {}


def test_changing_only_settings_doesnt_bother_the_inverter(client: TestClient, probed: Probed) -> None:
    client.put("/v1/devices/hybrid", json=SH, headers=AUTH)
    before = poller_of(client).hybrid
    client.put("/v1/devices/hybrid", json={**SH, "settings": {"note": "x"}}, headers=AUTH)
    assert len(probed.checked) == 1
    assert poller_of(client).status["hybrid"].settings == {"note": "x"}
    assert poller_of(client).hybrid is not before  # rebuilt, but its status carried over
    assert client.get("/v1/devices", headers=AUTH).json()["devices"][0]["settings"] == {"note": "x"}


@pytest.mark.parametrize(
    ("role", "body", "status", "says"),
    [
        ("hybrid", {"driver": "sungrow.sg_d", "host": "192.168.0.10"}, 422, "reads a pv2 device"),
        ("hybrid", {"driver": "nope", "host": "192.168.0.10"}, 422, "Unknown driver"),
        ("hybrid", {**SH, "host": "not an address!"}, 422, "IP address"),
        ("hybrid", {**SH, "port": 70000}, 422, "port"),
        ("battery", SH, 404, "No device role"),
    ],
)
def test_bad_devices_are_refused(client: TestClient, role: str, body: dict[str, Any], status: int, says: str) -> None:
    r = client.put(f"/v1/devices/{role}", json=body, headers=AUTH)
    assert r.status_code == status and says in r.json()["detail"]


def test_removing_a_device_stops_reading_it(client: TestClient) -> None:
    client.put("/v1/devices/hybrid", json=SH, headers=AUTH)
    assert client.delete("/v1/devices/hybrid", headers=AUTH).json() == {"removed": True}
    assert poller_of(client).hybrid is None
    assert client.delete("/v1/devices/hybrid", headers=AUTH).json() == {"removed": False}


def test_the_device_api_needs_the_token(client: TestClient) -> None:
    assert client.get("/v1/devices").status_code == 401
    assert client.put("/v1/devices/hybrid", json=SH).status_code == 401
    assert client.post("/v1/scan", json={"network": "192.168.0.0/24"}).status_code == 401


# ---------------------------------------------------------------------------------------- scanning


def test_networks_to_scan() -> None:
    assert str(parse_network("192.168.0.0/24")) == "192.168.0.0/24"
    assert str(parse_network("192.168.0.57")) == "192.168.0.0/24"
    assert str(parse_network("10.1.0.0/22")) == "10.1.0.0/22"
    with pytest.raises(ValueError, match="too big"):
        parse_network("10.0.0.0/16")
    with pytest.raises(ValueError, match="home network"):
        parse_network("8.8.8.0/24")
    with pytest.raises(ValueError, match="isn't a network"):
        parse_network("my house")


def test_a_scan_probes_what_answers_but_not_whats_connected() -> None:
    probed: list[str] = []

    def probe(host: str, port: int) -> tuple[str, Words] | None:
        probed.append(host)
        return ("sungrow.sg_d", {5000: 0x0126}) if host == "192.168.0.10" else None

    async def is_open(host: str, port: int) -> bool:
        return host in ("192.168.0.10", "192.168.0.244", "192.168.0.50")

    async def run() -> dict[str, Any]:
        scanner = Scanner(probe, is_open)
        started = scanner.start("192.168.0.0/24", connected=["192.168.0.244"])
        assert started["running"] and started["total"] == 254
        with pytest.raises(RuntimeError):
            scanner.start("192.168.0.0/24", connected=[])
        while scanner.state()["running"]:
            await asyncio.sleep(0.01)
        return scanner.state()

    state = asyncio.run(run())
    assert state["checked"] == 254 and state["error"] is None
    assert sorted(probed) == ["192.168.0.10", "192.168.0.50"]  # the connected inverter isn't bothered
    found = {f["host"]: f for f in state["found"]}
    assert found["192.168.0.10"]["driver"] == "sungrow.sg_d" and found["192.168.0.10"]["input"] == {"5000": 0x0126}
    assert found["192.168.0.244"]["connected"] is True
    assert found["192.168.0.50"]["driver"] is None  # something on port 502 that isn't a known inverter


def test_scanning_through_the_api(client: TestClient) -> None:
    r = client.post("/v1/scan", json={"network": "8.8.8.0/24"}, headers=AUTH)
    assert r.status_code == 422
    assert client.get("/v1/scan", headers=AUTH).json()["running"] is False


def test_mock_mode_has_inverters_to_find_and_connect(cfg: Config) -> None:
    with TestClient(create_app(replace(cfg, mock=True), poll=False)) as c:
        devices = c.get("/v1/devices", headers=AUTH).json()["devices"]
        assert [(d["role"], d["host"]) for d in devices] == [("hybrid", "mock"), ("pv2", "mock")]
        assert c.post("/v1/scan", json={"network": "192.168.0.0/24"}, headers=AUTH).status_code == 200
        deadline = time.time() + 10
        while c.get("/v1/scan", headers=AUTH).json()["running"] and time.time() < deadline:
            time.sleep(0.05)
        found = {f["host"]: f for f in c.get("/v1/scan", headers=AUTH).json()["found"]}
        assert found["192.168.0.244"]["driver"] == "sungrow.sh_rs" and found["192.168.0.244"]["input"]["5000"] == 0x0D0F
        r = c.put("/v1/devices/hybrid", json=SH, headers=AUTH)
        assert r.status_code == 200 and r.json()["input"]["5000"] == 0x0D0F


# ---------------------------------------------------------------------------------------- upgrading


def _hosted_v1_database(path: str) -> list[tuple[int, str]]:
    """A collector database exactly as the version before devices were stored writes it (schema v1),
    with a day of polls from both inverters. Returns the (ts, device) of every row."""
    import sqlite3

    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE readings (ts INTEGER NOT NULL, device TEXT NOT NULL, driver TEXT NOT NULL,"
        " input TEXT NOT NULL, holding TEXT, PRIMARY KEY (ts, device))"
    )
    conn.execute("PRAGMA user_version = 1")
    rows = []
    for k in range(1440):
        ts = 1_790_900_000 + k * 60
        conn.execute("INSERT INTO readings VALUES (?, 'hybrid', 'sungrow.sh_rs', ?, NULL)", (ts, f'{{"5017":{k}}}'))
        rows.append((ts, "hybrid"))
        if k % 2:
            conn.execute("INSERT INTO readings VALUES (?, 'pv2', 'sungrow.sg_d', '{\"5031\":1}', NULL)", (ts,))
            rows.append((ts, "pv2"))
    conn.commit()
    conn.close()
    return rows


def test_upgrading_the_hosted_collector_keeps_every_reading_and_its_inverters(cfg: Config, probed: Probed) -> None:
    """The hosted install: an existing database and INVERTER_HOST / PV2_HOST in .env. After upgrading,
    nothing stored is lost, the feed carries on from where the dashboard's cursor is, and the same
    inverters are read without anyone having to connect them."""
    rows = _hosted_v1_database(cfg.db_path)
    env = replace(cfg, inverter_host="192.168.0.244", pv2_host="192.168.0.10", pv2_behind_meter=True)
    with TestClient(create_app(env, poll=False, build=fake, check=probed.check)) as c:
        devices = c.get("/v1/devices", headers=AUTH).json()["devices"]
        assert [(d["role"], d["driver"], d["host"], d["settings"]) for d in devices] == [
            ("hybrid", "sungrow.sh_rs", "192.168.0.244", {}),
            ("pv2", "sungrow.sg_d", "192.168.0.10", {"behind_meter": True}),
        ]
        assert [d.host for d in poller_of(c).devices] == ["192.168.0.244", "192.168.0.10"]
        assert probed.checked == []  # moved over as they were: the inverters aren't bothered

        # Every stored row is still served, in order, and the dashboard's cursor still means the same.
        served, since = [], 0
        while True:
            body = c.get(f"/v1/readings?since={since}&limit=500", headers=AUTH).json()
            served += [(r["ts"], r["device"]) for r in body["readings"]]
            since = body["readings"][-1]["ts"]
            if not body["more"]:
                break
        assert served == rows
        cursor = rows[700][0]
        after = c.get(f"/v1/readings?since={cursor}&limit=5000", headers=AUTH).json()["readings"]
        assert after[0]["ts"] == rows[702][0] and len(after) == sum(1 for ts, _ in rows if ts > cursor)

        # New polls land after the old ones.
        assert c.portal.call(poller_of(c).poll_once) is True  # type: ignore[union-attr]
        assert store_rows(env) == len(rows) + 2

    # A restart doesn't seed again, and doesn't touch what's connected.
    with TestClient(create_app(env, poll=False, build=fake, check=probed.check)) as c:
        assert len(c.get("/v1/devices", headers=AUTH).json()["devices"]) == 2


def test_rolling_back_to_the_previous_collector_still_works(cfg: Config, probed: Probed) -> None:
    """If the update has to be undone, the previous version opens the upgraded database: it only
    runs the migrations it knows (none: it's already past them) and reads its inverters from .env."""
    import sqlite3

    _hosted_v1_database(cfg.db_path)
    env = replace(cfg, inverter_host="192.168.0.244")
    with TestClient(create_app(env, poll=False, build=fake, check=probed.check)):
        pass
    previous_migrations = 1  # the version before had only the baseline
    with sqlite3.connect(cfg.db_path) as conn:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        assert version >= previous_migrations  # so its migrate() runs nothing
        assert conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0] == 2160
        # Its writes still fit the readings table it knows.
        conn.execute("INSERT INTO readings VALUES (1, 'hybrid', 'sungrow.sh_rs', '{}', NULL)")


def store_rows(config: Config) -> int:
    import sqlite3

    with sqlite3.connect(config.db_path) as conn:
        n: int = conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
        return n
