"""The cars (Manage → Integrations → Electric vehicle, and the Overview's drawing): their details and levels."""

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
    """Every car connected: its details and its level."""
    return await asyncio.to_thread(svc.car.views)


@router.get("/models")
async def get_models():
    """Cars to choose from when connecting one, with their usual details."""
    return MODELS


@router.post("")
async def add_car(svc: ServicesDep, body: JsonBody):
    """Connect a car: its name, the model chosen (or none) and its details."""
    return await _run(svc.car.create, body)


@router.put("/{car_id}")
async def update_car(svc: ServicesDep, car_id: int, body: JsonBody):
    """Change a car's name, model or details."""
    return await _run(svc.car.update, car_id, body)


@router.delete("/{car_id}")
async def remove_car(svc: ServicesDep, car_id: int):
    """Disconnect a car, with its levels."""
    if not await asyncio.to_thread(svc.car.delete, car_id):
        raise HTTPException(status_code=404, detail="No such car.")
    return {"ok": True}
