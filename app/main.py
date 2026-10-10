"""The FastAPI app: `uvicorn app.main:app`. Build one for tests with create_app(Config(...))."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import HTMLResponse

from app.container import build_services
from app.core.config import Config, ConfigError
from app.core.security import DOCS_POLICY, SecurityHeadersMiddleware
from app.core.spa import mount_spa
from app.core.version import VERSION
from app.features.amber.router import router as amber_router
from app.features.auth.middleware import AuthMiddleware
from app.features.auth.router import router as auth_router
from app.features.battery.router import router as battery_router
from app.features.bills.router import router as bills_router
from app.features.car.router import router as car_router
from app.features.forecast.router import router as forecast_router
from app.features.grid.router import router as grid_router
from app.features.home.router import router as home_router
from app.features.imports.router import router as imports_router
from app.features.insights.router import router as insights_router
from app.features.integrations.router import router as integrations_router
from app.features.live.router import health_router
from app.features.live.router import router as live_router
from app.features.meter.router import router as meter_router
from app.features.onboarding.router import router as onboarding_router
from app.features.plans.router import router as plans_router
from app.features.readings.router import router as readings_router
from app.features.settings.router import name_location
from app.features.settings.router import router as settings_router
from app.features.storage.router import router as storage_router
from app.features.tariffs.router import router as tariffs_router
from app.features.tesla.router import router as tesla_router
from app.features.updates.router import router as updates_router
from app.features.weather.router import router as weather_router

log = logging.getLogger(__name__)

ROUTERS = [
    auth_router,
    live_router,
    readings_router,
    tariffs_router,
    amber_router,
    settings_router,
    storage_router,
    forecast_router,
    weather_router,
    insights_router,
    integrations_router,
    onboarding_router,
    bills_router,
    meter_router,
    imports_router,
    plans_router,
    car_router,
    battery_router,
    tesla_router,
    home_router,
    health_router,
    updates_router,
    grid_router,
]


def create_app(config: Config | None = None, *, poll: bool = True, serve_dashboard: bool = True) -> FastAPI:
    """The app and its services. `poll=False` doesn't start following the collector (for tests)."""
    config = config or Config.from_env()
    services = build_services(config)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(services.db.keep_private)
        await asyncio.to_thread(services.db.migrate)
        if services.auth.enabled:
            await asyncio.to_thread(services.auth.prepare_setup_code)  # while there's no account yet
        else:
            log.warning(
                "Sign-in is turned off (AUTH=%s): anyone who can reach the dashboard can see it and change its "
                "settings. Only do this if something in front of it, such as a reverse proxy, handles sign-in.",
                os.environ.get("AUTH", "false"),
            )
        if await asyncio.to_thread(services.settings.seed_system):
            c = services.config
            log.info(
                "Moved the system details into the database (solar array %g kW, battery capacity %s, backup reserve "
                "%g%% if the inverter doesn't report one, maximum rate %g kW). They're changed in the dashboard from "
                "now on (Manage → System); PV_KW, BATTERY_KWH, BATTERY_RESERVE and BATTERY_MAX_KW are no longer read.",
                c.pv_kw,
                f"{c.battery_kwh:g} kWh" if c.battery_kwh else "from the inverter",
                c.battery_reserve,
                c.battery_max_kw,
            )
        await asyncio.to_thread(services.settings.load)
        await asyncio.to_thread(services.tariffs.load)
        await asyncio.to_thread(services.amber.load)
        if poll:
            await services.source.start()
            await services.amber.start()  # does nothing until an Amber account is connected
            await services.weather.start()  # the forecast, filling in past weather, and the forecast's learning
            await services.home.start()  # polls the smart-home accounts connected, if any
            await services.battery.start_loop()  # ends battery controls when they're done
            await services.updates.start()  # asks GitHub for a newer version every few hours, unless turned off
            await services.grid.start()  # AEMO's prices and notices for the region, unless turned off
            await services.outages.start()
            await services.hazards.start()  # the Bureau's and the Fire Department's warnings for the house  # the electricity network's outages around the house
            await services.tesla.start()  # reads and steers the Teslas, once they're connected (Tessie or Bluetooth)
            # In the background: a network lookup for the forecast location's place name.
            naming = asyncio.create_task(asyncio.to_thread(name_location, services))
        yield
        if poll:
            naming.cancel()
            await services.hazards.stop()
            await services.outages.stop()
            await services.grid.stop()
            await services.updates.stop()
            await services.tesla.stop()
            await services.battery.stop_loop()
            await services.home.stop()
            await services.weather.stop()
            await services.amber.stop()
            await services.source.stop()

    # The API's documentation is only served with API_DOCS=1, and then under /api, so it needs signing in too.
    app = FastAPI(
        title="WattsMyPower",
        version=VERSION,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if config.api_docs else None,
    )
    app.state.services = services
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(AuthMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)  # outermost, so even refusals carry the headers
    for router in ROUTERS:
        app.include_router(router)
    if config.api_docs:
        add_docs(app)
    if serve_dashboard:
        mount_spa(app)
    return app


def add_docs(app: FastAPI) -> None:
    """/api/docs and /api/redoc, which load their viewers from a CDN (hence their own, looser policy)."""
    headers = {"Content-Security-Policy": DOCS_POLICY}

    @app.get("/api/docs", include_in_schema=False)
    async def docs() -> HTMLResponse:
        page = get_swagger_ui_html(openapi_url="/api/openapi.json", title="WattsMyPower API")
        return HTMLResponse(bytes(page.body).decode(), headers=headers)

    @app.get("/api/redoc", include_in_schema=False)
    async def redoc() -> HTMLResponse:
        page = get_redoc_html(openapi_url="/api/openapi.json", title="WattsMyPower API")
        return HTMLResponse(bytes(page.body).decode(), headers=headers)


# Files the app creates (its database, backups, the set-up code) are readable by its own user only.
os.umask(0o077)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# LOG_DEBUG: loggers to turn up to DEBUG, comma-separated ("tesla_fleet_api,bleak"), to see what a device says
# message by message when the INFO log doesn't say why something failed.
for _name in filter(None, (n.strip() for n in os.environ.get("LOG_DEBUG", "").split(","))):
    logging.getLogger(_name).setLevel(logging.DEBUG)
try:
    app = create_app()
except ConfigError as e:  # a mistyped setting: say which, once, rather than a traceback on every restart
    raise SystemExit(f"WattsMyPower can't start. {e}") from None
