"""Settings saved from the dashboard (forecast location, billing period, system details), and place search for the location."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from app.container import Services
from app.core.timezone import site_zone, use_zone
from app.dependencies import JsonBody, ServicesDep
from app.features.settings.store import SYSTEM, ZONE
from app.features.weather.openmeteo import zone_at

log = logging.getLogger(__name__)

# Settings the weather is fetched for or the forecast's sunlight depends on: changing one refetches.
WEATHER = {"latitude", "longitude", "weather_model", "panel_tilt", "panel_bearing", "pv_kw", "forecast_learning"}

router = APIRouter(prefix="/api")


def name_location(svc: Services) -> dict[str, Any] | None:
    """Give the forecast location a place name if it doesn't have one yet (a network lookup)."""
    where = svc.settings.location()
    if where is None or svc.settings.get_text("location_name"):
        return None  # none chosen yet, or it's named
    name = svc.geocoder.reverse(*where)
    return svc.settings.save({"location_name": name}) if name else None


def zone_location(svc: Services) -> dict[str, Any] | None:
    """Look up the location's time zone if it isn't known yet (a network lookup), and keep days in it unless another
    zone is chosen. Returns the settings when it was found."""
    where = svc.settings.location()
    if where is None or svc.settings.location_zone():
        return None
    try:
        tz = zone_at(*where)
    except Exception as e:
        log.warning("Couldn't look up the location's time zone (%s); days roll over in %s for now.", e, site_zone())
        return None
    if not tz:
        return None
    svc.settings.set_location_zone(tz)
    apply_zone(svc)
    return svc.settings.all_values()


def apply_zone(svc: Services) -> None:
    """Keep the process's days in the site's time zone (chosen, else the location's), and tell every open dashboard
    when that's a change, so it draws its times in it."""
    if not use_zone(svc.settings.zone()):
        return
    log.info("Days roll over at midnight in %s.", site_zone())
    svc.insights.forget_history()  # its months and last 30 days were worked out in the old zone
    svc.live.publish()


@router.get("/settings")
async def get_settings(svc: ServicesDep):
    return svc.settings.all_values()


@router.put("/settings")
async def put_settings(svc: ServicesDep, changes: JsonBody):
    """Save the forecast location (and its place name), billing period or system details. Only known keys are accepted."""
    moved = ("latitude" in changes or "longitude" in changes) and "location_name" not in changes
    before = svc.settings.location()
    if moved:
        changes = {**changes, "location_name": None}  # the old name no longer applies
    try:
        saved = await asyncio.to_thread(svc.settings.save, changes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if "latitude" in changes or "longitude" in changes:
        await asyncio.to_thread(svc.settings.set_location_zone, None)  # the old place's zone may not be the new one's
        zoned = await asyncio.to_thread(zone_location, svc)
        saved = zoned or {**saved, "location_zone": None}
    if ZONE in changes or "latitude" in changes or "longitude" in changes:
        apply_zone(svc)
    if SYSTEM.keys() & changes.keys():  # the battery's capacity or reserve may have changed: tell every open dashboard
        svc.live.publish()
    if WEATHER & changes.keys():  # fetch for the new place or model, and retrain for new panels
        svc.weather.invalidate()
        after = svc.settings.location()
        if before is None and after is not None:
            svc.weather.request_backfill()  # the location's been chosen: fill in the weather for days past
        elif before and after and any(abs(a - b) > 0.01 for a, b in zip(before, after, strict=True)):
            svc.weather.request_backfill(refetch=True)  # the weather stored for days past was another place's
        else:
            svc.weather.wake()
    if {"nem_region", "latitude", "longitude", "location_name"} & changes.keys():
        svc.grid.wake()  # the region (or whether to follow it) may have changed
    if {"power_network", "nem_region", "latitude", "longitude", "location_name", "home_suburb", "outage_radius_km"} & (
        changes.keys()
    ):
        svc.outages.wake()  # the network may have changed (the suburb tells Victoria's), or the outages to draw
    if {"hazard_warnings", "nem_region", "latitude", "longitude"} & changes.keys():
        svc.hazards.wake()  # the house's districts may have changed
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
            detail=f"Can't reach the place search ({type(e).__name__}). Try again, or enter coordinates instead.",
        ) from e
