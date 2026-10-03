"""Longer-term figures for the Health page (the insights feature)."""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter

from app.dependencies import ServicesDep
from app.features.insights.checkup import checkup

router = APIRouter(prefix="/api")


@router.get("/insights")
async def get_insights(svc: ServicesDep):
    """Self-sufficiency by month, battery figures, grid use by hour and month, and solar performance."""
    live = svc.live
    return await asyncio.to_thread(svc.insights.build, live.latest, live.battery_kwh(), live.reserve())


@router.get("/insights/checkup")
async def get_checkup(svc: ServicesDep):
    """Each part of the system green, amber or red, judged as the alerts judge it."""
    facts = svc.alerts.facts()  # read on the event loop, like the alerts do
    live = svc.live

    def build() -> dict[str, object]:
        now = int(time.time())
        insights = svc.insights.build(live.latest, live.battery_kwh(), live.reserve())
        active = {rule for rule, s in svc.alerts.repo.states().items() if s.active_since}
        coverage = svc.insights.repo.coverage(now - 30 * 86400, now)
        return checkup(facts, active, insights, coverage, svc.forecast.accuracy())

    return await asyncio.to_thread(build)
