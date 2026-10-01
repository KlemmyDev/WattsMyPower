"""Recorded readings: chart series, daily totals, CSV export and storage stats."""

from __future__ import annotations

import asyncio
import csv
import io
import time
from collections.abc import Iterator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.dependencies import ServicesDep, time_range

router = APIRouter(prefix="/api")


@router.get("/history")
async def history(
    svc: ServicesDep,
    start: int | None = Query(None, description="unix seconds"),
    end: int | None = Query(None, description="unix seconds"),
    points: int = Query(1200, ge=10, le=10000, description="approximate max points returned"),
    fields: str = Query("pv_power,load_power,grid_power,battery_power,battery_soc"),
):
    start, end = time_range(start, end, 86400)
    return await asyncio.to_thread(svc.readings.history, start, end, points, fields.split(","))


@router.get("/daily")
async def daily(svc: ServicesDep, start: int | None = None, end: int | None = None):
    start, end = time_range(start, end, 30 * 86400)
    return await asyncio.to_thread(svc.readings.daily, start, end)


@router.get("/export.csv")
async def export_csv(svc: ServicesDep, start: int | None = None, end: int | None = None, rollup: bool = False):
    """Download raw snapshots (or 5-minute rollups) as CSV."""
    start, end = time_range(start, end, 86400)

    def rows() -> Iterator[str]:
        buf = io.StringIO()
        w = csv.writer(buf)
        for row in svc.readings.export_rows(start, end, rollup):
            w.writerow(row)
            if buf.tell() > 64_000:
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate()
        yield buf.getvalue()

    day = lambda ts: time.strftime("%Y%m%d", time.localtime(ts))  # noqa: E731
    name = f"wattsmypower_{day(start)}-{day(end)}.csv"
    return StreamingResponse(
        rows(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


@router.get("/stats")
async def stats(svc: ServicesDep):
    return await asyncio.to_thread(svc.readings.stats)
