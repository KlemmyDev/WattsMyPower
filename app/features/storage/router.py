"""Settings → Database: what's stored in the dashboard's and the collector's databases, and how much room it takes."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api")


@router.get("/storage")
async def storage(svc: ServicesDep, fresh: bool = False):
    """Both databases, table by table. Reuses a measure from the last few minutes unless `fresh`."""
    return await asyncio.to_thread(svc.storage.report, fresh)
