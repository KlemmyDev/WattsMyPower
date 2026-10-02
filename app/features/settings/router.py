"""Settings saved from the dashboard (forecast location, billing period), and place search for the location."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.container import Services
from app.dependencies import JsonBody, ServicesDep

router = APIRouter(prefix="/api")


def name_location(svc: Services) -> dict[str, Any] | None:
    """Give the forecast location a place name if it doesn't have one yet (a network lookup)."""
    if svc.settings.get_text("location_name"):
        return None
    name = svc.geocoder.reverse(svc.settings.get("latitude"), svc.settings.get("longitude"))
    return svc.settings.save({"location_name": name}) if name else None


@router.get("/settings")
async def get_settings(svc: ServicesDep):
    return svc.settings.all_values()


@router.put("/settings")
async def put_settings(svc: ServicesDep, changes: JsonBody):
    """Save the forecast location (and its place name) or billing period. Only known keys are accepted."""
    moved = ("latitude" in changes or "longitude" in changes) and "location_name" not in changes
    if moved:
        changes = {**changes, "location_name": None}  # the old name no longer applies
    try:
        saved = await asyncio.to_thread(svc.settings.save, changes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if moved:  # coordinates typed in by hand: look up a place name for them
        named = await asyncio.to_thread(name_location, svc)
        return named or saved
    return saved


@router.get("/geocode")
async def search_places(svc: ServicesDep, q: str):
    """Suburbs, towns and addresses matching q, for choosing the forecast location (OpenStreetMap)."""
    try:
        return await asyncio.to_thread(svc.geocoder.search, q)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"The place search couldn't be reached ({type(e).__name__}). Try again, or enter coordinates instead.",
        ) from e
