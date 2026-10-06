"""The battery controls (the Battery page, and the Overview's shortcuts): standby, a floor, a charge from the grid."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep, time_range
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


@router.post("/preview")
async def preview_control(svc: ServicesDep, body: JsonBody):
    """What a control would do if started now, without starting it (same body as POST /control): the battery's
    level as it runs, when it ends, grid energy and cost, and the same stretch as normal."""
    return await _run(svc.battery.preview, body)


@router.get("/log")
async def control_log(svc: ServicesDep, limit: int = 50):
    """What the battery controls did lately (and what was seen of iSolarCloud and other controllers), newest
    first, at most `limit` (up to 200)."""
    return {"events": await _run(svc.battery.log, limit)}


@router.get("/history")
async def control_history(svc: ServicesDep, start: int | None = None, end: int | None = None):
    """The controls in effect over [start, end) (default: the last day), oldest first."""
    s, e = time_range(start, end, 86400)
    return {"controls": await _run(svc.battery.history, s, e)}


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
