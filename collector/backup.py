"""
A copy of the collector's database, for the dashboard's backups (GET /v1/backup, used by Manage → Data).

The copy is made with SQLite's online backup, not by copying the file: polls keep writing while it's made, and the
file on its own misses whatever is still in the write-ahead log. It's taken in one step, so it's the database as it
was at one moment, written to a temporary folder, sent, then deleted. The dashboard copies its own database the same
way (app/features/storage/backup.py; the collector's image doesn't include the dashboard's code).
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sqlite3
import tempfile
import time
from collections.abc import AsyncIterator, Callable
from contextlib import closing
from glob import glob

PREFIX = "wattsmypower-collector-backup-"
CHUNK = 1 << 20  # bytes read and sent at a time
STALE = 3600  # seconds after which a temporary folder is a leftover from a copy cut short


def snapshot(src: str, dest: str) -> None:
    """Copy the database at `src` to a new file `dest`: consistent while it's written to, and one file on its own (its
    journal switched from the write-ahead log back to the default, so there's no -wal file to keep with it)."""
    with closing(sqlite3.connect(f"file:{src}?mode=ro", uri=True)) as source, closing(sqlite3.connect(dest)) as copy:
        source.execute("PRAGMA busy_timeout=5000")
        source.backup(copy)
        copy.execute("PRAGMA journal_mode=DELETE")


def folder() -> str:
    """A new temporary folder for a copy, after deleting any an earlier copy left behind (one stopped by a restart)."""
    for old in glob(os.path.join(tempfile.gettempdir(), f"{PREFIX}*")):
        if os.path.getmtime(old) < time.time() - STALE:
            shutil.rmtree(old, ignore_errors=True)
    return tempfile.mkdtemp(prefix=PREFIX)


def once(*steps: Callable[[], object]) -> Callable[[], None]:
    """A function that runs `steps` in order the first time it's called, and does nothing after."""
    pending = list(steps)

    def run() -> None:
        while pending:
            pending.pop(0)()

    return run


async def send(path: str, done: Callable[[], None]) -> AsyncIterator[bytes]:
    """The file in chunks, read off the event loop. `done` runs once it's all sent, or the download stops."""
    try:
        with open(path, "rb") as f:
            while chunk := await asyncio.to_thread(f.read, CHUNK):
                yield chunk
    finally:
        done()
