"""The battery controls (the Overview's Battery control card): standby, a floor, a charge from the grid."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.battery.service import BatteryError

router = APIRouter(prefix="/api/battery")


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except BatteryError as e:
        raise HTTPException(status_code=e.status, detail=e.detail) from e


@router.get("")
async def get_battery(svc: ServicesDep):
    """The battery's settings as the inverter reports them, who has the battery, the control in effect and what the
    controls did lately."""
    return await _run(svc.battery.view)


@router.post("/control")
async def start_control(svc: ServicesDep, body: JsonBody):
    """Start a control, replacing any in effect: {"kind": "standby"|"floor"|"charge", "until": unix seconds or null,
    "floor": %, "power_w": W, "target": %}."""
    try:
        return await _run(svc.battery.start, body)
    finally:
        await svc.battery.publish()  # every page shows the new mode (or that something else has the battery)


@router.delete("/control")
async def stop_control(svc: ServicesDep):
    """End the control in effect and put the battery back to normal."""
    try:
        return await _run(svc.battery.stop)
    finally:
        await svc.battery.publish()
