"""Combining the hybrid's snapshot with a second, AC-coupled string inverter's."""

from __future__ import annotations

from collections.abc import Mapping

from app.features.inverters.types import Snapshot


def _add(a: float | None, b: float | None) -> float | None:
    return a if a is None or b is None else round(a + b, 3)


def merge_pv2(snap: Snapshot, pv2: Mapping[str, float | None] | None, behind_meter: bool = True) -> Snapshot:
    """
    Fold a second, AC-coupled solar system into the hybrid's snapshot. Solar becomes both
    systems together. The rest depends on where the second system connects:

    - behind the meter (house side, the default and usual setup): the meter already counts
      its surplus as export, and the hybrid sees its output as reduced (even negative) home
      use, so add it back there.
    - outside the hybrid's meter: the meter never sees it, so all of its output is export
      on top of what the meter measured, and the hybrid's home use is right.

    The hybrid's own figures are kept as *_pv1, load_hybrid, grid_hybrid and daily_export1.
    """
    out = dict(snap)
    out.update(
        pv1_power=snap.get("pv_power"),
        daily_pv1=snap.get("daily_pv"),
        total_pv1=snap.get("total_pv"),
        load_hybrid=snap.get("load_power"),
        grid_hybrid=snap.get("grid_power"),
        daily_export1=snap.get("daily_export"),
    )
    if not pv2:
        return out
    out.update(pv2)
    p2 = pv2.get("pv2_power")
    out["pv_power"] = _add(snap.get("pv_power"), p2)
    out["daily_pv"] = _add(snap.get("daily_pv"), pv2.get("daily_pv2"))
    out["total_pv"] = _add(snap.get("total_pv"), pv2.get("total_pv2"))
    if behind_meter:
        out["load_power"] = _add(snap.get("load_power"), p2)
    else:
        out["grid_power"] = _add(snap.get("grid_power"), -p2 if p2 is not None else None)
        out["daily_export"] = _add(snap.get("daily_export"), pv2.get("daily_pv2"))
    return out
