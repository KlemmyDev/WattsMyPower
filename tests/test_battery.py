"""The battery controls: what they write, when they end, and that they never fight another controller."""

from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.battery.service import GRACE, BatteryError, BatteryService
from app.features.inverters.sungrow import sh_control
from app.features.live.client import CollectorError
from app.features.live.service import LiveService
from app.main import create_app

NOW = 1_791_270_000.0
HOUR = 3600


class FakeRegisters:
    """The hybrid's settings registers, as read through the collector: self-consumption, 100 % / 5 %, 6.6 kW."""

    def __init__(self) -> None:
        self.words = {13050: 0, 13051: 0xCC, 13052: 0, 13058: 1000, 13059: 50, 33047: 660}
        self.writes: list[tuple[int, int]] = []
        self.fail = False

    def read(self) -> dict[int, int]:
        if self.fail:
            raise CollectorError(502, "The inverter didn't answer: timed out")
        return dict(self.words)

    def write(self, words: list[tuple[int, int]]) -> dict[int, int]:
        if self.fail:
            raise CollectorError(502, "The inverter didn't answer: timed out")
        self.writes.extend(words)
        self.words.update(words)
        return dict(self.words)

    def isolarcloud_charge(self) -> None:
        """A forced charge started from the iSolarCloud app, as the SH5.0RS showed one."""
        self.words.update({13050: 4, 13051: 0xAA, 13052: 6600})


class Clock:
    def __init__(self) -> None:
        self.t = NOW

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def regs() -> FakeRegisters:
    return FakeRegisters()


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def live() -> Any:
    return SimpleNamespace(
        driver="sungrow.sh_rs", info={"reserve": 5.0}, latest={"battery_soc": 60.0, "battery_power": 800}
    )


@pytest.fixture
def svc(db: Database, live: Any, regs: FakeRegisters, clock: Clock) -> BatteryService:
    return BatteryService(db, cast(LiveService, live), regs, clock)


def test_the_view_shows_the_settings_and_who_has_the_battery(svc: BatteryService) -> None:
    v = svc.view()
    assert v["supported"] and v["owner"] == "normal" and v["blocked"] is None and v["control"] is None
    assert v["settings"]["min_soc"] == 5.0 and v["settings"]["max_charge_w"] == 6600
    assert v["limits"]["floor"] == [5.0, 50.0] and v["limits"]["charge_w"] == [500, 6600]


def test_standby_forces_a_stop_and_stopping_puts_self_consumption_back(
    svc: BatteryService, regs: FakeRegisters
) -> None:
    v = svc.start({"kind": "standby", "until": NOW + 3 * HOUR})
    assert regs.writes == [(13051, 0xCC), (13050, 2)]
    assert v["owner"] == "dashboard" and v["control"]["kind"] == "standby" and v["control"]["confirmed"]
    assert "writes" not in v["control"]  # the registers stay on the server
    regs.writes.clear()
    v = svc.stop()
    assert regs.writes == [(13051, 0xCC), (13050, 0)]
    assert v["control"] is None and v["owner"] == "normal"
    assert v["log"][0]["text"].startswith("Standby ended (stopped)")


def test_a_floor_sets_min_soc_and_its_end_puts_the_usual_one_back(
    svc: BatteryService, regs: FakeRegisters, clock: Clock, live: Any
) -> None:
    svc.start({"kind": "floor", "floor": 40, "until": NOW + HOUR})
    assert regs.writes == [(13059, 400)]
    assert live.info["reserve"] == 40.0  # the reserve shown everywhere follows it
    clock.t += HOUR - 60
    svc.tick()
    assert svc.control() is not None
    clock.t += 60
    svc.tick()
    assert regs.writes[-1] == (13059, 50) and svc.control() is None and live.info["reserve"] == 5.0


def test_a_charge_runs_until_it_reaches_its_level(svc: BatteryService, regs: FakeRegisters, live: Any) -> None:
    svc.start({"kind": "charge", "power_w": 3000, "target": 80, "until": None})
    assert regs.writes == [(13052, 3000), (13051, 0xAA), (13050, 2)]
    live.latest = {"battery_soc": 79.9, "battery_power": -3000}
    svc.tick()
    assert svc.control() is not None
    live.latest = {"battery_soc": 80.0, "battery_power": -3000}
    svc.tick()
    assert regs.words[13050] == 0 and svc.control() is None
    assert svc.view()["log"][0]["text"].startswith("Grid charge ended (reached 80%)")


def test_a_charge_ends_when_the_battery_tops_out_short_of_its_level(svc: BatteryService, live: Any) -> None:
    svc.start({"kind": "charge", "until": None})  # to the max SOC, 100 %
    live.latest = {"battery_soc": 99.0, "battery_power": 0}
    svc.tick()
    assert svc.control() is None


def test_nothing_is_written_while_isolarcloud_has_the_battery(svc: BatteryService, regs: FakeRegisters) -> None:
    regs.isolarcloud_charge()
    v = svc.view()
    assert v["owner"] == "isolarcloud" and "forced charge at 6.6 kW" in v["blocked"]
    with pytest.raises(BatteryError) as e:
        svc.start({"kind": "standby", "until": None})
    assert e.value.status == 409 and "iSolarCloud" in e.value.detail
    assert regs.writes == []


