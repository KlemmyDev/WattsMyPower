"""
BYD (Manage → Integrations → Electric vehicles → BYD, and the EV page): the account's cars, read from BYD's cloud
every few minutes (app.features.byd.client), each with its charge, its range and whether it's charging. It only reads:
nothing is ever sent to the cars.

The account's email and password are kept on this server (BYD's sign-in needs them each time it runs out) and only
ever sent to BYD. Each car's last state is kept too, so the cars show after a restart, and a car that doesn't answer
one time keeps showing what it said before (with when that was).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import time
from collections.abc import Callable
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.core.timezone import site_zone
from app.features.byd.client import REGIONS, Account, BydAccount, BydError, email_hint
from app.features.byd.mock import DemoByd
from app.features.live.service import LiveService

log = logging.getLogger(__name__)

CONN_KEY = "byd"  # kv: the BYD account (email, password, region) and its cars as last read (JSON)
POLL = 600  # seconds between reads: each asks the cars themselves, so not too often
POLL_CHARGING = 300  # while a car's charging
BACKOFF = (60, 300, 900, 1800)  # after a failed read, before trying again (one more step each failure in a row)
TICK = 30  # how often the loop looks at whether a read's due


class BydSetupError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _duration(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h} h {m} min" if h and m else f"{h} h" if h else f"{m} min"


def car_status(car: dict[str, Any]) -> tuple[str, str]:
    """What a car's doing, as a status the EV page colours (charging, complete, stopped, unknown) and in a sentence."""
    s = car.get("state")
    if not s:
        return "unknown", "Not read yet: BYD hasn't had an answer from the car."
    if s.get("charging"):
        m = s.get("minutes_to_full")
        return "charging", f"Charging, full in {_duration(m)}." if m else "Charging."
    if (s.get("soc") or 0) >= 100:
        return "complete", "Charged."
    return "stopped", "Not charging."


