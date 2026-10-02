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
