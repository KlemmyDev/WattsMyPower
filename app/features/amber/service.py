"""
Amber Electric: connecting an account, and keeping its prices in the database for the "Amber"
tariff type (see app.features.tariffs.costs).

Optional: nothing here calls Amber, and no cost uses its prices, until the household pastes an API
key in Bills → Rates & settings and chooses Amber as their rate type. Once a key and site are set, a
background loop runs just after every 5-minute price update and:

  1. fetches yesterday to tomorrow in one request: today's prices so far, the forecast, and
     yesterday's final prices;
  2. catches up on days missed while the dashboard was off, a week per request;
  3. backfills older days, a week per request, back to the latest of: the first day with readings
     (older prices would price nothing), the day the site joined Amber, and two years ago. Amber
     doesn't document how far back prices go, so a page with no prices also ends it, and a page
     Amber refuses is retried a smaller one at a time.

Steps 2 and 3 make at most a few requests per run and stop early when Amber says few are left in its
rate-limit window (shared with anything else on the account); a "too many requests" answer pauses
syncing until the window resets.

The API key is kept in the database and never sent back to the browser: status() shows it masked.
Amber's days are NEM days (UTC+10 all year), so the dates here are too.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import re
import threading
import time
from collections.abc import Callable
from typing import Any

from app.core.database import Database
from app.features.amber.client import AmberClient, AmberError
from app.features.amber.prices import convert
from app.features.amber.repository import AmberSettings, PriceRepository
from app.features.tariffs.store import TariffStore

log = logging.getLogger(__name__)

NEM = dt.timezone(dt.timedelta(hours=10))
REFRESH = 300  # seconds between runs: Amber updates prices every 5 minutes
AFTER_UPDATE = 30  # seconds past each 5-minute mark to run, so the new price is out
PAGE_DAYS = 7  # days of prices per request when catching up or backfilling
PAGES_PER_RUN = 4  # catch-up and backfill requests per run
RESERVE = 10  # requests to leave in Amber's rate-limit window for anything else on the account
MAX_DAYS = 730  # how far back to backfill at most
KEY = re.compile(r"^[A-Za-z0-9_.-]{16,128}$")


class AmberSetupError(ValueError):
    """A connection change that can't be made; `status` is the HTTP status to answer with."""

    def __init__(self, detail: str, status: int = 422):
        super().__init__(detail)
        self.status = status


class _Changed(Exception):
    """The connection changed while a sync was running: its results are for the old one."""


def mask(key: str) -> str:
    """Enough of an API key to recognise it, not to use it: "psk_…9f2c"."""
    return f"{key[:4]}…{key[-4:]}" if len(key) >= 16 else "••••"


def nem_date(ts: float) -> dt.date:
    return dt.datetime.fromtimestamp(ts, NEM).date()


def _date(v: Any) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _site(s: dict[str, Any]) -> dict[str, Any]:
    """The parts of Amber's site record we keep."""
    length = s.get("intervalLength")
    return {
        "id": str(s["id"]),
        "nmi": str(s.get("nmi") or ""),
        "network": str(s.get("network") or ""),
        "status": str(s.get("status") or ""),
        "interval_length": length if length in (5, 30) else None,
        "active_from": s.get("activeFrom"),
        "channels": sorted({c.get("type") for c in s.get("channels") or [] if isinstance(c, dict) and c.get("type")}),
    }


