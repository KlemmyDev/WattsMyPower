"""
Smart-home devices (the Home page, and Manage → Integrations → Smart home): connecting accounts, polling them, and
recording what their devices use.

Each connected account is polled on its integration's interval (Integration.poll_seconds) by a background loop. A
poll's readings go through each device's meter (app.features.home.energy), which adds its energy and runs to the
database, and are kept in memory as what each device is doing now. Devices are added the first time their account
reports them, as their integration says they are; the household can rename one, say what it is (a smart plug
powering the washer), put it in a group with others (the plugs in a room, which the Home page shows as one), or hide it
from the breakdown.

There's one account per integration: a second sign-in to the same one would count its devices twice. A poll that
fails tries again later, backing off to BACKOFF_MAX; one whose sign-in no longer works stops until it's signed in
again. What an account keeps to sign in is never sent to the browser.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import sqlite3
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import asdict
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.features.home import estimate, rules
from app.features.home.energy import MAX_W, Meter, step
from app.features.home.registry import INTEGRATIONS
from app.features.home.repository import Account, Device, HomeRepository
from app.features.home.types import CATEGORIES, KINDS, Hints, Integration, IntegrationError, Reading

log = logging.getLogger(__name__)

BACKFILL_DAYS = 28  # how far back to ask an integration that can look back, when it's connected
BACKOFF_MAX = 15 * 60  # the longest wait between tries after failed polls
NAME_MAX = 60
PROTECTED = {"fridge", "freezer"}  # only switched off when that's confirmed


class HomeSetupError(ValueError):
    """A change that can't be made; `status` is the HTTP status to answer with."""

    def __init__(self, detail: str, status: int = 422):
        super().__init__(detail)
        self.status = status