def test_the_dashboard_lets_go_when_isolarcloud_takes_over(
    svc: BatteryService, regs: FakeRegisters, clock: Clock
) -> None:
    svc.start({"kind": "standby", "until": NOW + 3 * HOUR})
    regs.writes.clear()
    regs.isolarcloud_charge()
    clock.t += GRACE
    svc.tick()
    assert svc.control() is None and regs.writes == []  # not written back
    assert svc.view()["log"][0]["text"] == "Standby ended: iSolarCloud took over the battery"


def test_a_gateway_slow_to_show_a_change_gets_time(svc: BatteryService, regs: FakeRegisters, clock: Clock) -> None:
    svc.start({"kind": "standby", "until": None})
    regs.words[13050] = 0  # still reads as before the write
    clock.t += GRACE - 1
    svc.tick()
    assert svc.control() is not None
    clock.t += 1
    svc.tick()
    assert svc.control() is None  # the inverter didn't take it: let go rather than write again


def test_a_floor_that_ends_under_isolarcloud_waits_to_be_put_back(
    svc: BatteryService, regs: FakeRegisters, clock: Clock
) -> None:
    svc.start({"kind": "floor", "floor": 30, "until": NOW + HOUR})
    regs.isolarcloud_charge()
    regs.writes.clear()
    clock.t += HOUR
    svc.tick()
    svc.tick()
    assert regs.writes == [] and svc.control() is not None
    assert "goes back once iSolarCloud" in svc.view()["log"][0]["text"]
    regs.words.update({13050: 0, 13051: 0xCC})  # its command ended
    svc.tick()
    assert regs.writes == [(13059, 50)] and svc.control() is None


def test_switching_from_a_floor_to_standby_puts_the_floor_back_first(svc: BatteryService, regs: FakeRegisters) -> None:
    svc.start({"kind": "floor", "floor": 30, "until": None})
    svc.start({"kind": "floor", "floor": 45, "until": None})  # a new floor simply replaces it
    svc.start({"kind": "standby", "until": None})
    assert regs.writes == [(13059, 300), (13059, 450), (13059, 50), (13051, 0xCC), (13050, 2)]
    regs.writes.clear()
    svc.start({"kind": "floor", "floor": 20, "until": None})
    assert regs.writes == [(13051, 0xCC), (13050, 0), (13059, 200)]
    regs.writes.clear()
    svc.stop()
    assert regs.writes == [(13059, 50)]  # the floor from before any control here


@pytest.mark.parametrize(
    ("body", "match"),
    [
        ({"kind": "boost"}, "Choose a control"),
        ({"kind": "standby", "until": NOW - 1}, "already passed"),
        ({"kind": "standby", "until": NOW + 49 * HOUR}, "up to 48 hours"),
        ({"kind": "floor", "floor": 80, "until": None}, "between 5 and 50"),
        ({"kind": "floor", "until": None}, "Give the floor"),
        ({"kind": "charge", "power_w": 9000, "until": None}, "between 500 and 6600"),
        ({"kind": "charge", "target": 50, "until": None}, "already at 60%"),
    ],
)
def test_controls_that_cant_be_done_are_explained(
    svc: BatteryService, regs: FakeRegisters, body: dict[str, Any], match: str
) -> None:
    with pytest.raises(BatteryError, match=match):
        svc.start(body)
    assert regs.writes == []


def test_an_unreachable_inverter_is_a_502(svc: BatteryService, regs: FakeRegisters) -> None:
    regs.fail = True
    v = svc.view()
    assert v["owner"] is None and "couldn't be read" in v["blocked"] and "timed out" in v["error"]
    with pytest.raises(BatteryError) as e:
        svc.start({"kind": "standby", "until": None})
    assert e.value.status == 502


def test_a_control_outlives_a_restart(db: Database, live: Any, regs: FakeRegisters, clock: Clock) -> None:
    BatteryService(db, cast(LiveService, live), regs, clock).start({"kind": "standby", "until": NOW + HOUR})
    clock.t += HOUR
    BatteryService(db, cast(LiveService, live), regs, clock).tick()
    assert regs.words[13050] == 0


def test_without_a_controllable_inverter_there_are_no_controls(db: Database, regs: FakeRegisters) -> None:
    for driver, reason in ((None, "Connect the inverter"), ("acme.x", "can't be controlled")):
        live = SimpleNamespace(driver=driver, info={}, latest=None)
        v = BatteryService(db, cast(LiveService, live), regs).view()
        assert not v["supported"] and reason in v["reason"]


def test_decode_reads_the_sh5_0rs_as_found() -> None:
    s = sh_control.decode({13050: 4, 13051: 170, 13052: 6600, 13053: 65535, 13058: 1000, 13059: 50, 33047: 660})
    assert s == {"mode": "vpp", "mode_code": 4, "command": "charge", "power_w": 6600, "max_soc": 100.0,
                 "min_soc": 5.0, "max_charge_w": 6600}  # fmt: skip


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def test_the_api_in_mock_mode(client: TestClient) -> None:
    client.app.state.services.live.driver = "sungrow.sh_rs"  # type: ignore[attr-defined]  # set by the simulator
    assert client.get("/api/battery").json()["owner"] == "normal"
    r = client.post("/api/battery/control", json={"kind": "standby", "until": None})
    assert r.status_code == 200 and r.json()["owner"] == "dashboard"
    assert client.app.state.services.source.inverter.holding[13050] == 2  # type: ignore[attr-defined]
    r = client.post("/api/battery/control", json={"kind": "floor", "floor": 90, "until": None})
    assert r.status_code == 422 and "between 5 and 50" in r.json()["detail"]
    assert client.delete("/api/battery/control").json()["owner"] == "normal"
