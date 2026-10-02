"""The live reading (fetched, or streamed as server-sent events) and the health check."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api")
health_router = APIRouter()


@router.get("/live")
async def live_status(svc: ServicesDep):
    return svc.live.status()


@router.get("/stream")
async def stream(request: Request, svc: ServicesDep) -> StreamingResponse:
    """Server-sent events: one message per poll."""
    live = svc.live
    q = live.subscribe()

    async def events() -> AsyncIterator[str]:
        try:
            yield f"data: {json.dumps(live.status())}\n\n"
            while not await request.is_disconnected():
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(msg)}\n\n"
                except TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            live.unsubscribe(q)

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@health_router.get("/healthz")
async def healthz(svc: ServicesDep):
    live = svc.live
    fresh = live.last_success and time.time() - live.last_success < max(120, svc.config.poll_interval * 6)
    return {"ok": True, "inverter_fresh": bool(fresh), "error": live.last_error}