def _same(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


class HomeService:
    def __init__(
        self,
        config: Config,
        db: Database,
        integrations: dict[str, type[Integration]] = INTEGRATIONS,
        clock: Callable[[], float] = time.time,
        conditions: Callable[[], rules.Conditions] | None = None,
    ):
        self.config = config
        self.db = db
        self.repo = HomeRepository(db)
        self.integrations = integrations
        self.clock = clock
        # What's happening for rules to decide on (what's going to the grid, the price now). None: rules don't run.
        self.conditions = conditions
        self._lock = threading.Lock()  # one change to the home tables at a time
        self._now: dict[int, dict[str, Any]] = {}  # device id -> what it's doing, as last read
        self._raw: dict[int, dict[str, Any]] = {}  # device id -> its properties as last read, for diagnosis
        self._due: dict[int, float] = {}  # account id -> when it's next polled (not there: now)
        self._failures: dict[int, int] = {}  # account id -> polls failed in a row
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    def available(self) -> dict[str, type[Integration]]:
        """The integrations that can be connected here: the demo only in mock mode."""
        return {k: v for k, v in self.integrations.items() if self.config.mock or not v.demo}

    def _integration(self, integration_id: str) -> type[Integration]:
        cls = self.available().get(integration_id)
        if cls is None:
            raise HomeSetupError("There's no such integration.", 404)
        return cls

    # -- what's connected ---------------------------------------------------------
    def overview(self) -> dict[str, Any]:
        """Every integration that can be connected (with its account, if it is), the kinds a device can be set as,
        and every device with what it's doing now."""
        accounts = {a.integration: a for a in self.repo.accounts()}
        devices = self.repo.devices()
        last = self.repo.last_runs()
        now = self.clock()
        usual = estimate.typical(self.repo.runs(int(now) - estimate.LOOKBACK_DAYS * 86400, int(now) + 1))
        return {
            "integrations": [
                self._integration_view(cls, accounts.get(cls.id), devices) for cls in self.available().values()
            ],
            "kinds": [{"id": k, "label": v.label, "cycles": v.cycles} for k, v in KINDS.items()],
            "categories": [{"id": k, "label": v.label, "about": v.about} for k, v in CATEGORIES.items()],
            "devices": [self._device_view(d, accounts, last.get(d.id), usual.get(d.id)) for d in devices],
        }

    def _integration_view(
        self, cls: type[Integration], account: Account | None, devices: list[Device]
    ) -> dict[str, Any]:
        return {
            "id": cls.id,
            "name": cls.name,
            "via": cls.via,
            "about": cls.about,
            "category": cls.category,
            "icon": cls.icon,
            "kinds": list(cls.kinds),
            "fields": [
                {
                    "key": f.key,
                    "label": f.label,
                    "type": f.type,
                    "help": f.help,
                    "secret": f.secret,
                    "placeholder": f.placeholder,
                    "optional": f.optional,
                }
                for f in cls.fields
            ],
            "poll_seconds": cls.poll_seconds,
            "demo": cls.demo,
            "find_label": cls.find_label,
            "can_switch": cls.can_switch,
            "cloud": cls.cloud,
            "account": self._account_view(cls, account, devices) if account else None,
        }

    def _account_view(self, cls: type[Integration], a: Account, devices: list[Device]) -> dict[str, Any]:
        try:
            label = cls(dict(a.saved)).label()
        except Exception:  # what it keeps may be from an older version: the page still opens
            label = ""
        return {
            "id": a.id,
            "label": label,
            "connected_at": a.created_at,
            "last_poll": a.state.get("last_poll"),
            "error": a.state.get("error"),
            "signed_out": bool(a.state.get("signed_out")),
            "devices": sum(d.account == a.id for d in devices),
        }

    def _device_view(
        self,
        d: Device,
        accounts: dict[str, Account],
        last_run: dict[str, Any] | None,
        usual: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        integration = next((a.integration for a in accounts.values() if a.id == d.account), None)
        cls = self.integrations.get(integration or "")
        now = self._now.get(d.id)
        # What it was doing is only what it's doing for a few polls; after that it's unknown (not being read).
        if now and cls and self.clock() - now["at"] > 3 * cls.poll_seconds + 60:
            now = {**now, "stale": True}
        can_estimate = estimate.estimable(d)
        w = (usual or {}).get("w")
        # While it runs, what its runs usually draw stands in for the power it doesn't report.
        if can_estimate and d.estimate and w and now and now["running"] and now["online"] and not now.get("stale"):
            now = estimate.overlay(now, w, self.clock()) if now["power_w"] is None else now
        return {
            "id": d.id,
            "account": d.account,
            "integration": integration,
            "name": d.name,
            "kind": d.kind,
            "model": d.model,
            "hidden": d.hidden,
            "group": d.group,
            "now": now,
            "last_run": last_run,
            "can_switch": bool(cls and cls.can_switch),
            "rule": self._rule_view(d) if d.rule.get("settings") else None,
            # For an appliance that doesn't report its power: whether it shows what its runs usually draw while it
            # runs, that (W, None until enough runs have counted), and how many runs it's from.
            "estimate": {
                "on": d.estimate,
                "w": w,
                "runs": (usual or {}).get("runs", 0),
                "needs": estimate.MIN_RUNS,
            }
            if can_estimate
            else None,
        }

    @staticmethod
    def _rule_view(d: Device) -> dict[str, Any]:
        state = d.rule.get("state") or {}
        return {
            **d.rule["settings"],
            "paused_until": state.get("paused_until"),
            "last": state.get("last"),  # what it last did: {"at", "on", "why"}
        }

    # -- connecting ---------------------------------------------------------------
    def _form(self, cls: type[Integration], form: dict[str, Any]) -> dict[str, str]:
        values = {f.key: str(form.get(f.key) or "").strip() for f in cls.fields}
        missing = next((f for f in cls.fields if not f.optional and not values[f.key]), None)
        if missing:
            raise HomeSetupError(f"Enter your {missing.label.lower()}.")
        return values

    def _sign_in(self, cls: type[Integration], form: dict[str, Any], hints: Hints) -> dict[str, Any]:
        try:
            return cls.sign_in(self._form(cls, form), hints)
        except IntegrationError as e:
            raise HomeSetupError(str(e), 422 if e.signed_out else 502) from e

    def connect(self, integration_id: str, form: dict[str, Any], hints: Hints | None = None) -> dict[str, Any]:
        """Sign in to an integration and keep the account. Its devices arrive with the first poll (asked for at once:
        call wake()), and from before it was connected if the integration can look back."""
        cls = self._integration(integration_id)
        if any(a.integration == cls.id for a in self.repo.accounts()):
            raise HomeSetupError(f"{cls.name} is already connected. Sign in again from its page to change it.", 409)
        saved = self._sign_in(cls, form, hints or Hints())
        ts = int(self.clock())
        with self._lock, self.db.writing() as conn:
            account_id = self.repo.add_account(conn, cls.id, saved, ts)
        try:
            past = cls(dict(saved)).past(ts - BACKFILL_DAYS * 86400, ts)
        except Exception:  # it's connected either way; only the history before is missing
            log.exception("Couldn't read %s's history", cls.name)
            past = []
        if past:
            with self._lock, self.db.writing() as conn:
                if self.repo.account(conn, account_id):
                    self._apply(conn, account_id, past, live=False)
        self._due.pop(account_id, None)
        return self.overview()

    def sign_in_again(self, integration_id: str, form: dict[str, Any], hints: Hints | None = None) -> dict[str, Any]:
        """Sign in to a connected integration afresh (a changed password), keeping its devices and what they've used."""
        cls = self._integration(integration_id)
        account = next((a for a in self.repo.accounts() if a.integration == cls.id), None)
        if account is None:
            raise HomeSetupError(f"{cls.name} isn't connected.", 404)
        saved = self._sign_in(cls, form, hints or Hints())
        with self._lock, self.db.writing() as conn:
            self.repo.save_account(conn, account.id, saved=saved, state={})
        self._due.pop(account.id, None)
        self._failures.pop(account.id, None)
        return self.overview()

    def find(self, integration_id: str) -> dict[str, Any]:
        """Look for devices added to a connected integration since (Look for new plugs), and read them at once."""
        cls = self._integration(integration_id)
        account = next((a for a in self.repo.accounts() if a.integration == cls.id), None)
        if account is None:
            raise HomeSetupError(f"{cls.name} isn't connected.", 404)
        if cls.find_label is None:
            raise HomeSetupError(f"{cls.name} finds its devices by itself.", 404)
        integration = cls(dict(account.saved))
        try:
            new, answered = integration.find()
        except IntegrationError as e:
            raise HomeSetupError(str(e), 422 if e.signed_out else 502) from e
        with self._lock, self.db.writing() as conn:
            current = self.repo.account(conn, account.id)
            if current is None:
                raise HomeSetupError(f"{cls.name} isn't connected.", 404)
            if _same(current.saved, account.saved):  # unless it was signed in again meanwhile
                self.repo.save_account(conn, account.id, saved=integration.saved)
        self.poll(account.id)  # read them now, so new ones are on the page
        word = lambda n: "device" if n == 1 else "devices"  # noqa: E731
        message = (f"Found {new} new {word(new)}." if new
                   else f"No new devices: {answered} answered, all already here." if answered
                   else "Nothing answered.")  # fmt: skip
        return {**self.overview(), "found": {"new": new, "answered": answered, "message": message}}

    def disconnect(self, integration_id: str) -> dict[str, Any]:
        """Forget an account: its devices, and everything they've used."""
        cls = self._integration(integration_id)
        account = next((a for a in self.repo.accounts() if a.integration == cls.id), None)
        if account is None:
            raise HomeSetupError(f"{cls.name} isn't connected.", 404)
        with self._lock, self.db.writing() as conn:
            gone = [d.id for d in self.repo.devices(conn, account.id)]
            self.repo.delete_account(conn, account.id)
        for d in gone:
            self._now.pop(d, None)
            self._raw.pop(d, None)
        self._due.pop(account.id, None)
        self._failures.pop(account.id, None)
        return self.overview()

    # -- devices --------------------------------------------------------------------
    def switch(self, device_id: int, on: Any, confirm: Any = False) -> dict[str, Any]:
        """Switch a device on or off, then read its account so the change shows. A fridge or freezer is only switched
        off when that's confirmed: off, it stops keeping food cold."""
        if not isinstance(on, bool):
            raise HomeSetupError("Say whether to switch it on or off.")
        with self.db.reading() as conn:
            d = self.repo.device(conn, device_id)
            account = self.repo.account(conn, d.account) if d else None
        if d is None or account is None:
            raise HomeSetupError("There's no such device.", 404)
        cls = self.available().get(account.integration)
        if cls is None or not cls.can_switch:
            raise HomeSetupError(f"{d.name} can't be switched from here.", 409)
        if not on and d.kind in PROTECTED and confirm is not True:
            raise HomeSetupError(
                f"{d.name} is set as a {KINDS[d.kind].label.lower()}: switched off, it stops keeping food cold. "
                "Confirm to switch it off anyway.",
                409,
            )
        integration = cls(dict(account.saved))
        try:
            integration.switch(d.key, on)
        except IntegrationError as e:
            raise HomeSetupError(str(e), 422 if e.signed_out else 502) from e
        log.info("Switched %s (%s) %s", d.name, cls.name, "on" if on else "off")
        if d.rule.get("settings", {}).get("enabled"):  # by hand: its rule waits until tomorrow
            with self._lock, self.db.writing() as conn:
                state = {**(d.rule.get("state") or {}), "paused_until": rules.end_of_day(self.clock())}
                self.repo.save_rule(conn, d.id, {**d.rule, "state": state})
        if not _same(integration.saved, account.saved):
            with self._lock, self.db.writing() as conn:
                current = self.repo.account(conn, account.id)
                if current is not None and _same(current.saved, account.saved):
                    self.repo.save_account(conn, account.id, saved=integration.saved)
        self.poll(account.id)  # read it again, so it shows as it now is
        return self.overview()

    def update_device(self, device_id: int, body: dict[str, Any]) -> dict[str, Any]:
        """Rename a device, say what it is, put it in a group (or take it out, with an empty one), hide it from the
        breakdown, or show what its runs usually draw while it runs (for an appliance that doesn't report its power).
        A group named as one that's there already, but for its capitals, is that one."""
        changes: dict[str, Any] = {}
        if "name" in body:
            name = str(body["name"] or "").strip()
            if not 0 < len(name) <= NAME_MAX:
                raise HomeSetupError(f"Give it a name of up to {NAME_MAX} characters.")
            changes["name"] = name
        if "kind" in body:
            if body["kind"] not in KINDS:
                raise HomeSetupError("Choose what kind of device it is.")
            changes["kind"] = body["kind"]
        if "hidden" in body:
            if not isinstance(body["hidden"], bool):
                raise HomeSetupError("Say whether to leave it out of the breakdown.")
            changes["hidden"] = int(body["hidden"])
        if "estimate" in body:
            if not isinstance(body["estimate"], bool):
                raise HomeSetupError("Say whether to estimate what it draws while it runs.")
            changes["estimate"] = int(body["estimate"])
        if "group" in body:
            if body["group"] is not None and not isinstance(body["group"], str):
                raise HomeSetupError("Name the group, or leave it empty.")
            group = " ".join((body["group"] or "").split())
            if len(group) > NAME_MAX:
                raise HomeSetupError(f"Give the group a name of up to {NAME_MAX} characters.")
            changes["group"] = group or None
        with self._lock, self.db.writing() as conn:
            if self.repo.device(conn, device_id) is None:
                raise HomeSetupError("There's no such device.", 404)
            if changes.get("group"):
                there = {d.group.casefold(): d.group for d in self.repo.devices(conn) if d.group}
                changes["group"] = there.get(changes["group"].casefold(), changes["group"])
            self.repo.update_device(conn, device_id, **changes)
        return self.overview()

    def set_rule(self, device_id: int, body: dict[str, Any]) -> dict[str, Any]:
        """Run a switchable device on spare solar (rules.validate says how), or change how. Saving it resumes a rule
        paused by switching the device by hand."""
        with self.db.reading() as conn:
            d = self.repo.device(conn, device_id)
            account = self.repo.account(conn, d.account) if d else None
        if d is None or account is None:
            raise HomeSetupError("There's no such device.", 404)
        cls = self.available().get(account.integration)
        if cls is None or not cls.can_switch:
            raise HomeSetupError(f"{d.name} can't be switched from here, so it can't run on spare solar.", 409)
        try:
            settings = rules.validate(body, d.kind)
        except rules.RuleError as e:
            raise HomeSetupError(str(e)) from e
        if (self._now.get(d.id) or {}).get("switched_on") is None:
            raise HomeSetupError(
                f"{d.name} doesn't say whether it's on (or hasn't been read since the dashboard started), so a rule "
                "couldn't switch it.",
                409,
            )
        state = {k: v for k, v in (d.rule.get("state") or {}).items() if k != "paused_until"}
        with self._lock, self.db.writing() as conn:
            self.repo.save_rule(conn, device_id, {"settings": settings, "state": state})
        self.wake()
        return self.overview()

    def clear_rule(self, device_id: int) -> dict[str, Any]:
        """Stop running a device on spare solar (it's left as it is)."""
        with self._lock, self.db.writing() as conn:
            if self.repo.device(conn, device_id) is None:
                raise HomeSetupError("There's no such device.", 404)
            self.repo.save_rule(conn, device_id, {})
        return self.overview()

    def automate(self) -> None:
        """Follow each device's rule: switch it if its rule says to (rules.decide), with what's happening now.
        Blocking: run it in a thread."""
        if self.conditions is None:
            return
        devices = [d for d in self.repo.devices() if d.rule.get("settings", {}).get("enabled")]
        if not devices:
            return
        c = self.conditions()
        now = self.clock()
        accounts = {a.id: a for a in self.repo.accounts()}
        for d in devices:
            reading = self._now.get(d.id)
            account = accounts.get(d.account)
            cls = self.available().get(account.integration) if account else None
            if not reading or not account or not cls or not cls.can_switch or d.kind in rules.PROTECTED:
                continue
            if (
                not reading["online"]
                or reading.get("switched_on") is None
                or now - reading["at"] > 3 * cls.poll_seconds
            ):
                continue
            state = dict(d.rule.get("state") or {})
            decision = rules.decide(d.rule["settings"], state, reading["switched_on"], c, now)
            if decision is None:
                continue
            on, why = decision
            integration = cls(dict(account.saved))
            try:
                integration.switch(d.key, on)
            except IntegrationError as e:
                log.warning("A rule couldn't switch %s %s: %s", d.name, "on" if on else "off", e)
                state["at"] = now  # try again after the usual wait, not every pass
            else:
                log.info("A rule switched %s (%s) %s: %s", d.name, cls.name, "on" if on else "off", why)
                state.update(at=now, on_by_rule=on, last={"at": int(now), "on": on, "why": why})
                self._now[d.id] = {**reading, "switched_on": on}
            with self._lock, self.db.writing() as conn:
                current = self.repo.device(conn, d.id)
                if current is not None and current.rule.get("settings") == d.rule["settings"]:
                    self.repo.save_rule(conn, d.id, {**current.rule, "state": state})

    def raw(self, device_id: int) -> dict[str, Any]:
        """A device's properties as its integration last sent them, to check how they're read."""
        with self.db.reading() as conn:
            d = self.repo.device(conn, device_id)
        if d is None:
            raise HomeSetupError("There's no such device.", 404)
        return {"id": d.id, "name": d.name, **self._raw.get(d.id, {"ts": None, "properties": {}})}

    def now(self) -> dict[int, dict[str, Any]]:
        return dict(self._now)

    # -- polling --------------------------------------------------------------------
    def poll(self, account_id: int) -> None:
        """Read one account and record what its devices used. Blocking: run it in a thread."""
        ts = int(self.clock())
        with self.db.reading() as conn:
            account = self.repo.account(conn, account_id)
        cls = self.available().get(account.integration) if account else None
        if account is None or cls is None:
            return
        integration = cls(dict(account.saved))
        readings: list[Reading] = []
        state = dict(account.state)
        try:
            readings = integration.poll()
            state.update(last_poll=ts, error=None, signed_out=False, retry_at=None)
        except IntegrationError as e:
            state.update(error=str(e), signed_out=e.signed_out, retry_at=ts + e.retry_after if e.retry_after else None)
        except Exception as e:  # keep the loop going; the settings page shows the problem
            log.exception("Polling %s failed", cls.name)
            state.update(error=f"{cls.name} couldn't be read ({type(e).__name__}). Trying again shortly.")

        failures = 0 if state.get("error") is None else self._failures.get(account_id, 0) + 1
        self._failures[account_id] = failures
        self._due[account_id] = ts + min(BACKOFF_MAX, cls.poll_seconds * 2 ** min(failures, 6))
        with self._lock, self.db.writing() as conn:
            current = self.repo.account(conn, account_id)
            if current is None:  # disconnected while it was being read
                return
            self._apply(conn, account_id, [(ts, readings)], live=True)
            # Keep what it refreshed (a new token), unless it was signed in again while it was being read.
            keep = (
                integration.saved
                if _same(current.saved, account.saved) and not _same(integration.saved, account.saved)
                else None
            )
            self.repo.save_account(conn, account_id, saved=keep, state=state)

    def _apply(
        self, conn: sqlite3.Connection, account_id: int, batches: Iterable[tuple[int, list[Reading]]], live: bool
    ) -> None:
        """Put readings through their devices' meters, oldest first, adding devices seen for the first time."""
        devices = {d.key: d for d in self.repo.devices(conn, account_id)}
        meters: dict[int, Meter] = {d.id: d.meter for d in devices.values()}
        for ts, readings in batches:
            for r in readings:
                d = devices.get(r.key)
                if d is None:
                    kind = r.kind if r.kind in KINDS else "other"
                    d = devices[r.key] = self.repo.add_device(conn, account_id, r.key, r.name, kind, r.model, ts)
                    meters[d.id] = {}
                elif r.model and r.model != d.model:
                    self.repo.update_device(conn, d.id, model=r.model)
                s = step(meters[d.id], r, ts, d.kind)
                if s.energy:
                    self.repo.add_energy(conn, d.id, s.energy)
                if r.online and r.power_w is not None and 0 < r.power_w <= MAX_W:
                    self.repo.add_peak(conn, d.id, ts, r.power_w)
                for run in s.runs:  # before the meter's saved: a new run's id is set on it here
                    self.repo.save_run(conn, d.id, run)
                meters[d.id] = s.meter
                if live:
                    current = s.meter.get("run")
                    self._now[d.id] = {
                        "at": ts,
                        "online": r.online,
                        "power_w": r.power_w,
                        "running": bool(current),
                        "program": r.program if current else None,
                        "phase": r.phase if current else None,
                        "remaining_min": r.remaining_min if current else None,
                        "run": {"start": current["start"], "kwh": current["kwh"]} if current else None,
                        "details": dict(r.details),
                        "info": dict(r.info),
                        "switched_on": r.switched_on,
                        "battery": asdict(r.battery) if r.battery else None,
                    }
                    self._raw[d.id] = {"ts": ts, "properties": dict(r.raw)}
        for device_id, meter in meters.items():
            self.repo.save_meter(conn, device_id, meter)

    def _next_wait(self, now: float) -> float:
        """Seconds until an account is next due (a minute when nothing's connected, to notice one being added)."""
        accounts = [
            a for a in self.repo.accounts() if a.integration in self.available() and not a.state.get("signed_out")
        ]
        dues = [max(self._due.get(a.id, 0), a.state.get("retry_at") or 0) for a in accounts]
        return min(60.0, max(1.0, min(dues, default=now + 60) - now))

    def poll_due(self, now: float | None = None) -> None:
        """Poll every account whose time has come. Blocking: run it in a thread."""
        now = now if now is not None else self.clock()
        for a in self.repo.accounts():
            if a.integration not in self.available() or a.state.get("signed_out"):
                continue
            if now >= max(self._due.get(a.id, 0), a.state.get("retry_at") or 0):
                self.poll(a.id)

    async def start(self) -> None:
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def wake(self) -> None:
        """Poll what's due now (after connecting or signing in) rather than at the next check. Call from the event
        loop."""
        if self._wake:
            self._wake.set()

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.poll_due)
                await asyncio.to_thread(self.automate)
                wait = await asyncio.to_thread(self._next_wait, self.clock())
            except Exception:
                log.exception("Polling home devices failed")
                wait = 60
            assert self._wake is not None
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=wait)
            self._wake.clear()
