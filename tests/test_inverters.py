from __future__ import annotations

from app.features.inverters.merge import merge_pv2

HYBRID = {"pv_power": 3000.0, "load_power": 800.0, "grid_power": -1500.0, "daily_pv": 12.0, "total_pv": 900.0,
          "daily_export": 4.0}  # fmt: skip
PV2 = {"pv2_power": 1200.0, "daily_pv2": 5.0, "total_pv2": 4000.0}


def test_without_a_second_system_the_hybrid_figures_are_kept() -> None:
    out = merge_pv2(HYBRID, None)
    assert out["pv_power"] == 3000.0 and out["pv1_power"] == 3000.0 and out["load_hybrid"] == 800.0


def test_behind_the_meter_its_output_is_added_back_to_home_use() -> None:
    out = merge_pv2(HYBRID, PV2, behind_meter=True)
    assert out["pv_power"] == 4200.0 and out["daily_pv"] == 17.0 and out["total_pv"] == 4900.0
    assert out["load_power"] == 2000.0 and out["grid_power"] == -1500.0


def test_outside_the_meter_its_output_counts_as_export() -> None:
    out = merge_pv2(HYBRID, PV2, behind_meter=False)
    assert out["load_power"] == 800.0
    assert out["grid_power"] == -2700.0 and out["daily_export"] == 9.0


def test_missing_values_stay_missing() -> None:
    out = merge_pv2({**HYBRID, "pv_power": None}, PV2)
    assert out["pv_power"] is None


def test_feed_in_comes_from_the_meter_not_the_hybrids_own_pv() -> None:
    """13005/13006 are the hybrid's own panels' export; a system behind the meter exports through 13045/13046."""
    from app.features.inverters.hybrid import BLOCKS, REGISTERS

    by_key = {r.key: r.address for r in REGISTERS}
    assert by_key["daily_export"] == 13045 and by_key["total_export"] == 13046
    assert by_key["daily_pv_export"] == 13005 and by_key["total_pv_export"] == 13006
    for r in REGISTERS:  # every register is read as part of a block
        assert any(start <= r.address and r.address + r.count <= start + count for start, count in BLOCKS), r.key
