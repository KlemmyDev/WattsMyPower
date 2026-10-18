"""Settings → Notifications: what's reported and how, where it goes (with a test send), the browsers turned on, and
what was sent."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.notifications.channels import KINDS, DeliveryError

router = APIRouter(prefix="/api/notifications")


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except DeliveryError as e:
        raise HTTPException(status_code=502, detail=f"The test didn't go through: {e}") from e


@router.get("")
async def overview(svc: ServicesDep):
    """The rules and their numbers, channels (secrets masked), browsers turned on, options and recent history."""
    return await _run(svc.notifications.view)


@router.put("/rules/{rule}")
async def save_rule(svc: ServicesDep, rule: str, body: JsonBody):
    """Turn one on or off, set its numbers and channels: {"enabled": true, "values": {"percent": 15}}."""
    await _run(svc.notifications.save_rule, rule, body)
    return await _run(svc.notifications.view)


@router.put("/options")
async def save_options(svc: ServicesDep, body: JsonBody):
    """Quiet hours and the day's limit: {"quiet": {"enabled": true, "start": "22:00", "end": "07:00"}, "daily_cap": 20}."""
    await _run(svc.notifications.save_options, body)
    return await _run(svc.notifications.view)


@router.put("/channels/{kind}")
async def save_channel(svc: ServicesDep, kind: str, body: JsonBody):
    """Set up or change ntfy or a webhook, e.g. {"url": "https://ntfy.sh/my-solar", "enabled": true}. A masked secret
    sent back as it was shown keeps the saved one."""
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="There's no such channel.")
    await _run(svc.notifications.save_channel, kind, body)
    return await _run(svc.notifications.view)


@router.delete("/channels/{kind}")
async def remove_channel(svc: ServicesDep, kind: str):
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="There's no such channel.")
    await _run(svc.notifications.repo.delete_channel, kind)
    return await _run(svc.notifications.view)


@router.post("/test")
async def test(svc: ServicesDep, body: JsonBody):
    """Send a test to one place: {"target": "push"} (every browser), a browser's id, "ntfy" or "webhook"."""
    target = str(body.get("target") or "push")
    result = await _run(svc.notifications.test, target)
    return {**result, **(await _run(svc.notifications.view))}


@router.get("/push")
async def push(svc: ServicesDep):
    """The server's public key, which a browser subscribes with."""
    return {"public_key": svc.notifications.push.keys().public}


@router.post("/push/devices")
async def subscribe(svc: ServicesDep, body: JsonBody):
    """Turn notifications on for a browser: {"subscription": PushSubscription.toJSON(), "name": "Chrome on Mac"}."""
    return await _run(svc.notifications.push.subscribe, body)


@router.delete("/push/devices/{device}")
async def unsubscribe(svc: ServicesDep, device: str):
    return {"removed": await _run(svc.notifications.push.remove, device)}
