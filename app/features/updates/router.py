"""Updates (Settings → System): whether a newer version is on GitHub."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api/updates")


@router.get("")
async def update_status(svc: ServicesDep):
    """This version, the latest on GitHub as last checked, and whether it's an update."""
    return await asyncio.to_thread(svc.updates.status)


@router.post("/check")
async def check_now(svc: ServicesDep):
    """Check GitHub now (Settings → System → Check now), whether or not checking is turned on."""
    return await asyncio.to_thread(svc.updates.check)
