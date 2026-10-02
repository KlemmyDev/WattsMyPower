"""
The collector's HTTP feed (see PROTOCOL.md): `python -m collector`, or `uvicorn collector.main:app`.
Build one for tests with create_app(Config(...), hybrid=..., poll=False).
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, Response

from collector.config import Config
from collector.devices import Device
from collector.devices.drivers import build_devices
from collector.devices.sungrow.mock import backfill
from collector.poller import Poller
from collector.store import Row, Store

log = logging.getLogger(__name__)

PROTOCOL_VERSION = 1
DEFAULT_LIMIT, MAX_LIMIT = 1000, 5000
MAX_WAIT = 30.0
MOCK_BACKFILL_DAYS = 7


def _row_json(r: Row) -> str:
    """A row as JSON, splicing in the stored word objects as they are (they're JSON already)."""
    holding = "" if r.holding is None else f',"holding":{r.holding}'
    return f'{{"ts":{r.ts},"device":{json.dumps(r.device)},"driver":{json.dumps(r.driver)},"input":{r.input}{holding}}}'


def require_token(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    token: str = request.app.state.config.token
    if not token:
        raise HTTPException(503, "The feed is disabled: set COLLECTOR_TOKEN (and give the API the same token)")
    scheme, _, given = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(given.strip().encode(), token.encode()):
        raise HTTPException(401, "Missing or wrong token", headers={"WWW-Authenticate": "Bearer"})


router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])


@router.get("/readings")
async def readings(request: Request, since: int = 0, limit: int = DEFAULT_LIMIT, wait: float = 0) -> Response:
    """Rows after `since`. With nothing new and `wait` > 0, holds the request until the next poll lands."""
    store: Store = request.app.state.store
    poller: Poller = request.app.state.poller
    limit = min(max(limit, 1), MAX_LIMIT)
    wait = min(max(wait, 0.0), MAX_WAIT)
    landed = poller.landed()  # before looking, so a poll landing meanwhile isn't missed
    rows, more = await asyncio.to_thread(store.since, since, limit)
    if not rows and wait > 0:
        with suppress(TimeoutError):
            await asyncio.wait_for(landed.wait(), wait)
            rows, more = await asyncio.to_thread(store.since, since, limit)
    body = '{"readings":[' + ",".join(map(_row_json, rows)) + '],"more":' + ("true" if more else "false") + "}"
    return Response(body, media_type="application/json")


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    store: Store = request.app.state.store
    poller: Poller = request.app.state.poller
    oldest, latest = await asyncio.to_thread(store.bounds)
    return {
        "version": PROTOCOL_VERSION,
        "poll_interval": poller.config.poll_interval,
        "started_at": poller.started_at,
        "oldest_ts": oldest,
        "latest_ts": latest,
        "devices": {name: st.as_json() for name, st in poller.status.items()},
    }


health_router = APIRouter()


@health_router.get("/healthz")
async def healthz(request: Request) -> dict[str, bool]:
    poller: Poller = request.app.state.poller
    return {"ok": True, "fresh": poller.hybrid_fresh()}


def create_app(
    config: Config | None = None, *, hybrid: Device | None = None, pv2: Device | None = None, poll: bool = True
) -> FastAPI:
    """The feed and its poller. Devices default to the configured inverters (or mocks);
    `poll=False` doesn't start the loop (tests drive `app.state.poller.poll_once()` themselves)."""
    config = config or Config.from_env()
    if hybrid is None:
        hybrid, pv2 = build_devices(config)
    store = Store(config.db_path, config.retention_days)
    poller = Poller(config, store, hybrid, pv2)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(store.migrate)
        if not config.token:
            log.warning("COLLECTOR_TOKEN is not set: /v1/* will refuse every request (503) until it is")
        if config.mock and await asyncio.to_thread(store.is_empty):
            await asyncio.to_thread(backfill, store, poller.devices, config.poll_interval, MOCK_BACKFILL_DAYS)
        if poll:
            await poller.start()
        yield
        await poller.stop()

    app = FastAPI(title="WattsMyPower collector", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config, app.state.store, app.state.poller = config, store, poller
    app.include_router(router)
    app.include_router(health_router)
    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
