"""The Bills page."""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api")


@router.get("/bills")
async def get_bills(svc: ServicesDep):
    """The current billing period so far and expected, upcoming and past bills, and this period's breakdown."""
    return await asyncio.to_thread(svc.bills.build, int(time.time()))


@router.get("/bills/grid-hours")
async def get_grid_hours(svc: ServicesDep):
    """Grid use and its cost by hour of the day, for each of the last 12 months."""
    return await asyncio.to_thread(svc.bills.grid_hours, int(time.time()))


@router.get("/bills/payback")
async def get_payback(svc: ServicesDep):
    """What the system has saved so far and a year, and when it pays for itself (from Manage → System)."""
    total_pv = (svc.live.latest or {}).get("total_pv")
    return await asyncio.to_thread(svc.bills.payback, int(time.time()), total_pv)
