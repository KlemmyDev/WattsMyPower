"""
What an appliance that doesn't report its power is likely drawing while it runs. Hisense's washers and dryers only say
what a cycle used once it's finished, so while one runs, the Home page would have nothing to show; with this on for it
(home_devices.estimate), it shows what its runs usually draw instead, marked as estimated.

What its runs usually draw is the median of its last RECENT finished runs' averages (each one's kWh over how long it
ran), from the last LOOKBACK_DAYS. Runs whose energy never arrived, and runs too short to say, are left out, and
there's no estimate until MIN_RUNS have counted. It's only what's shown: nothing estimated is recorded, so the energy
the appliance reports when the run's done is still what's counted.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import median
from typing import Any

from app.features.home.repository import Device
from app.features.home.types import KINDS

MIN_RUNS = 3  # finished runs with their energy before there's an estimate
RECENT = 10  # how many of the latest runs it's judged from
LOOKBACK_DAYS = 90
MIN_MINUTES = 5  # a run shorter than this says too little about what it draws


def estimable(d: Device) -> bool:
    """A device that runs in cycles and doesn't report its power (it's never been read with any)."""
    return (KINDS.get(d.kind) or KINDS["other"]).cycles and d.meter.get("power") is None


def typical(runs: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Each device's usual draw while running, from its runs (oldest first): {"w": average W or None, "runs": how
    many counted}."""
    by_device: dict[int, list[float]] = defaultdict(list)
    for r in runs:
        seconds = (r["end"] or 0) - r["start"]
        if r["end"] is None or r["kwh"] <= 0 or seconds < MIN_MINUTES * 60:
            continue
        by_device[r["device"]].append(r["kwh"] * 3.6e6 / seconds)
    out = {}
    for device, ws in by_device.items():
        recent = ws[-RECENT:]
        out[device] = {"w": round(median(recent)) if len(recent) >= MIN_RUNS else None, "runs": len(recent)}
    return out


def overlay(now: dict[str, Any], w: float, at: float) -> dict[str, Any]:
    """What a running appliance is doing, with the estimate as its power: power_w is `w`, flagged as estimated, with
    what the run has likely used so far and, when the appliance says how long is left, by the end."""
    run = now.get("run") or {}
    elapsed = max(0.0, at - run["start"]) if run.get("start") else 0.0
    left = (now.get("remaining_min") or 0) * 60
    return {
        **now,
        "power_w": w,
        "estimated": True,
        "estimate": {
            "kwh_so_far": round(w * elapsed / 3.6e6, 3),
            "kwh_total": round(w * (elapsed + left) / 3.6e6, 3) if left else None,
        },
    }
