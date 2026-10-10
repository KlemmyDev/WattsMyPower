"""Fronius, decoded from the figures the collector stores from its Solar API (tests/fixtures/fronius)."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from app.features.inverters import drivers
from app.features.inverters.fronius import inverter, site
from app.features.live.transform import Freeze, Pv2Carry, snapshots
from app.features.readings.repository import ReadingsRepository
from collector.devices.fronius.solar_api import FLOW_INVERTER, FLOW_SITE, INFO, INVERTER, METER, STORAGE, pick

FIXTURES = Path(__file__).parent / "fixtures" / "fronius"


def stored(name: str) -> dict[str, Any]:
    """What the collector stores for a site, built from its fixture responses as the reader picks them."""

    def data(f: str) -> dict[str, Any]:
        p = FIXTURES / name / f"{f}.json"
        return json.loads(p.read_text())["Body"]["Data"] if p.exists() else {}

    flow, meter, inv = (
        data("GetPowerFlowRealtimeData"),
        data("GetMeterRealtimeData"),
        data("GetInverterRealtimeData_Device_1"),
    )
    storage = data("GetStorageRealtimeData").get("0", {}).get("Controller")
    values = {
        **pick("info", data("GetInverterInfo").get("1"), INFO),
        **pick("flow", flow.get("Site"), FLOW_SITE),
        **pick("flow.inverter", flow.get("Inverters", {}).get("1"), FLOW_INVERTER),
        **pick("meter", meter.get("0"), METER),
        **pick("inverter", inv, INVERTER),
        **pick("inverter.DeviceStatus", inv.get("DeviceStatus"), ("StatusCode",)),
        **pick("storage", storage, STORAGE),
    }  # fmt: skip
    return {"input": values}


def test_a_gen24_with_a_battery() -> None:
    snap = site.decode(stored("gen24_storage"))
    assert snap["pv_power"] == pytest.approx(216.43, abs=0.01)
    assert snap["grid_power"] == 2274.9  # importing
    assert snap["load_power"] == pytest.approx(2459.31, abs=0.01)
    assert snap["battery_power"] == pytest.approx(0.159, abs=0.001)  # all but idle ("suspended")
    assert snap["battery_soc"] == 4.6 and snap["battery_temp"] == 21.5
    assert snap["daily_pv"] is None  # a GEN24 has no daily counters: ReadingsRepository works them out
    assert snap["total_pv"] == pytest.approx(7512.664, abs=0.001)
    assert snap["total_import"] == 1247.204 and snap["total_export"] == 1705.128
    assert snap["grid_voltage"] == 229.4 and snap["grid_freq"] == 49.9
    assert snap["mppt1_v"] == pytest.approx(419.1, abs=0.01) and snap["mppt2_a"] == pytest.approx(0.356, abs=0.001)
    assert snap["running_state"] == 0x0000
    assert site.decode_info(stored("gen24_storage")) == {
        "brand": "Fronius", "model": "GEN24 13.93", "serial": "12345678", "nominal_kw": 13.9, "name": "Gen24 Storage",
        "battery_kwh": 16.59,
    }  # fmt: skip


def test_a_symo_with_a_smart_meter_and_no_battery() -> None:
    snap = site.decode(stored("symo"))
    assert snap["pv_power"] == 1111 and snap["grid_power"] == 1703.74 and snap["load_power"] == 2814.74
    assert snap["battery_power"] is None and snap["battery_soc"] is None
    assert snap["daily_pv"] == pytest.approx(1.102, abs=0.001) and snap["total_pv"] == 44188.0
    info = site.decode_info(stored("symo"))
    assert info["model"] == "Symo 20.0-3-M" and info["brand"] == "Fronius"


def test_asleep_at_night_is_no_solar() -> None:
    raw = stored("symo")
    raw["input"] = {k: v for k, v in raw["input"].items() if k != "flow.P_PV"}
    assert site.decode(raw)["pv_power"] == 0.0
    assert site.decode({"input": {}})["pv_power"] is None  # nothing read at all: unknown


def test_identified_from_what_a_probe_read() -> None:
    found = drivers.identify("fronius.site", {k: v for k, v in stored("gen24_storage")["input"].items() if k.startswith(("info.", "flow."))})  # fmt: skip
    assert found["brand"] == "Fronius" and found["model"] == "GEN24 13.93" and found["supported"] is True


def test_a_datamanagers_name_comes_out_plain() -> None:
    raw = {"input": {"info.DT": 76, "info.CustomName": "&#71;&#97;&#114;&#97;&#103;&#101;"}}
    assert site.decode_info(raw)["name"] == "Garage" and site.decode_info(raw)["model"] == "Primo 5.0-1"


def test_a_second_fronius() -> None:
    raw = stored("symo")
    values = inverter.decode(raw)
    assert values is not None
    assert values["pv2_power"] == 1190 and values["daily_pv2"] == 1.113 and values["total_pv2"] == 44188.0
    assert values["pv2_dc_power"] == pytest.approx(518 * 2.19, abs=0.1)
    assert inverter.decode_info(raw)["model"] == "Symo 20.0-3-M"
    assert inverter.decode({"input": {"info.DT": 121}}) is None  # nothing about its output: a missed read


def test_a_fronius_site_flows_through_to_snapshots() -> None:
    rows = [{"ts": 1_790_900_000, "device": "hybrid", "driver": "fronius.site", **stored("gen24_storage")}]
    [(_, snap)] = snapshots(rows, has_pv2=False, behind_meter=True, poll_interval=60, carry=Pv2Carry(), freeze=Freeze())
    assert snap["grid_power"] == 2274.9 and snap["battery_soc"] == 4.6


def test_days_without_daily_counters_are_worked_out(readings: ReadingsRepository) -> None:
    """A GEN24: no daily solar counter, no battery counters. Solar comes from its lifetime counter, the battery's
    charge and discharge from its power."""
    midnight = int(dt.datetime(2026, 3, 2).timestamp())
    conn = readings.db.connect()
    # 6 am to 6 pm: 2 kW of solar, its lifetime counter keeping up; charging at 1 kW until noon, then discharging at 500 W.
    rows = [(midnight - 600, {"total_pv": 1000.0, "pv_power": 0.0, "battery_power": 0.0})]
    for m in range(6 * 60, 18 * 60):
        ts = midnight + m * 60
        rows.append((ts, {"pv_power": 2000.0, "total_pv": 1000.0 + 2.0 * (m - 360 + 1) / 60,
                          "battery_power": -1000.0 if m < 12 * 60 else 500.0}))  # fmt: skip
    readings.insert_many(conn, rows)
    conn.close()
    (day,) = [d for d in readings.daily(midnight, midnight + 86400) if d["date"] == "2026-03-02"]
    assert day["daily_pv"] == pytest.approx(24.0, abs=0.05)
    assert day["daily_charge"] == pytest.approx(6.0, abs=0.1) and day["daily_discharge"] == pytest.approx(3.0, abs=0.1)
