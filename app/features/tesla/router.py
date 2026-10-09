"""Tesla (the EV page, Manage → Integrations → Tesla): connect through Tessie or pair over Bluetooth, set how each car
charges, and command it. The same whichever way the cars are reached."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.tesla.service import TeslaSetupError

router = APIRouter(prefix="/api/tesla")


async def _change(svc: Any, fn: Callable[..., dict[str, Any]], *args: Any) -> dict[str, Any]:
    try:
        out = await asyncio.to_thread(fn, *args)
    except TeslaSetupError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    await svc.tesla.publish()
    return out


@router.get("")
async def tesla_status(svc: ServicesDep):
    """How the cars are reached (provider: tessie or bluetooth; the token masked, the key by its fingerprint, a
    pairing under way), and each car: what it's doing and how it's set to charge."""
    return await asyncio.to_thread(svc.tesla.status)


@router.put("/tessie")
async def tesla_connect_tessie(svc: ServicesDep, body: JsonBody):
    """Connect through Tessie with an access token ({"token"}): checked by listing the account's cars. Switches from
    Bluetooth, keeping the settings of the cars on both."""
    return await _change(svc, svc.tesla.connect, body.get("token"))


@router.post("/bluetooth")
async def tesla_pair(svc: ServicesDep, body: JsonBody):
    """Pair a car over Bluetooth by its VIN ({"vin"}). Answers at once; the pairing (a tap of a key card in the car)
    goes on in the background, followed by GET's `bluetooth.pairing`. Switches from Tessie once it's paired."""
    return await _change(svc, svc.tesla.pair, body.get("vin"))


@router.delete("")
async def tesla_disconnect(svc: ServicesDep):
    """Forget the token and the cars' links. The dashboard's cars stay."""
    return await _change(svc, svc.tesla.disconnect)


@router.put("/vehicles/{vin}")
async def tesla_configure(svc: ServicesDep, vin: str, body: JsonBody):
    """How a car charges: {mode (off, solar), battery_first, grid_w, car, home ("here" or null)}."""
    return await _change(svc, svc.tesla.configure, vin, body)


@router.delete("/vehicles/{vin}")
async def tesla_remove(svc: ServicesDep, vin: str):
    """Stop following a car."""
    return await _change(svc, svc.tesla.remove, vin)


@router.post("/vehicles/{vin}/command")
async def tesla_command(svc: ServicesDep, vin: str, body: JsonBody):
    """{"action": "start" | "stop" | "amps" (with "amps") | "limit" (with "percent") | "resume"}."""
    return await _change(svc, svc.tesla.command, vin, body)


@router.get("/log")
async def tesla_log(svc: ServicesDep, limit: int = 50):
    """What the dashboard did with the cars, and what it saw done outside it, newest first."""
    return {"events": await asyncio.to_thread(svc.tesla.log, limit)}
