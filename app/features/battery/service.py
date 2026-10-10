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

Controls only start on a model they've been tried on (the driver's VERIFIED_TYPES), unless they've been turned on
for this inverter as an experiment (kv `battery_experimental`, kept to its model and serial). Ending a control and
putting the battery back always goes ahead.
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
from app.features.battery import plan
from app.features.inverters import drivers
from app.features.inverters.types import BatterySettings, ControlDriver, Writes
from app.features.live.client import CollectorClient, CollectorError
from app.features.live.service import LiveService

log = logging.getLogger(__name__)

CONTROL_KEY = "battery_control"  # kv: the control in effect (JSON), if any
LOG_KEY = "battery_control_log"  # kv: what the controls did lately (JSON list, newest last)
EXPERIMENTAL_KEY = "battery_experimental"  # kv: the inverter the controls were turned on for, untried on its model
LOG_KEPT = 200
TICK = 30  # seconds between the loop's checks while a control is in effect
FRESH = 20  # how long a read of the settings is shown before reading again
IDLE_READ = 55  # with no control in effect, how often the loop reads the settings (so the mode shown stays current)
GRACE = 180  # how long a gateway may take to show what was written before it counts as changed elsewhere
MAX_HOURS = 48
KINDS = ("standby", "floor", "charge")
FORCED_KINDS = ("standby", "charge")
OUTSIDE = (
    "isolarcloud",
    "external",
    "elsewhere",
)  # who else may have the battery, recorded as they're seen  # the ones that take the battery out of self-consumption
DEFAULT_CHARGE_W = 5000
MIN_CHARGE_W = 500

LABELS = {"standby": "Standby", "floor": "Reserve", "charge": "Grid charge"}


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


class Planner(Protocol):
    """What working a control out ahead needs (app.features.battery.plan): solar and home use to come, the price
    of grid power, and the most the battery charges or discharges at."""

    def conditions(self, now: int, latest: dict[str, Any] | None) -> plan.Conditions: ...

    def buy(self, start: int, end: int) -> Callable[[int], float]: ...

    def max_kw(self) -> float | None: ...


class ForecastPlanner:
    """The forecast's solar and home use, and the tariff's (or Amber's) price for each moment."""

    def __init__(self, forecast: Any, tariffs: Any, prices: Any, settings: Any):
        self.forecast, self.tariffs, self.prices, self.settings = forecast, tariffs, prices, settings
        self._steps: tuple[int, Any] | None = None  # (when, the forecast's steps then)

    def conditions(self, now: int, latest: dict[str, Any] | None) -> plan.Conditions:
        latest = latest or {}
        now_kw = ((latest.get("pv_power") or 0) / 1000, max(0.0, (latest.get("load_power") or 0) / 1000))
        # The forecast only moves with the weather: the same steps serve for five minutes.
        if self._steps is None or now - self._steps[0] >= 300:
            try:
                steps = self.forecast.steps(now, days=2)
            except Exception:  # the forecast isn't ready (no location, no weather yet): carry on as things are now
                log.debug("No forecast for the battery plan", exc_info=True)
                steps = None
            self._steps = (now, steps)
        return plan.conditions_from(self._steps[1], now_kw)

    def buy(self, start: int, end: int) -> Callable[[int], float]:
        from app.features.tariffs.costs import Pricer

        t, tables = self.tariffs.current()
        return Pricer(t, tables, self.prices, start, end).buy

    def max_kw(self) -> float | None:
        v = self.settings.get("battery_max_kw")
        return float(v) if v else None


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


