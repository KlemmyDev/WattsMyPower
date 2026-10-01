from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, forecast, geocode, insights, plans, savings, settings, tariffs
from .poller import Poller

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
STATIC = Path(__file__).resolve().parent.parent / "static"
poller = Poller()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await poller.start()
    asyncio.create_task(asyncio.to_thread(_name_location))  # in the background: it's a network lookup
    yield
    await poller.stop()


app = FastAPI(title="WattsMyPower", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)


def _range(start: Optional[int], end: Optional[int], default_span: int) -> tuple[int, int]:
    end = end or int(time.time()) + 1
    start = start if start is not None else end - default_span
    return start, end


@app.get("/api/live")
async def live():
    return poller.status()


@app.get("/api/stream")
async def stream(request: Request):
    """Server-sent events: one message per poll."""
    q = poller.subscribe()

    async def events():
        try:
            yield f"data: {json.dumps(poller.status())}\n\n"
            while not await request.is_disconnected():
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            poller.unsubscribe(q)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/history")
async def history(
    start: Optional[int] = Query(None, description="unix seconds"),
    end: Optional[int] = Query(None, description="unix seconds"),
    points: int = Query(1200, ge=10, le=10000, description="approximate max points returned"),
    fields: str = Query("pv_power,load_power,grid_power,battery_power,battery_soc"),
):
    start, end = _range(start, end, 86400)
    return await asyncio.to_thread(db.history, start, end, points, fields.split(","))


@app.get("/api/daily")
async def daily(start: Optional[int] = None, end: Optional[int] = None):
    start, end = _range(start, end, 30 * 86400)
    return await asyncio.to_thread(db.daily, start, end)


@app.get("/api/export.csv")
async def export_csv(start: Optional[int] = None, end: Optional[int] = None, rollup: bool = False):
    """Download raw snapshots (or 5-minute rollups) as CSV."""
    start, end = _range(start, end, 86400)

    def rows():
        buf = io.StringIO()
        w = csv.writer(buf)
        for row in db.export_rows(start, end, rollup):
            w.writerow(row)
            if buf.tell() > 64_000:
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate()
        yield buf.getvalue()

    name = f"wattsmypower_{time.strftime('%Y%m%d', time.localtime(start))}-{time.strftime('%Y%m%d', time.localtime(end))}.csv"
    return StreamingResponse(rows(), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/forecast")
async def get_forecast():
    """Next ~24 h of solar and battery, from Open-Meteo plus our own history. null if unavailable."""
    return await asyncio.to_thread(forecast.build, poller.latest, poller.battery_kwh(), poller.reserve())


@app.get("/api/insights")
async def get_insights():
    """Self-sufficiency by month, battery figures, grid use by hour and month, and solar performance."""
    return await asyncio.to_thread(insights.build, poller.latest, poller.battery_kwh())


@app.get("/api/savings")
async def get_savings():
    """This quarter's bill (so far and estimated) and system payback."""
    return await asyncio.to_thread(savings.build, poller.latest)


@app.get("/api/plans/compare")
async def plan_compare(brand: str, postcode: str):
    """A year of your actual usage priced on each of a retailer's published plans, cheapest first."""
    try:
        return await asyncio.to_thread(savings.compare, brand, postcode)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"The retailer's plan data could not be loaded ({type(e).__name__}). Try again shortly.")


@app.get("/api/tariff")
async def get_tariff():
    return tariffs.get()


@app.put("/api/tariff")
async def put_tariff(tariff: dict = Body(...)):
    """Replace the tariff. Validated (including overlapping time windows); errors come back as 422 with a readable message."""
    try:
        return await asyncio.to_thread(tariffs.save, tariff)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.get("/api/plans/brands")
async def plan_brands():
    """Energy retailers from the CDR Register (cached for a day)."""
    try:
        return [{"id": b["id"], "name": b["name"]} for b in await asyncio.to_thread(plans.brands)]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"The retailer list could not be loaded ({type(e).__name__}).")


@app.get("/api/plans/search")
async def plan_search(brand: str, postcode: str, q: str = ""):
    """A retailer's current residential electricity plans available at a postcode, with headline prices (incl. GST)."""
    try:
        return await asyncio.to_thread(plans.search, brand, postcode, q)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"The retailer's plan data could not be loaded ({type(e).__name__}). Try again shortly.")


@app.get("/api/plans/tariff")
async def plan_tariff(brand: str, plan: str):
    """Convert one published plan into a tariff for the editor. Not saved until PUT /api/tariff."""
    try:
        return await asyncio.to_thread(plans.to_tariff, brand, plan)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"The plan could not be loaded ({type(e).__name__}). Try again shortly.")


@app.get("/api/costs")
async def get_costs(start: Optional[int] = None, end: Optional[int] = None):
    """Per-day import/export, costs and savings, priced at the rate in force for each 5 minutes."""
    start, end = _range(start, end, 86400)
    return await asyncio.to_thread(tariffs.costs, start, end)


@app.get("/api/settings")
async def get_settings():
    return settings.all_values()


@app.put("/api/settings")
async def put_settings(changes: dict = Body(...)):
    """Save the forecast location (and its place name) or system cost. Only keys in settings.EDITABLE / TEXT are accepted."""
    moved = ("latitude" in changes or "longitude" in changes) and "location_name" not in changes
    if moved:
        changes = {**changes, "location_name": None}  # the old name no longer applies
    try:
        saved = await asyncio.to_thread(settings.save, changes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if moved:  # coordinates typed in by hand: look up a place name for them
        saved = await asyncio.to_thread(_name_location) or saved
    return saved


def _name_location() -> dict | None:
    """Give the forecast location a place name if it doesn't have one yet."""
    if settings.get_text("location_name"):
        return None
    name = geocode.reverse(settings.get("latitude"), settings.get("longitude"))
    return settings.save({"location_name": name}) if name else None


@app.get("/api/geocode")
async def search_places(q: str):
    """Suburbs, towns and addresses matching q, for choosing the forecast location (OpenStreetMap)."""
    try:
        return await asyncio.to_thread(geocode.search, q)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"The place search couldn't be reached ({type(e).__name__}). Try again, or enter coordinates instead.")


@app.get("/api/stats")
async def stats():
    return await asyncio.to_thread(db.stats)


@app.get("/healthz")
async def healthz():
    fresh = poller.last_success and time.time() - poller.last_success < max(120, config.POLL_INTERVAL * 6)
    return {"ok": True, "inverter_fresh": bool(fresh), "error": poller.last_error}


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


class RevalidatedStatic(StaticFiles):
    """Static files that browsers re-check (cheaply, via ETag) so updates show up without a hard refresh."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


app.mount("/static", RevalidatedStatic(directory=STATIC), name="static")
