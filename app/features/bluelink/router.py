"""Hyundai and Kia (the EV page, Manage → Integrations → Electric vehicles → Hyundai and Kia): sign in to the maker's
cloud, see the cars, read them now (or ask a car itself), set the app's PIN, change how each charges, start and stop
it or set its charge limit, disconnect."""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Annotated, Any

from fastapi import APIRouter, Body, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.bluelink.service import BluelinkSetupError

router = APIRouter(prefix="/api/bluelink")


async def _run(change: Awaitable[dict[str, Any]]) -> dict[str, Any]:
    try:
        return await change
    except BluelinkSetupError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


@router.get("")
async def bluelink_status(svc: ServicesDep):
    """The account (its email partly hidden, its make and country, whether a PIN is set), how reading it is going,
    and each car: its charge, plug and charging, how it charges from solar, and what the dashboard did lately."""
    return svc.bluelink.status()


@router.put("")
async def bluelink_connect(svc: ServicesDep, body: JsonBody):
    """Sign in ({"username", "password", "pin", "brand": "hyundai" or "kia", "region": "AU" or "NZ"}), checked by
    reading the account's cars."""
    return await _run(svc.bluelink.connect(body))


@router.put("/pin")
async def bluelink_pin(svc: ServicesDep, body: JsonBody):
    """Set the app's 4-digit PIN ({"pin"}), which newer (CCS2) cars need to start and stop charging."""
    return await _run(svc.bluelink.set_pin(body))


@router.post("/refresh")
async def bluelink_refresh(svc: ServicesDep, body: Annotated[dict[str, Any] | None, Body()] = None):
    """Read the cars now, from the cloud ({"force": vin} asks that car itself: at most every 10 minutes)."""
    return await _run(svc.bluelink.refresh(body))


@router.put("/vehicles/{vin}")
async def bluelink_configure(svc: ServicesDep, vin: str, body: JsonBody):
    """How a car charges: mode, who gets the sun first, how far short, timing, its charging power, how often the car
    itself may be asked, its home."""
    return await _run(svc.bluelink.configure(vin, body))


@router.post("/vehicles/{vin}/command")
async def bluelink_command(svc: ServicesDep, vin: str, body: JsonBody):
    """Start or stop charging, set the charge limit ({"action": "limit", "percent"}), or let the dashboard take
    charge again ("resume")."""
    return await _run(svc.bluelink.command(vin, body))


@router.delete("")
async def bluelink_disconnect(svc: ServicesDep):
    """Forget the account and its cars."""
    return await svc.bluelink.disconnect()
