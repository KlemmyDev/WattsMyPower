"""Connecting inverters from Manage → Integrations: the API's side (the collector is faked)."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.features.integrations.service import IntegrationError, IntegrationsService
from app.features.inverters.drivers import identify
from app.features.live.client import CollectorError
from app.features.live.ingest import NO_INVERTER, CollectorIngest
from app.features.live.service import LiveService
from app.main import create_app

SERIAL = {str(4990 + i): int.from_bytes(b"A23A0903744\x00\x00\x00\x00\x00\x00\x00\x00\x00"[2 * i : 2 * i + 2], "big") for i in range(10)}  # fmt: skip
SH5 = {"5000": 0x0D0F, "5001": 50, "5002": 0, **SERIAL}
SG5K = {"5000": 0x0126, "5001": 50, "5003": 0, "5004": 0, "5005": 0, "5006": 0, "5007": 0, "5008": 0}


class FakeCollector:
    """The collector's devices API, in memory."""

    def __init__(self) -> None:
        self.stored: dict[str, dict[str, Any]] = {}
        self.answers: dict[str, dict[str, int]] = {"192.168.0.244": {k: int(v) for k, v in SH5.items()}}
        self.scan_state: dict[str, Any] = {"running": False, "network": None}
        self.requests: list[tuple[str, dict[str, Any]]] = []

    def status(self) -> dict[str, Any]:
        return {"devices": {r: {**d, "last_success": None, "error": None, "info": {"input": {}}} for r, d in self.stored.items()}}  # fmt: skip

    def devices(self) -> dict[str, Any]:
        return {"devices": list(self.stored.values()), "drivers": {"sungrow.sh_rs": "hybrid", "sungrow.sg_d": "pv2"}}

    def put_device(self, role: str, body: dict[str, Any]) -> dict[str, Any]:
        self.requests.append((role, body))
        words = self.answers.get(body["host"])
        if body["check"] and words is None:
            raise CollectorError(422, f"Nothing at {body['host']}:502 answered like a {body['driver']} inverter.")
        self.stored[role] = {"role": role, **{k: v for k, v in body.items() if k != "check"}}
        return {"device": self.stored[role], "input": {str(a): w for a, w in (words or {}).items()}}

    def remove_device(self, role: str) -> dict[str, Any]:
        return {"removed": self.stored.pop(role, None) is not None}

    def scan(self) -> dict[str, Any]:
        return self.scan_state

    def start_scan(self, network: str) -> dict[str, Any]:
        if network.startswith("8."):
            raise CollectorError(422, "Only your home network can be scanned.")
        self.scan_state = {
            "running": False,
            "network": network,
            "checked": 254,
            "total": 254,
            "error": None,
            "found": [
                {"host": "192.168.0.50", "port": 502, "driver": None, "input": {}},
                {"host": "192.168.0.10", "port": 502, "driver": "sungrow.sg_d", "input": SG5K},
                {"host": "192.168.0.244", "port": 502, "driver": None, "input": {}, "connected": True},
            ],
        }
        return self.scan_state


@pytest.fixture
def collector() -> FakeCollector:
    return FakeCollector()


@pytest.fixture
def service(config: Config, collector: FakeCollector) -> IntegrationsService:
    cfg = replace(config, mock=False)
    return IntegrationsService(cfg, collector, LiveService(cfg, None, None))  # type: ignore[arg-type]


def test_identity_registers_say_what_an_inverter_is() -> None:
    assert identify("sungrow.sh_rs", {k: int(v) for k, v in SH5.items()}) == {
        "brand": "Sungrow", "model": "SH5.0RS", "serial": "A23A0903744", "nominal_kw": 5.0, "supported": True,
        "untested": False,
    }  # fmt: skip
    assert identify("sungrow.sg_d", {k: int(v) for k, v in SG5K.items()})["model"] == "SG5K-D"
    assert identify("sungrow.sh_rs", {"5000": 0x2C12, "5001": 50, "5002": 0})["supported"] is False
    # A hybrid newer than the list can still be connected, marked as not tested.
    newer = identify("sungrow.sh_rs", {"5000": 0x0D2C, "5001": 50, "5002": 0})
    assert newer["supported"] is True and newer["untested"] is True and newer["model"] == "SH hybrid (type 0x0D2C)"
    assert identify(None, {}) == {"brand": None, "model": None, "serial": None, "nominal_kw": None, "supported": False,
                                  "untested": False}  # fmt: skip


def test_a_scan_says_what_it_found(service: IntegrationsService, collector: FakeCollector) -> None:
    service.connect("hybrid", {"driver": "sungrow.sh_rs", "host": "192.168.0.244"})
    service.live.info = {"brand": "Sungrow", "model": "SH5.0RS"}
    collector.scan_state["found"] = []
    found = service.start_scan("192.168.0.0/24")["found"]
    assert [(f["host"], f["model"], f["supported"], f["connected_as"]) for f in found] == [
        ("192.168.0.10", "SG5K-D", True, None),  # something new to connect comes first
        ("192.168.0.244", "SH5.0RS", True, "hybrid"),
        ("192.168.0.50", None, False, None),
    ]
    assert found[0]["role"] == "pv2" and found[0]["label"] == "SG-D string inverter"
    with pytest.raises(IntegrationError, match="home network"):
        service.start_scan("8.8.8.0/24")


