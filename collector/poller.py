"""
The poll loop: read every device, store what answered, wake the feed's waiting requests.

Every poll gets one `ts` (unix seconds at its start) shared by all its rows. The hybrid sets the
pace: when it doesn't answer, polls back off exponentially (up to MAX_BACKOFF) so a struggling
WiNet-S2 gets room to recover. The second inverter's failures never hold up the hybrid: it sleeps
after dark, and its row is simply missing from those polls.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

from collector.config import Config
from collector.devices import Device, RawReading, Words
from collector.store import PollRow, Store

log = logging.getLogger(__name__)

# Info registers (serial, model, battery size, reserve) rarely change: read on start, then this often.
INFO_EVERY = 6 * 3600
PRUNE_EVERY = 3600


@dataclass
class DeviceStatus:
    host: str
    driver: str
    last_success: float | None = None
    error: str | None = None
    # The most recent words read from each info register (kept across polls that don't read them).
    info_input: Words = field(default_factory=dict)
    info_holding: Words = field(default_factory=dict)
    info_at: float | None = None  # when info was last read successfully

    def as_json(self) -> dict[str, Any]:
        info: dict[str, Any] = {"input": {str(a): w for a, w in sorted(self.info_input.items())}}
        if self.info_holding:
            info["holding"] = {str(a): w for a, w in sorted(self.info_holding.items())}
        return {
            "host": self.host,
            "driver": self.driver,
            "last_success": self.last_success,
            "error": self.error,
            "info": info,
        }


class Poller:
    def __init__(
        self,
        config: Config,
        store: Store,
        hybrid: Device,
        pv2: Device | None = None,
        *,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    ):
        self.config = config
        self.store = store
        self.hybrid = hybrid
        self.devices: list[Device] = [hybrid] if pv2 is None else [hybrid, pv2]
        self.status = {d.name: DeviceStatus(d.host, d.driver) for d in self.devices}
        self._clock = clock
        self._sleep = sleep
        self.started_at = int(clock())
        self._landed = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._pruned_at = 0.0

    # -- waiting for new rows -------------------------------------------------
    def landed(self) -> asyncio.Event:
        """Set once the next poll's rows are stored.

        Take it *before* looking for rows: a poll that lands while you look has then already set
        it, so the wait returns at once instead of missing that poll.
        """
        return self._landed

    def _notify(self) -> None:
        event, self._landed = self._landed, asyncio.Event()
        event.set()

    # -- lifecycle ------------------------------------------------------------
    async def start(self) -> None:
        self._landed = asyncio.Event()  # bound to the running loop
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        cfg = self.config
        backoff = cfg.poll_interval
        while True:
            started = time.monotonic()
            try:
                ok = await self.poll_once()
                error = self.status[self.hybrid.name].error
            except Exception as e:  # e.g. the disk filled up: keep polling no matter what
                ok, error = False, f"{type(e).__name__}: {e}"
            if not ok:
                log.warning("Poll failed (next try in %ss): %s", backoff, error)
                await self._sleep(backoff)
                backoff = min(backoff * 2, cfg.max_backoff)
                continue
            backoff = cfg.poll_interval

            now = self._clock()
            if now - self._pruned_at > PRUNE_EVERY:
                self._pruned_at = now
                try:
                    n = await asyncio.to_thread(self.store.prune, now)
                    if n:
                        log.info("Pruned %d rows older than %d days", n, cfg.retention_days)
                except Exception as e:
                    log.warning("Prune failed: %s: %s", type(e).__name__, e)

            await self._sleep(max(0.0, cfg.poll_interval - (time.monotonic() - started)))

    # -- one poll -------------------------------------------------------------
    async def poll_once(self) -> bool:
        """Read every device and store the rows of those that answered. True if the hybrid answered."""
        now = self._clock()
        ts = int(now)
        results: list[tuple[Device, bool, RawReading]] = []
        for device in self.devices:
            st = self.status[device.name]
            include_info = st.info_at is None or now - st.info_at >= INFO_EVERY
            try:
                reading = await asyncio.to_thread(device.read, include_info)
            except Exception as e:
                error = f"{type(e).__name__}: {e}"
                if device is not self.hybrid and st.error is None:  # the hybrid's failures are logged by the loop
                    log.warning("%s (%s) not responding: %s", device.name, device.host, error)
                st.error = error
                continue
            results.append((device, include_info, reading))

        if results:
            rows: list[PollRow] = [(d.name, d.driver, r.input, r.holding) for d, _, r in results]
            await asyncio.to_thread(self.store.write_poll, ts, rows)
            self._notify()

        done = self._clock()
        for device, include_info, reading in results:
            st = self.status[device.name]
            if st.error is not None and device is not self.hybrid:
                log.info("%s (%s) answering again", device.name, device.host)
            st.last_success, st.error = done, None
            if include_info:
                st.info_at = now
                st.info_input.update(reading.info_input)
                st.info_holding.update(reading.info_holding)
        return any(d is self.hybrid for d, _, _ in results)

    # -- status ---------------------------------------------------------------
    def hybrid_fresh(self) -> bool:
        """Whether the hybrid answered recently enough for the feed to count as live."""
        last = self.status[self.hybrid.name].last_success
        return last is not None and self._clock() - last <= max(120, self.config.poll_interval * 6)
