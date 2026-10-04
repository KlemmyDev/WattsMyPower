"""Settings → Alerts: where alerts go (with a test send), browsers notified, which rules are on, and what was sent."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep
from app.features.alerts.channels import DeliveryError

router = APIRouter(prefix="/api/alerts")


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except DeliveryError as e:
        raise HTTPException(status_code=502, detail=f"The test didn't go through: {e}") from e


@router.get("")
async def overview(svc: ServicesDep):
    """Channels (secrets masked), rules with their thresholds, and recent alerts."""
    return await _run(svc.alerts.overview)


@router.get("/history")
async def history(svc: ServicesDep, limit: int = 50):
    return await _run(svc.alerts.history, max(1, min(limit, 500)))


@router.put("/channels/{kind}")
async def save_channel(svc: ServicesDep, kind: str, body: JsonBody):
    """Set up or change a channel, e.g. {"url": "https://ntfy.sh/my-solar", "token": "", "enabled": true}.
    A masked secret sent back as it was shown keeps the saved one."""
    return await _run(svc.alerts.save_channel, kind, body)


@router.delete("/channels/{kind}")
async def remove_channel(svc: ServicesDep, kind: str):
    return {"removed": await _run(svc.alerts.remove_channel, kind)}


@router.post("/channels/{kind}/test")
async def test_channel(svc: ServicesDep, kind: str, body: JsonBody):
    """Send a test notification with the settings given (or the saved ones, for an empty body)."""
    return await _run(svc.alerts.test_channel, kind, body)


@router.get("/push")
async def push(svc: ServicesDep):
    """The server's public key for subscribing, and the browsers subscribed to notifications."""
    return await _run(svc.alerts.push_overview)


@router.post("/push/devices")
async def subscribe(svc: ServicesDep, body: JsonBody):
    """Turn on notifications for a browser: {"subscription": PushSubscription.toJSON(), "name": "Chrome on Mac"}."""
    return await _run(svc.alerts.subscribe, body)


@router.delete("/push/devices/{device}")
async def unsubscribe(svc: ServicesDep, device: str):
    return {"removed": await _run(svc.alerts.remove_device, device)}


@router.post("/push/test")
async def test_push(svc: ServicesDep, body: JsonBody):
    """Send a test notification to one browser ({"device": id}) or all of them ({})."""
    return await _run(svc.alerts.test_push, body)


@router.put("/rules/{rule}")
async def save_rule(svc: ServicesDep, rule: str, body: JsonBody):
    """Switch an alert on or off, or change its thresholds: {"enabled": true, "settings": {"percent": 15}}."""
    return await _run(svc.alerts.save_rule, rule, body)
