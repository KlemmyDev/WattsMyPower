"""Longer-term figures for the Insights page."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api")


@router.get("/insights")
async def get_insights(svc: ServicesDep):
    """Self-sufficiency by month, battery figures, grid use by hour and month, and solar performance."""
    return await asyncio.to_thread(svc.insights.build, svc.live.latest, svc.live.battery_kwh())
