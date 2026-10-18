"""Sharing the power summary: a secret link to a small read-only page that another website can show in a frame.

The dashboard itself can't be framed and needs a signed-in browser. A page in a frame on another address doesn't send
the dashboard's session cookie, so this has its own way in: a random token, made and revoked in Settings, that has to
come with the request. It opens the live power figures and nothing else.
"""

from __future__ import annotations

import hmac
import secrets

from fastapi import APIRouter, HTTPException

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api/embed")


@router.get("")
async def status(svc: ServicesDep):
    """Whether the link is on, and its token (signed in only)."""
    token = svc.settings.embed_token()
    return {"enabled": token is not None, "token": token}


@router.post("")
async def create(svc: ServicesDep):
    """Turn the link on, or make a new one (the old link stops working)."""
    token = secrets.token_urlsafe(24)
    svc.settings.set_embed_token(token)
    return {"enabled": True, "token": token}


@router.delete("")
async def revoke(svc: ServicesDep):
    """Turn the link off."""
    svc.settings.set_embed_token(None)
    return {"enabled": False, "token": None}


@router.get("/public/power")
async def power(svc: ServicesDep, token: str = ""):
    """The live power flow for the shared page: the one thing the token opens. Not found for a wrong or missing token,
    so it doesn't say whether sharing is on."""
    expected = svc.settings.embed_token()
    if not expected or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status_code=404, detail="Not found")
    p = svc.live.latest or {}
    return {
        "solar_w": p.get("pv_power"),
        "home_w": p.get("load_power"),
        "grid_w": p.get("grid_power"),
        "battery_w": p.get("battery_power"),
        "battery_pct": p.get("battery_soc"),
        "updated": svc.live.last_success,
    }
