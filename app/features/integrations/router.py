"""Connecting inverters (Settings → Integrations): list, scan the network, connect, change, remove."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.container import Services
from app.dependencies import JsonBody, ServicesDep
from app.features.integrations.service import IntegrationError
from app.features.live.ingest import CollectorIngest

router = APIRouter(prefix="/api/integrations")
log = logging.getLogger(__name__)


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except IntegrationError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


async def _changed(svc: Services) -> None:
    """Show the change on the dashboard now, rather than on the next poll."""
    if isinstance(svc.source, CollectorIngest):
        try:
            await svc.source.refresh()
        except Exception as e:  # the change is made either way; the next poll picks it up
            log.info("Couldn't refresh the collector's status: %s: %s", type(e).__name__, e)


@router.get("")
async def overview(svc: ServicesDep, request: Request):
    """The connected inverters, the kinds that can be connected, the latest scan, and a network to scan."""
    return await asyncio.to_thread(svc.integrations.overview, request.client.host if request.client else None)


@router.get("/scan")
async def scan(svc: ServicesDep):
    return await _run(svc.integrations.scan)


@router.post("/scan")
async def start_scan(svc: ServicesDep, body: JsonBody):
    """Look for inverters on a network, e.g. {"network": "192.168.1.0/24"}. Poll GET for progress."""
    return await _run(svc.integrations.start_scan, str(body.get("network") or ""))


@router.put("/{role}")
async def connect(svc: ServicesDep, role: str, body: JsonBody):
    """Connect an inverter as the main one (hybrid) or a second solar inverter (pv2)."""
    device = await _run(svc.integrations.connect, role, body)
    await _changed(svc)
    return device


@router.patch("/{role}")
async def update(svc: ServicesDep, role: str, body: JsonBody):
    """Change a connected inverter's settings, e.g. {"behind_meter": false}."""
    device = await _run(svc.integrations.update, role, body)
    await _changed(svc)
    return device


@router.delete("/{role}")
async def remove(svc: ServicesDep, role: str):
    removed = await _run(svc.integrations.remove, role)
    await _changed(svc)
    return {"removed": removed}
