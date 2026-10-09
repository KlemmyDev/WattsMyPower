"""Updates (Manage → System): whether a newer version is on GitHub, on the release channel followed."""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.dependencies import ServicesDep
from app.features.updates.service import UpdateRefused

router = APIRouter(prefix="/api/updates")


class ChannelBody(BaseModel):
    channel: Literal["nightly", "beta", "stable"]


@router.get("")
async def update_status(svc: ServicesDep):
    """This version, the latest on GitHub as last checked, and whether it's an update."""
    return await asyncio.to_thread(svc.updates.status)


@router.post("/check")
async def check_now(svc: ServicesDep):
    """Check GitHub now (Manage → System → Check now), whether or not checking is turned on."""
    return await asyncio.to_thread(svc.updates.check)


@router.put("/channel")
async def set_channel(body: ChannelBody, svc: ServicesDep):
    """Follow another release channel (Manage → System → Updates), and check it now."""
    try:
        return await asyncio.to_thread(svc.updates.set_channel, body.channel)
    except UpdateRefused as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.post("/install")
async def install(svc: ServicesDep):
    """Update now: ask updater.sh, on the host, to run install.sh, which installs the channel's version, newer or older
    (Manage → System → Update now)."""
    try:
        return await asyncio.to_thread(svc.updates.install)
    except UpdateRefused as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
