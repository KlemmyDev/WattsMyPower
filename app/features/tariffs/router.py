"""The tariff, and what each day cost under it."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep, time_range
from app.features.tariffs.costs import daily_costs

router = APIRouter(prefix="/api")


@router.get("/tariff")
async def get_tariff(svc: ServicesDep):
    return svc.tariffs.get()


@router.put("/tariff")
async def put_tariff(svc: ServicesDep, tariff: JsonBody):
    """Replace the tariff. Validated (including overlapping time windows); errors come back as 422 with a readable message."""
    if tariff.get("type") == "amber" and not svc.amber.ready:
        raise HTTPException(
            status_code=422, detail="Connect your Amber account and choose its site first, then choose Amber prices."
        )
    try:
        return await asyncio.to_thread(svc.tariffs.save, tariff)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.get("/costs")
async def get_costs(svc: ServicesDep, start: int | None = None, end: int | None = None):
    """Per-day import/export, costs and savings, priced at the rate (or Amber price) in force for each 5 minutes
    (or meter interval)."""
    start, end = time_range(start, end, 86400)
    t, tables = svc.tariffs.current()
    return await asyncio.to_thread(daily_costs, svc.readings, t, tables, start, end, svc.meter, svc.amber.repo)
