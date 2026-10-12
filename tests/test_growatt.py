"""Growatt string inverters, decoded from what the collector stores: from Growatt's cloud, or through an RS485 adapter;
and a Growatt beside another brand's hybrid."""

from __future__ import annotations

import hashlib
import time
from dataclasses import replace
from typing import Any

import pytest

from app.core.config import Config
from app.features.integrations.service import IntegrationError, IntegrationsService
from app.features.inverters import drivers
from app.features.inverters.growatt import cloud, tl, tlx
from app.features.live.service import LiveService
from app.features.live.transform import Freeze, Pv2Carry, snapshots
from collector.devices.growatt.cloud import hash_password as collector_hash
from collector.devices.sungrow.mock import MockSite, as_growatt_cloud
from tests.test_integrations import FakeCollector

NOON = int(time.mktime((2026, 10, 12, 12, 30, 0, 0, 0, -1)))


def stamp(ts: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))


def cloud_figures(**changes: Any) -> dict[str, Any]:
    """An older inverter's details as Growatt's cloud sends them (mostly strings), fetched at NOON."""
    f: dict[str, Any] = {
        "pac": "2412.5", "ppv": "2530.1", "powerToday": "12.3", "powerTotal": "45,678.9", "temperature": "38.8",
        "vpv1": "320.4", "ipv1": "7.9", "fac": "50.01", "status": "1", "nominalPower": "5000",
        "deviceModel": "Growatt 5000MTL-S", "lastUpdateTime": stamp(NOON - 120),
        "sn": "AB12345678", "type": "inverter", "fetched_at": NOON,
    }  # fmt: skip
    f.update(changes)
    return {k: v for k, v in f.items() if v is not None}


def row(figures: dict[str, Any], ts: int = NOON) -> dict[str, Any]:
    return {"ts": ts, "device": "pv2", "driver": "growatt.cloud", "input": figures}


def test_a_growatt_from_its_cloud() -> None:
    assert cloud.decode(row(cloud_figures())) == {
        "pv2_power": 2412.5,
        "pv2_dc_power": 2530.1,
        "daily_pv2": 12.3,
        "total_pv2": 45678.9,
        "pv2_temp": 38.8,
    }
    assert cloud.decode_info(row(cloud_figures())) == {
        "brand": "Growatt", "model": "5000MTL-S", "serial": "AB12345678", "nominal_kw": 5.0, "firmware": None,
    }  # fmt: skip


def test_a_newer_one_names_its_figures_differently() -> None:
    tlx_figures = cloud_figures(
        powerToday=None, powerTotal=None, temperature=None, deviceModel=None, lastUpdateTime=None
    )
    tlx_figures.update({"eacToday": 9.8, "eacTotal": 1234.5, "temp1": 41.2, "time": stamp(NOON - 60), "type": "tlx"})
    values = cloud.decode(row(tlx_figures))
    assert values is not None
    assert (values["daily_pv2"], values["total_pv2"], values["pv2_temp"]) == (9.8, 1234.5, 41.2)
    assert cloud.decode_info(row(tlx_figures))["model"] == "5 kW inverter"  # no model given: its rated power


def test_an_answer_the_cloud_stopped_refreshing_is_a_missed_reading() -> None:
    assert cloud.decode(row(cloud_figures(), ts=NOON + 300)) is not None  # the 5-minute answer, stored again
    assert cloud.decode(row(cloud_figures(), ts=NOON + 1000)) is None  # the cloud hasn't answered for a while


def test_an_inverter_asleep_for_the_night_makes_nothing() -> None:
    evening = cloud.decode(row(cloud_figures(lastUpdateTime=stamp(NOON - 3600))))
    assert evening is not None and evening["pv2_power"] == 0.0 and evening["daily_pv2"] == 12.3  # today's yield stays
    yesterday = cloud.decode(row(cloud_figures(lastUpdateTime=stamp(NOON - 86400))))
    assert yesterday is not None and yesterday["daily_pv2"] == 0.0  # nothing made yet today


def test_more_than_the_inverter_can_make_is_garbled() -> None:
    assert cloud.decode(row(cloud_figures(pac="60000"))) is None


def test_the_password_is_hashed_the_same_way_on_both_sides() -> None:
    for pw in ("hunter2", "Sun0Power!", "", "0000"):
        assert cloud.hash_password(pw) == collector_hash(pw)
    # Growatt's twist on MD5: a "0" at an even position is a "c"; everything else is the MD5 as it is.
    md5, hashed = hashlib.md5(b"hunter2").hexdigest(), cloud.hash_password("hunter2")
    assert "0" in md5[::2] and "0" not in hashed[::2]
    assert all(
        h == m or (m == "0" and h == "c" and i % 2 == 0) for i, (h, m) in enumerate(zip(hashed, md5, strict=True))
    )


# -- through an RS485 adapter -------------------------------------------------------------------------------------


def ascii_words(s: str, count: int) -> list[int]:
    raw = s.encode().ljust(2 * count, b"\x00")
    return [int.from_bytes(raw[i : i + 2], "big") for i in range(0, 2 * count, 2)]


