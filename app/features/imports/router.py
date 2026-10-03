"""Importing history from iSolarCloud exports (Settings → Import)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.container import Services
from app.dependencies import ServicesDep
from app.features.imports.files import UnreadableFile
from app.features.imports.isolarcloud import NotACurve

router = APIRouter(prefix="/api/imports")

MAX_BYTES = 50 * 1024 * 1024


async def _file(request: Request) -> bytes:
    """The upload, sent as the request body itself (no multipart: the dashboard posts the File as is)."""
    if int(request.headers.get("content-length") or 0) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="This file is too large to import. Export a shorter date range.")
    data = await request.body()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="This file is too large to import. Export a shorter date range.")
    if not data:
        raise HTTPException(status_code=422, detail="The file is empty.")
    return data


def _overrides(columns: str | None) -> dict[str, list[str]] | None:
    """Columns chosen by hand, as JSON {field: [header, ...]}."""
    if not columns:
        return None
    try:
        parsed = json.loads(columns)
        return {str(f): [str(h) for h in (hs if isinstance(hs, list) else [hs]) if h] for f, hs in parsed.items()}
    except (ValueError, AttributeError) as e:
        raise HTTPException(status_code=422, detail="The column choices couldn't be read.") from e


async def _guarded(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except (UnreadableFile, NotACurve) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


def _changed(svc: Services) -> None:
    svc.insights.forget_history()


@router.post("/preview")
async def preview(svc: ServicesDep, request: Request, name: str = "export", columns: str | None = None):
    """What an export holds and what importing it would change. Writes nothing."""
    return await _guarded(svc.imports.preview, name, await _file(request), _overrides(columns))


@router.post("")
async def run(
    svc: ServicesDep,
    request: Request,
    name: str = "export",
    columns: str | None = None,
    into: int | None = None,
    label: str | None = None,
    replace: bool = False,
):
    """
    Import an export's readings where the dashboard has none of its own, or with `replace`, in place of what it
    recorded too (before today). `into` adds the file to an earlier import.
    """
    result = await _guarded(svc.imports.run, name, await _file(request), _overrides(columns), into, label, replace)
    _changed(svc)
    return result


@router.get("")
async def list_imports(svc: ServicesDep):
    return await asyncio.to_thread(svc.imports.list)


@router.delete("/{import_id}")
async def remove(svc: ServicesDep, import_id: int):
    removed = await asyncio.to_thread(svc.imports.remove, import_id)
    _changed(svc)
    return {"removed": removed}
