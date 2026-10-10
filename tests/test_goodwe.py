"""GoodWe's ET hybrids and DT string inverters, decoded from the raw words the collector stores."""

from __future__ import annotations

from typing import Any

from app.features.inverters import drivers
from app.features.inverters.goodwe import dt, et
from app.features.live.transform import Freeze, Pv2Carry, snapshots


def ascii_words(s: str, count: int) -> list[int]:
    raw = s.encode().ljust(2 * count, b"\x00")
    return [int.from_bytes(raw[i : i + 2], "big") for i in range(0, 2 * count, 2)]


def put(w: dict[int, int], address: int, values: list[int]) -> None:
    w.update(zip(range(address, address + len(values)), values, strict=True))


def u32(v: int) -> list[int]:
    raw = v & 0xFFFFFFFF
    return [raw >> 16, raw & 0xFFFF]  # high word first


def s16(v: int) -> int:
    return v & 0xFFFF


def et_words(*, export_w: int = 1500, battery_w: int = -800, mode: int = 1) -> dict[int, int]:
    """An ET hybrid at midday: 4 kW of solar, charging the battery at 800 W and exporting 1.5 kW."""
    w = dict.fromkeys(range(35000, 35033), 0)
    w.update(dict.fromkeys(range(35100, 35225), 0))
    w.update(dict.fromkeys(range(37000, 37024), 0))
    put(w, 35001, [10000, 0])  # 10 kW, single phase
    put(w, 35003, ascii_words("9010KETU123W4567", 8))
    put(w, 35011, ascii_words("GW10K-ET", 5))
    put(w, 35100, [0x1A0A, 0x0A0C, 0x1E00])  # its clock: 2026-10-10 12:30:00
    put(w, 35103, [3800, 55])
    put(w, 35105, u32(2500))
    put(w, 35107, [3700, 41])
    put(w, 35109, u32(1500))
    put(w, 35113, u32(0xFFFFFFFF))  # no third string
    put(w, 35121, [2412])
    put(w, 35123, [5001])
    put(w, 35140, [s16(export_w)])
    put(w, 35176, [s16(425)])
    put(w, 35180, [5120, s16(-156)])
    put(w, 35182, u32(battery_w))
    put(w, 35184, [3])  # charging
    put(w, 35187, [mode])
    put(w, 35191, u32(123456))  # 12,345.6 kWh
    put(w, 35193, u32(184))  # 18.4 kWh today
    put(w, 35195, u32(45678))
    put(w, 35199, [62])
    put(w, 35200, u32(23456))
    put(w, 35202, [31])
    put(w, 35206, u32(9876))
    put(w, 35208, [45])
    put(w, 35209, u32(8765))
    put(w, 35211, [12])
    put(w, 37003, [s16(254)])
    put(w, 37007, [67, 98])
    return w


def raw(w: dict[int, int]) -> dict[str, Any]:
    return {"input": {str(a): x for a, x in w.items()}}


def test_an_et_hybrid_at_midday() -> None:
    snap = et.decode(raw(et_words()))
    assert snap["pv_power"] == 4000  # 2500 + 1500; the missing third string doesn't count
    assert snap["grid_power"] == -1500  # exporting
    assert snap["battery_power"] == -800  # charging
    assert snap["load_power"] == 1700  # 4000 - 800 - 1500
    assert snap["mppt1_v"] == 380.0 and snap["mppt1_a"] == 5.5
    assert snap["grid_voltage"] == 241.2 and snap["grid_freq"] == 50.01
    assert snap["inverter_temp"] == 42.5 and snap["battery_temp"] == 25.4
    assert snap["battery_voltage"] == 512.0 and snap["battery_current"] == -15.6
    assert snap["battery_soc"] == 67 and snap["battery_soh"] == 98
    assert snap["total_pv"] == 12345.6 and snap["daily_pv"] == 18.4
    assert snap["daily_export"] == 6.2 and snap["total_export"] == 4567.8
    assert snap["daily_import"] == 3.1 and snap["total_import"] == 2345.6
    assert snap["daily_charge"] == 4.5 and snap["daily_discharge"] == 1.2
    assert snap["running_state"] == 0x0000


