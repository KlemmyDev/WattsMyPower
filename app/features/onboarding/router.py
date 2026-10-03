"""The first-run guide's progress: GET to read it (deciding it for an install that's already set up), PATCH to mark it."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.dependencies import JsonBody, ServicesDep

router = APIRouter(prefix="/api/onboarding")


@router.get("")
async def get_onboarding(svc: ServicesDep):
    return await asyncio.to_thread(svc.onboarding.state)


@router.patch("")
async def patch_onboarding(svc: ServicesDep, changes: JsonBody):
    """Mark steps, finish, or put it off, e.g. {"steps": {"plan": "skipped"}} or {"complete": true}."""
    try:
        return await asyncio.to_thread(svc.onboarding.update, changes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
