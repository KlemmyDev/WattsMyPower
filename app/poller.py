"""Background loop: read the inverter, store the snapshot, fan it out to live clients."""

from __future__ import annotations

import asyncio
import logging
import time

from . import config, db, settings, tariffs
from .inverter import MockInverter, SungrowInverter
from .string_inverter import StringInverter

log = logging.getLogger(__name__)


def merge_pv2(snap: dict, pv2: dict | None, behind_meter: bool = True) -> dict:
    """
    Fold a second, AC-coupled solar system into the hybrid's snapshot. Solar becomes both
    systems together. The rest depends on where the second system connects:

    - behind the meter (house side, the default and usual setup): the meter already counts
      its surplus as export, and the hybrid sees its output as reduced (even negative) home
      use, so add it back there.
    - outside the hybrid's meter: the meter never sees it, so all of its output is export
      on top of what the meter measured, and the hybrid's home use is right.

    The hybrid's own figures are kept as *_pv1, load_hybrid, grid_hybrid and daily_export1.
    """
    out = dict(snap)
    out.update(pv1_power=snap.get("pv_power"), daily_pv1=snap.get("daily_pv"), total_pv1=snap.get("total_pv"),
               load_hybrid=snap.get("load_power"), grid_hybrid=snap.get("grid_power"), daily_export1=snap.get("daily_export"))
    if not pv2:
        return out
    out.update(pv2)
    add = lambda a, b: a if a is None or b is None else round(a + b, 3)
    p2 = pv2.get("pv2_power")
    out["pv_power"] = add(snap.get("pv_power"), p2)
    out["daily_pv"] = add(snap.get("daily_pv"), pv2.get("daily_pv2"))
    out["total_pv"] = add(snap.get("total_pv"), pv2.get("total_pv2"))
    if behind_meter:
        out["load_power"] = add(snap.get("load_power"), p2)
    else:
        out["grid_power"] = add(snap.get("grid_power"), -p2 if p2 is not None else None)
        out["daily_export"] = add(snap.get("daily_export"), pv2.get("daily_pv2"))
    return out
    out.update(pv2)
    add = lambda a, b: a if a is None or b is None else round(a + b, 3)
    out["pv_power"] = add(snap.get("pv_power"), pv2.get("pv2_power"))
    out["load_power"] = add(snap.get("load_power"), pv2.get("pv2_power"))
    out["daily_pv"] = add(snap.get("daily_pv"), pv2.get("daily_pv2"))
    out["total_pv"] = add(snap.get("total_pv"), pv2.get("total_pv2"))
    return out