class BydService:
    def __init__(
        self,
        config: Config,
        db: Database,
        live: LiveService,
        clock: Callable[[], float] = time.time,
        account: Callable[[str, str, str], Account] | None = None,
    ):
        self.config = config
        self.db = db
        self.live = live
        self.clock = clock
        self._make_account = account or self._default_account
        self._account: Account | None = None  # kept between reads, so it stays signed in
        self._lock = asyncio.Lock()  # one read (or change) at a time
        self._error: str | None = None
        self._signed_out = False  # BYD turned the email and password down: not tried again until they're entered
        self._failed = 0  # failed reads in a row (BACKOFF)
        self._next_read = 0.0
        self._reading = False
        self._task: asyncio.Task[None] | None = None

    def _default_account(self, username: str, password: str, region: str) -> Account:
        if self.config.mock:
            return DemoByd(self.clock)
        return BydAccount(username, password, region, site_zone() or "Australia/Sydney")

    # -- storage ---------------------------------------------------------------------------
    def _conn(self) -> dict[str, Any]:
        with self.db.reading() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", (CONN_KEY,)).fetchone()
        return json.loads(row[0]) if row else {}

    def _save(self, value: dict[str, Any] | None) -> None:
        with self.db.writing() as conn:
            if value is None:
                conn.execute("DELETE FROM kv WHERE key = ?", (CONN_KEY,))
            else:
                conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (CONN_KEY, json.dumps(value)))

    # -- what's shown ----------------------------------------------------------------------
    @staticmethod
    def vehicle(car: dict[str, Any]) -> dict[str, Any]:
        status, doing = car_status(car)
        return {**car, "status": status, "doing": doing}

    def status(self) -> dict[str, Any]:
        """The account (its email, partly hidden, and region), how the reads are going, and each car. The password
        never leaves this server."""
        c = self._conn()
        connected = bool(c.get("username"))
        return {
            "connected": connected,
            "account": email_hint(c["username"]) if connected else None,
            "region": c.get("region") if connected else None,
            "regions": [{"code": k, "name": name} for k, (name, _) in REGIONS.items()],
            "error": self._error if connected else None,
            "signed_out": self._signed_out and connected,
            "read_at": c.get("read_at") if connected else None,
            # When the cars are next read (unix seconds; null when they won't be until signed in again); a read now.
            "next_read": max(math.ceil(self._next_read), int(self.clock()))
            if connected and not self._signed_out
            else None,
            "reading": self._reading,
            "mock": self.config.mock,  # any email and password connects the made-up car
            "vehicles": [self.vehicle(car) for car in c.get("vehicles", [])] if connected else [],
        }

    def summary(self) -> list[dict[str, Any]] | None:
        """Each car in brief, for every page (the live status's `ev`, beside any Teslas: so it's parked at the
        Overview's house, drawn as its model); None when not connected. BYD's cloud doesn't say what a car's
        drawing, where it is or its paint, and the dashboard doesn't charge it, so those are left empty."""
        c = self._conn()
        if not c.get("username"):
            return None
        out = []
        for car in c.get("vehicles", []):
            full = self.vehicle(car)
            st = car.get("state") or {}
            out.append({k: full[k] for k in ("vin", "make", "model", "year", "name", "status", "doing")} | {
                "colour": None, "car": None, "mode": "off", "soc": st.get("soc"), "limit": None, "power_kw": None,
                "amps": None, "at_home": None,
            })  # fmt: skip
        return out

    # -- changes ---------------------------------------------------------------------------
    async def connect(self, body: dict[str, Any]) -> dict[str, Any]:
        """Sign in to BYD ({"username", "password", "region"}), checked by reading the account's cars."""
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        region = str(body.get("region") or "AU").upper()
        if not username or not password:
            raise BydSetupError("Enter the email (or phone number) and password you sign in to the BYD app with.")
        if region not in REGIONS:
            raise BydSetupError("Choose the region the account was made in.")
        account = self._make_account(username, password, region)
        try:
            cars = await account.read()
        except BydError as e:
            await account.close()
            raise BydSetupError(str(e), 400 if e.refused else 502) from e
        if not cars:
            await account.close()
            raise BydSetupError(
                "BYD accepted the sign-in, but there's no electric car on the account. If yours is on another "
                "account, share it to this one from the BYD app, or sign in with that one."
            )
        async with self._lock:
            if self._account is not None:
                await self._account.close()
            self._account = account
            now = self.clock()
            self._save(
                {"username": username, "password": password, "region": region, "vehicles": cars, "read_at": int(now)}
            )
            self._error, self._signed_out, self._failed = None, False, 0
            self._next_read = now + self._poll(cars)
        await self.publish()
        return self.status()

    async def disconnect(self) -> dict[str, Any]:
        """Forget the account and its cars."""
        async with self._lock:
            if self._account is not None:
                await self._account.close()
            self._account = None
            self._save(None)
            self._error, self._signed_out, self._failed = None, False, 0
        await self.publish()
        return self.status()

    async def refresh(self) -> dict[str, Any]:
        """Read the cars now. How it went is in the status (`error`), as for every read."""
        if not self._conn().get("username"):
            raise BydSetupError("Connect a BYD account first.", 409)
        await self.read()
        await self.publish()
        return self.status()

    # -- reading ---------------------------------------------------------------------------
    @staticmethod
    def _poll(cars: list[dict[str, Any]]) -> int:
        return POLL_CHARGING if any((car.get("state") or {}).get("charging") for car in cars) else POLL

    async def read(self) -> None:
        async with self._lock:
            c = self._conn()
            if not c.get("username"):
                return
            if self._account is None:
                self._account = self._make_account(c["username"], c["password"], c.get("region") or "AU")
            self._reading = True
            try:
                cars = await self._account.read()
            except BydError as e:
                self._error, self._signed_out = str(e), e.refused
                self._next_read = self.clock() + BACKOFF[min(self._failed, len(BACKOFF) - 1)]
                self._failed += 1
                log.info("Reading the BYDs: %s", e)
                return
            finally:
                self._reading = False
            # A car that didn't answer this time keeps what it said last (with when that was).
            before = {car["vin"]: car for car in c.get("vehicles", [])}
            for car in cars:
                if car.get("state") is None and (was := before.get(car["vin"], {}).get("state")):
                    car["state"] = was
            now = self.clock()
            self._save({**c, "vehicles": cars, "read_at": int(now)})
            self._error, self._signed_out, self._failed = None, False, 0
            self._next_read = now + self._poll(cars)

    # -- the loop --------------------------------------------------------------------------
    async def publish(self) -> None:
        if self.live.set_ev("byd", self.summary()):
            self.live.publish()

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._account is not None:
            await self._account.close()
            self._account = None

    async def _run(self) -> None:
        while True:
            try:
                if self._conn().get("username") and not self._signed_out and self.clock() >= self._next_read:
                    await self.read()
                await self.publish()
            except Exception:
                log.exception("Reading the BYDs failed")
            await asyncio.sleep(TICK)
