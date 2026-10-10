"""Manage → Data: what's stored in the dashboard's and the collector's databases, how much room it takes, and a backup."""

from __future__ import annotations

import asyncio
import sqlite3
import urllib.parse

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.dependencies import ServicesDep
from app.features.storage.backup import Busy, send

router = APIRouter(prefix="/api")


@router.get("/storage")
async def storage(svc: ServicesDep, fresh: bool = False):
    """Both databases, table by table. Reuses a measure from the last few minutes unless `fresh`."""
    return await asyncio.to_thread(svc.storage.report, fresh)


@router.get("/storage/backup")
async def backup(svc: ServicesDep, everything: bool = False) -> StreamingResponse:
    """A zip of the dashboard's database, and with `everything` the collector's too, to download (see backup.py).
    It's made before the first byte is sent, which takes a while with a large collector database. When the
    collector's was asked for but isn't in it, X-Backup-Skipped says why (URL-encoded). 409 while another is made."""
    try:
        made = await asyncio.to_thread(svc.storage.backups.make, everything)
    except Busy:
        raise HTTPException(409, "A backup is already being made. Try again once it's downloaded.") from None
    except sqlite3.Error as e:
        raise HTTPException(500, f"The dashboard's database couldn't be copied: {e}") from e
    except OSError as e:
        raise HTTPException(507, f"The backup couldn't be written on the server ({e.strerror or e}).") from e
    headers = {
        "Content-Length": str(made.size),
        "Content-Disposition": f'attachment; filename="{made.name}"',
        "Cache-Control": "no-store",  # it holds saved passwords and tokens
    }
    if made.skipped:
        headers["X-Backup-Skipped"] = urllib.parse.quote(made.skipped)
    return StreamingResponse(
        send(made.path, made.done),
        media_type="application/zip",
        headers=headers,
        background=BackgroundTask(made.done),  # in case the download stops before the first chunk is read
    )
