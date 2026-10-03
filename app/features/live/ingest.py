"""
Follows the collector's feed (collector/PROTOCOL.md): decodes and merges each poll's raw
registers, writes the readings and their rollups, and keeps the live status current.

Where it has got to is stored in the database (kv `collector_cursor`), so after a restart, or the
collector having run on its own for a while, it catches up on everything it missed.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import time
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.features.inverters import drivers
from app.features.live.client import Feed
from app.features.live.service import LiveService
from app.features.live.transform import Freeze, Pv2Carry, behind_meter, snapshots
from app.features.readings.repository import ReadingsRepository

log = logging.getLogger(__name__)

CURSOR_KEY = "collector_cursor"
NO_INVERTER = "No inverter connected yet. Connect one in Settings → Integrations."
BATCH = 2000  # rows per request while catching up
WAIT = 30  # seconds to hold a request open for the next poll once caught up


def load_cursor(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM kv WHERE key = ?", (CURSOR_KEY,)).fetchone()
    return int(row[0]) if row else 0


def save_cursor(conn: sqlite3.Connection, ts: int) -> None:
    conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (CURSOR_KEY, str(ts)))
    conn.commit()


class CollectorIngest:
    def __init__(
        self,
        config: Config,
        db: Database,
        readings: ReadingsRepository,
        live: LiveService,
        client: Feed,
    ):
        self.config = config
        self.db = db
        self.readings = readings
        self.live = live
        self.client = client
        self.carry = Pv2Carry()
        self.freeze = Freeze()
        self.has_pv2 = False
        self.behind_meter = config.pv2_behind_meter
        self._hybrid: tuple[Any, Any] | None = None  # (host, driver) the details in live.info are from
        self._conn: sqlite3.Connection | None = None
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Open the write connection and start following the feed. Expects the database migrated already."""
        self._conn = conn = await asyncio.to_thread(self.db.connect)
        await asyncio.to_thread(self.readings.heal_rollups, conn)
        latest = await asyncio.to_thread(self.readings.latest)
        self.live.latest = latest and await asyncio.to_thread(self.readings.with_metered_today, latest)
        self._task = asyncio.create_task(self._run(conn))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self._conn:
            self._conn.close()

    # ------------------------------------------------------------------ status
    async def refresh(self) -> None:
        """Take in the collector's status now (after a device was connected or removed) rather than on the next poll."""
        self.apply_status(await asyncio.to_thread(self.client.status))
        self.live.publish()

    def apply_status(self, status: dict[str, Any]) -> None:
        """The collector's view of the devices: connection state and their details."""
        devices = status.get("devices") or {}
        h = devices.get("hybrid")
        if h is None:  # none connected yet (or it was removed): nothing to show about one
            self.live.last_success, self.live.last_error, self.live.info = None, NO_INVERTER, {}
            self.freeze = Freeze()
            self.live.frozen_since = None
        else:
            if (h.get("host"), h.get("driver")) != self._hybrid:  # another inverter: the old one's details don't apply
                self._hybrid, self.live.info = (h.get("host"), h.get("driver")), {}
                self.freeze = Freeze()
                self.live.frozen_since = None
            self.live.last_success = h.get("last_success")
            self.live.last_error = h.get("error")
            main = drivers.hybrid(h.get("driver"))
            decoded = main.decode_info(h.get("info") or {}) if main else {}
            if decoded:
                self.live.info = {**self.live.info, **decoded}
        p = devices.get("pv2")
        self.has_pv2 = p is not None
        self.behind_meter = behind_meter(p, self.config.pv2_behind_meter)
        if p is None:
            self.carry.info = {}
        self.live.pv2 = (
            None
            if p is None
            else {
                "host": p.get("host"),
                **self.carry.info,
                "behind_meter": self.behind_meter,
                "last_success": p.get("last_success"),
                "error": p.get("error"),
            }
        )

    # ------------------------------------------------------------------ the loop
    def _ingest(self, conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
        """Write a batch of collector rows. Returns the newest ts in it."""
        snaps = snapshots(
            rows,
            has_pv2=self.has_pv2,
            behind_meter=self.behind_meter,
            poll_interval=self.config.poll_interval,
            carry=self.carry,
            freeze=self.freeze,
        )
        self.readings.insert_many(conn, snaps)
        self.live.frozen_since = self.freeze.since
        if snaps:
            self.live.latest = self.readings.with_metered_today({"ts": snaps[-1][0], **snaps[-1][1]})
        newest = max(int(r["ts"]) for r in rows)
        save_cursor(conn, newest)
        return newest

    async def _run(self, conn: sqlite3.Connection) -> None:
        cfg = self.config
        cursor = await asyncio.to_thread(load_cursor, conn)
        backoff = 5
        last_prune = 0.0
        more = True  # catching up: don't wait for new polls until there's nothing left
        while True:
            try:
                self.apply_status(await asyncio.to_thread(self.client.status))
                rows, more = await asyncio.to_thread(self.client.readings, cursor, BATCH, 0 if more else WAIT)
                if rows:
                    cursor = await asyncio.to_thread(self._ingest, conn, rows)
                    if more:
                        log.info("Catching up on the collector's readings (up to %s)", time.ctime(cursor))
                backoff = 5
            except asyncio.CancelledError:
                raise
            except Exception as e:  # keep going no matter what: the collector may be restarting
                self.live.last_error = f"Collector not reachable ({type(e).__name__}: {e})"
                log.warning("%s; retrying in %ss", self.live.last_error, backoff)
                self.live.publish()
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, cfg.max_backoff)
                more = True
                continue
            if not more:
                self.live.publish()

            if time.time() - last_prune > 3600:
                last_prune = time.time()
                n = await asyncio.to_thread(self.readings.prune, conn)
                if n:
                    log.info("Pruned %d raw rows older than %d days", n, cfg.raw_retention_days)