def _outside(kind: str, command: str | None, power_w: float | None) -> str:
    """What something other than the dashboard had the battery doing, in words."""
    who = {"isolarcloud": "iSolarCloud", "external": "An energy manager"}.get(kind, "Forced mode set elsewhere")
    doing = {
        "charge": f"force charging{f' at {_kw(power_w)}' if power_w else ''}",
        "discharge": f"force discharging{f' at {_kw(power_w)}' if power_w else ''}",
        "stop": "on standby",
    }.get(command or "")
    return f"{who}: {doing}" if doing else f"{who} in control"


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
        planner: Planner | None = None,
    ):
        self.db = db
        self.live = live
        self.registers = registers
        self.clock = clock
        self.planner = planner
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

    def _began(self, control: dict[str, Any]) -> None:
        """Record a control starting (battery_controls), keeping its row's id with it."""
        with self.db.writing() as conn:
            cur = conn.execute(
                "INSERT INTO battery_controls (kind, started_at, until, floor, target, power_w) VALUES (?, ?, ?, ?, ?, ?)",
                (control["kind"], control["started_at"], control.get("until"), control.get("floor"),
                 control.get("target"), control.get("power_w")),
            )  # fmt: skip
            control["history_id"] = cur.lastrowid

    def _end(self, control: dict[str, Any], why: str) -> None:
        """A control is over: forget it, and record when and why it ended."""
        self._save(None)
        if control.get("history_id") is not None:
            with self.db.writing() as conn:
                conn.execute(
                    "UPDATE battery_controls SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL",
                    (int(self.clock()), why, control["history_id"]),
                )

    def history(self, start: int, end: int) -> list[dict[str, Any]]:
        """The controls in effect at any time in [start, end), and the stretches something else had the battery
        (kind isolarcloud, external, elsewhere), oldest first. `ended_at` null: still in effect."""
        self._recorded()
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT kind, started_at, ended_at, until, floor, target, power_w, ended_by, command"
                " FROM battery_controls WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at",
                (end, start),
            ).fetchall()
        keys = ("kind", "started_at", "ended_at", "until", "floor", "target", "power_w", "ended_by", "command")
        return [dict(zip(keys, r, strict=True)) for r in rows]

    def log(self, limit: int = 50) -> list[dict[str, Any]]:
        """What the controls did (and what was seen of other controllers), newest first: at most `limit`."""
        events: list[dict[str, Any]] = self._kv(LOG_KEY) or []
        return list(reversed(events))[: max(1, min(limit, LOG_KEPT))]

    def _recorded(self) -> None:
        """Make sure the control in effect has its row: one started before controls were recorded (or whose row
        couldn't be written) gets one from when it started."""
        control = self.control()
        if control is None or control.get("ending") or control.get("history_id") is not None:
            return
        with self._lock:
            control = self.control()
            if control is not None and not control.get("ending") and control.get("history_id") is None:
                self._began(control)
                self._save(control)

    def _seen(self, settings: BatterySettings | None) -> None:
        """Record what something other than the dashboard has the battery doing, as it changes: a stretch opens when
        iSolarCloud (or an energy manager, or forced mode set elsewhere) takes it, and closes when that ends."""
        if settings is None:
            return
        who = owner(settings, self.control())
        now = int(self.clock())
        kind, command = (who, settings.get("command")) if who in OUTSIDE else (None, None)
        with self.db.writing() as conn:
            row = conn.execute(
                "SELECT id, kind, command FROM battery_controls WHERE ended_at IS NULL AND kind IN (?, ?, ?)", OUTSIDE
            ).fetchone()
            if row and (row[1], row[2]) == (kind, command):
                return
            if row:
                conn.execute("UPDATE battery_controls SET ended_at = ?, ended_by = 'ended' WHERE id = ?", (now, row[0]))
            if kind:
                conn.execute(
                    "INSERT INTO battery_controls (kind, started_at, power_w, command) VALUES (?, ?, ?, ?)",
                    (kind, now, settings.get("power_w"), command),
                )
        if kind:
            self._note(f"{_outside(kind, command, settings.get('power_w'))} (seen on the inverter)", kind)
        elif row:
            self._note(f"{_outside(row[1], row[2], None)} ended; the battery is back to normal", row[1])

    # -- the inverter --------------------------------------------------------------------------
    def _driver(self) -> ControlDriver | None:
        return drivers.control(self.live.driver) if self.registers else None

    def _inverter(self) -> dict[str, Any]:
        """Which inverter is connected, to keep an experiment to it: its driver, model (device type) and serial."""
        info = self.live.info or {}
        return {"driver": self.live.driver, "device_type": info.get("device_type"), "serial": info.get("serial")}

    def verified(self, driver: ControlDriver) -> bool:
        """Whether the inverter is a model the controls have been tried on."""
        return (self.live.info or {}).get("device_type") in driver.VERIFIED_TYPES

    def experimental(self) -> bool:
        """Whether the controls were turned on for this inverter, on a model they haven't been tried on."""
        saved = self._kv(EXPERIMENTAL_KEY)
        here = self._inverter()
        return bool(saved) and here["device_type"] is not None and all(saved.get(k) == v for k, v in here.items())

    def untried(self, driver: ControlDriver) -> str | None:
        """Why the controls are off for this inverter's model, in words; None when they can be used (a model they've
        been tried on, or turned on for this inverter)."""
        if self.verified(driver) or self.experimental():
            return None
        code = (self.live.info or {}).get("device_type")
        if code is None:
            return "The inverter hasn't said which model it is yet, so the battery controls are off until it does."
        model = self.live.model
        this = f"this {model}" if model and not model.startswith("Unknown") else f"this inverter (model 0x{code:04X})"
        return f"The battery controls have only been tried on {driver.VERIFIED_LABEL}, so they're off for {this}."

    def set_experimental(self, on: Any) -> dict[str, Any]:
        """Turn the controls on for this inverter though they haven't been tried on its model, or back off."""
        if not isinstance(on, bool):
            raise BatteryError("Say whether to turn them on (true) or off (false).")
        driver = self._driver()
        if driver is None:
            raise BatteryError("This inverter's battery can't be controlled from the dashboard.", 409)
        with self._lock:
            if on and not self.verified(driver) and not self.experimental():
                here = self._inverter()
                if here["device_type"] is None:
                    raise BatteryError("The inverter hasn't said which model it is yet. Try again once it has.", 409)
                self._put(EXPERIMENTAL_KEY, {**here, "model": self.live.model, "at": int(self.clock())})
                self._note(f"Battery controls turned on for this {self.live.model or 'inverter'}, untried on its model")
            elif not on and self._kv(EXPERIMENTAL_KEY) is not None:
                self._put(EXPERIMENTAL_KEY, None)
                self._note("Experimental battery controls turned off")
        return self.view()

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

    def known(self) -> BatterySettings | None:
        """The settings as last read, without asking the inverter (the loop keeps them current); read now only if
        they never have been. For the page and previews, which mustn't wait on the inverter."""
        return self._settings if self._settings is not None else self.settings()

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
                "Connect the inverter first (Manage → Integrations)."
                if not self.live.driver
                else "This inverter's battery can't be controlled from the dashboard yet."
            )
            return {"supported": False, "reason": reason, "log": events}
        settings = self.known()
        control = self.control()
        who = owner(settings, control)
        verified = self.verified(driver)
        return {
            "supported": True,
            "model": self.live.model,
            # A model the controls have been tried on; if not, whether they were turned on for this inverter anyway,
            # or why they're off.
            "verified": verified,
            "experimental": not verified and self.experimental(),
            "untried": self.untried(driver),
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
            "plan": (current := self._plan_of(control, settings) if control and not control.get("ending") else None),
            # What's expected through tomorrow as things are set: the control in effect, then as normal.
            "outlook": current["ahead"] if current else self._outlook(settings),
        }

    # -- working it out ahead -------------------------------------------------------------------
    def _battery(self, settings: BatterySettings | None, usual_floor: float | None) -> plan.Battery | None:
        """The battery now, for working a control out ahead (None without its level or size)."""
        soc = (self.live.latest or {}).get("battery_soc")
        cap = self.live.battery_kwh()
        if soc is None or not cap or self.planner is None:
            return None
        s = settings or {}
        most = self.planner.max_kw() or (s.get("max_charge_w") or DEFAULT_CHARGE_W) / 1000
        reserve = usual_floor if usual_floor is not None else s.get("min_soc") or self.live.reserve()
        return plan.Battery(soc=soc, capacity_kwh=cap, reserve=reserve, top=s.get("max_soc") or 100.0, max_kw=most)

    def _project(self, b: plan.Battery, c: plan.Control) -> dict[str, Any]:
        assert self.planner is not None
        now = int(self.clock())
        cond = self.planner.conditions(now, self.live.latest)
        return plan.project(b, c, now, cond, self.planner.buy(now, now + plan.MAX_HOURS * 3600))

    def _plan_of(self, control: dict[str, Any], settings: BatterySettings | None) -> dict[str, Any] | None:
        """What the control in effect will do from now on."""
        b = self._battery(settings, control.get("usual_floor"))
        if b is None:
            return None
        c = plan.Control(control["kind"], control.get("until"), control.get("floor"), control.get("target"),
                         control.get("power_w"))  # fmt: skip
        return self._project(b, c)

    def _outlook(self, settings: BatterySettings | None) -> dict[str, Any] | None:
        """The battery from now to the end of tomorrow, running as normal."""
        b = self._battery(settings, None)
        if b is None or self.planner is None:
            return None
        now = int(self.clock())
        cond = self.planner.conditions(now, self.live.latest)
        return plan.outlook(b, None, now, cond, self.planner.buy(now, plan.end_of_tomorrow(now)), None)

    def preview(self, body: dict[str, Any]) -> dict[str, Any]:
        """What a control would do if started now (nothing is written): its level as it runs, when it ends, what
        comes from the grid and what that costs, and the same stretch as normal."""
        driver = self._driver()
        if driver is None:
            raise BatteryError("This inverter's battery can't be controlled from the dashboard.", 409)
        if reason := self.untried(driver):
            raise BatteryError(reason, 409)
        settings = self.known()
        if settings is None:
            raise BatteryError("The inverter's battery settings couldn't be read.", 502)
        control = self.control()
        usual = control["usual_floor"] if control and control["kind"] == "floor" else settings.get("min_soc")
        spec = self._spec(body, driver, settings, self.clock())
        b = self._battery(settings, usual)
        if b is None:
            raise BatteryError("The battery's level isn't known yet, so it can't be worked out.", 409)
        return self._project(b, plan.Control(spec["kind"], spec["until"], spec.get("floor"), spec.get("target"),
                                             spec.get("power_w")))  # fmt: skip

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

    def _spec(
        self, body: dict[str, Any], driver: ControlDriver, settings: BatterySettings, now: float
    ) -> dict[str, Any]:
        """A control as asked for, checked: kind, until, and its floor, or its power and level. Raises BatteryError."""
        kind = body.get("kind")
        if kind not in KINDS:
            raise BatteryError(f"Choose a control: {', '.join(KINDS)}.")
        spec: dict[str, Any] = {"kind": kind, "until": self._until(body, now)}
        if kind == "floor":
            low, high = driver.FLOOR_RANGE
            spec["floor"] = round(self._number(body, "floor", "reserve", low, high, None))
        elif kind == "charge":
            top = settings.get("max_soc") or 100.0
            most = int(settings.get("max_charge_w") or DEFAULT_CHARGE_W)
            power = round(
                self._number(body, "power_w", "charging power", MIN_CHARGE_W, most, min(most, DEFAULT_CHARGE_W))
            )
            soc = (self.live.latest or {}).get("battery_soc")
            target = round(self._number(body, "target", "level to charge to", 10, top, top))
            if soc is not None and soc >= target:
                raise BatteryError(f"The battery is already at {soc:.0f}%.")
            spec.update(power_w=power, target=target)
        return spec

    def start(self, body: dict[str, Any]) -> dict[str, Any]:
        """Start a control (replacing any in effect): body {"kind": "standby"|"floor"|"charge", "until": unix seconds
        or null, "floor": %, "power_w": W, "target": %}."""
        driver = self._driver()
        if driver is None:
            raise BatteryError("This inverter's battery can't be controlled from the dashboard.", 409)
        if reason := self.untried(driver):  # nothing is written to a model the controls haven't been tried on
            raise BatteryError(reason, 409)
        if body.get("kind") not in KINDS:
            raise BatteryError(f"Choose a control: {', '.join(KINDS)}.")
        with self._lock:
            now = self.clock()
            self._until(body, now)  # a bad time is turned away before the inverter is asked anything
            settings = self._read(driver)
            spec = self._spec(body, driver, settings, now)
            kind, until = spec["kind"], spec["until"]
            current = self.control()
            who = owner(settings, current)
            if reason := blocked(settings, who):
                raise BatteryError(reason, 409)

            # What it was before any control here: the floor to put back.
            usual_floor = settings.get("min_soc")
            if current and current["kind"] == "floor":
                usual_floor = current["usual_floor"]
            control: dict[str, Any] = {**spec, "started_at": int(now), "usual_floor": usual_floor}
            if kind == "standby":
                writes = driver.standby()
                restore = driver.normal()
                text = "Battery on standby: the house runs on solar and the grid"
            elif kind == "floor":
                if usual_floor is None:
                    raise BatteryError("The inverter didn't report its usual reserve, so it couldn't be put back.", 502)
                writes = driver.floor(spec["floor"])
                restore = driver.floor(usual_floor)
                text = f"Reserve raised to {spec['floor']}%: below it the house runs on the grid"
            else:
                writes = driver.charge(spec["power_w"])
                restore = driver.normal()
                text = f"Charging from the grid at {_kw(spec['power_w'])} to {spec['target']}%"

            # Undo the control in effect where the new one doesn't simply replace it: a floor's min SOC, or the
            # forced mode of standby or a charge when a floor follows.
            before: Writes = []
            if current and current["kind"] != kind and not (kind in FORCED_KINDS and current["kind"] in FORCED_KINDS):
                before = _pairs(current["restore"])
            back = self._write(driver, before + writes)
            if current:
                self._end(current, "replaced")
            control.update(
                writes=writes,
                restore=restore,
                written_at=int(self.clock()),
                confirmed=bool(back and driver.holds(back, writes)),
            )
            self._began(control)
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
            self._end(control, control["ending"])
            self._note(f"{label} ended ({why}); the battery was already under other control", control["kind"])
            return
        if control["kind"] == "floor" and who != "normal":
            if not self._waiting_noted:
                self._waiting_noted = True
                self._note(
                    f"{label} ended ({why}); the usual reserve goes back once iSolarCloud's command ends", "floor"
                )
            return
        self._write(driver, _pairs(control["restore"]))
        self._end(control, control["ending"])
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
                    self._end(control, "elsewhere")
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

    def summary(self) -> dict[str, Any] | None:
        """The battery's mode for every page (the live status's `battery_mode`): who has it (see owner), the control
        in effect here, or what another controller is doing; the floor; and why the controls are off for this model
        (`untried`), if they are. From the last read; None when this inverter's battery can't be controlled."""
        driver = self._driver()
        if driver is None:
            return None
        settings, control = self._settings, self.control()
        who = owner(settings, control)
        out: dict[str, Any] = {
            "owner": who,
            "untried": self.untried(driver),
            "min_soc": (settings or {}).get("min_soc"),
            "max_soc": (settings or {}).get("max_soc"),
        }
        if control:
            out.update({k: control.get(k) for k in ("kind", "until", "floor", "target", "power_w", "ending")})
        elif settings and who not in ("normal", None):
            out.update(command=settings.get("command"), power_w=settings.get("power_w"))
        return out

    def _cycle(self) -> dict[str, Any] | None:
        """One turn of the loop: check the control in effect, or read the settings now and then so another
        controller taking the battery shows. The summary after."""
        if self.control() is not None:
            self._recorded()
            self.tick()
        elif self._driver() is not None and self.clock() - self._read_at >= IDLE_READ:
            self.settings(fresh=True)
        if self._driver() is not None and self._read_error is None:
            self._seen(self._settings)
        return self.summary()

    async def publish(self, summary: dict[str, Any] | None = None) -> None:
        """Put the battery's mode in the live status, and send it to every page if it changed. On the event loop."""
        if summary is None:
            summary = await asyncio.to_thread(self.summary)
        if summary != self.live.battery_mode:
            self.live.battery_mode = summary
            self.live.publish()

    async def _run(self) -> None:
        while True:
            try:
                await self.publish(await asyncio.to_thread(self._cycle))
            except Exception:
                log.exception("Checking the battery control failed")
            await asyncio.sleep(TICK)