def test_connecting_checks_the_kind_matches_the_role(service: IntegrationsService, collector: FakeCollector) -> None:
    with pytest.raises(IntegrationError, match="only be connected as a second solar inverter"):
        service.connect("hybrid", {"driver": "sungrow.sg_d", "host": "192.168.0.10"})
    with pytest.raises(IntegrationError, match="which kind"):
        service.connect("hybrid", {"driver": "acme.x", "host": "192.168.0.10"})
    with pytest.raises(
        IntegrationError, match=r"Nothing at 192\.168\.0\.99 answered like a Sungrow SH-series hybrid"
    ) as e:
        service.connect("hybrid", {"driver": "sungrow.sh_rs", "host": "192.168.0.99"})
    assert e.value.status == 422
    device = service.connect("hybrid", {"driver": "sungrow.sh_rs", "host": " 192.168.0.244 "})
    assert device["identified"]["model"] == "SH5.0RS" and device["host"] == "192.168.0.244"
    assert collector.requests[-1][1]["settings"] == {}


def test_goodwe_connects_on_its_own_port_and_unit(service: IntegrationsService, collector: FakeCollector) -> None:
    collector.answers["192.168.0.30"] = {}
    service.connect("hybrid", {"driver": "goodwe.et", "host": "192.168.0.30"})
    assert {k: collector.requests[-1][1][k] for k in ("port", "unit")} == {"port": 8899, "unit": 0xF7}
    service.connect("hybrid", {"driver": "goodwe.et", "host": "192.168.0.30", "port": 502})  # a newer LAN dongle
    assert collector.requests[-1][1]["port"] == 502


def test_a_second_inverter_says_where_it_connects(service: IntegrationsService, collector: FakeCollector) -> None:
    pv2 = {"driver": "sungrow.sg_d", "host": "192.168.0.10", "check": False}
    assert service.connect("pv2", pv2)["behind_meter"] is True  # the usual setup
    assert service.update("pv2", {"behind_meter": False})["behind_meter"] is False
    assert collector.requests[-1][1] == {
        "driver": "sungrow.sg_d", "host": "192.168.0.10", "port": 502, "unit": 1,
        "settings": {"behind_meter": False}, "check": False,
    }  # fmt: skip
    with pytest.raises(IntegrationError, match="house side"):
        service.update("pv2", {"behind_meter": "maybe"})
    with pytest.raises(IntegrationError) as e:
        service.update("hybrid", {})
    assert e.value.status == 404


def test_the_network_to_scan(service: IntegrationsService) -> None:
    assert service.suggest_network([], None) == "192.168.1.0/24"
    assert service.suggest_network([], "10.0.5.23") == "10.0.5.0/24"
    assert service.suggest_network([], "203.0.113.9") == "192.168.1.0/24"  # not a home network
    assert service.suggest_network([{"host": "192.168.0.244"}], "10.0.5.23") == "192.168.0.0/24"


