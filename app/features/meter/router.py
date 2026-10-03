"""Smart-meter data (Settings → Billing): preview and import NEM12 files, list and remove imports, compare.

Files are sent as the raw request body (Content-Type: application/octet-stream) with the file's
name as a query parameter: the API doesn't depend on a multipart form parser.
"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Request

from app.dependencies import ServicesDep
from app.features.meter.nem12 import Nem12Error

router = APIRouter(prefix="/api/meter")

MAX_BYTES = 32 * 1024 * 1024  # years of five-minute data from several channels fits in a few MB


async def _file(request: Request) -> bytes:
    """The uploaded file, or a readable 413/422 if it's empty or too large to be meter data."""
    size = request.headers.get("content-length")
    if size and size.isdigit() and int(size) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="That file is too large to be meter data (over 32 MB).")
    data = await request.body()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="That file is too large to be meter data (over 32 MB).")
    if not data.strip():
        raise HTTPException(status_code=422, detail="That file is empty.")
    return data


@router.post("/preview")
async def preview(svc: ServicesDep, request: Request, filename: str | None = None):
    """What a NEM12 file holds and which imported days it would replace, without importing it."""
    data = await _file(request)
    try:
        return await asyncio.to_thread(svc.meter.preview, data, filename)
    except Nem12Error as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.post("/imports")
async def import_file(svc: ServicesDep, request: Request, filename: str | None = None):
    """Import a NEM12 file. Readings for days already imported are replaced by the file's."""
    data = await _file(request)
    try:
        return await asyncio.to_thread(svc.meter.import_file, data, filename, int(time.time()))
    except Nem12Error as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.get("/imports")
async def imports(svc: ServicesDep):
    return await asyncio.to_thread(svc.meter.imports)


@router.delete("/imports/{import_id}")
async def remove(svc: ServicesDep, import_id: int):
    if not await asyncio.to_thread(svc.meter.remove, import_id):
        raise HTTPException(status_code=404, detail="That import has already been removed.")
    return {"removed": True}


@router.get("/reconcile")
async def reconcile(svc: ServicesDep, start: int | None = None, end: int | None = None):
    """The meter's daily import and export against the dashboard's, for the days the meter data covers."""
    return await asyncio.to_thread(svc.meter.reconcile, start, end)
