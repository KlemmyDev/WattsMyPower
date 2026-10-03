"""The solar and battery forecast."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api")


@router.get("/forecast")
async def get_forecast(svc: ServicesDep):
    """Next ~24 h of solar and battery, from Open-Meteo plus our own history. null if unavailable."""
    live = svc.live
    return await asyncio.to_thread(svc.forecast.build, live.latest, live.battery_kwh(), live.reserve())


@router.get("/forecast/accuracy")
async def get_accuracy(svc: ServicesDep):
    """How close the day-ahead solar forecast has come over the last 30 days, and the likely range it implies."""
    return await asyncio.to_thread(svc.forecast.accuracy)