def modbus_row(newer: bool) -> dict[str, Any]:
    """A 5 kW Growatt at midday, as the collector stores its words (32-bit values high word first)."""
    w = dict.fromkeys(range(125 if newer else 45), 0)
    h = dict.fromkeys(range(30), 0)
    h.update({6: 0, 7: 50000})  # 5000.0 VA
    h.update(dict(zip(range(9, 12), ascii_words("GH1.0", 3), strict=True)))
    h.update(dict(zip(range(23, 28), ascii_words("AB12345678", 5), strict=True)))
    ac, today, total, hours, temp = (35, 53, 55, 57, 93) if newer else (11, 26, 28, 30, 32)
    w.update({0: 1, 1: 0, 2: 25301, ac: 0, ac + 1: 24125, today: 0, today + 1: 123})
    w.update({total: 6, total + 1: 63573, hours: 1, hours + 1: 38928, temp: 388})  # 456789 (0.1 kWh), 104464 half-s
    return {"input": {str(a): x for a, x in w.items()}, "holding": {str(a): x for a, x in h.items()}}


@pytest.mark.parametrize(
    ("module", "newer", "model"), [(tl, False, "5 kW TL inverter"), (tlx, True, "5 kW TL-X inverter")]
)
def test_a_growatt_through_an_adapter(module: Any, newer: bool, model: str) -> None:
    assert module.decode(modbus_row(newer)) == {
        "pv2_power": 2412.5, "pv2_dc_power": 2530.1, "daily_pv2": 12.3, "total_pv2": 45678.9, "pv2_temp": 38.8,
    }  # fmt: skip
    assert module.decode_info(modbus_row(newer)) == {
        "brand": "Growatt", "model": model, "serial": "AB12345678", "nominal_kw": 5.0, "firmware": "GH1.0",
        "running_hours": 14,
    }  # fmt: skip


def test_a_probe_of_its_identity_says_what_it_is() -> None:
    words = modbus_row(False)["holding"]
    assert drivers.identify("growatt.tl", words) == {
        "brand": "Growatt", "model": "5 kW TL inverter", "serial": "AB12345678", "nominal_kw": 5.0,
        "supported": True, "untested": False,
    }  # fmt: skip


# -- beside another brand's hybrid -----------------------------------------------------------------------------------


def test_a_sungrow_hybrid_with_a_growatt_beside_it() -> None:
    """Two brands, each row decoded by its own driver, folded into one house: the Sungrow's reading as the collector
    stores it, and the Growatt's figures as Growatt's cloud reports them."""
    site = MockSite()
    site.simulate(NOON - 60)  # a minute in, so the day's counters have started
    raw = site.simulate(NOON)
    assert raw["hybrid"] is not None and raw["pv2"] is not None
    hybrid = {"ts": NOON, "device": "hybrid", "driver": "sungrow.sh_rs", "input": {str(a): w for a, w in raw["hybrid"].input.items()}}  # fmt: skip
    growatt = row(as_growatt_cloud(site, raw["pv2"], NOON))
    alone = drivers.hybrid("sungrow.sh_rs").decode(hybrid)  # type: ignore[union-attr]
    from_cloud = cloud.decode(growatt)
    assert from_cloud is not None and from_cloud["pv2_power"]
    [(_, snap)] = snapshots(
        [hybrid, growatt], has_pv2=True, behind_meter=True, poll_interval=60, carry=Pv2Carry(), freeze=Freeze()
    )
    assert snap["pv1_power"] == alone["pv_power"] and snap["pv2_power"] == from_cloud["pv2_power"]
    assert snap["pv_power"] == pytest.approx(alone["pv_power"] + from_cloud["pv2_power"], abs=0.01)
    assert snap["load_power"] == pytest.approx(alone["load_power"] + from_cloud["pv2_power"], abs=0.01)


# -- connecting it -------------------------------------------------------------------------------------------------


@pytest.fixture
def service(config: Config) -> tuple[IntegrationsService, FakeCollector]:
    cfg = replace(config, mock=False)
    collector = FakeCollector()
    collector.answers["openapi-au.growatt.com"] = {}
    return IntegrationsService(cfg, collector, LiveService(cfg, None, None)), collector  # type: ignore[arg-type]


def test_connecting_growatts_cloud_keeps_only_the_hashed_password(
    service: tuple[IntegrationsService, FakeCollector],
) -> None:
    svc, collector = service
    device = svc.connect("pv2", {"driver": "growatt.cloud", "username": "sam", "password": "hunter2"})
    _, sent = collector.requests[-1]
    assert sent["host"] == "openapi-au.growatt.com"  # the Australian server unless another region's chosen
    assert sent["settings"] == {
        "username": "sam",
        "password_hash": cloud.hash_password("hunter2"),
        "behind_meter": True,
    }
    assert "hunter2" not in repr(sent)
    assert device["settings"]["password_hash"] is None  # never handed back to the browser
    # Changing where it connects keeps the sign-in it has, without asking for the password again.
    svc.update("pv2", {"behind_meter": False})
    assert collector.requests[-1][1]["settings"]["password_hash"] == cloud.hash_password("hunter2")


def test_a_cloud_inverter_needs_a_sign_in_and_a_known_server(
    service: tuple[IntegrationsService, FakeCollector],
) -> None:
    svc, _ = service
    with pytest.raises(IntegrationError, match="username and password"):
        svc.connect("pv2", {"driver": "growatt.cloud", "username": "sam"})
    with pytest.raises(IntegrationError, match="region"):
        svc.connect(
            "pv2", {"driver": "growatt.cloud", "username": "sam", "password": "x", "server": "evil.example.com"}
        )