class AmberService:
    def __init__(
        self,
        db: Database,
        tariffs: TariffStore,
        client_factory: Callable[[str], AmberClient] = AmberClient,
        clock: Callable[[], float] = time.time,
    ):
        self.db = db
        self.repo = PriceRepository(db)
        self.store = AmberSettings(db)
        self.tariffs = tariffs
        self.client_factory = client_factory
        self.clock = clock
        self._lock = threading.Lock()
        self._conn: dict[str, Any] = {}  # api_key, sites, site_id
        self._sync: dict[str, Any] = {}  # from, to, backfilled, page, last_sync, error, retry_at
        self._gen = 0  # bumped whenever the connection changes, so a sync in flight can tell
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    def load(self) -> None:
        conn, sync = self.store.read("amber"), self.store.read("amber_sync")
        with self._lock:
            self._conn, self._sync = conn, sync

    # -- the connection ---------------------------------------------------------
    def _chosen(self, c: dict[str, Any]) -> dict[str, Any] | None:
        return next((s for s in c.get("sites") or [] if s["id"] == c.get("site_id")), None)

    @property
    def ready(self) -> bool:
        """Connected, with a site chosen: prices are (or are being) fetched."""
        with self._lock:
            return bool(self._conn.get("api_key")) and self._chosen(self._conn) is not None

    def status(self) -> dict[str, Any]:
        """The connection as the Settings page shows it. The API key only ever leaves masked."""
        with self._lock:
            c, st = dict(self._conn), dict(self._sync)
        key, site = c.get("api_key"), self._chosen(c)
        cov = self.repo.coverage() if site else {}
        return {
            "connected": bool(key),
            "key": mask(key) if key else None,
            "sites": c.get("sites") or [],
            "site_id": site["id"] if site else None,
            "interval_length": site["interval_length"] if site else None,
            "prices_from": cov.get("first"),
            "prices_until": cov.get("until"),
            "backfilling": bool(site) and not st.get("backfilled"),
            "last_sync": st.get("last_sync"),
            "error": st.get("error"),
        }

    def _set(self, c: dict[str, Any]) -> None:
        """Replace the connection. Prices and sync progress belong to a site, so they go when it changes."""
        with self._lock:
            same_site = c.get("site_id") is not None and c.get("site_id") == self._conn.get("site_id")
            self._gen += 1
            with self.db.writing() as conn:
                if not same_site:
                    self.repo.clear(conn)
                    self._sync = {}
                    self.store.write(conn, "amber_sync", {})
                self.store.write(conn, "amber", c)
            self._conn = c

    def connect(self, api_key: str) -> dict[str, Any]:
        """Check a key by listing its sites, then keep it. Chooses the site when there's only one to choose."""
        key = str(api_key or "").strip()
        if not KEY.match(key):
            raise AmberSetupError("That doesn't look like an Amber API key. Copy it again from the Amber app.")
        try:
            sites = [_site(s) for s in self.client_factory(key).sites()]
        except AmberError as e:
            raise AmberSetupError(str(e), 422 if e.bad_key else 502) from e
        if not sites:
            raise AmberSetupError("Amber has no sites on this account yet. Try again once your site is set up.")
        live = [s for s in sites if s["status"] != "closed"] or sites
        with self._lock:
            previous = self._conn.get("site_id")
        site_id = previous if any(s["id"] == previous for s in sites) else (live[0]["id"] if len(live) == 1 else None)
        self._set({"api_key": key, "sites": sites, "site_id": site_id})
        return self.status()

    def choose_site(self, site_id: str) -> dict[str, Any]:
        with self._lock:
            c = dict(self._conn)
        if not c.get("api_key"):
            raise AmberSetupError("Connect your Amber account first.")
        if not any(s["id"] == site_id for s in c.get("sites") or []):
            raise AmberSetupError("That site isn't on your Amber account.")
        self._set({**c, "site_id": site_id})
        return self.status()

    def disconnect(self) -> dict[str, Any]:
        """Forget the key and the prices. A tariff on Amber prices goes back to a single rate at its fallback rates."""
        with self._lock:
            self._gen += 1
            with self.db.writing() as conn:
                self.repo.clear(conn)
                self.store.delete_all(conn)
            self._conn, self._sync = {}, {}
        t = self.tariffs.get()
        if t.get("type") == "amber":
            self.tariffs.save({**t, "type": "flat"})
        return self.status()

    # -- prices for the page ----------------------------------------------------
    def prices(self, start: int, end: int, now: int) -> dict[str, Any]:
        """Import and feed-in prices for [start, end), and those in force now."""
        with self._lock:
            site = self._chosen(self._conn)
        out: dict[str, Any] = {"interval_length": site["interval_length"] if site else None, "now": {}}
        for channel, name in (("general", "general"), ("feedIn", "feed_in")):
            rows = self.repo.intervals(channel, start, end)
            out[name] = [{"start": ts, "end": ts + d, "rate": r, "actual": a} for ts, d, r, a in rows]
            out["now"][name] = self.repo.lookup(channel, now, now + 1).at(now)
        return out

    # -- keeping prices up to date ----------------------------------------------
    def sync(self, now: float | None = None) -> None:
        """One run of the background loop (see the module docstring). Blocking: run it in a thread."""
        ts = int(now if now is not None else self.clock())
        with self._lock:
            c, st, gen = dict(self._conn), dict(self._sync), self._gen
        site = self._chosen(c)
        if not c.get("api_key") or site is None or ts < (st.get("retry_at") or 0):
            return
        client = self.client_factory(c["api_key"])
        today = nem_date(ts)
        day = dt.timedelta(days=1)
        yesterday = today - day
        budget = PAGES_PER_RUN

        def fetch(start: dt.date, end: dt.date) -> int:
            """Store one request's prices; the number of import prices it had."""
            prices = convert(client.prices(site["id"], start, end))
            with self._lock:
                if gen != self._gen:
                    raise _Changed
                with self.db.writing() as conn:
                    self.repo.save(conn, prices, ts)
            return sum(p.channel == "general" for p in prices)

        def room() -> bool:
            return budget > 0 and (client.remaining is None or client.remaining > RESERVE)

        try:
            # 1. Today, the forecast, and yesterday's final prices.
            fetch(yesterday, today + day)
            st.update(last_sync=ts, error=None, retry_at=None)
            newest, oldest = _date(st.get("to")), _date(st.get("from"))
            if newest is None or oldest is None:
                newest = oldest = yesterday

            # 2. Days missed while the dashboard was off.
            nxt = newest + day
            while nxt < yesterday and room():
                end = min(nxt + (PAGE_DAYS - 1) * day, yesterday - day)
                fetch(nxt, end)
                budget -= 1
                nxt = end + day
            newest = yesterday if nxt >= yesterday else nxt - day

            # 3. Older days, back as far as there's anything to price.
            floor = self._floor(site, today)
            while not st.get("backfilled") and room():
                if oldest <= floor:
                    st["backfilled"] = True
                    break
                page = int(st.get("page") or PAGE_DAYS)
                start = max(floor, oldest - page * day)
                budget -= 1
                try:
                    found = fetch(start, oldest - day)
                except AmberError as e:
                    if e.status != 400:
                        raise
                    if page > 1:  # perhaps too long a range for Amber: try a shorter one
                        st["page"] = page // 2
                        continue
                    found = 0
                if not found:  # Amber has nothing older
                    st["backfilled"] = True
                    break
                oldest = start
            st.update({"from": oldest.isoformat(), "to": newest.isoformat()})
        except _Changed:
            return
        except AmberError as e:
            st["error"] = str(e)
            if e.status == 429:
                st["retry_at"] = ts + (e.retry_after or REFRESH)
        except Exception as e:  # keep the loop going; the page shows the problem
            log.exception("Amber price sync failed")
            st["error"] = f"Prices could not be updated ({type(e).__name__}). Trying again in a few minutes."

        with self._lock:
            if gen == self._gen:
                self._sync = st
                with self.db.writing() as conn:
                    self.store.write(conn, "amber_sync", st)

    def _floor(self, site: dict[str, Any], today: dt.date) -> dt.date:
        """The oldest day worth backfilling."""
        with self.db.reading() as conn:
            first = conn.execute("SELECT MIN(ts) FROM samples_5m").fetchone()[0]
        days = [today - dt.timedelta(days=MAX_DAYS), nem_date(first) if first is not None else today]
        active = _date(site.get("active_from"))
        if active:
            days.append(active)
        return max(days)

    async def start(self) -> None:
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    def wake(self) -> None:
        """Run the sync now (after connecting or choosing a site) rather than at the next price update.
        Call from the event loop."""
        if self._wake:
            self._wake.set()

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.sync)
            except Exception:
                log.exception("Amber price sync failed")
            assert self._wake is not None
            now = self.clock()
            wait = (now // REFRESH + 1) * REFRESH + AFTER_UPDATE - now
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=wait)
            self._wake.clear()
