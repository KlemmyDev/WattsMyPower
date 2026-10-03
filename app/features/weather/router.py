"""The weather: its settings' status, filling in past weather, a day's weather, and how the forecast is doing."""

from __future__ import annotations

import asyncio
import datetime as dt

from fastapi import APIRouter, HTTPException

from app.dependencies import ServicesDep
from app.features.forecast.learning import MIN_BACKTEST_DAYS

router = APIRouter(prefix="/api/weather")


@router.get("")
async def status(svc: ServicesDep):
    """What's stored, filling in past weather, the learned model and its back-test, and day-ahead accuracy."""

    def gather():
        learned = svc.forecast.learned() or {}
        return {
            **svc.weather.status(),
            "learning": {
                "on": bool(svc.settings.get("forecast_learning")),
                "in_use": svc.forecast._active_model() is not None,
                "trained_at": learned.get("trained_at"),
                "days": learned.get("days", 0),
                "first_day": learned.get("first_day"),
                "better": bool(learned.get("better")),
                "min_days": MIN_BACKTEST_DAYS,  # back-test days it needs before it can be used
                "backtest": learned.get("backtest"),
            },
            "accuracy": svc.forecast.accuracy(),
        }

    return await asyncio.to_thread(gather)


@router.post("/backfill")
async def backfill(svc: ServicesDep, refetch: bool = False):
    """Fill in past weather now, all of it, rather than a little each half hour. `refetch` fetches every day with
    readings again (say after changing the weather model), not only those without weather."""
    svc.weather.request_backfill(refetch)
    return {"started": True, "backfill": svc.weather.backfill_state}


@router.post("/retrain")
async def retrain(svc: ServicesDep):
    """Retrain the learned model now (after filling in history), and say how it did."""
    saved = await asyncio.to_thread(svc.forecast.train)
    return {k: v for k, v in saved.items() if k != "model"}


@router.get("/days")
async def days(svc: ServicesDep, start: str, end: str):
    """Each day's weather summed up, from `start` up to (not including) `end` (YYYY-MM-DD), for a heatmap."""
    try:
        first, last = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    except ValueError as e:
        raise HTTPException(status_code=422, detail="start and end must be YYYY-MM-DD") from e
    if not first < last <= first + dt.timedelta(days=370):
        raise HTTPException(status_code=422, detail="end must be after start, and at most a year on")
    return await asyncio.to_thread(svc.weather.days, first, last)


@router.get("/day")
async def day(svc: ServicesDep, date: str):
    """A day's weather hour by hour, summed up, with its day-ahead solar forecast."""
    try:
        when = dt.date.fromisoformat(date)
    except ValueError as e:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD") from e
    return await asyncio.to_thread(svc.weather.day, when)