def test_the_network_to_scan_behind_docker_desktop(
    service: IntegrationsService, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Docker Desktop hands every connection on from the container's own network, so the browser looks like
    # Docker's gateway: the address the dashboard was opened at is used instead, else the default.
    monkeypatch.setattr("app.features.integrations.service._container_networks", lambda: frozenset({"172.18.0.0/24"}))
    assert service.suggest_network([], "172.18.0.1", "192.168.0.50") == "192.168.0.0/24"
    assert service.suggest_network([], "172.18.0.1", "localhost") == "192.168.1.0/24"
    assert service.suggest_network([], "10.0.5.23", "wattsmypower.local") == "10.0.5.0/24"
    assert service.suggest_network([{"host": "192.168.0.244"}], None, "10.0.5.9") == "192.168.0.0/24"


def test_smart_home_devices_are_looked_for_where_the_inverters_are() -> None:
    service = IntegrationsService(Config(), None, None)  # type: ignore[arg-type]
    assert service.home_network("10.0.5.23") == "10.0.5.0/24"  # no collector: the browser's network, as for inverters
    assert service.home_network("127.0.0.1", "localhost") == "192.168.1.0/24"


def test_no_collector_to_reach(service: IntegrationsService, collector: FakeCollector) -> None:
    def down() -> dict[str, Any]:
        raise CollectorError(502, "The collector couldn't be reached (URLError).")

    collector.devices = down  # type: ignore[method-assign]
    overview = service.overview()
    assert overview["available"] is False and "couldn't be reached" in overview["error"]


# ---------------------------------------------------------------------------------------- ingest


def test_status_without_a_hybrid_says_to_connect_one(config: Config, collector: FakeCollector) -> None:
    cfg = replace(config, mock=False)
    live = LiveService(cfg, None, None)  # type: ignore[arg-type]
    ingest = CollectorIngest(cfg, None, None, live, collector)  # type: ignore[arg-type]
    live.info = {"model": "SH5.0RS"}
    ingest.apply_status({"devices": {}})
    assert live.last_error == NO_INVERTER and live.info == {} and live.pv2 is None


def test_where_the_second_inverter_connects_comes_from_its_settings(config: Config, collector: FakeCollector) -> None:
    cfg = replace(config, mock=False, pv2_behind_meter=True)
    live = LiveService(cfg, None, None)  # type: ignore[arg-type]
    ingest = CollectorIngest(cfg, None, None, live, collector)  # type: ignore[arg-type]
    hybrid = {"host": "192.168.0.244", "driver": "sungrow.sh_rs", "info": {}}
    ingest.apply_status({"devices": {"hybrid": hybrid, "pv2": {"host": "192.168.0.10", "settings": {"behind_meter": False}}}})  # fmt: skip
    assert ingest.behind_meter is False and live.pv2 and live.pv2["behind_meter"] is False
    ingest.apply_status({"devices": {"hybrid": hybrid, "pv2": {"host": "192.168.0.10", "settings": {}}}})
    assert ingest.behind_meter is True  # no setting: PV2_BEHIND_METER


# ---------------------------------------------------------------------------------------- http


@pytest.fixture
def client(config: Config, collector: FakeCollector) -> Iterator[TestClient]:
    app = create_app(replace(config, mock=False), poll=False, serve_dashboard=False)
    app.state.services.integrations.collector = collector
    with TestClient(app) as c:
        yield c


def test_the_integrations_api(client: TestClient, collector: FakeCollector) -> None:
    body = client.get("/api/integrations").json()
    assert body["available"] is True and body["devices"] == []
    assert [k["driver"] for k in body["kinds"]] == ["sungrow.sh_rs", "sungrow.sg_d"]

    r = client.put("/api/integrations/hybrid", json={"driver": "sungrow.sh_rs", "host": "192.168.0.99"})
    assert r.status_code == 422 and "answered like" in r.json()["detail"]
    r = client.put("/api/integrations/hybrid", json={"driver": "sungrow.sh_rs", "host": "192.168.0.244"})
    assert r.status_code == 200 and r.json()["identified"]["model"] == "SH5.0RS"
    [device] = client.get("/api/integrations").json()["devices"]
    assert device["host"] == "192.168.0.244" and device["label"] == "SH-series hybrid"

    assert (
        client.post("/api/integrations/scan", json={"network": "192.168.0.0/24"}).json()["found"][0]["model"]
        == "SG5K-D"
    )
    assert client.delete("/api/integrations/hybrid").json() == {"removed": True}


def test_the_demo_has_no_inverters_to_connect(config: Config) -> None:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        body = c.get("/api/integrations").json()
        assert body["available"] is False and "MOCK=1" in body["error"]
        r = c.put("/api/integrations/hybrid", json={"driver": "sungrow.sh_rs", "host": "192.168.0.244"})
        assert r.status_code == 503


def test_an_old_collector_says_to_update(monkeypatch: pytest.MonkeyPatch) -> None:
    """A collector from before /v1/devices answers 404 "Not Found": that reads as out of date."""
    import io
    import urllib.error
    import urllib.request

    from app.features.live.client import CollectorClient

    def not_found(req: urllib.request.Request, timeout: float) -> None:
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO(b'{"detail":"Not Found"}'))  # type: ignore[arg-type]

    monkeypatch.setattr(urllib.request, "urlopen", not_found)
    with pytest.raises(CollectorError, match="out of date"):
        CollectorClient("http://collector", "t").devices()


def test_a_read_only_dashboard_cant_change_the_collector(config: Config, collector: FakeCollector) -> None:
    """A dashboard following another server's collector (COLLECTOR_WRITES=false) lists its inverters
    but can't connect, change, remove or scan, so trying the UI can't disturb the live system."""
    cfg = replace(config, mock=False, collector_writes=False)
    collector.stored["hybrid"] = {"role": "hybrid", "driver": "sungrow.sh_rs", "host": "192.168.0.244", "settings": {}}
    service = IntegrationsService(cfg, collector, LiveService(cfg, None, None))  # type: ignore[arg-type]
    overview = service.overview()
    assert overview["read_only"] is True and [d["host"] for d in overview["devices"]] == ["192.168.0.244"]
    for attempt in (
        lambda: service.connect("hybrid", {"driver": "sungrow.sh_rs", "host": "192.168.0.99"}),
        lambda: service.update("hybrid", {}),
        lambda: service.remove("hybrid"),
        lambda: service.start_scan("192.168.0.0/24"),
    ):
        with pytest.raises(IntegrationError, match="COLLECTOR_WRITES") as e:
            attempt()
        assert e.value.status == 403
    assert collector.requests == [] and "hybrid" in collector.stored
