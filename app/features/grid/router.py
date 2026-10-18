"""The grid (the Grid page): the region's wholesale market, AEMO's notices, and the outlook."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter

from app.dependencies import ServicesDep
from app.features.grid.events import recent

router = APIRouter(prefix="/api/grid")


@router.get("")
async def grid(svc: ServicesDep):
    """The region and its price now, the day's prices and those ahead, its notices, storms coming, and the outlook."""
    return await asyncio.to_thread(svc.grid.view)


@router.get("/events")
async def events(svc: ServicesDep):
    """Each time the house ran without the grid (newest first), and whether this inverter reports it at all."""

    def read() -> dict:
        with svc.db.reading() as conn:
            return {"events": recent(conn), "known": svc.live.off_grid_known}

    return await asyncio.to_thread(read)


@router.post("/refresh")
async def refresh(svc: ServicesDep):
    """Fetch from AEMO now (the Grid page's retry)."""
    if svc.grid.enabled():
        await asyncio.to_thread(svc.grid.refresh)
    return await asyncio.to_thread(svc.grid.view)
