"""BYD (the EV page, Manage → Integrations → Electric vehicles → BYD): sign in to BYD's cloud, see the cars, read them
now, disconnect. Only reads the cars."""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.byd.service import BydSetupError

router = APIRouter(prefix="/api/byd")


async def _run(change: Awaitable[dict[str, Any]]) -> dict[str, Any]:
    try:
        return await change
    except BydSetupError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


@router.get("")
async def byd_status(svc: ServicesDep):
    """The account (its email partly hidden, its region), how reading it is going, and each car: its charge, range,
    whether it's charging, and when it was read."""
    return svc.byd.status()


@router.put("")
async def byd_connect(svc: ServicesDep, body: JsonBody):
    """Sign in ({"username", "password", "region": "AU" or "NZ"}), checked by reading the account's cars."""
    return await _run(svc.byd.connect(body))


@router.post("/refresh")
async def byd_refresh(svc: ServicesDep):
    """Read the cars now."""
    return await _run(svc.byd.refresh())


@router.delete("")
async def byd_disconnect(svc: ServicesDep):
    """Forget the account and its cars."""
    return await svc.byd.disconnect()
