"""Mock mode (MOCK=1): generated readings instead of a collector, for working on the app without hardware."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import time

from app.core.config import Config
from app.core.database import Database
from app.features.inverters.sungrow.mock import MockInverter
from app.features.live.service import LiveService
from app.features.readings.repository import ReadingsRepository

log = logging.getLogger(__name__)


class Simulator:
    def __init__(self, config: Config, db: Database, readings: ReadingsRepository, live: LiveService):
        self.config = config
        self.db = db
        self.readings = readings
        self.live = live
        self.inverter = MockInverter()
        self._conn: sqlite3.Connection | None = None
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._conn = conn = await asyncio.to_thread(self.db.connect)
        await asyncio.to_thread(self.readings.heal_rollups, conn)
        if await asyncio.to_thread(self.readings.is_empty, conn):
            await asyncio.to_thread(self._backfill, conn, 14)
        self.live.info = dict(self.inverter.info)
        self.live.latest = await asyncio.to_thread(self.readings.latest)
        self._task = asyncio.create_task(self._run(conn))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self._conn:
            self._conn.close()

    def _backfill(self, conn: sqlite3.Connection, days: int) -> None:
        log.info("Mock mode: generating %d days of history", days)
        now = int(time.time())
        step = self.config.poll_interval
        self.readings.insert_many(
            conn, [(ts, self.inverter.simulate(ts)) for ts in range(now - days * 86400, now, step)]
        )

    async def _run(self, conn: sqlite3.Connection) -> None:
        while True:
            started = time.monotonic()
            snap = self.inverter.read_snapshot()
            ts = int(time.time())
            await asyncio.to_thread(self.readings.insert, conn, ts, snap)
            self.live.latest = {"ts": ts, **snap}
            self.live.last_success, self.live.last_error = time.time(), None
            wait = max(0.0, self.config.poll_interval - (time.monotonic() - started))
            self.live.next_poll = time.time() + wait
            self.live.publish()
            await asyncio.sleep(wait)