class Poller:
    def __init__(self):
        self.inverter = MockInverter() if config.MOCK else SungrowInverter(
            config.INVERTER_HOST, config.INVERTER_PORT, config.INVERTER_UNIT)
        self.conn = None
        self.latest: dict | None = None
        self.last_error: str | None = None
        self.last_success: float | None = None
        self._subscribers: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None
        self.pv2 = StringInverter(config.PV2_HOST, config.PV2_PORT, config.PV2_UNIT) if config.PV2_HOST and not config.MOCK else None
        self.pv2_last: tuple[float, dict] | None = None  # (time, values) of the last good read
        self.pv2_error: str | None = None
        self.pv2_success: float | None = None

    # -- live fan-out ---------------------------------------------------------
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=10)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _publish(self, msg: dict) -> None:
        for q in list(self._subscribers):
            if q.full():  # slow client: drop its oldest message rather than block everyone
                q.get_nowait()
            q.put_nowait(msg)

    # -- lifecycle ------------------------------------------------------------
    async def start(self) -> None:
        self.conn = await asyncio.to_thread(db.init)
        await asyncio.to_thread(settings.load)
        await asyncio.to_thread(tariffs.load)
        if config.MOCK and await asyncio.to_thread(db.is_empty, self.conn):
            await asyncio.to_thread(self._mock_backfill, 14)
        self.latest = await asyncio.to_thread(db.latest)
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self.conn:
            self.conn.close()

    def _mock_backfill(self, days: int) -> None:
        log.info("Mock mode: generating %d days of history", days)
        now = int(time.time())
        rows = [(ts, self.inverter.simulate(ts)) for ts in range(now - days * 86400, now, config.POLL_INTERVAL)]
        db.insert_many(self.conn, rows)

    async def _run(self) -> None:
        backoff = config.POLL_INTERVAL
        last_prune = 0.0
        while True:
            started = time.monotonic()
            try:
                snap = await asyncio.to_thread(self.inverter.read_snapshot)
                if self.pv2:
                    snap = merge_pv2(snap, await self._read_pv2(), config.PV2_BEHIND_METER)
                ts = int(time.time())
                await asyncio.to_thread(db.insert, self.conn, ts, snap)
                self.latest = {"ts": ts, **snap}
                self.last_success, self.last_error = time.time(), None
                backoff = config.POLL_INTERVAL
                self._publish(self.status())
            except Exception as e:  # keep polling no matter what
                self.last_error = f"{type(e).__name__}: {e}"
                log.warning("Poll failed (next try in %ss): %s", backoff, self.last_error)
                self._publish(self.status())
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, config.MAX_BACKOFF)
                continue

            if time.time() - last_prune > 3600:
                last_prune = time.time()
                n = await asyncio.to_thread(db.prune, self.conn)
                if n:
                    log.info("Pruned %d raw rows older than %d days", n, config.RAW_RETENTION_DAYS)

            await asyncio.sleep(max(0.0, config.POLL_INTERVAL - (time.monotonic() - started)))

    async def _read_pv2(self) -> dict | None:
        """The second inverter's values for this poll. Its failures never stop the main poll."""
        now = time.time()
        try:
            vals = await asyncio.to_thread(self.pv2.read_snapshot)
            self.pv2_last, self.pv2_success, self.pv2_error = (now, vals), now, None
            return vals
        except Exception as e:
            if self.pv2_error is None:
                log.warning("Second inverter %s not responding: %s", config.PV2_HOST, e)
            self.pv2_error = f"{type(e).__name__}: {e}"
        if not self.pv2_last:
            return None
        at, vals = self.pv2_last
        if now - at < config.POLL_INTERVAL * 3:
            return vals  # a missed read or two: carry the last values
        # Longer gaps are usually the inverter asleep (they power down after dark): no output,
        # but today's counters still stand. Yesterday's counters don't carry over.
        if time.strftime("%Y-%m-%d", time.localtime(at)) != time.strftime("%Y-%m-%d", time.localtime(now)):
            return None
        return {**vals, "pv2_power": 0, "pv2_dc_power": 0}

    def battery_kwh(self) -> float:
        return config.BATTERY_KWH or getattr(self.inverter, "battery_kwh", None) or 0.0

    def reserve(self) -> float:
        r = getattr(self.inverter, "info", {}).get("reserve")
        return r if r is not None else config.BATTERY_RESERVE

    def system(self) -> dict:
        info = getattr(self.inverter, "info", {})
        return {
            "model": info.get("model"),
            "serial": info.get("serial"),
            "nominal_kw": info.get("nominal_kw"),
            "phases": info.get("phases"),
            "pv_kw": config.PV_KW,
            "battery_kwh": self.battery_kwh(),
            "battery_reserve": self.reserve(),
            "battery_max_kw": config.BATTERY_MAX_KW,
            "forecast": config.FORECAST,
            "tariff": tariffs.get(),
            "pv2": None if not self.pv2 else {
                "host": config.PV2_HOST, "behind_meter": config.PV2_BEHIND_METER, **self.pv2.info,
                "last_success": self.pv2_success, "error": self.pv2_error,
            },
            **settings.all_values(),
        }

    def status(self) -> dict:
        return {
            "snapshot": self.latest,
            "system": self.system(),
            "model": getattr(self.inverter, "model", None),
            "mock": config.MOCK,
            "poll_interval": config.POLL_INTERVAL,
            "last_success": self.last_success,
            "error": self.last_error,
        }
