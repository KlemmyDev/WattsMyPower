"""
Hyundai and Kia (Manage → Integrations → Electric vehicles → Hyundai and Kia, and the EV page): the account's cars,
read from the maker's cloud (app.features.bluelink.client), each with its charge, range, plug and charging, and
charged from spare solar the way a Tesla is: the same controller (app.features.tesla.control) decides when to start
and stop, with the same modes, who gets the sun first, how far short it may run, timing and holds.

What's different from a Tesla: the charging current can't be set from the cloud, so the car charges at whatever its
charger gives (its charging power, set per car: a 10 A portable charger's 2.4 kW by default, or what a CCS2 car
measured while charging at home). The controller sees it as a charger with a single step, that power: it starts the
car once there's been that much spare for a while and stops it once there's been too little for a while, and never
changes its speed.

The cloud only knows what the car last sent it: when it's plugged in or out, starts or stops charging, takes a command,
or is asked (a forced read, which wakes the car's modem and draws on its 12 V battery). So the cars are read from the
cloud every 15 minutes (every 5 while one could charge from solar or is charging), and the car itself is only asked
by day, in Spare solar mode, at most every two hours (each car's to change, or turn off), when what the cloud has is
that old. After a command the car is taken to have done it until it says otherwise (the command's outcome, then its
next state). Too many requests in a day and the cloud refuses more: the dashboard then leaves it alone for an hour.

The account's email, password and PIN are kept on this server (the sign-in needs them each time it runs out; the PIN
each time a command is sent to a CCS2 car) and only ever sent to the maker.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import asdict
from typing import Any

from app.core.config import DEMO_LOCATION, Config
from app.core.database import Database
from app.features.bluelink.client import (
    BRANDS,
    LIMITS,
    REGIONS,
    Account,
    BluelinkAccount,
    BluelinkError,
    email_hint,
)
from app.features.bluelink.mock import DemoBluelink
from app.features.live.service import LiveService
from app.features.settings.store import SettingsStore
from app.features.tesla import control
from app.features.tesla.control import CarState, Charger, Decision, Memory
from app.features.weather import sun

log = logging.getLogger(__name__)

CONN_KEY = "bluelink"  # kv: the account (email, password, PIN, make, country), each car as last read, its settings
MEMORY_KEY = "bluelink_memory"  # kv: what the dashboard last did with each car (control.Memory)
LOG_KEY = "bluelink_log"  # kv: what it did lately (JSON list, newest last)
LOG_KEPT = 100
TICK = 20  # seconds between the loop's turns: spare power is sampled and each car steered each turn
POLL = 900  # seconds between reads of the cloud's copy of the cars
POLL_ACTIVE = 300  # while one could charge from solar now, or is charging
AFTER_COMMAND = 45  # read again this soon after a command: the car sends its state once it's done it
BACKOFF = (60, 300, 900, 1800)  # after a failed read, before trying again (one more step each failure in a row)
LIMITED = 3600  # after the cloud said too many requests
REFUSALS = 3  # sign-ins turned down in a row in the background before it waits to be signed in again
CMD_BACKOFF = (60, 120, 300, 600)  # before sending again after 1, 2, 3, 4+ commands in a row that failed
FORCE_CHOICES = (0, 3600, 7200, 14400)  # how often the car itself may be asked (0: never): each car's to choose
FORCE_EVERY = 7200
FORCE_MIN = 600  # the page may ask a car itself at most this often
OUTCOME_EVERY = 15  # seconds between asking how a command went
OUTCOME_FOR = 180  # and for how long
CHARGE_W = (1000, 22000, 2400)  # a car's charging power at home (W): lowest, highest, the default (10 A portable)
MEASURE_FROM_KW = 0.5  # a CCS2 car's charging power at home is kept once it's at least this
STALE_READING = 240  # an inverter reading older than this isn't used for spare power
SETTLE = 30  # seconds after a command before an inverter reading counts: the car ramps up
SAMPLES = 400
AHEAD_EVERY = 300
NIGHT_ELEVATION = 0.0
WORDS = {"off": "Charging control off", "solar": "Charging from spare solar"}


class BluelinkSetupError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _duration(minutes: float) -> str:
    h, m = divmod(round(minutes), 60)
    return f"{h} h {m} min" if h and m else f"{h} h" if h else f"{m} min"


def car_state(vin: str, car: dict[str, Any], home: tuple[float, float] | None) -> CarState | None:
    """A car as the controller sees it (control.CarState), from what the cloud last had: Tesla's charging states
    (Disconnected, Charging, Complete, Stopped) from its plug, charging and charge against its limit; at home when it's
    parked within 500 m of `home`. It's always awake to the controller (the cloud takes commands either way), and set
    to its one step of current (see the module's docstring). None until the car's said anything."""
    st = car.get("state")
    if not st:
        return None
    loc = tuple(st["location"]) if st.get("location") else None
    at_home = None if loc is None or home is None else control.distance_m(loc, home) <= control.HOME_RADIUS_M
    soc, limit = st.get("soc"), st.get("limit")
    if st.get("charging"):
        cs = "Charging"
    elif not st.get("plugged"):
        cs = "Disconnected" if st.get("plugged") is False else ""
    elif soc is not None and limit is not None and soc >= limit:
        cs = "Complete"
    else:
        cs = "Stopped"
    return CarState(
        vin=vin,
        name=car.get("name"),
        as_of=st.get("as_of"),
        asleep=False,
        charging_state=cs,
        soc=soc,
        limit=limit,
        range_km=st.get("range_km"),
        request_amps=1,
        max_amps=None,
        actual_amps=None,
        volts=None,
        power_kw=st.get("power_kw"),
        charger_phases=None,
        energy_added=None,
        minutes_to_full=st.get("minutes_to_full"),
        at_home=at_home,
        location=loc,
        fast_charger=bool(st.get("fast")),
        model=None,
    )


def charger(charge_w: float) -> Charger:
    """The car's charger as the controller sees it: one step of current, its whole charging power (so spare power
    covers "one amp" once it's at least that, and the current is never changed)."""
    return Charger(phases=1, volts=float(charge_w), min_amps=1, max_amps=1)


class BluelinkService:
    def __init__(
        self,
        config: Config,
        db: Database,
        live: LiveService,
        settings: SettingsStore,
        forecast: Any = None,
        clock: Callable[[], float] = time.time,
        account: Callable[[str, str, str, str, str], Account] | None = None,
    ):
        self.config = config
        self.db = db
        self.live = live
        self.settings = settings
        self.forecast = forecast  # app.features.forecast.service.ForecastService: when spare solar is expected
        self.clock = clock
        self._make_account = account or self._default_account
        self._demo: DemoBluelink | None = None
        self._account: Account | None = None  # kept between reads, so it stays signed in
        self._lock = asyncio.Lock()  # one read, command or change at a time
        self._error: str | None = None
        self._signed_out = False  # the email and password were turned down: not tried again until they're entered
        self._failed = 0  # failed reads in a row (BACKOFF)
        self._refusals = 0  # sign-ins turned down in a row (REFUSALS)
        self._next_read = 0.0
        self._retry_at = 0.0  # after a failed read: not read again before this, however soon one's wanted
        self._reading = False
        self._samples: dict[str, deque[tuple[int, float]]] = {}
        self._assumed: dict[str, dict[str, Any]] = {}  # vin -> {charging, at}: what a command it took did
        self._pending: dict[str, dict[str, Any]] = {}  # vin -> {id, action, at, asked}: a command not yet confirmed
        self._ahead: tuple[int, list[dict[str, Any]], dict[str, Any]] | None = None
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    def _default_account(self, username: str, password: str, pin: str, region: str, brand: str) -> Account:
        if self.config.mock:
            if self._demo is None:
                self._demo = DemoBluelink(lambda: self.home() or DEMO_LOCATION, self.clock)
            return self._demo
        return BluelinkAccount(username, password, pin, region, brand)

    # -- storage ---------------------------------------------------------------------------
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

    def _conn(self) -> dict[str, Any]:
        c = self._kv(CONN_KEY) or {}
        c.setdefault("cars", {})
        c.setdefault("settings", {})
        return c

    def _memory(self, vin: str) -> Memory:
        return Memory.load((self._kv(MEMORY_KEY) or {}).get(vin))

    def _remember(self, vin: str, mem: Memory | None) -> None:
        all_ = self._kv(MEMORY_KEY) or {}
        if mem is None:
            all_.pop(vin, None)
        else:
            all_[vin] = mem.dump()
        self._put(MEMORY_KEY, all_)

    def _note(self, vin: str, text: str, kind: str | None = None) -> None:
        entries = self._kv(LOG_KEY) or []
        entries.append({"ts": int(self.clock()), "vin": vin, "text": text, "kind": kind})
        self._put(LOG_KEY, entries[-LOG_KEPT:])
        log.info("%s: %s", vin[-6:], text)

    def _events(self, vin: str, limit: int = 6) -> list[dict[str, Any]]:
        return [e for e in reversed(self._kv(LOG_KEY) or []) if e["vin"] == vin][:limit]

    @staticmethod
    def _connected(c: dict[str, Any]) -> bool:
        return bool(c.get("username"))

    def _acct(self, c: dict[str, Any]) -> Account:
        if self._account is None:
            self._account = self._make_account(
                c["username"], c["password"], c.get("pin") or "", c.get("region") or "AU", c.get("brand") or "hyundai"
            )
        return self._account

    def home(self) -> tuple[float, float] | None:
        """The house's location, None until it's been chosen."""
        return self.settings.location()

    # -- each car's settings ------------------------------------------------------------------
    @staticmethod
    def _settings(c: dict[str, Any], vin: str) -> dict[str, Any]:
        s = c["settings"].get(vin) or {}
        cfg = control.clean({}, s.get("control"))
        cfg.setdefault("charge_w", None)
        cfg.setdefault("force_every", FORCE_EVERY)
        return {**s, "control": cfg}

    def _home_of(self, c: dict[str, Any], vin: str) -> tuple[float, float] | None:
        h = self._settings(c, vin).get("home")
        return (float(h[0]), float(h[1])) if h else self.home()

    def _charge_w(self, c: dict[str, Any], vin: str) -> tuple[float, str]:
        """The car's charging power at home (W), and where it's from: "set" (on the EV page), "measured" (by a CCS2
        car while charging at home) or "default"."""
        s = self._settings(c, vin)
        if s["control"].get("charge_w"):
            return float(s["control"]["charge_w"]), "set"
        if s.get("measured_w"):
            return float(s["measured_w"]), "measured"
        return float(CHARGE_W[2]), "default"

    def _state(self, c: dict[str, Any], vin: str) -> CarState | None:
        car = c["cars"].get(vin)
        return car_state(vin, car, self._home_of(c, vin)) if car else None

    def _can_command(self, c: dict[str, Any], vin: str) -> bool:
        """Whether commands can be sent to the car: a CCS2 car needs the app's PIN."""
        return not (c["cars"].get(vin) or {}).get("ccs2") or bool(c.get("pin"))

    # -- what's shown ----------------------------------------------------------------------
    def _doing(self, c: dict[str, Any], vin: str, s: CarState | None, mem: Memory) -> tuple[str, str]:
        mode = self._settings(c, vin)["control"]["mode"]
        if s is None:
            return "unknown", "Not read yet: the car hasn't sent its state to the cloud."
        st = c["cars"][vin]["state"]
        full_in = f", full in {_duration(s.minutes_to_full)}" if s.minutes_to_full else ""
        if st.get("plugged") is None and not s.charging:
            return "unknown", "The car hasn't said whether it's plugged in."
        if not s.plugged:
            return "unplugged", "Not plugged in"
        if s.fast_charger:
            return "away", "Fast charging away from home" if s.charging else "Plugged into a fast charger"
        if s.at_home is False:
            return ("charging", "Charging away from home") if s.charging else ("away", "Plugged in away from home")
        if s.full and not s.charging:
            return "complete", f"Charged to its limit ({s.limit:.0f}%)" if s.limit is not None else "Charged"
        if mode != "off" and s.at_home is None:
            return ("charging" if s.charging else "waiting"), "The car's location isn't known, so it's left alone"
        if mode != "off" and not self._can_command(c, vin):
            return ("charging" if s.charging else "waiting"), "Enter the app's PIN to charge it from solar"
        if mem.hold and mode != "off":
            return ("charging" if s.charging else "hold"), f"{mem.hold}: on hold until it's unplugged"
        if s.charging:
            return "charging", ("Charging" if mode == "off" else "Charging from spare solar") + full_in
        if mode == "off":
            return "stopped", "Plugged in, not charging"
        return "waiting", "Waiting for spare solar"

    def _follow(self, c: dict[str, Any], vin: str, s: CarState | None) -> tuple[str, int | None]:
        """How closely it's followed (control.readiness: active, ready, quiet), and when spare solar is next expected
        for it."""
        cfg = self._settings(c, vin)["control"]
        need, _ = self._charge_w(c, vin)
        now = int(self.clock())
        chance = None
        if cfg["mode"] == "solar":
            chance = control.next_chance(self._spare_ahead(cfg["first"]), now, need)
        held = self._memory(vin).hold is not None
        timing = control.Timing.of(cfg)
        spare = self._recent_spare(vin, timing.average)
        return control.readiness(s, cfg["mode"], held, chance, spare, need, now, timing.lead), chance

    def vehicle(self, c: dict[str, Any], vin: str) -> dict[str, Any]:
        """A car, shaped as the EV page shows a Tesla (so the same charging card steers it), with what's its own."""
        car = c["cars"][vin]
        s = self._state(c, vin)
        mem = self._memory(vin)
        st = car.get("state") or {}
        cfg = self._settings(c, vin)
        charge_w, charge_from = self._charge_w(c, vin)
        status, doing = self._doing(c, vin, s, mem)
        spare = self._spare_now(c, vin, s, mem)
        follow, chance = self._follow(c, vin, s)
        pending = self._pending.get(vin)
        forced_at = cfg.get("forced_at")
        return {
            "vin": vin,
            "make": car["make"],
            "model": car.get("model"),
            "year": car.get("year"),
            "colour": None,
            "name": car.get("name"),
            "car": None,
            "control": {**cfg["control"], **asdict(control.Timing.of(cfg["control"]))},
            "home": cfg.get("home"),
            "paired_at": None,
            "no_wake_until": None,
            "seen_at": c.get("read_at"),
            "linked": False,
            "status": status,
            "doing": doing,
            "hold": mem.hold if cfg["control"]["mode"] != "off" else None,
            "spare_w": round(spare) if spare is not None else None,
            "follow": follow,
            "solar_from": chance,
            "night": False,
            "wake_at": None,
            "share": self._share_brief() if cfg["control"]["first"] == "shared" else None,
            "min_w": round(charge_w),
            "min_amps": None,
            "max_amps": None,
            "phases": None,
            "volts": None,
            "solar_amps": None,
            "state": None
            if s is None
            else {
                "as_of": s.as_of,
                "asleep": False,
                "charging_state": s.charging_state,
                "plugged": s.plugged,
                "charging": s.charging,
                "soc": s.soc,
                "limit": s.limit,
                "range_km": s.range_km,
                "amps": None,
                "actual_amps": None,
                "power_kw": (s.power_kw or round(charge_w / 1000, 2)) if s.charging else None,
                "energy_added": None,
                "minutes_to_full": s.minutes_to_full,
                "at_home": s.at_home,
                "in_range": None,
                "odometer_km": st.get("odometer_km"),
                "limit_dc": st.get("limit_dc"),
            },
            # Its own: a plug-in hybrid; where its charging power is from (set, measured or the default); whether
            # commands can be sent (a CCS2 car needs the PIN); a command not yet confirmed; when the car itself was
            # last asked and when it may be asked again from the page; and what the dashboard did lately.
            "hybrid": bool(car.get("hybrid")),
            "ccs2": bool(car.get("ccs2")),
            "charge_from": charge_from,
            "can_command": self._can_command(c, vin),
            "pending": {"action": pending["action"], "at": pending["at"]} if pending else None,
            "forced_at": forced_at,
            "force_from": int(forced_at + FORCE_MIN) if forced_at and forced_at + FORCE_MIN > self.clock() else None,
            "events": self._events(vin),
        }

    def status(self) -> dict[str, Any]:
        """The account (its email partly hidden, its make and country), how reading it is going, and each car. The
        password and PIN never leave this server."""
        c = self._conn()
        connected = self._connected(c)
        return {
            "connected": connected,
            "account": email_hint(c["username"]) if connected else None,
            "brand": c.get("brand") if connected else None,
            "brands": [{"code": k, "name": name, "app": app} for k, (name, _, app) in BRANDS.items()],
            "region": c.get("region") if connected else None,
            "regions": [{"code": k, "name": name, "brands": list(b)} for k, (name, _, b) in REGIONS.items()],
            "pin": bool(c.get("pin")) if connected else False,
            "error": self._error if connected else None,
            "signed_out": self._signed_out and connected,
            "read_at": c.get("read_at") if connected else None,
            "next_read": max(math.ceil(self._next_read), int(self.clock()))
            if connected and not self._signed_out
            else None,
            "reading": self._reading,
            "tick": TICK,
            "mock": self.config.mock,  # any email and password connects the made-up car
            "timing": {k: {"default": d, "min": lo, "max": hi} for k, (d, lo, hi, _) in control.TIMING.items()},
            "limits": list(LIMITS),
            "charge_w": {"min": CHARGE_W[0], "max": CHARGE_W[1], "default": CHARGE_W[2]},
            "force_choices": list(FORCE_CHOICES),
            "home": list(home) if (home := self.home()) else None,
            "vehicles": [self.vehicle(c, vin) for vin in c["cars"]] if connected else [],
        }

    def summary(self) -> list[dict[str, Any]] | None:
        """Each car in brief, for every page (the live status's `ev`, beside any Teslas: so it's parked at the
        Overview's house, drawn as its model); None when not connected."""
        c = self._conn()
        if not self._connected(c):
            return None
        out = []
        for vin in c["cars"]:
            full = self.vehicle(c, vin)
            st = full["state"] or {}
            out.append({k: full[k] for k in ("vin", "make", "model", "year", "colour", "name", "car", "status", "doing")} | {
                "mode": full["control"]["mode"], "soc": st.get("soc"), "limit": st.get("limit"),
                "power_kw": st.get("power_kw"), "amps": None, "at_home": st.get("at_home"),
            })  # fmt: skip
        return out

    # -- connecting ------------------------------------------------------------------------
    async def connect(self, body: dict[str, Any]) -> dict[str, Any]:
        """Sign in ({"username", "password", "pin", "brand", "region"}), checked by reading the account's cars. Each
        car connected before keeps its settings."""
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        pin = str(body.get("pin") or "").strip()
        brand = str(body.get("brand") or "hyundai").lower()
        region = str(body.get("region") or "AU").upper()
        if brand not in BRANDS:
            raise BluelinkSetupError("Choose Hyundai or Kia.")
        app = BRANDS[brand][2]
        if not username or not password:
            raise BluelinkSetupError(f"Enter the email and password you sign in to the {app} app with.")
        if region not in REGIONS or brand not in REGIONS[region][2]:
            raise BluelinkSetupError(f"{BRANDS[brand][0]} cars in that country can't be reached yet.")
        if pin and not (pin.isdigit() and len(pin) == 4):
            raise BluelinkSetupError("The PIN is the 4 digits you use in the app (or leave it empty).")
        account = self._make_account(username, password, pin, region, brand)
        try:
            cars = await asyncio.to_thread(account.read)
        except BluelinkError as e:
            await asyncio.to_thread(account.close)
            raise BluelinkSetupError(str(e), 400 if e.refused else 502) from e
        if not cars:
            await asyncio.to_thread(account.close)
            raise BluelinkSetupError(
                f"{app} accepted the sign-in, but there's no electric car on the account. If yours is on another "
                "account, sign in with that one."
            )
        async with self._lock:
            if self._account is not None and self._account is not account:
                await asyncio.to_thread(self._account.close)
            self._account = account
            c = self._conn()
            now = self.clock()
            settings = {car["vin"]: c["settings"][car["vin"]] for car in cars if car["vin"] in c["settings"]}
            c = {
                "username": username, "password": password, "pin": pin, "brand": brand, "region": region,
                "cars": {car["vin"]: car for car in cars}, "settings": settings, "read_at": int(now),
            }  # fmt: skip
            for car in cars:
                self._measure(c, car["vin"], car)
            self._put(CONN_KEY, c)
            self._error, self._signed_out, self._failed, self._refusals = None, False, 0, 0
            self._retry_at = 0.0
            self._next_read = now + self._poll_after(self._conn())
        await self.publish()
        return self.status()

    async def set_pin(self, body: dict[str, Any]) -> dict[str, Any]:
        """Set the app's PIN ({"pin"}; empty: none), which a CCS2 car needs for commands."""
        pin = str(body.get("pin") or "").strip()
        if pin and not (pin.isdigit() and len(pin) == 4):
            raise BluelinkSetupError("The PIN is the 4 digits you use in the app.")
        async with self._lock:
            c = self._conn()
            if not self._connected(c):
                raise BluelinkSetupError("Connect an account first.", 409)
            c["pin"] = pin
            self._put(CONN_KEY, c)
            if self._account is not None:
                await asyncio.to_thread(self._account.close)
            self._account = None  # signed in afresh with it
        return self.status()

    async def disconnect(self) -> dict[str, Any]:
        """Forget the account, its cars and what the dashboard did with them."""
        async with self._lock:
            if self._account is not None:
                await asyncio.to_thread(self._account.close)
            self._account = None
            for key in (CONN_KEY, MEMORY_KEY, LOG_KEY):
                self._put(key, None)
            self._error, self._signed_out, self._failed, self._refusals = None, False, 0, 0
            self._samples.clear()
            self._assumed.clear()
            self._pending.clear()
        await self.publish()
        return self.status()

    async def configure(self, vin: str, body: dict[str, Any]) -> dict[str, Any]:
        """Change how a car charges: its mode, who gets the sun first, how far short it may run, its timing
        (control.clean), its charging power at home ({"charge_w"}: W, null for measured or the default), how often the
        car itself may be asked ({"force_every"}: seconds, 0 for never), or its home ({"home": "here"}: where it's
        parked now; null: the system's location)."""
        async with self._lock:
            c = self._conn()
            if vin not in c["cars"]:
                raise BluelinkSetupError("No such car.", 404)
            s = self._settings(c, vin)
            before = s["control"]["mode"]
            try:
                cfg = control.clean(body, s["control"])
            except ValueError as e:
                raise BluelinkSetupError(str(e)) from e
            if "charge_w" in body:
                w = body["charge_w"]
                lo, hi, _ = CHARGE_W
                if w is not None and (isinstance(w, bool) or not isinstance(w, int | float) or not lo <= w <= hi):
                    raise BluelinkSetupError(f"The charging power must be {lo / 1000:g} to {hi / 1000:g} kW.")
                cfg["charge_w"] = round(w) if w is not None else None
            if "force_every" in body:
                if body["force_every"] not in FORCE_CHOICES:
                    raise BluelinkSetupError("Choose how often the car itself may be asked.")
                cfg["force_every"] = body["force_every"]
            s["control"] = cfg
            if "home" in body:
                st = self._state(c, vin)
                if body["home"] == "here":
                    if st is None or st.location is None:
                        raise BluelinkSetupError("The car's location isn't known yet.")
                    s["home"] = list(st.location)
                elif body["home"] is None:
                    s.pop("home", None)
                else:
                    raise BluelinkSetupError(
                        'Give "here" for where the car is now, or null for the system\'s location.'
                    )
            c["settings"][vin] = s
            self._put(CONN_KEY, c)
            if before != cfg["mode"]:
                self._note(vin, WORDS[cfg["mode"]], "mode")
            self._samples.pop(vin, None)  # spare power worked out the old way
            self._soon(1)
        self.wake()
        await self.publish()
        return self.status()

    # -- commands from the EV page -----------------------------------------------------------
    async def command(self, vin: str, body: dict[str, Any]) -> dict[str, Any]:
        """Start or stop charging now, set the charge limit (50 to 100%, in tens), or let the dashboard take charge
        again ("resume"). Starting or stopping puts the car on hold (from solar) until it's unplugged or resumed, so the
        dashboard doesn't undo it."""
        action = body.get("action")
        async with self._lock:
            c = self._conn()
            if vin not in c["cars"]:
                raise BluelinkSetupError("No such car.", 404)
            mem = self._memory(vin)
            now = int(self.clock())
            if action == "resume":
                mem.hold = mem.hold_at = None
                mem.command = None
                mem.enough_since = mem.short_since = None
                self._remember(vin, mem)
                self._note(vin, "The dashboard is in charge of charging again", "mode")
                return self.status()
            params: dict[str, Any] = {}
            if action == "start":
                hold, text = "Charging now, started here", "Started charging"
            elif action == "stop":
                hold, text = "Stopped here", "Stopped charging"
            elif action == "limit":
                pct = body.get("percent")
                if isinstance(pct, bool) or pct not in LIMITS:
                    raise BluelinkSetupError("The charge limit must be 50 to 100%, in tens.")
                params, hold, text = {"percent": pct}, None, f"Charge limit set to {pct}%"
            else:
                raise BluelinkSetupError("Unknown command.")
            if action != "limit" and not self._can_command(c, vin):
                raise BluelinkSetupError("This car needs the 4-digit PIN you use in the app to start and stop it.")
            try:
                action_id = await asyncio.to_thread(self._acct(c).command, vin, action, **params)
            except BluelinkError as e:
                raise BluelinkSetupError(str(e), 400 if e.pin else 502) from e
            if hold and self._settings(c, vin)["control"]["mode"] != "off":
                mem.hold, mem.hold_at = hold, now
                text += ": on hold from spare solar until it's unplugged"
            if action in ("start", "stop"):
                self._took(c, vin, action == "start")
            else:
                car = c["cars"][vin]
                if car.get("state"):
                    car["state"]["limit"] = float(params["percent"])
                    self._put(CONN_KEY, c)
            if action_id:
                self._pending[vin] = {"id": action_id, "action": action, "at": now, "asked": now, "solar": False}
            self._samples.pop(vin, None)
            self._remember(vin, mem)
            self._note(vin, text, "manual")
            self._soon(AFTER_COMMAND)
        self.wake()
        await self.publish()
        return self.status()

    def _took(self, c: dict[str, Any], vin: str, charging: bool) -> None:
        """The car took a start or stop: it's taken to be charging (or not) until it sends a state newer than the
        command, so the page shows it at once and the controller goes on from there."""
        now = int(self.clock())
        self._assumed[vin] = {"charging": charging, "at": now}
        car = c["cars"].get(vin)
        if car and car.get("state"):
            car["state"]["charging"] = charging
            if charging:
                car["state"]["plugged"] = True
            else:
                car["state"]["minutes_to_full"] = None
            self._put(CONN_KEY, c)

    # -- reading ---------------------------------------------------------------------------
    def _night(self) -> bool:
        home = self.home()
        if home is None:
            hour = time.localtime(self.clock()).tm_hour
            return hour >= 19 or hour < 6
        return sun.position(self.clock(), *home)[0] < NIGHT_ELEVATION

    def _force_at(self, c: dict[str, Any], vin: str) -> float | None:
        """When the car itself may next be asked for its state in the background: by day, in solar mode, unless it's
        away, once what the cloud has is `force_every` old (and it wasn't asked for that long). None: not."""
        s = self._settings(c, vin)
        every = s["control"].get("force_every") or 0
        st = self._state(c, vin)
        if not every or s["control"]["mode"] != "solar" or (st is not None and st.at_home is False):
            return None
        return max(float(st.as_of or 0) + every if st else 0.0, float(s.get("forced_at") or 0) + every)

    def _due_force(self, c: dict[str, Any]) -> set[str]:
        if self._night():
            return set()
        now = self.clock()
        return {vin for vin in c["cars"] if (at := self._force_at(c, vin)) is not None and at <= now}

    def _poll_after(self, c: dict[str, Any]) -> float:
        """Seconds until the cloud's copy of the cars is next read: every 5 minutes while one's charging or could
        charge from solar now, else every 15; and in time to ask a car itself when that's due."""
        after = float(POLL)
        now = self.clock()
        night = self._night()
        for vin in c["cars"]:
            s = self._state(c, vin)
            mode = self._settings(c, vin)["control"]["mode"]
            if s is not None and (
                s.charging or (mode == "solar" and s.plugged and s.at_home and not s.full and not night)
            ):
                after = POLL_ACTIVE
            if not night and (at := self._force_at(c, vin)) is not None:
                after = min(after, max(1.0, at - now))
        return after

    async def refresh(self, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Read the cars now ({"force": vin}: ask that car itself, at most every 10 minutes). How it went is in the
        status (`error`), as for every read."""
        c = self._conn()
        if not self._connected(c):
            raise BluelinkSetupError("Connect an account first.", 409)
        vin = (body or {}).get("force")
        force: set[str] = set()
        if vin:
            if vin not in c["cars"]:
                raise BluelinkSetupError("No such car.", 404)
            last = self._settings(c, vin).get("forced_at") or 0
            if self.clock() - last < FORCE_MIN:
                raise BluelinkSetupError(
                    "The car was asked a moment ago. Asking it often runs down its 12 V battery: try again in a few "
                    "minutes.",
                    429,
                )
            force = {vin}
        await self.read(force)
        await self.publish()
        return self.status()

    def _soon(self, after: float) -> None:
        """Read again within `after` seconds (but not before a failed read said)."""
        self._next_read = min(self._next_read, max(self._retry_at, self.clock() + after))

    def _read_failed(self, e: BluelinkError) -> None:
        now = self.clock()
        self._error = str(e)
        if e.refused:
            self._refusals += 1
            self._signed_out = self._refusals >= REFUSALS
        self._next_read = self._retry_at = now + (
            LIMITED if e.limited else BACKOFF[min(self._failed, len(BACKOFF) - 1)]
        )
        self._failed += 1
        log.info("Reading the Hyundai or Kia account: %s", e)

    async def read(self, force: set[str] | None = None) -> None:
        async with self._lock:
            c = self._conn()
            if not self._connected(c):
                return
            asked = self._due_force(c) if force is None else force
            self._reading = True
            try:
                cars = await asyncio.to_thread(self._acct(c).read, asked)
            except BluelinkError as e:
                self._read_failed(e)
                return
            finally:
                self._reading = False
            now = self.clock()
            for vin in asked:
                s = c["settings"].setdefault(vin, {})
                s["forced_at"] = int(now)
            before = c["cars"]
            fresh: dict[str, dict[str, Any]] = {}
            for car in cars:
                vin = car["vin"]
                was = before.get(vin, {}).get("state")
                st = car.get("state")
                if st is None and was:  # a car that said nothing this time keeps what it said last
                    car["state"] = st = was
                # What a command did stands until the car sends a state newer than it.
                if st and (took := self._assumed.get(vin)):
                    if (st.get("as_of") or 0) <= took["at"]:
                        st = car["state"] = {**st, "charging": took["charging"]}
                        if took["charging"]:
                            st["plugged"] = True
                    else:
                        self._assumed.pop(vin, None)
                fresh[vin] = car
                self._measure(c, vin, car)
            c["cars"] = fresh
            c["read_at"] = int(now)
            self._put(CONN_KEY, c)
            self._error, self._signed_out, self._failed, self._refusals = None, False, 0, 0
            self._retry_at = 0.0
            self._next_read = now + self._poll_after(c)

    def _measure(self, c: dict[str, Any], vin: str, car: dict[str, Any]) -> None:
        """Keep the power a CCS2 car says it's charging at, at home, as its charging power."""
        st = car.get("state") or {}
        kw = st.get("power_kw")
        if not st.get("charging") or not kw or kw < MEASURE_FROM_KW:
            return
        s = car_state(vin, car, self._home_of(c, vin))
        if s is None or not s.at_home:
            return
        w = round(kw * 1000, -2)
        settings = c["settings"].setdefault(vin, {})
        if abs((settings.get("measured_w") or 0) - w) >= 100:
            settings["measured_w"] = w
            self._note(vin, f"Charging at home at {w / 1000:g} kW, as the car measures it", "mode")

    # -- what the forecast expects (for sharing with the home battery, and when the sun's next spare) ---------------
    def _ahead_now(self) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        now = int(self.clock())
        if self._ahead is None or now - self._ahead[0] >= AHEAD_EVERY:
            steps: list[dict[str, Any]] | None = None
            if self.forecast is not None:
                try:
                    steps = self.forecast.steps(now, days=2)
                except Exception:
                    log.debug("No forecast for the Hyundai or Kia", exc_info=True)
            self._ahead = (now, steps or [], {})
        return self._ahead[1], self._ahead[2]

    def _home_soc(self) -> float | None:
        soc = (self.live.latest or {}).get("battery_soc")
        return soc / 100 if soc is not None else None

    def _share(self) -> tuple[float, float]:
        steps, made = self._ahead_now()
        if "share" not in made:
            made["share"] = control.battery_share(
                steps,
                int(self.clock()),
                soc=self._home_soc(),
                cap=self.live.battery_kwh(),
                max_kw=self.settings.get("battery_max_kw"),
            )
        share: tuple[float, float] = made["share"]
        return share

    def _share_brief(self) -> dict[str, float] | None:
        if self.live.battery_kwh() <= 0:
            return None
        f, need = self._share()
        return {"battery": round(f, 2), "need_kwh": round(need, 1)}

    def _spare_ahead(self, first: str) -> list[tuple[int, int, float]]:
        steps, made = self._ahead_now()
        if first not in made:
            made[first] = control.spare_ahead(
                steps,
                first=first,
                soc=self._home_soc(),
                cap=self.live.battery_kwh(),
                reserve=self.live.reserve() / 100,
                max_kw=self.settings.get("battery_max_kw"),
                share=self._share()[0] if first == "shared" else 0.0,
            )
        ahead: list[tuple[int, int, float]] = made[first]
        return ahead

    # -- following the sun ---------------------------------------------------------------------
    def _recent_spare(self, vin: str, average: int) -> float | None:
        now = int(self.clock())
        recent = [w for ts, w in self._samples.get(vin) or () if ts > now - average - 30]
        return sum(recent) / len(recent) if recent else None

    def _spare(self, c: dict[str, Any], vin: str, s: CarState, mem: Memory) -> float | None:
        """The power there is for the car, averaged over the last few inverter readings (control.spare_w): what it
        draws (as a CCS2 car says, else its charging power) counts as spare."""
        cfg = self._settings(c, vin)["control"]
        reading = self.live.latest
        now = int(self.clock())
        timing = control.Timing.of(cfg)
        samples = self._samples.setdefault(vin, deque(maxlen=SAMPLES))
        if reading and reading.get("ts") and now - int(reading["ts"]) <= STALE_READING:
            ts = int(reading["ts"])
            if ts >= mem.command_at + SETTLE and (not samples or samples[-1][0] < ts):
                car_w = ((s.power_kw or 0) * 1000 or self._charge_w(c, vin)[0]) if s.charging else 0.0
                has_battery = self.live.battery_kwh() > 0
                spare = control.spare_w(
                    reading,
                    car_w,
                    first=cfg["first"],
                    home_soc=reading.get("battery_soc") if has_battery else None,
                    battery_max_w=self.settings.get("battery_max_kw") * 1000 if has_battery else 0,
                    share=self._share()[0] if cfg["first"] == "shared" else 0.0,
                    battery_full=timing.battery_full,
                )
                if spare is not None:
                    samples.append((ts, spare))
        return self._recent_spare(vin, timing.average)

    def _spare_now(self, c: dict[str, Any], vin: str, s: CarState | None, mem: Memory) -> float | None:
        """The power there's been for the car lately; before the loop's sampled any, from the latest reading."""
        cfg = self._settings(c, vin)["control"]
        spare = self._recent_spare(vin, control.Timing.of(cfg).average)
        if spare is None and s is not None and s.plugged and s.at_home and cfg["mode"] == "solar":
            spare = self._spare(c, vin, s, mem)
        return spare

    async def _send(self, c: dict[str, Any], vin: str, d: Decision, mem: Memory, now: int) -> None:
        if mem.failures and now - mem.failed_at < CMD_BACKOFF[min(mem.failures, len(CMD_BACKOFF)) - 1]:
            return
        try:
            action_id = await asyncio.to_thread(self._acct(c).command, vin, d.action)
        except BluelinkError as e:
            mem.failures, mem.failed_at = mem.failures + 1, now
            if mem.failures == 1:
                self._note(vin, f"Couldn't {d.action} charging: {e} Trying again shortly", "error")
            if e.limited:
                self._next_read = self._retry_at = max(self._retry_at, self.clock() + LIMITED)
            return
        mem.failures = 0
        self._samples.pop(vin, None)  # what was spare before the change doesn't say what's spare after it
        mem.command, mem.command_at = d.action, now
        mem.enough_since = mem.short_since = None
        if d.action == "start":
            mem.amps, mem.amps_at = 1, now
        self._took(c, vin, d.action == "start")
        if action_id:
            self._pending[vin] = {"id": action_id, "action": d.action, "at": now, "asked": now, "solar": True}
        self._note(vin, f"{'Started' if d.action == 'start' else 'Stopped'} charging: {d.why}", "solar")
        self._soon(AFTER_COMMAND)

    async def _steer(self, c: dict[str, Any], vin: str) -> None:
        """Tell one car what to do, if anything (control.decide), as a Tesla is told."""
        s = self._state(c, vin)
        if s is None:
            return
        now = int(self.clock())
        mem = self._memory(vin)
        changed = False
        if not s.plugged and c["cars"][vin]["state"].get("plugged") is False and mem != Memory():
            if mem.hold:
                self._note(vin, "Unplugged: the dashboard is in charge of charging again", "mode")
            mem, changed = Memory(), True
            self._samples.pop(vin, None)
        cfg = self._settings(c, vin)["control"]
        if (
            cfg["mode"] == "off"
            or not s.plugged
            or not s.at_home
            or s.fast_charger
            or not self._can_command(c, vin)
            or vin in self._pending
        ):
            if changed:
                self._remember(vin, mem)
            return
        spare = self._spare(c, vin, s, mem)
        if mem.hold is None and (why := control.taken_over(s, mem, now)):
            mem.hold, mem.hold_at = why, now
            self._note(vin, f"{why}: on hold until it's unplugged", "manual")
            self._remember(vin, mem)
            return
        if mem.hold is not None:
            if changed:
                self._remember(vin, mem)
            return
        before = mem.dump()
        charge_w, _ = self._charge_w(c, vin)
        d = control.decide(cfg["mode"], s, charger(charge_w), spare, cfg["grid_w"], mem, now, control.Timing.of(cfg))
        if d is not None:
            await self._send(c, vin, d, mem, now)
        if changed or mem.dump() != before:
            self._remember(vin, mem)

    async def _check_pending(self, c: dict[str, Any]) -> None:
        """Ask how each command not yet confirmed went: one the car turned down (or didn't answer) is undone, as far
        as the dashboard's concerned, and tried again later; one it did is read back soon."""
        now = int(self.clock())
        for vin, p in list(self._pending.items()):
            if now - p["asked"] < OUTCOME_EVERY:
                continue
            p["asked"] = now
            try:
                result = await asyncio.to_thread(self._acct(c).outcome, vin, p["id"])
            except BluelinkError:
                result = "unknown"
            if result == "done":
                del self._pending[vin]
                self._soon(5)
            elif result in ("failed", "timeout"):
                del self._pending[vin]
                words = {"start": "start charging", "stop": "stop charging", "limit": "change its charge limit"}
                why = "it said no" if result == "failed" else "it didn't answer"
                self._note(vin, f"The car didn't {words.get(p['action'], 'take the command')}: {why}", "error")
                if p["action"] in ("start", "stop"):
                    self._assumed.pop(vin, None)
                    if p.get("solar"):
                        mem = self._memory(vin)
                        # As if it had been told the opposite: the controller waits its usual time before trying again.
                        mem.command = "stop" if p["action"] == "start" else "start"
                        mem.failures, mem.failed_at = mem.failures + 1, now
                        self._remember(vin, mem)
                    car = c["cars"].get(vin)
                    if car and car.get("state"):
                        car["state"]["charging"] = p["action"] == "stop"
                        self._put(CONN_KEY, c)
                self._soon(5)
            elif now - p["at"] >= OUTCOME_FOR:
                del self._pending[vin]  # no word either way: the car's next state says
                self._soon(5)

    async def tick(self) -> None:
        """One turn of the loop: read the cars when it's time, see how commands went, then steer each car."""
        c = self._conn()
        if not self._connected(c) or self._signed_out:
            return
        if self.clock() >= self._next_read:
            await self.read()
        async with self._lock:
            c = self._conn()
            if not self._connected(c):
                return
            if self._pending:
                await self._check_pending(c)
                c = self._conn()
            for vin in list(c["cars"]):
                try:
                    await self._steer(c, vin)
                except Exception:
                    log.exception("Steering %s failed", vin[-6:])
            self._soon(self._poll_after(self._conn()))

    # -- the loop --------------------------------------------------------------------------
    def wake(self) -> None:
        if self._wake is not None:
            self._wake.set()

    async def publish(self) -> None:
        if self.live.set_ev("bluelink", self.summary()):
            self.live.publish()

    async def start(self) -> None:
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._account is not None:
            self._account.close()
            self._account = None

    async def _run(self) -> None:
        assert self._wake is not None
        while True:
            try:
                await self.tick()
                await self.publish()
            except Exception:
                log.exception("Checking the Hyundai or Kia failed")
            self._wake.clear()
            due = self._next_read - self.clock()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), min(TICK, due) if due > 0 else TICK)
