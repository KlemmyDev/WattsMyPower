"""The car (the EV integration, the Plan page and the Overview): its details, level, planned and suggested charges."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.car.catalog import MODELS

router = APIRouter(prefix="/api/car")


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.get("")
async def get_car(svc: ServicesDep):
    """Whether a car is connected, its details (from Settings), its level, and its planned charges: still to come,
    under way or just ended."""
    return await asyncio.to_thread(svc.car.view)


@router.get("/models")
async def get_models():
    """Cars to choose from when connecting one, with their usual details."""
    return MODELS


@router.post("/level")
async def set_level(svc: ServicesDep, body: JsonBody):
    """The car's charge now (%), as read from the car or its app."""
    return await _run(svc.car.set_level, body)


@router.post("/suggest")
async def suggest(svc: ServicesDep, body: JsonBody):
    """The best times to charge the car to a level by a time, from the forecast and the prices, with what each costs.
    Leave out its level now, the level to reach or the time, for its last known level, its usual limit and time."""
    live = svc.live
    soc = (live.latest or {}).get("battery_soc")
    return await _run(
        lambda: svc.charge_planner.suggest(
            body, home_soc=soc, battery_kwh=live.battery_kwh(), reserve_pct=live.reserve()
        )
    )


@router.post("/estimate")
async def estimate(svc: ServicesDep, body: JsonBody):
    """What a charge would come to: power, how long, energy from the wall and into the car, and where it ends."""
    return await _run(svc.car.preview, body)


@router.post("/charges")
async def add_charge(svc: ServicesDep, body: JsonBody):
    """Plan a charge; the forecast counts it as home use from now on."""
    return await _run(svc.car.add, body)


@router.post("/plans")
async def add_plan(svc: ServicesDep, body: JsonBody):
    """Plan a charge in steps, as suggested: the forecast counts each step as home use from now on."""
    return await _run(svc.car.add_plan, body)


@router.delete("/charges/{charge_id}")
async def remove_charge(svc: ServicesDep, charge_id: int):
    """Remove a charge, or the whole plan it's a step of."""
    if not await asyncio.to_thread(svc.car.remove, charge_id):
        raise HTTPException(status_code=404, detail="No such charge.")
    return {"ok": True}
