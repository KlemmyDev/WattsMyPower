"""Car charges planned ahead (the Plan page): the car's details and charges, an estimate, add and remove."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep

router = APIRouter(prefix="/api/car")


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.get("")
async def get_car(svc: ServicesDep):
    """The car's details (from Settings) and its planned charges: still to come, under way or just ended."""
    return await asyncio.to_thread(svc.car.view)


@router.post("/estimate")
async def estimate(svc: ServicesDep, body: JsonBody):
    """What a charge would come to: power, how long, energy from the wall and into the car, and where it ends."""
    return await _run(svc.car.preview, body)


@router.post("/charges")
async def add_charge(svc: ServicesDep, body: JsonBody):
    """Plan a charge; the forecast counts it as home use from now on."""
    return await _run(svc.car.add, body)


@router.delete("/charges/{charge_id}")
async def remove_charge(svc: ServicesDep, charge_id: int):
    if not await asyncio.to_thread(svc.car.remove, charge_id):
        raise HTTPException(status_code=404, detail="No such charge.")
    return {"ok": True}
