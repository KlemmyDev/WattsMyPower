"""Background loop: read the inverter, store the snapshot, fan it out to live clients."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import time
from typing import Any, Protocol

from app.core.config import Config
from app.core.database import Database
from app.features.inverters.hybrid import Snapshot, SungrowInverter
from app.features.inverters.merge import merge_pv2
from app.features.inverters.mock import MockInverter
from app.features.inverters.string import StringInverter
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore

log = logging.getLogger(__name__)

Status = dict[str, Any]


class Inverter(Protocol):
    """What the poller needs from the hybrid inverter: SungrowInverter, or MockInverter in mock mode."""

    info: dict[str, Any]

    @property
    def model(self) -> str | None: ...

    @property
    def battery_kwh(self) -> float | None: ...

    def read_snapshot(self) -> Snapshot: ...


class Poller:
    def __init__(
        self,
        config: Config,
        db: Database,
        readings: ReadingsRepository,
        settings: SettingsStore,
        tariffs: TariffStore,
    ):
        self.config = config
        self.db = db
        self.readings = readings
        self.settings = settings
        self.tariffs = tariffs
        self.inverter: Inverter = (
            MockInverter()
            if config.mock
            else SungrowInverter(config.inverter_host, config.inverter_port, config.inverter_unit)
        )
        self.conn: sqlite3.Connection | None = None
        self.latest: Snapshot | None = None
        self.last_error: str | None = None
        self.last_success: float | None = None
        self._subscribers: set[asyncio.Queue[Status]] = set()
        self._task: asyncio.Task[None] | None = None
        self.pv2 = (
            StringInverter(config.pv2_host, config.pv2_port, config.pv2_unit)
            if config.pv2_host and not config.mock
            else None
        )
        self.pv2_last: tuple[float, dict[str, float | None]] | None = None  # (time, values) of the last good read
        self.pv2_error: str | None = None
        self.pv2_success: float | None = None

    # -- live fan-out ---------------------------------------------------------
    def subscribe(self) -> asyncio.Queue[Status]:
        q: asyncio.Queue[Status] = asyncio.Queue(maxsize=10)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[Status]) -> None:
        self._subscribers.discard(q)

    def _publish(self, msg: Status) -> None:
        for q in list(self._subscribers):
            if q.full():  # slow client: drop its oldest message rather than block everyone
                q.get_nowait()
            q.put_nowait(msg)

    # -- lifecycle ------------------------------------------------------------
    async def start(self) -> None:
        """Open the poller's write connection and start polling. Expects the database migrated already."""
        self.conn = conn = await asyncio.to_thread(self.db.connect)
        await asyncio.to_thread(self.readings.heal_rollups, conn)
        if self.config.mock and await asyncio.to_thread(self.readings.is_empty, conn):
            await asyncio.to_thread(self._mock_backfill, conn, 14)
        self.latest = await asyncio.to_thread(self.readings.latest)
        self._task = asyncio.create_task(self._run(conn))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self.conn:
            self.conn.close()

    def _mock_backfill(self, conn: sqlite3.Connection, days: int) -> None:
        assert isinstance(self.inverter, MockInverter)
        log.info("Mock mode: generating %d days of history", days)
        now = int(time.time())
        rows = [(ts, self.inverter.simulate(ts)) for ts in range(now - days * 86400, now, self.config.poll_interval)]
        self.readings.insert_many(conn, rows)

    async def _run(self, conn: sqlite3.Connection) -> None:
        cfg = self.config
        backoff = cfg.poll_interval
        last_prune = 0.0
        while True:
            started = time.monotonic()
            try:
                snap = await asyncio.to_thread(self.inverter.read_snapshot)
                if self.pv2:
                    snap = merge_pv2(snap, await self._read_pv2(self.pv2), cfg.pv2_behind_meter)
                ts = int(time.time())
                await asyncio.to_thread(self.readings.insert, conn, ts, snap)
                self.latest = {"ts": ts, **snap}
                self.last_success, self.last_error = time.time(), None
                backoff = cfg.poll_interval
                self._publish(self.status())
            except Exception as e:  # keep polling no matter what
                self.last_error = f"{type(e).__name__}: {e}"
                log.warning("Poll failed (next try in %ss): %s", backoff, self.last_error)
                self._publish(self.status())
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, cfg.max_backoff)
                continue

            if time.time() - last_prune > 3600:
                last_prune = time.time()
                n = await asyncio.to_thread(self.readings.prune, conn)
                if n:
                    log.info("Pruned %d raw rows older than %d days", n, cfg.raw_retention_days)

            await asyncio.sleep(max(0.0, cfg.poll_interval - (time.monotonic() - started)))

    async def _read_pv2(self, pv2: StringInverter) -> dict[str, float | None] | None:
        """The second inverter's values for this poll. Its failures never stop the main poll."""
        now = time.time()
        try:
            vals = await asyncio.to_thread(pv2.read_snapshot)
            self.pv2_last, self.pv2_success, self.pv2_error = (now, vals), now, None
            return vals
        except Exception as e:
            if self.pv2_error is None:
                log.warning("Second inverter %s not responding: %s", self.config.pv2_host, e)
            self.pv2_error = f"{type(e).__name__}: {e}"
        if not self.pv2_last:
            return None
        at, vals = self.pv2_last
        if now - at < self.config.poll_interval * 3:
            return vals  # a missed read or two: carry the last values
        # Longer gaps are usually the inverter asleep (they power down after dark): no output,
        # but today's counters still stand. Yesterday's counters don't carry over.
        if time.strftime("%Y-%m-%d", time.localtime(at)) != time.strftime("%Y-%m-%d", time.localtime(now)):
            return None
        return {**vals, "pv2_power": 0, "pv2_dc_power": 0}

    # -- system details -------------------------------------------------------
    def battery_kwh(self) -> float:
        return self.config.battery_kwh or self.inverter.battery_kwh or 0.0

    def reserve(self) -> float:
        r: float | None = self.inverter.info.get("reserve")
        return r if r is not None else self.config.battery_reserve

    def system(self) -> dict[str, Any]:
        cfg = self.config
        info = self.inverter.info
        return {
            "model": info.get("model"),
            "serial": info.get("serial"),
            "nominal_kw": info.get("nominal_kw"),
            "phases": info.get("phases"),
            "pv_kw": cfg.pv_kw,
            "battery_kwh": self.battery_kwh(),
            "battery_reserve": self.reserve(),
            "battery_max_kw": cfg.battery_max_kw,
            "forecast": cfg.forecast,
            "tariff": self.tariffs.get(),
            "pv2": None
            if not self.pv2
            else {
                "host": cfg.pv2_host,
                "behind_meter": cfg.pv2_behind_meter,
                **self.pv2.info,
                "last_success": self.pv2_success,
                "error": self.pv2_error,
            },
            **self.settings.all_values(),
        }

    def status(self) -> Status:
        return {
            "snapshot": self.latest,
            "system": self.system(),
            "model": self.inverter.model,
            "mock": self.config.mock,
            "poll_interval": self.config.poll_interval,
            "last_success": self.last_success,
            "error": self.last_error,
        }
