"""The FastAPI app: `uvicorn app.main:app`. Build one for tests with create_app(Config(...))."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

from app.container import build_services
from app.core.config import Config
from app.core.spa import mount_spa
from app.features.auth.middleware import AuthMiddleware
from app.features.auth.router import router as auth_router
from app.features.forecast.router import router as forecast_router
from app.features.insights.router import router as insights_router
from app.features.live.router import health_router
from app.features.live.router import router as live_router
from app.features.plans.router import router as plans_router
from app.features.readings.router import router as readings_router
from app.features.savings.router import router as savings_router
from app.features.settings.router import name_location
from app.features.settings.router import router as settings_router
from app.features.tariffs.router import router as tariffs_router

ROUTERS = [
    auth_router,
    live_router,
    readings_router,
    tariffs_router,
    settings_router,
    forecast_router,
    insights_router,
    savings_router,
    plans_router,
    health_router,
]


def create_app(config: Config | None = None, *, poll: bool = True, serve_dashboard: bool = True) -> FastAPI:
    """The app and its services. `poll=False` skips the inverter poller (for tests)."""
    config = config or Config.from_env()
    services = build_services(config)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(services.db.migrate)
        await asyncio.to_thread(services.settings.load)
        await asyncio.to_thread(services.tariffs.load)
        if poll:
            await services.poller.start()
            # In the background: a network lookup for the forecast location's place name.
            naming = asyncio.create_task(asyncio.to_thread(name_location, services))
        yield
        if poll:
            naming.cancel()
            await services.poller.stop()

    app = FastAPI(title="WattsMyPower", lifespan=lifespan)
    app.state.services = services
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(AuthMiddleware)
    for router in ROUTERS:
        app.include_router(router)
    if serve_dashboard:
        mount_spa(app)
    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