def test_importing_at_night_and_off_grid() -> None:
    w = et_words(export_w=-2200, battery_w=600)
    put(w, 35105, u32(0))
    put(w, 35109, u32(0))
    snap = et.decode(raw(w))
    assert snap["grid_power"] == 2200 and snap["battery_power"] == 600 and snap["load_power"] == 2800
    assert et.decode(raw(et_words(mode=2)))["running_state"] == 0x1000  # what the Grid page calls the grid down


def test_without_a_battery_its_charge_is_unknown() -> None:
    w = et_words(battery_w=0)
    put(w, 35184, [0])
    assert et.decode(raw(w))["battery_soc"] is None


def test_what_an_et_says_it_is() -> None:
    assert et.decode_info(raw(et_words())) == {
        "brand": "GoodWe", "serial": "9010KETU123W4567", "model": "GW10K-ET", "nominal_kw": 10.0,
        "phases": "Single phase",
    }  # fmt: skip
    found = drivers.identify("goodwe.et", {str(a): x for a, x in et_words().items() if a < 35033})
    assert found["model"] == "GW10K-ET" and found["supported"] is True and found["brand"] == "GoodWe"


def test_a_repeat_is_frozen_and_a_new_reading_isnt() -> None:
    a = raw(et_words())
    assert et.frozen(a, raw(et_words())) is True
    later = et_words()
    put(later, 35102, [0x1E01])  # a second on
    assert et.frozen(a, raw(later)) is False


def dt_words(ac_w: int = 2400) -> dict[int, int]:
    w = dict.fromkeys(range(30001, 30041), 0)
    w.update(dict.fromkeys(range(30100, 30173), 0))
    put(w, 30004, ascii_words("55000DSN21AB1234", 8))
    put(w, 30012, ascii_words("GW5000D-NS", 5))
    put(w, 30103, [3500, 72])  # 350 V × 7.2 A = 2520 W
    put(w, 30127, u32(ac_w))
    put(w, 30141, [s16(388)])
    put(w, 30144, [123])
    put(w, 30145, u32(456789))
    put(w, 30147, u32(15000))
    return w


def test_a_dt_string_inverter() -> None:
    values = dt.decode(raw(dt_words()))
    assert values == {
        "pv2_power": 2400,
        "daily_pv2": 12.3,
        "total_pv2": 45678.9,
        "pv2_temp": 38.8,
        "pv2_dc_power": 2520.0,
    }
    assert dt.decode_info(raw(dt_words())) == {
        "brand": "GoodWe", "model": "GW5000D-NS", "serial": "55000DSN21AB1234", "nominal_kw": 5.0,
        "running_hours": 15000,
    }  # fmt: skip
    assert dt.decode(raw(dt_words(ac_w=60000))) is None  # far more than a 5 kW inverter makes: garbled


def test_rated_power_from_the_model_name() -> None:
    assert dt.nominal_kw("GW5000D-NS") == 5.0
    assert dt.nominal_kw("GW3000-XS") == 3.0
    assert dt.nominal_kw("GW10K-DT") == 10.0
    assert dt.nominal_kw("GW600") == 0.6
    assert dt.nominal_kw("Something") is None


def test_a_goodwe_pair_flows_through_to_snapshots() -> None:
    rows = [
        {"ts": 1_790_900_000, "device": "hybrid", "driver": "goodwe.et", **raw(et_words())},
        {"ts": 1_790_900_000, "device": "pv2", "driver": "goodwe.dt", **raw(dt_words())},
    ]
    [(_, snap)] = snapshots(rows, has_pv2=True, behind_meter=True, poll_interval=60, carry=Pv2Carry(), freeze=Freeze())
    assert snap["pv_power"] == 6400 and snap["pv1_power"] == 4000 and snap["pv2_power"] == 2400
    assert snap["load_power"] == 4100  # behind the meter: its output is added back to home use
