"""Smart-home devices (the Home page, Settings → Integrations → Smart home): connect accounts, the devices they bring,
and where the home's power went."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request

from app.container import Services
from app.dependencies import JsonBody, ServicesDep, time_range
from app.features.home import usage
from app.features.home.service import HomeSetupError
from app.features.home.types import Hints

router = APIRouter(prefix="/api/home")

DAY = 86400


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except HomeSetupError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


@router.get("")
async def overview(svc: ServicesDep):
    """The integrations that can be connected (with their accounts), the kinds of device, and every device with what
    it's doing now."""
    return await asyncio.to_thread(svc.home.overview)


async def _hints(svc: Services, request: Request) -> Hints:
    """Where to look for devices on the network: where the inverters are, or the dashboard was opened from."""
    client = request.client.host if request.client else None
    return Hints(network=await asyncio.to_thread(svc.integrations.home_network, client, request.url.hostname))


@router.get("/hints")
async def hints(svc: ServicesDep, request: Request):
    """What a connect form left blank falls back to: the home network devices are looked for on."""
    return {"network": (await _hints(svc, request)).network}


@router.post("/integrations/{integration}")
async def connect(svc: ServicesDep, integration: str, body: JsonBody, request: Request):
    """Connect an integration with what its form asks for (signing in, for an account; finding its devices, for
    devices on the network)."""
    result = await _run(svc.home.connect, integration, body, await _hints(svc, request))
    svc.home.wake()
    return result


@router.put("/integrations/{integration}")
async def sign_in_again(svc: ServicesDep, integration: str, body: JsonBody, request: Request):
    """Sign in to a connected integration afresh (or look for its devices again), keeping its devices and their
    history."""
    result = await _run(svc.home.sign_in_again, integration, body, await _hints(svc, request))
    svc.home.wake()
    return result


@router.post("/integrations/{integration}/find")
async def find(svc: ServicesDep, integration: str):
    """Look for devices added to a connected integration since (Look for new plugs), and read them at once."""
    return await _run(svc.home.find, integration)


@router.delete("/integrations/{integration}")
async def disconnect(svc: ServicesDep, integration: str):
    """Forget an integration's account, its devices and what they used."""
    return await _run(svc.home.disconnect, integration)


@router.patch("/devices/{device_id}")
async def update_device(svc: ServicesDep, device_id: int, body: JsonBody):
    """Rename a device ({"name"}), say what it is ({"kind"}), or leave it out of the breakdown ({"hidden"})."""
    return await _run(svc.home.update_device, device_id, body)


@router.post("/devices/{device_id}/switch")
async def switch_device(svc: ServicesDep, device_id: int, body: JsonBody):
    """Switch a device on or off ({"on": true}). A fridge or freezer is only switched off with {"confirm": true}."""
    return await _run(svc.home.switch, device_id, body.get("on"), body.get("confirm", False))


@router.get("/devices/{device_id}/raw")
async def raw(svc: ServicesDep, device_id: int):
    """A device's properties as its integration last sent them, to check how they're read."""
    return await _run(svc.home.raw, device_id)


@router.get("/usage")
async def get_usage(
    svc: ServicesDep, start: int | None = None, end: int | None = None, bucket: Literal["hour", "day"] = "day"
):
    """The home's use by the hour or day over [start, end) (by default the last 7 days), each device's share, and what
    no device measured."""
    start, end = time_range(start, end, 7 * DAY)
    if end <= start or end - start > (2 * DAY if bucket == "hour" else 400 * DAY):
        raise HTTPException(status_code=422, detail="Choose up to 2 days by the hour, or 400 by the day.")
    return await asyncio.to_thread(usage.breakdown, svc.home.repo, svc.readings, start, end, bucket)


@router.get("/patterns")
async def get_patterns(svc: ServicesDep):
    """Each device's habits over the last eight weeks: when it runs, and what it uses through the day and week."""
    return await asyncio.to_thread(usage.patterns, svc.home.repo, int(time.time()))


@router.get("/runs")
async def get_runs(svc: ServicesDep, start: int | None = None, end: int | None = None, device: int | None = None):
    """Appliance runs that started in [start, end) (by default the last 7 days), newest first."""
    start, end = time_range(start, end, 7 * DAY)
    runs = await asyncio.to_thread(svc.home.repo.runs, start, end, device)
    return runs[::-1]
