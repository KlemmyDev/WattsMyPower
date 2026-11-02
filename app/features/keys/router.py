"""Making and removing API keys (signed in only), and the read-only /api/v1 that a key opens.

/api/v1 sits outside the dashboard's sign-in (see AuthMiddleware.OPEN): an app has no session cookie, so each route
asks for a key instead, and one that may read what the route gives. The routes only ever read.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse

from app.dependencies import JsonBody, ServicesDep, time_range
from app.features.keys.service import DEFAULT_SCOPES, SCOPES, ApiKey
from app.features.readings.router import export_csv as export_csv_rows
from app.features.tariffs.costs import daily_costs

router = APIRouter(prefix="/api")
v1 = APIRouter(prefix="/api/v1")


# --- making and removing keys (the dashboard's own, so behind its sign-in)


@router.get("/keys")
async def list_keys(svc: ServicesDep):
    """The keys made so far (never the keys themselves), and the permissions a key can be given."""
    keys = await asyncio.to_thread(svc.keys.all)
    return {
        "keys": [k.public() for k in keys],
        "scopes": [{"id": s, "name": n, "about": a, "default": s in DEFAULT_SCOPES} for s, (n, a) in SCOPES.items()],
    }


@router.post("/keys")
async def make_key(svc: ServicesDep, body: JsonBody):
    """Make a key. The whole key is in this answer only: it can't be shown again."""
    scopes = body.get("scopes")
    if scopes is not None and not (isinstance(scopes, list) and all(isinstance(s, str) for s in scopes)):
        raise HTTPException(status_code=422, detail="Permissions should be a list.")
    try:
        made, key = await asyncio.to_thread(svc.keys.make, str(body.get("name") or ""), scopes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return JSONResponse({**made.public(), "key": key}, headers={"Cache-Control": "no-store"})


@router.delete("/keys/{key_id}")
async def remove_key(svc: ServicesDep, key_id: str):
    if not await asyncio.to_thread(svc.keys.remove, key_id):
        raise HTTPException(status_code=404, detail="That key has gone already.")
    return {"ok": True}


# --- the read-only API


def _key(svc: ServicesDep, authorization: Annotated[str | None, Header()] = None) -> ApiKey:
    word, _, token = (authorization or "").partition(" ")
    found = svc.keys.check(token.strip()) if word.lower() == "bearer" else None
    if found is None:
        raise HTTPException(
            status_code=401,
            detail="Send a key as: Authorization: Bearer wmp_...",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return found


KeyDep = Annotated[ApiKey, Depends(_key)]


def reading(scope: str) -> Callable[[ApiKey], ApiKey]:
    """A route's check that the key may read `scope`."""

    def check(key: KeyDep) -> ApiKey:
        if scope not in key.scopes:
            raise HTTPException(
                status_code=403,
                detail=f"This key can't read {SCOPES[scope][0].lower()}. Make a key with that permission.",
            )
        return key

    return check


def _live(svc: ServicesDep) -> dict[str, Any]:
    """The live figures without the system's own details, the app's version or the car (their own permissions)."""
    return {k: v for k, v in svc.live.status().items() if k not in ("system", "app", "ev")}


@v1.get("/ping")
async def ping(svc: ServicesDep, key: KeyDep):
    """Who the key is, what it may read, and whether the inverter is answering."""
    live = svc.live
    fresh = live.last_success and time.time() - live.last_success < max(120, svc.config.poll_interval * 6)
    return {
        "app": "WattsMyPower",
        "key": {"name": key.name, "scopes": list(key.scopes)},
        "inverter_fresh": bool(fresh),
        "mock": svc.config.mock,
        "now": int(time.time()),
    }


@v1.get("/live")
async def live(svc: ServicesDep, key: Annotated[ApiKey, Depends(reading("live:read"))]):
    """Power right now: the latest reading and today's counters."""
    return _live(svc)


@v1.get("/today")
async def today(svc: ServicesDep, key: Annotated[ApiKey, Depends(reading("live:read"))]):
    """One answer for a widget: the live figures, and (if the key may read costs) today's cost and savings."""
    out: dict[str, Any] = {"live": _live(svc)}
    if "costs:read" in key.scopes:
        start = int(time.mktime(time.strptime(time.strftime("%Y-%m-%d"), "%Y-%m-%d")))
        t, tables = svc.tariffs.current()
        days = await asyncio.to_thread(
            daily_costs, svc.readings, t, tables, start, int(time.time()) + 1, svc.meter, svc.amber.repo
        )
        rows = days.get("days") if isinstance(days, dict) else None
        out["costs"] = rows[-1] if rows else None
    return out


@v1.get("/history")
async def history(
    svc: ServicesDep,
    key: Annotated[ApiKey, Depends(reading("history:read"))],
    start: int | None = Query(None, description="unix seconds"),
    end: int | None = Query(None, description="unix seconds"),
    points: int = Query(1200, ge=10, le=10000, description="approximate max points returned"),
    fields: str = Query("pv_power,load_power,grid_power,battery_power,battery_soc"),
):
    start, end = time_range(start, end, 86400)
    return await asyncio.to_thread(svc.readings.history, start, end, points, fields.split(","))


@v1.get("/daily")
async def daily(
    svc: ServicesDep,
    key: Annotated[ApiKey, Depends(reading("history:read"))],
    start: int | None = None,
    end: int | None = None,
):
    start, end = time_range(start, end, 30 * 86400)
    return await asyncio.to_thread(svc.readings.daily, start, end)


@v1.get("/export.csv")
async def export_csv(
    svc: ServicesDep,
    key: Annotated[ApiKey, Depends(reading("history:read"))],
    start: int | None = None,
    end: int | None = None,
    rollup: bool = False,
) -> StreamingResponse:
    return await export_csv_rows(svc, start, end, rollup)


@v1.get("/costs")
async def costs(
    svc: ServicesDep,
    key: Annotated[ApiKey, Depends(reading("costs:read"))],
    start: int | None = None,
    end: int | None = None,
):
    start, end = time_range(start, end, 86400)
    t, tables = svc.tariffs.current()
    return await asyncio.to_thread(daily_costs, svc.readings, t, tables, start, end, svc.meter, svc.amber.repo)


@v1.get("/tariff")
async def tariff(svc: ServicesDep, key: Annotated[ApiKey, Depends(reading("costs:read"))]):
    return svc.tariffs.get()


@v1.get("/bills")
async def bills(svc: ServicesDep, key: Annotated[ApiKey, Depends(reading("costs:read"))]):
    return await asyncio.to_thread(svc.bills.build, int(time.time()))


@v1.get("/forecast")
async def forecast(svc: ServicesDep, key: Annotated[ApiKey, Depends(reading("forecast:read"))]):
    live = svc.live
    return await asyncio.to_thread(svc.forecast.build, live.latest, live.battery_kwh(), live.reserve())


@v1.get("/insights")
async def insights(svc: ServicesDep, key: Annotated[ApiKey, Depends(reading("insights:read"))]):
    live = svc.live
    return await asyncio.to_thread(svc.insights.build, live.latest, live.battery_kwh(), live.reserve())


@v1.get("/system")
async def system(svc: ServicesDep, key: Annotated[ApiKey, Depends(reading("system:read"))]):
    """The system's own details, the saved settings (location, system cost) and what the database holds."""
    return {
        "system": svc.live.system(),
        "settings": svc.settings.all_values(),
        "storage": await asyncio.to_thread(svc.readings.stats),
    }


__all__ = ["router", "v1"]
