"""The cars (the EV integration, the Plan page and the Overview): their details, levels, planned and suggested charges."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.car.catalog import MODELS
from app.features.car.service import NoSuchCar

router = APIRouter(prefix="/api/cars")


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except NoSuchCar as e:
        raise HTTPException(status_code=404, detail="No such car.") from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.get("")
async def get_cars(svc: ServicesDep):
    """Every car connected: its details, its level, and its planned charges (still to come, under way or just ended)."""
    return await asyncio.to_thread(svc.car.views)


@router.get("/models")
async def get_models():
    """Cars to choose from when connecting one, with their usual details."""
    return MODELS


@router.post("")
async def add_car(svc: ServicesDep, body: JsonBody):
    """Connect a car: its name, the model chosen (or none) and its details."""
    return await _run(svc.car.create, body)


@router.delete("/charges/{charge_id}")
async def remove_charge(svc: ServicesDep, charge_id: int):
    """Remove a charge, or the whole plan it's a step of."""
    if not await asyncio.to_thread(svc.car.remove, charge_id):
        raise HTTPException(status_code=404, detail="No such charge.")
    return {"ok": True}


@router.put("/{car_id}")
async def update_car(svc: ServicesDep, car_id: int, body: JsonBody):
    """Change a car's name, model or details."""
    return await _run(svc.car.update, car_id, body)


@router.delete("/{car_id}")
async def remove_car(svc: ServicesDep, car_id: int):
    """Disconnect a car, with its planned charges and levels."""
    if not await asyncio.to_thread(svc.car.delete, car_id):
        raise HTTPException(status_code=404, detail="No such car.")
    return {"ok": True}


@router.post("/{car_id}/level")
async def set_level(svc: ServicesDep, car_id: int, body: JsonBody):
    """The car's charge now (%), as read from the car or its app."""
    return await _run(svc.car.set_level, car_id, body)


@router.post("/{car_id}/suggest")
async def suggest(svc: ServicesDep, car_id: int, body: JsonBody):
    """A plan for each aim to charge the car to a level by a time, from the forecast and the prices, with what each
    costs. Leave out its level now, the level to reach or the time, for its last known level, its usual limit and
    time."""
    live = svc.live
    soc = (live.latest or {}).get("battery_soc")
    return await _run(
        lambda: svc.charge_planner.suggest(
            car_id, body, home_soc=soc, battery_kwh=live.battery_kwh(), reserve_pct=live.reserve()
        )
    )


@router.post("/{car_id}/estimate")
async def estimate(svc: ServicesDep, car_id: int, body: JsonBody):
    """What a charge would come to: power, how long, energy from the wall and into the car, and where it ends."""
    return await _run(svc.car.preview, car_id, body)


@router.post("/{car_id}/charges")
async def add_charge(svc: ServicesDep, car_id: int, body: JsonBody):
    """Plan a charge; the forecast counts it as home use from now on."""
    return await _run(svc.car.add, car_id, body)


@router.post("/{car_id}/plans")
async def add_plan(svc: ServicesDep, car_id: int, body: JsonBody):
    """Plan a charge in steps, as suggested: the forecast counts each step as home use from now on."""
    return await _run(svc.car.add_plan, car_id, body)
