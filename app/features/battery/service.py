"""
Battery controls: put the home battery on standby, set a floor it won't discharge below, or charge it from the
grid, each for a while or until stopped. The inverter does the work (its driver's control module says what to
write, app.features.inverters.sungrow.sh_control); the collector reads and writes its settings registers.

One control at a time. What it wrote, and what puts things back, are saved (kv `battery_control`), so a restart
doesn't leave the battery stuck: the loop ends each control when its time is up (or a charge reaches its level)
and puts the battery back to normal.

The dashboard never fights another controller. While iSolarCloud (VPP mode: its app's remote commands), an
external energy manager, or anything else has the battery, the controls only show what it's doing:
nothing is written, not even putting back a floor that ended meanwhile (that waits until the battery is back
in self-consumption). And when the battery's settings stop being what the dashboard wrote (changed in
iSolarCloud, or the inverter didn't take them), the dashboard lets go rather than writing them again.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import threading
import time
from collections.abc import Callable
from typing import Any, Protocol

from app.core.database import Database
from app.features.inverters import drivers
from app.features.inverters.types import BatterySettings, ControlDriver, Writes
from app.features.live.client import CollectorClient, CollectorError
from app.features.live.service import LiveService

log = logging.getLogger(__name__)

CONTROL_KEY = "battery_control"  # kv: the control in effect (JSON), if any
LOG_KEY = "battery_control_log"  # kv: what the controls did lately (JSON list, newest last)
LOG_KEPT = 30
TICK = 30  # seconds between the loop's checks while a control is in effect
FRESH = 20  # how long a read of the settings is shown before reading again
GRACE = 180  # how long a gateway may take to show what was written before it counts as changed elsewhere
MAX_HOURS = 48
KINDS = ("standby", "floor", "charge")
FORCED_KINDS = ("standby", "charge")  # the ones that take the battery out of self-consumption
DEFAULT_CHARGE_W = 5000
MIN_CHARGE_W = 500

LABELS = {"standby": "Standby", "floor": "Floor", "charge": "Grid charge"}


class BatteryError(ValueError):
    """A control that can't be done, in words; `status` is the HTTP status to answer with."""

    def __init__(self, detail: str, status: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status = status


class Registers(Protocol):
    """The hybrid's settings registers: the collector's, or the mock inverter's."""

    def read(self) -> dict[int, int]: ...

    def write(self, words: Writes) -> dict[int, int]:
        """Write in order; what they read back as afterwards (empty if that couldn't be read)."""
        ...


class CollectorRegisters:
    """The hybrid's settings, read and written through the collector."""

    def __init__(self, client: CollectorClient):
        self.client = client

    def read(self) -> dict[int, int]:
        return self.client.holding("hybrid")

    def write(self, words: Writes) -> dict[int, int]:
        return self.client.write_holding("hybrid", words)


def owner(settings: BatterySettings | None, control: dict[str, Any] | None) -> str | None:
    """Who has the battery: "normal" (self-consumption), "dashboard" (forced by a control here), "isolarcloud"
    (VPP mode: a command from iSolarCloud), "external" (an energy manager), "elsewhere" (forced, but not from
    here) or "unknown" (a mode not known). None when the settings couldn't be read."""
    if not settings or settings.get("mode") is None:
        return None
    mode = settings["mode"]
    if mode == "self":
        return "normal"
    if mode == "forced":
        return "dashboard" if control and control["kind"] in FORCED_KINDS else "elsewhere"
    if mode == "vpp":
        return "isolarcloud"
    if mode == "external":
        return "external"
    return "unknown"


def _pairs(raw: list[list[int]]) -> Writes:
    """Writes as saved (JSON lists) back as (address, word) pairs."""
    return [(a, w) for a, w in raw]


def _kw(w: float | None) -> str:
    return f"{(w or 0) / 1000:.1f} kW"


def blocked(settings: BatterySettings | None, who: str | None) -> str | None:
    """Why the controls can't be used now, in words; None when they can."""
    if who in ("normal", "dashboard"):
        return None
    if who is None:
        return "The inverter's battery settings couldn't be read, so the controls are off until they can be."
    s = settings or {}
    doing = {
        "charge": f": a forced charge at {_kw(s.get('power_w'))}",
        "discharge": f": a forced discharge at {_kw(s.get('power_w'))}",
        "stop": ": the battery on standby",
    }.get(s.get("command") or "", "")
    if who == "isolarcloud":
        return (
            f"iSolarCloud is controlling the battery right now{doing}. The controls here come back once that "
            "ends; stop it in the iSolarCloud app to end it sooner."
        )
    if who == "external":
        return "An external energy manager is controlling the battery, so the controls here are off."
    if who == "elsewhere":
        return (
            f"The battery was put in forced mode outside the dashboard{doing}. The controls here come back once "
            "it's back in self-consumption (in the iSolarCloud app)."
        )
    return f"The inverter reports a battery mode the dashboard doesn't know ({s.get('mode_code')}), so the controls are off."


class BatteryService:
    def __init__(
        self,
        db: Database,
        live: LiveService,
        registers: Registers | None,
        clock: Callable[[], float] = time.time,
    ):
        self.db = db
        self.live = live
        self.registers = registers
        self.clock = clock
        self._lock = threading.Lock()  # one change at a time: requests and the loop
        self._settings: BatterySettings | None = None
        self._read_at = 0.0
        self._read_error: str | None = None
        self._waiting_noted = False  # "waiting to put the floor back" logged once per wait
        self._task: asyncio.Task[None] | None = None

    # -- storage ------------------------------------------------------------------------------
    def _kv(self, key: str) -> Any:
        with self.db.reading() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def _put(self, key: str, value: Any) -> None:
        with self.db.writing() as conn:
            if value is None:
                conn.execute("DELETE FROM kv WHERE key = ?", (key,))
            else:
                conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (key, json.dumps(value)))

    def control(self) -> dict[str, Any] | None:
        """The control in effect (or ended, waiting to put things back), if any."""
        c: dict[str, Any] | None = self._kv(CONTROL_KEY)
        return c

    def _save(self, control: dict[str, Any] | None) -> None:
        self._put(CONTROL_KEY, control)

    def _note(self, text: str, kind: str | None = None, until: int | None = None) -> None:
        log.info("Battery: %s", text)
        events = (self._kv(LOG_KEY) or [])[-(LOG_KEPT - 1) :]
        events.append({"ts": int(self.clock()), "text": text, "kind": kind, "until": until})
        self._put(LOG_KEY, events)

    # -- the inverter --------------------------------------------------------------------------
    def _driver(self) -> ControlDriver | None:
        return drivers.control(self.live.driver) if self.registers else None

    def _took(self, words: dict[int, int], driver: ControlDriver) -> BatterySettings | None:
        """Note settings just read (empty: none came back)."""
        if not words:
            return None
        settings = driver.decode(words)
        self._settings, self._read_at, self._read_error = settings, self.clock(), None
        if settings.get("min_soc") is not None:  # the reserve shown everywhere follows a floor at once
            self.live.info = {**self.live.info, "reserve": settings["min_soc"]}
        return settings

    def _read(self, driver: ControlDriver) -> BatterySettings:
        """The settings, read now. Raises BatteryError(502) when they can't be."""
        assert self.registers is not None
        try:
            words = self.registers.read()
        except CollectorError as e:
            self._read_error = e.detail
            raise BatteryError(e.detail, 502 if e.status >= 500 else e.status) from e
        settings = self._took(words, driver)
        if settings is None:
            raise BatteryError("The inverter returned none of its battery settings.", 502)
        return settings

    def _write(self, driver: ControlDriver, words: Writes) -> BatterySettings | None:
        """Write, and what the settings read back as (None if they couldn't be read). Raises BatteryError."""
        assert self.registers is not None
        try:
            back = self.registers.write(words)
        except CollectorError as e:
            raise BatteryError(e.detail, 502 if e.status >= 500 else e.status) from e
        return self._took(back, driver)

    def settings(self, fresh: bool = False) -> BatterySettings | None:
        """The settings: as last read if that's recent, else read now (None if that fails)."""
        driver = self._driver()
        if driver is None:
            return None
        if fresh or self._settings is None or self.clock() - self._read_at > FRESH:
            with contextlib.suppress(BatteryError):
                self._read(driver)
        return self._settings

    # -- what the dashboard shows ----------------------------------------------------------------
    def view(self) -> dict[str, Any]:
        driver = self._driver()
        events = list(reversed(self._kv(LOG_KEY) or []))[:10]
        if driver is None:
            reason = (
                "Connect the inverter first (Settings → Integrations)."
                if not self.live.driver
                else "This inverter's battery can't be controlled from the dashboard yet."
            )
            return {"supported": False, "reason": reason, "log": events}
        settings = self.settings()
        control = self.control()
        who = owner(settings, control)
        return {
            "supported": True,
            "settings": settings,
            "read_at": self._read_at or None,
            "error": self._read_error,
            "owner": who,
            "blocked": blocked(settings, who),
            "control": control and {k: v for k, v in control.items() if k not in ("writes", "restore")},
            "limits": {
                "floor": list(driver.FLOOR_RANGE),
                "charge_w": [MIN_CHARGE_W, int((settings or {}).get("max_charge_w") or DEFAULT_CHARGE_W)],
                "max_hours": MAX_HOURS,
            },
            "log": events,
        }

    # -- changes ---------------------------------------------------------------------------------
    def _until(self, body: dict[str, Any], now: float) -> int | None:
        until = body.get("until")
        if until is None:
            return None
        if not isinstance(until, (int, float)) or isinstance(until, bool):
            raise BatteryError("Say until when, as a time, or leave it on until it's stopped.")
        if until <= now:
            raise BatteryError("That time has already passed.")
        if until > now + MAX_HOURS * 3600:
            raise BatteryError(f"A control can be set for up to {MAX_HOURS} hours, or until it's stopped.")
        return int(until)

    @staticmethod
    def _number(body: dict[str, Any], key: str, name: str, low: float, high: float, default: float | None) -> float:
        value = body.get(key, default)
        if value is None:
            raise BatteryError(f"Give the {name}.")
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not low <= value <= high:
            raise BatteryError(f"The {name} must be between {low:g} and {high:g}.")
        return float(value)

    def start(self, body: dict[str, Any]) -> dict[str, Any]:
        """Start a control (replacing any in effect): body {"kind": "standby"|"floor"|"charge", "until": unix seconds
        or null, "floor": %, "power_w": W, "target": %}."""
        driver = self._driver()
        if driver is None:
            raise BatteryError("This inverter's battery can't be controlled from the dashboard.", 409)
        kind = body.get("kind")
        if kind not in KINDS:
            raise BatteryError(f"Choose a control: {', '.join(KINDS)}.")
        with self._lock:
            now = self.clock()
            until = self._until(body, now)
            settings = self._read(driver)
            current = self.control()
            who = owner(settings, current)
            if reason := blocked(settings, who):
                raise BatteryError(reason, 409)

            # What it was before any control here: the floor to put back.
            usual_floor = settings.get("min_soc")
            if current and current["kind"] == "floor":
                usual_floor = current["usual_floor"]
            control: dict[str, Any] = {"kind": kind, "started_at": int(now), "until": until, "usual_floor": usual_floor}
            if kind == "standby":
                writes = driver.standby()
                restore = driver.normal()
                text = "Battery on standby: the house runs on solar and the grid"
            elif kind == "floor":
                low, high = driver.FLOOR_RANGE
                pct = round(self._number(body, "floor", "floor", low, high, None))
                if usual_floor is None:
                    raise BatteryError("The inverter didn't report its usual floor, so it couldn't be put back.", 502)
                control["floor"] = pct
                writes = driver.floor(pct)
                restore = driver.floor(usual_floor)
                text = f"Floor set to {pct}%: below it the house runs on the grid"
            else:
                top = settings.get("max_soc") or 100.0
                most = int(settings.get("max_charge_w") or DEFAULT_CHARGE_W)
                power = round(
                    self._number(body, "power_w", "charging power", MIN_CHARGE_W, most, min(most, DEFAULT_CHARGE_W))
                )
                soc = (self.live.latest or {}).get("battery_soc")
                target = round(self._number(body, "target", "level to charge to", 10, top, top))
                if soc is not None and soc >= target:
                    raise BatteryError(f"The battery is already at {soc:.0f}%.")
                control.update(power_w=power, target=target)
                writes = driver.charge(power)
                restore = driver.normal()
                text = f"Charging from the grid at {_kw(power)} to {target}%"

            # Undo the control in effect where the new one doesn't simply replace it: a floor's min SOC, or the
            # forced mode of standby or a charge when a floor follows.
            before: Writes = []
            if current and current["kind"] != kind and not (kind in FORCED_KINDS and current["kind"] in FORCED_KINDS):
                before = _pairs(current["restore"])
            back = self._write(driver, before + writes)
            control.update(
                writes=writes,
                restore=restore,
                written_at=int(self.clock()),
                confirmed=bool(back and driver.holds(back, writes)),
            )
            self._save(control)
            self._note(text, kind, until)
        return self.view()

    def stop(self) -> dict[str, Any]:
        """End the control in effect now and put the battery back to normal."""
        driver = self._driver()
        with self._lock:
            current = self.control()
            if current is None or driver is None:
                return self.view()
            current["ending"] = current.get("ending") or "stopped"
            self._save(current)
            self._finish(driver, current, self._read(driver))
        return self.view()

    # -- the loop ----------------------------------------------------------------------------------
    def _finish(self, driver: ControlDriver, control: dict[str, Any], settings: BatterySettings) -> None:
        """Put back what an ended control changed, unless something else has the battery now."""
        who = owner(settings, control)
        label = LABELS[control["kind"]]
        why = {
            "time": "time's up",
            "target": f"reached {control.get('target')}%",
            "full": "the battery is full",
            "stopped": "stopped",
        }.get(control["ending"], control["ending"])
        if control["kind"] in FORCED_KINDS and who != "dashboard":
            # Something else took the battery over meanwhile: nothing of ours left to undo.
            self._save(None)
            self._note(f"{label} ended ({why}); the battery was already under other control", control["kind"])
            return
        if control["kind"] == "floor" and who != "normal":
            if not self._waiting_noted:
                self._waiting_noted = True
                self._note(f"{label} ended ({why}); the usual floor goes back once iSolarCloud's command ends", "floor")
            return
        self._write(driver, _pairs(control["restore"]))
        self._save(None)
        self._waiting_noted = False
        self._note(f"{label} ended ({why}); the battery is back to normal", control["kind"])

    def _ended(self, control: dict[str, Any], now: float) -> str | None:
        """Why a control in effect is done ("time", "target", "full"), or None while it isn't."""
        if control.get("until") and now >= control["until"]:
            return "time"
        if control["kind"] == "charge":
            latest = self.live.latest or {}
            soc, power = latest.get("battery_soc"), latest.get("battery_power")
            top = (self._settings or {}).get("max_soc") or 100.0
            if soc is not None and soc >= control["target"]:
                return "target"
            # A battery tops out a little short of its max now and then: it stops taking charge, and the
            # level never reaches the target.
            if soc is not None and power is not None and soc >= top - 2 and power > -50:
                return "full"
        return None

    def tick(self) -> None:
        """End controls that are done, and let go of any changed elsewhere. Blocking: run it in a thread."""
        driver = self._driver()
        if driver is None or self.control() is None:
            return
        with self._lock:
            control = self.control()
            if control is None:
                return
            try:
                settings = self._read(driver)
            except BatteryError as e:
                log.warning("Battery: couldn't check the control in effect: %s", e.detail)
                return
            now = self.clock()
            if not control.get("ending"):
                if not driver.holds(settings, _pairs(control["writes"])):
                    if now - control["written_at"] < GRACE:
                        return  # the gateway may not show the change yet
                    self._save(None)
                    why = (
                        "iSolarCloud took over the battery"
                        if owner(settings, None) == "isolarcloud"
                        else "its settings were changed outside the dashboard, or the inverter didn't take them"
                    )
                    self._note(f"{LABELS[control['kind']]} ended: {why}", control["kind"])
                    return
                control["confirmed"] = True
                control["ending"] = self._ended(control, now)
                self._save(control)
                if not control["ending"]:
                    return
            try:
                self._finish(driver, control, settings)
            except BatteryError as e:
                log.warning("Battery: couldn't put the battery back to normal (will try again): %s", e.detail)

    async def start_loop(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop_loop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.tick)
            except Exception:
                log.exception("Checking the battery control failed")
            await asyncio.sleep(TICK)
