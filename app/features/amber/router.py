"""Amber Electric (Settings → Tariffs): connect an account, choose its site, and today's prices."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.amber.service import AmberSetupError

router = APIRouter(prefix="/api/amber")

DAY = 86400


async def _change(fn: Callable[..., dict[str, Any]], *args: Any) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(fn, *args)
    except AmberSetupError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


@router.get("")
async def amber_status(svc: ServicesDep):
    """Whether Amber is connected (the API key masked), its sites, and how far back prices go."""
    return await asyncio.to_thread(svc.amber.status)


@router.put("")
async def amber_connect(svc: ServicesDep, body: JsonBody):
    """Connect with an API key ({"api_key"}). Checked by listing the account's sites."""
    status = await _change(svc.amber.connect, body.get("api_key"))
    svc.amber.wake()
    return status


@router.put("/site")
async def amber_site(svc: ServicesDep, body: JsonBody):
    """Choose which of the account's sites to follow ({"site_id"})."""
    status = await _change(svc.amber.choose_site, str(body.get("site_id") or ""))
    svc.amber.wake()
    return status


@router.delete("")
async def amber_disconnect(svc: ServicesDep):
    """Forget the API key and prices. A tariff on Amber prices goes back to a single rate."""
    return await _change(svc.amber.disconnect)


@router.get("/prices")
async def amber_prices(svc: ServicesDep, start: int | None = None, end: int | None = None):
    """Import and feed-in prices ($/kWh incl. GST; feed-in is what a kWh exported earns) for [start, end),
    by default the last 24 hours and what's forecast after, and the prices in force now."""
    now = int(time.time())
    start = start if start is not None else now - DAY
    end = end if end is not None else now + 2 * DAY
    if end <= start or end - start > 8 * DAY:
        raise HTTPException(status_code=422, detail="Choose a range of up to 8 days.")
    return await asyncio.to_thread(svc.amber.prices, start, end, now)
