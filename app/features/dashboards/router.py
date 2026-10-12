"""The Overview's dashboards and their layouts: GET them, PUT them back whole, DELETE to go back to the default."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.dashboards.service import DashboardError

router = APIRouter(prefix="/api/dashboards")


@router.get("")
async def get_dashboards(svc: ServicesDep):
    return await asyncio.to_thread(svc.dashboards.get)


@router.put("")
async def save_dashboards(svc: ServicesDep, body: JsonBody):
    """{"dashboards": [{"id", "name", "layouts": {"computer": [widget…], "phone": [widget…] | null}}]}, each widget
    {"id", "type", "x", "y", "w", "h", "settings"} on a grid 12 columns wide (a phone's: 4)."""
    try:
        return await asyncio.to_thread(svc.dashboards.save, body)
    except DashboardError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.delete("")
async def reset_dashboards(svc: ServicesDep):
    return await asyncio.to_thread(svc.dashboards.reset)
