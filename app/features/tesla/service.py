"""
Tesla: connecting the cars, showing each, and charging it from spare solar (app.features.tesla.control says what to
tell the car; this sends it). Two ways to reach the cars, with the same features through either (Manage →
Integrations → Tesla):

    tessie      the cloud: a Tessie account's access token (app.features.tesla.tessie). Every car on the account,
                wherever it is; at home is from its location
    bluetooth   locally, over this server's Bluetooth (app.features.tesla.bluetooth): each car paired by its VIN and
                a tap of its key card. At home is in range; nothing leaves the house

One at a time. Switching keeps each car's settings (its mode, its dashboard car, what it measured), matched by VIN.

Optional: nothing here reaches a car until one is connected. Each Tesla is tied to one of the dashboard's cars
(app.features.car), made for it when it's connected, so its details (phases, the lowest and highest current) are the
ones charging works with; its level is recorded from the car from then on. A Tesla whose dashboard car was
disconnected (or that chose none) needn't have one: its model's figures are worked with instead, and its levels
kept by its VIN (History).

A background loop reads the cars and, after each reading of the inverters, works out the spare power and tells each
car in solar mode what to do. How often depends on whether a car could charge soon (control.readiness): each minute
while one is charging, or plugged in at home in solar mode with spare solar for it now or expected from the forecast
within half an hour (then, over Bluetooth, it's woken and kept awake so it starts and follows the sun quickly);
otherwise every five minutes, letting it sleep, and reading again in time to wake it before spare solar is expected. Commands go out at most one at a time per car; one that fails is retried after a pause that grows.

The access token and the Bluetooth key are kept in the database and never sent back to the browser: status() shows
the token masked, and the key by a short fingerprint.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import asdict
from typing import Any

from app.core.config import DEMO_LOCATION, Config
from app.core.database import Database
from app.features.car import service as car_service
from app.features.car.service import CarService, NoSuchCar
from app.features.live.service import LiveService
from app.features.settings.store import SettingsStore
from app.features.tesla import bluetooth, control, details, history
from app.features.tesla.bluetooth import BluetoothClient, Radio
from app.features.tesla.client import VIN, CarAsleep, Client, TeslaError
from app.features.tesla.control import CarState, Charger, Decision, Memory
from app.features.tesla.history import History
from app.features.tesla.mock import TOKEN as DEMO_TOKEN
from app.features.tesla.mock import VIN as DEMO_VIN
from app.features.tesla.mock import DemoRadio, DemoTesla, DemoTessie
from app.features.tesla.tessie import TOKEN, TessieClient
from app.features.weather import sun

log = logging.getLogger(__name__)

PROVIDERS = ("tessie", "bluetooth")
MAKE = "Tesla"  # every car here is one: the page names its section after the make of the cars connected
CONN_KEY = "tesla"  # kv: how the cars are reached (provider, token) and each car's link and control settings (JSON)
KEY_KEY = "tesla_key"  # kv: this server's Bluetooth key (PEM), kept across disconnecting so a car needn't re-pair
MEMORY_KEY = "tesla_memory"  # kv: what the dashboard last did with each car (JSON)
LOG_KEY = "tesla_log"  # kv: what it did lately (JSON list, newest last)
CHARGE_KEY = "tesla_charge"  # kv: each car's last charge reading over Bluetooth (BluetoothClient's), across restarts
DETAILS_KEY = "tesla_details"  # kv: each car's details, group by group (app.features.tesla.details), as last read
WAKE_WHY = {
    "first": "to read it (nothing known of it since the dashboard started)",
    "ready": "ready for spare solar",
    "refresh": "to read its details",
    "command": "to send it a command",
    "solar": "to charge from spare solar",
}
TRACK_KEY = "tesla_track"  # kv: each car's last level and odometer at home, and since when it's been gone
LOG_KEPT = 200
TICK = 20  # seconds between the loop's turns
POLL_ACTIVE = 60  # seconds between reads of the cars while one could start charging soon (ready)
# While one's charging at home (awake anyway): as often as each way of reaching it allows. Over Bluetooth a read is a
# conversation of a few seconds on a radio others share; Tessie's own copy of the car changes no faster than this.
POLL_CHARGING = {"bluetooth": 15, "tessie": 30}
POLL_IDLE = 300  # otherwise
POLL_NIGHT = (
    1800  # over Bluetooth, with the sun down and no car charging: only checked whether it's asleep or plugged in
)
NIGHT_ELEVATION = 0.0  # degrees: the sun below this is night (no car is woken or read in the background)
AFTER_COMMAND = 25  # read the cars again this soon after a command, to see it take
AHEAD_EVERY = 300  # seconds the forecast's spare solar is kept before it's worked out again
SETTLE = 20  # seconds after a command before an inverter reading counts towards spare power
STALE_READING = 240  # an inverter reading older than this isn't used for spare power
SAMPLES = 400  # inverter readings kept per car for its spare power: enough for the longest average (control.TIMING)
LEVEL_EVERY = 900  # record a car's level at least this often while it changes less than a percent
# While it's asleep it isn't read (that would wake it, or keep it awake), and its level holds: logged as it stands
# about every half hour (the night's checks are POLL_NIGHT apart), marked asleep, so its chart has a point throughout.
LEVEL_ASLEEP = 1740
ASLEEP = ":asleep"  # a level's source, for one logged while it slept
BACKOFF = (60, 120, 300, 600)  # seconds before retrying after 1, 2, 3, 4+ failed commands
# Seconds before reading again after 1, 2, 3+ reads the car wouldn't take a Bluetooth connection for (busy: all its
# few connections taken by phones with its key): every try holds the radio for a while, and it clears on its own.
BUSY_BACKOFF = (120, 300, 600)
# Seconds before reading again after 1, 2, 3+ failed reads of any other kind (the car didn't answer in time, say):
# each failed read holds the radio for up to half a minute, so they're spaced out while it lasts. Commands still go.
READ_BACKOFF = (60, 120, 300)
MAX_CARS = 6


class TeslaSetupError(ValueError):
    """A change that can't be made, in words; `status` is the HTTP status to answer with."""

    def __init__(self, detail: str, status: int = 422):
        super().__init__(detail)
        self.status = status


def mask(token: str) -> str:
    return f"{token[:4]}…{token[-4:]}" if len(token) >= 16 else "••••"


def guess_model(car_type: str | None, trim: str | None) -> str | None:
    """The catalog model (app.features.car.catalog) closest to what Tesla calls the car: its type and trim badge."""
    kind = {"model3": "tesla-model-3", "modely": "tesla-model-y"}.get((car_type or "").lower())
    if not kind:
        return None
    t = (trim or "").lower()
    if t.startswith("p"):
        return f"{kind}-perf"
    if "d" in t:  # dual motor
        return f"{kind}-lr"
    return f"{kind}-rwd"


def _spawn(fn: Callable[[], None]) -> None:
    threading.Thread(target=fn, name="tesla-pairing", daemon=True).start()


class TeslaService:
    def __init__(
        self,
        config: Config,
        db: Database,
        live: LiveService,
        cars: CarService,
        settings: SettingsStore,
        forecast: Any = None,
        tessie: Callable[[str], Client] | None = None,
        radio: Radio | None = None,
        clock: Callable[[], float] = time.time,
        spawn: Callable[[Callable[[], None]], None] = _spawn,
    ):
        self.config = config
        self.db = db
        self.live = live
        self.cars = cars
        self.settings = settings
        self.forecast = forecast  # app.features.forecast.service.ForecastService: when spare solar is expected
        self.clock = clock
        self._spawn = spawn
        self._demo: DemoTesla | None = None
        self._tessie = tessie or self._default_tessie
        self._radio = radio
        self._bluetooth: BluetoothClient | None = None  # kept: it holds each car's last charge reading
        self._lock = threading.RLock()  # one change at a time: requests and the loop
        self._states: dict[str, CarState] = {}
        self._raw: dict[str, dict[str, Any]] = {}  # each car's last read: {last_state, in_range}
        self._samples: dict[str, deque[tuple[int, float]]] = {}
        self._error: str | None = None
        self._busy = 0  # reads in a row the car wouldn't take a Bluetooth connection for (TeslaError.busy)
        self._failed = 0  # failed reads in a row, of any kind (READ_BACKOFF)
        self._retry_at = 0.0  # after a failed read: not read again before this, however closely a car's followed
        self._read_at: float | None = None
        self._next_read = 0.0
        self._reading = False  # a read is under way (over Bluetooth, seconds)
        self._pairing: dict[str, Any] | None = None  # {vin, step (looking, tap, done, failed), error, at}
        self._ahead: tuple[int, list[dict[str, Any]], dict[str, Any]] | None = None
        self._details: dict[str, dict[str, Any]] | None = None  # vin -> group -> entry (DETAILS_KEY), once loaded
        self._seen: dict[str, int] = {}  # vin -> when it was last read (heard, over Bluetooth)
        self._no_wake: dict[str, int] = {}  # vin -> until when it's left asleep: it didn't wake (over Bluetooth)
        self.history = History(db)  # each car's in and out (app.features.tesla.history)
        self._tracks: dict[str, dict[str, Any]] | None = None  # TRACK_KEY, once loaded
        self._charge_tick: dict[str, float] = {}  # vin -> when its charging was last counted
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    def _demo_car(self) -> DemoTesla:
        if self._demo is None:
            self._demo = DemoTesla(lambda: self.home() or DEMO_LOCATION, self.clock)
        return self._demo

    def _default_tessie(self, token: str) -> Client:
        if self.config.mock and token == DEMO_TOKEN:
            return DemoTessie(self._demo_car())
        return TessieClient(token)

    @property
    def radio(self) -> Radio:
        if self._radio is None:
            self._radio = DemoRadio(self._demo_car()) if self.config.mock else bluetooth.Bleak()
        return self._radio

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
        c: dict[str, Any] = self._kv(CONN_KEY) or {}
        for v in c.setdefault("vehicles", {}).values():
            v["control"] = control.clean({}, v.get("control"))  # as kept by an earlier version, made current
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
        """What the dashboard did with a car, or saw done: logged, in the latest activity (LOG_KEY), and kept for good
        for the car's day-by-day chart (history.events)."""
        log.info("Tesla %s: %s", vin[-6:], text)
        events = (self._kv(LOG_KEY) or [])[-(LOG_KEPT - 1) :]
        events.append({"ts": int(self.clock()), "vin": vin, "text": text, "kind": kind})
        self._put(LOG_KEY, events)
        self.history.add_event(vin, self.clock(), text, kind)

    def log(self, limit: int = 50) -> list[dict[str, Any]]:
        """What the dashboard did with the cars, and what it saw the household do, newest first."""
        events: list[dict[str, Any]] = self._kv(LOG_KEY) or []
        return list(reversed(events))[: max(1, min(limit, LOG_KEPT))]

    def _key(self) -> str | None:
        """This server's Bluetooth key (PEM), once a car's been paired."""
        k: str | None = (self._kv(KEY_KEY) or {}).get("pem")
        return k

    def _key_role(self) -> str | None:
        """The key's role in the cars (bluetooth.ROLES): keys made before there was a choice are charging managers."""
        kept = self._kv(KEY_KEY) or {}
        return (kept.get("role") or "charging_manager") if kept.get("pem") else None

    @staticmethod
    def _is_connected(c: dict[str, Any]) -> bool:
        if c.get("provider") == "tessie":
            return bool(c.get("token"))
        return c.get("provider") == "bluetooth" and bool(c["vehicles"])

    @property
    def connected(self) -> bool:
        return self._is_connected(self._conn())

    def _client(self, c: dict[str, Any]) -> Client:
        """How the cars are reached now."""
        if c.get("provider") == "tessie":
            return self._tessie(c["token"])
        key = self._key()
        if key is None:
            raise TeslaError("There's no Bluetooth key yet. Pair the car again.", refused=True)
        if self._bluetooth is None or self._bluetooth.key != key:
            self._bluetooth = BluetoothClient(
                key,
                lambda: list(self._conn()["vehicles"]),
                self.radio,
                self.clock,
                kept=self._kv(CHARGE_KEY),
                keep=lambda kept: self._put(CHARGE_KEY, kept),
            )
            # Shown from the start, before it's read again (or if that fails): each car's charge as last read, else
            # (kept from before there was a kept reading) the level last logged for it.
            for vin, v in c["vehicles"].items():
                if vin in self._raw:
                    continue
                if vin in self._bluetooth._charge:
                    at, charge = self._bluetooth._charge[vin]
                    charge = {**charge, "timestamp": int(at * 1000)}
                elif logged := self._logged_level(vin, v):
                    charge = {"battery_level": logged["given"], "timestamp": int(logged["given_at"]) * 1000}
                else:
                    continue
                last = {"state": "online", "vehicle_config": {"car_type": bluetooth.car_type(vin)},
                        "charge_state": charge}  # fmt: skip
                self._raw[vin] = {"last_state": last, "in_range": None}
                self._states[vin] = self._parse(vin, v)
        return self._bluetooth

    def home(self) -> tuple[float, float] | None:
        """The house's location, None until it's been chosen."""
        return self.settings.location()

    # -- connecting ------------------------------------------------------------------------
    def _switch(self, c: dict[str, Any], provider: str, vins: list[str]) -> dict[str, Any]:
        """The connection through `provider`, keeping the cars it reaches (by VIN) and their settings; what it doesn't
        reach is dropped, with what the dashboard remembered of it."""
        if c.get("provider") != provider:
            for vin in [v for v in c["vehicles"] if v not in vins]:
                c["vehicles"].pop(vin)
                self._remember(vin, None)
                self._states.pop(vin, None)
                self._raw.pop(vin, None)
            c.pop("token", None)
            c["provider"] = provider
            self._error = None
            self._bluetooth = None
        return c

    def _add(self, c: dict[str, Any], vin: str, last: dict[str, Any], name: str | None = None) -> None:
        """A car reached for the first time (or again): kept with its settings, tied to a dashboard car."""
        claimed = {v.get("car") for k, v in c["vehicles"].items() if k != vin}
        v = c["vehicles"].setdefault(vin, {"control": dict(control.DEFAULTS)})
        v["name"] = name or str(last.get("display_name") or "") or v.get("name")
        if v.get("car") not in self.cars.ids():
            v["car"] = self._claim(vin, last, claimed)

    def connect(self, token: Any) -> dict[str, Any]:
        """Connect through Tessie with an access token: checked by listing the account's cars, each tied to a
        dashboard car (one is made for it if there's no unclaimed Tesla to tie it to). Raises TeslaSetupError."""
        token = str(token or "").strip()
        if not TOKEN.match(token):
            raise TeslaSetupError("Paste the access token from Tessie (Settings → API → Generate Access Token).")
        try:
            found = self._tessie(token).vehicles()
        except TeslaError as e:
            raise TeslaSetupError(str(e), 400 if e.refused else 502) from e
        if not found:
            raise TeslaSetupError("Tessie doesn't have any cars on that account yet. Add your Tesla in Tessie first.")
        with self._lock:
            c = self._switch(self._conn(), "tessie", [r["vin"] for r in found])
            c["token"] = token
            for row in found:
                last = row.get("last_state") or {}
                self._raw[row["vin"]] = {"last_state": last}
                self._add(c, row["vin"], last)
                self._states[row["vin"]] = control.parse(row["vin"], last, self._home_of(c["vehicles"][row["vin"]]))
                self._merge_details(row["vin"], row.get("details") or {})
            self._put(CONN_KEY, c)
            self._read_at = self.clock()
            self._error = None
            self._next_read = 0
        self.wake()
        return self.status()

    def pair(self, vin: Any, role: Any = None) -> dict[str, Any]:
        """Start pairing a car over Bluetooth, by its VIN, in `role` (bluetooth.ROLES; by default the key's own): find
        it, and (unless it already knows this server's key) ask it to add the key, which takes a tap of a key card in
        the car. Another role takes a new key, kept only once the car's taken it (until then the old one still
        works). Runs in the background: status()'s `bluetooth.pairing` follows it. Raises TeslaSetupError."""
        vin = str(vin or "").strip().upper()
        if not VIN.match(vin):
            raise TeslaSetupError("Enter the car's VIN: 17 letters and numbers, as on the car's screen (Controls → "
                                  "Software) or the Tesla app.")  # fmt: skip
        role = role or self._key_role() or "charging_manager"
        if role not in bluetooth.ROLES:
            raise TeslaSetupError("Pair the key as a charging manager (charging_manager) or a driver (driver).")
        with self._lock:
            if self._pairing and self._pairing["step"] in ("looking", "tap"):
                raise TeslaSetupError("A car is already being paired. Wait for it to finish.", 409)
            c = self._conn()
            if c.get("provider") == "bluetooth" and vin not in c["vehicles"] and len(c["vehicles"]) >= MAX_CARS:
                raise TeslaSetupError(f"Up to {MAX_CARS} cars can be paired.")
            key = self._key() if role == self._key_role() else None
            key = key or bluetooth.new_key()
            self._pairing = {"vin": vin, "step": "looking", "error": None, "at": int(self.clock()), "role": role}
        self._spawn(lambda: self._pair(vin, key, role))
        return self.status()

    def _pair(self, vin: str, key: str, role: str = "charging_manager") -> None:
        """Pairing, in the background (see pair)."""
        try:
            name = None
            if not self.radio.probe(vin, key):
                with self._lock:
                    if self._pairing:
                        self._pairing["step"] = "tap"
                name = self.radio.pair(vin, key, bluetooth.PAIR_SECONDS, role)
        except TeslaError as e:
            with self._lock:
                self._pairing = {"vin": vin, "step": "failed", "error": str(e), "at": int(self.clock())}
            return
        except Exception:
            log.exception("Pairing Tesla %s failed", vin[-6:])
            with self._lock:
                self._pairing = {"vin": vin, "step": "failed", "error": "Pairing failed. Try again.",
                                 "at": int(self.clock())}  # fmt: skip
            return
        with self._lock:
            if key != self._key():  # a new key (the first, or in another role): the one used from now on
                self._put(KEY_KEY, {"pem": key, "role": role, "made_at": int(self.clock())})
            c = self._conn()
            vins = [*c["vehicles"], vin] if c.get("provider") == "bluetooth" else [vin]
            c = self._switch(c, "bluetooth", vins)
            last = {"display_name": name, "vehicle_config": {"car_type": bluetooth.car_type(vin)}}
            self._add(c, vin, last, name)
            c["vehicles"][vin]["paired_at"] = int(self.clock())
            self._put(CONN_KEY, c)
            self._pairing = {"vin": vin, "step": "done", "error": None, "at": int(self.clock())}
            if self._bluetooth is not None and name:
                self._bluetooth.names[vin] = name
            self._next_read = 0
            self._note(
                vin, f"Paired over Bluetooth, as a {'driver' if role == 'driver' else 'charging manager'}", "mode"
            )
        self.wake()

    def _claim(self, vin: str, last: dict[str, Any], claimed: set[Any]) -> int | None:
        """The dashboard car for a Tesla: a Tesla not tied to another, else a new one with its model's details (and
        its paint, when Tesla says)."""
        for view in self.cars.views():
            model = view.get("model") or {}
            if view["id"] not in claimed and str(model.get("id", "")).startswith("tesla-"):
                return int(view["id"])
        vc = last.get("vehicle_config") or {}
        model = guess_model(vc.get("car_type"), vc.get("trim_badging"))
        try:
            paint = control.paint(last)
            made = self.cars.create(
                {"name": last.get("display_name") or "Tesla", "model": model} | ({"car_colour": paint} if paint else {})
            )
        except ValueError as e:  # six cars already
            log.warning("Tesla %s: no car to tie it to: %s", vin[-6:], e)
            return None
        return int(made["id"])

    def remove(self, vin: str) -> dict[str, Any]:
        """Stop following a car (a Tesla on the Tessie account stays left out until it's connected again). Its
        dashboard car and levels stay."""
        with self._lock:
            c = self._conn()
            if c["vehicles"].pop(vin, None) is None:
                raise TeslaSetupError("No such car.", 404)
            self._remember(vin, None)
            self._states.pop(vin, None)
            self._raw.pop(vin, None)
            self._samples.pop(vin, None)
            if self._all_details().pop(vin, None) is not None:
                self._put(DETAILS_KEY, self._all_details())
            self._put(CONN_KEY, c)
        self.wake()
        return self.status()

    def disconnect(self) -> dict[str, Any]:
        """Forget the token, the cars' links and what the dashboard did. The cars themselves stay, and so does the
        Bluetooth key, so a car that still has it pairs again without a tap."""
        with self._lock:
            self._put(CONN_KEY, None)
            self._put(MEMORY_KEY, None)
            self._put(LOG_KEY, None)
            self._put(DETAILS_KEY, None)
            self._put(CHARGE_KEY, None)
            self._details = None
            self._seen.clear()
            self._states.clear()
            self._raw.clear()
            self._samples.clear()
            self._bluetooth = None
            self._error = None
            self._read_at = None
            if self._pairing and self._pairing["step"] not in ("looking", "tap"):
                self._pairing = None
        self.wake()
        return self.status()

    def configure(self, vin: str, body: dict[str, Any]) -> dict[str, Any]:
        """Change a car's mode, whether the home battery fills first, how far short it may run, which dashboard car
        it is (null for none: its model's figures), or its home ({"home": "here"}: where it is now; null: the system's location). Raises TeslaSetupError."""
        with self._lock:
            c = self._conn()
            v = c["vehicles"].get(vin)
            if v is None:
                raise TeslaSetupError("No such car.", 404)
            try:
                v["control"] = control.clean(body, v.get("control"))
            except ValueError as e:
                raise TeslaSetupError(str(e)) from e
            if "car" in body and body["car"] is None:  # none: its model's figures
                v["car"] = None
            elif "car" in body:
                if body["car"] not in self.cars.ids():
                    raise TeslaSetupError("Choose one of the cars on the dashboard.")
                if any(o.get("car") == body["car"] for k, o in c["vehicles"].items() if k != vin):
                    raise TeslaSetupError("That car is already tied to another Tesla.")
                v["car"] = body["car"]
            if "home" in body:
                if body["home"] == "here":
                    state = self._states.get(vin)
                    if state is None or state.location is None:
                        raise TeslaSetupError("The car's location isn't known yet.")
                    v["home"] = list(state.location)
                elif body["home"] is None:
                    v.pop("home", None)
                else:
                    raise TeslaSetupError('Give "here" for where the car is now, or null for the system\'s location.')
            before = (self._conn()["vehicles"].get(vin) or {}).get("control", {}).get("mode")
            self._put(CONN_KEY, c)
            if before != v["control"]["mode"]:
                words = {"off": "Charging control off", "solar": "Charging from spare solar"}
                self._note(vin, words[v["control"]["mode"]], "mode")
            self._refresh(vin)
            self._samples.pop(vin, None)  # spare power worked out the old way
            self._next_read = min(self._next_read, self.clock() + 1)
        self.wake()
        return self.status()

    # -- commands from the EV page -----------------------------------------------------------
    def command(self, vin: str, body: dict[str, Any]) -> dict[str, Any]:
        """Start or stop charging now, set the current or the charge limit, or let the dashboard take charge again
        ("resume"). Starting, stopping or setting the current puts the car on hold until it's unplugged (or resumed),
        so the dashboard doesn't undo it. Raises TeslaSetupError, in words."""
        action = body.get("action")
        with self._lock:
            c = self._conn()
            if vin not in c["vehicles"] or not self._is_connected(c):
                raise TeslaSetupError("No such car.", 404)
            mem = self._memory(vin)
            now = int(self.clock())
            if action == "resume":
                mem.hold = mem.hold_at = None
                mem.command = None
                mem.enough_since = mem.short_since = None
                self._remember(vin, mem)
                self._note(vin, "The dashboard is in charge of charging again", "mode")
                return self.status()
            spec = self._charger(vin)
            params: dict[str, Any]
            if action == "start":
                name, params, hold, text = "start_charging", {}, "Charging now, started here", "Started charging"
            elif action == "stop":
                name, params, hold, text = "stop_charging", {}, "Stopped here", "Stopped charging"
            elif action == "amps":
                amps = body.get("amps")
                hi = spec.max_amps if spec else 32
                if isinstance(amps, bool) or not isinstance(amps, int) or not 1 <= amps <= hi:
                    raise TeslaSetupError(f"Give the current as whole amps, 1 to {hi}.")
                name, params, hold, text = (
                    "set_charging_amps",
                    {"amps": amps},
                    f"Set to {amps} A here",
                    f"Set to {amps} A",
                )
            elif action == "limit":
                pct = body.get("percent")
                if isinstance(pct, bool) or not isinstance(pct, int) or not 50 <= pct <= 100:
                    raise TeslaSetupError("Give the charge limit as a whole percentage, 50 to 100.")
                name, params, hold, text = "set_charge_limit", {"percent": pct}, None, f"Charge limit set to {pct}%"
            else:
                raise TeslaSetupError("Unknown command.")
            was_asleep = bool(self._states.get(vin) and self._states[vin].asleep)
            try:
                ok = self._client(c).command(vin, name, **params)
            except TeslaError as e:
                raise TeslaSetupError(str(e), 502) from e
            if ok and was_asleep:
                self._woke(vin, "command")
            if not ok:
                raise TeslaSetupError(
                    "The car didn't take the command. It may be out of reach; try again shortly.", 502
                )
            if hold and c["vehicles"][vin]["control"]["mode"] != "off":
                mem.hold, mem.hold_at = hold, now
                text += ": on hold from spare solar until it's unplugged"
            if name == "set_charging_amps":
                mem.amps, mem.amps_at = params["amps"], now
            self._took(vin, name, params)
            self._samples.pop(vin, None)
            self._remember(vin, mem)
            self._note(vin, text, "manual")
            # Read soon, to see it take (but not sooner than a failed read said: a car that takes commands but
            # doesn't answer its charge would otherwise be read, slowly, after each).
            self._next_read = min(self._next_read, max(self._retry_at, self.clock() + AFTER_COMMAND))
        self.wake()
        return self.status()

    # -- what's known of each car ---------------------------------------------------------------
    def _home_of(self, v: dict[str, Any]) -> tuple[float, float] | None:
        h = v.get("home")
        return (float(h[0]), float(h[1])) if h else self.home()

    def _car_of(self, v: dict[str, Any]) -> int | None:
        """The dashboard car a Tesla's tied to, if it's still connected."""
        car = v.get("car")
        return car if car is not None and car in self.cars.ids() else None

    def _figures(self, vin: str) -> dict[str, Any]:
        """A Tesla's details (app.features.car's): its dashboard car's, else its model's figures, guessed from what
        Tesla calls it (else its VIN), over the defaults."""
        car = self._car_of(self._conn()["vehicles"].get(vin, {}))
        if car is not None:
            with contextlib.suppress(NoSuchCar):
                return self.cars.details(car)
        vc = (self._raw.get(vin, {}).get("last_state") or {}).get("vehicle_config") or {}
        model = guess_model(vc.get("car_type") or bluetooth.car_type(vin), vc.get("trim_badging"))
        return car_service.defaults() | car_service.from_model(model)

    def _levels(self, vin: str, v: dict[str, Any]) -> tuple[Any, Any]:
        """Where a Tesla's levels are kept, and under what: with its dashboard car, else by its VIN (History). Both
        take the same calls (level, record_level, last_read, levels)."""
        car = self._car_of(v)
        return (self.cars, car) if car is not None else (self.history, vin)

    def _charger(self, vin: str) -> Charger | None:
        d = self._figures(vin)
        # What the car last measured charging at home wins over the car's details.
        m = self._conn()["vehicles"].get(vin, {}).get("measured") or {}
        return Charger(
            phases=int(m.get("phases") or d["car_phases"]),
            volts=float(m.get("volts") or d["car_voltage"]),
            min_amps=int(min(d["car_min_amps"], d["car_amps"])),
            max_amps=int(d["car_amps"]),
        )

    def _parse(self, vin: str, v: dict[str, Any]) -> CarState:
        raw = self._raw[vin]
        last = raw["last_state"]
        if not last.get("display_name") and v.get("name"):
            last = {**last, "display_name": v["name"]}
        return control.parse(vin, last, self._home_of(v), raw.get("in_range"))

    def _took(self, vin: str, name: str, params: dict[str, Any]) -> None:
        """The car took a command from the page: what's known of it says so until it's next read (AFTER_COMMAND), so
        the page shows it at once and the next step goes from there. It's awake (a command wakes it), and a current or
        a limit is what was set. Its reading keeps its own time, so the dashboard doesn't take it as the car's word."""
        v = self._conn()["vehicles"].get(vin)
        if v is None or vin not in self._raw:
            return
        last = self._raw[vin]["last_state"]
        cs = dict(last.get("charge_state") or {})
        if name == "set_charging_amps":
            cs["charge_current_request"] = params["amps"]
        elif name == "set_charge_limit":
            cs["charge_limit_soc"] = params["percent"]
        self._raw[vin]["last_state"] = {**last, "state": "online", "charge_state": cs}
        self._refresh(vin)

    def _refresh(self, vin: str) -> None:
        """Re-read a car's state from its last raw state (after its home changed)."""
        v = self._conn()["vehicles"].get(vin)
        if v is not None and vin in self._raw:
            self._states[vin] = self._parse(vin, v)

    def _night(self) -> bool:
        """Whether the sun's down at home: over Bluetooth, no car's woken or read in the background (POLL_NIGHT).
        Without the house's location, the hours the sun's down most of the year (7 pm to 6 am)."""
        home = self.home()
        if home is None:
            hour = time.localtime(self.clock()).tm_hour
            return hour >= 19 or hour < 6
        return sun.position(self.clock(), *home)[0] < NIGHT_ELEVATION

    def _want(self, vin: str, v: dict[str, Any], c: dict[str, Any]) -> str:
        """How closely to follow a car now (control.readiness), as the client's read takes it: at night over
        Bluetooth, a car that isn't charging is "night" (never woken, only checked whether it's asleep)."""
        follow = self._follow(vin, v)[0]
        if follow != "active" and c.get("provider") == "bluetooth" and self._night():
            return "night"
        return follow

    def read(self) -> None:
        """Read every car. Blocking: over Bluetooth, finding and talking to a car takes seconds, so that's done without
        holding the lock, and changes from the page don't wait on it."""
        with self._lock:
            c = self._conn()
            if not self._is_connected(c):
                return
            want = {vin: self._want(vin, v, c) for vin, v in c["vehicles"].items()}
            try:
                client = self._client(c)
            except TeslaError as e:
                return self._read_failed(e)
        self._reading = True
        try:
            found = client.vehicles(want)
        except TeslaError as e:
            with self._lock:
                return self._read_failed(e)
        finally:
            self._reading = False
        with self._lock:
            c = self._conn()  # as it is now: the page may have changed it meanwhile
            if not self._is_connected(c):
                return
            if self._busy:
                self._busy = 0
                for vin in c["vehicles"]:
                    self._note(vin, "Reached over Bluetooth again")
            self._failed, self._retry_at = 0, 0.0
            self._error = None
            self._read_at = self.clock()
            for row in found:
                if row["vin"] in c["vehicles"]:
                    self._take(row, c)
            self._next_read = self.clock() + self._poll_after(c)

    def _read_failed(self, e: TeslaError) -> None:
        """A read failed: tried again later, later each time it keeps failing (BUSY_BACKOFF, READ_BACKOFF), and not
        sooner for a car being followed closely (tick keeps to _retry_at)."""
        self._error = str(e)
        self._failed += 1
        if e.busy:  # the car's taking no more connections: eased off, it clears once a phone's out of range
            self._busy += 1
            after = BUSY_BACKOFF[min(self._busy, len(BUSY_BACKOFF)) - 1]
            if self._busy == 1:
                for vin in self._conn()["vehicles"]:
                    self._note(vin, "Couldn't connect over Bluetooth: the car's taking no more connections (phones "
                                    "or watches with its key are near it)", "error")  # fmt: skip
        else:
            self._busy = 0
            after = POLL_IDLE if e.refused else READ_BACKOFF[min(self._failed, len(READ_BACKOFF)) - 1]
        self._retry_at = self._next_read = self.clock() + after
        log.warning("Tesla: %s", e)

    def _take(self, row: dict[str, Any], c: dict[str, Any]) -> None:
        """What was read of a car (as Client.vehicles gives it): its state, level, supply, details."""
        vin = row["vin"]
        self._raw[vin] = {"last_state": row.get("last_state") or {}, "in_range": row.get("in_range"),
                          "linked": bool(row.get("linked"))}  # fmt: skip
        self._states[vin] = self._parse(vin, c["vehicles"][vin])
        if row.get("in_range") is not False:  # heard (or read through Tessie)
            self._seen[vin] = int(self.clock())
        self._level(vin, c["vehicles"][vin])
        self._measure(vin, c)
        self._merge_details(vin, row.get("details") or {})
        if row.get("woke"):
            self._woke(vin, str(row["woke"]))
        if row.get("wake_failed"):
            self._no_wake[vin] = int(row["wake_failed"])
            self._note(vin, "The car didn't wake up for the dashboard's key: it's left asleep for half an hour, and its "
                            "charge is read once it's awake (charging, in use, or woken from the Tesla app)"
                            + (". A charging-only key can't wake it: pair it again as a driver to let it"
                               if self._key_role() == "charging_manager" else ""), "error")  # fmt: skip
        elif self._states[vin].asleep is False:
            self._no_wake.pop(vin, None)

    def _woke(self, vin: str, why: str) -> None:
        """The dashboard woke the car (or sent it something while it slept, which wakes it): kept, to see that it isn't
        woken too often (the EV page's chart), and in the activity."""
        self.history.add_wake(vin, self.clock(), why)
        self._note(vin, f"Woke the car {WAKE_WHY.get(why, why)}", "wake")

    # -- details (app.features.tesla.details) ------------------------------------------------------
    def _all_details(self) -> dict[str, dict[str, Any]]:
        if self._details is None:
            self._details = self._kv(DETAILS_KEY) or {}
        return self._details

    def _merge_details(self, vin: str, found: dict[str, Any]) -> None:
        """Keep each group as newly read, unless what's kept is newer (Tessie's copy can lag a read over Bluetooth)."""
        kept = self._all_details().setdefault(vin, {})
        changed = False
        for g, entry in found.items():
            old = kept.get(g)
            if entry != old and (old is None or (entry.get("as_of") or 0) >= (old.get("as_of") or 0)):
                kept[g] = entry
                changed = True
        if changed:
            self._put(DETAILS_KEY, self._all_details())

    def details(self, vin: str) -> dict[str, Any]:
        """A car's details, group by group, each with when it was read; whether a refresh now would wake it (it's
        asleep); what's using power while it's parked; and anything in the car that starts charging by itself."""
        c = self._conn()
        if vin not in c["vehicles"] or not self._is_connected(c):
            raise TeslaSetupError("No such car.", 404)
        groups = self._all_details().get(vin, {})
        s = self._states.get(vin)
        schedule = (groups.get("schedule") or {}).get("data")
        return {
            "vin": vin,
            "provider": c.get("provider"),
            "seen_at": self._seen.get(vin),
            "asleep": s.asleep if s else None,
            "in_range": s.in_range if s else None,
            # Reading the details needs the car awake: a refresh now would wake it (and asks first).
            "refresh_wakes": bool(s and s.asleep),
            "every": bluetooth.DETAILS_EVERY if c.get("provider") == "bluetooth" else None,
            "groups": {g: groups[g] for g in details.GROUPS if g in groups},
            "parked_draw": details.parked_draw(groups),
            "overrides_solar": details.overrides_solar(schedule),
        }

    def refresh_details(self, vin: str, wake: Any) -> dict[str, Any]:
        """Read everything about a car now. An asleep car is only woken with `wake` true (the household said so):
        otherwise this raises TeslaSetupError 409, for the page to ask. Raises TeslaSetupError, in words."""
        wake = wake is True
        with self._lock:
            c = self._conn()
            if vin not in c["vehicles"] or not self._is_connected(c):
                raise TeslaSetupError("No such car.", 404)
            if c.get("provider") == "bluetooth" and self._pairing and self._pairing["step"] in ("looking", "tap"):
                raise TeslaSetupError("A car is being paired over Bluetooth. Try again once it's done.", 409)
            was_asleep = bool(self._states.get(vin) and self._states[vin].asleep)
            try:
                row = self._client(c).refresh_details(vin, wake)
            except CarAsleep as e:
                if e.row:
                    self._take(e.row, c)
                raise TeslaSetupError(
                    "The car is asleep. Reading its details wakes it, and it then stays awake for a while.", 409
                ) from e
            except TeslaError as e:
                raise TeslaSetupError(str(e), 502) from e
            self._take({"in_range": True if c.get("provider") == "bluetooth" else None} | row, c)
            if wake and was_asleep:
                self._woke(vin, "refresh")
        self.wake()
        return self.details(vin)

    # -- how closely each car is followed ----------------------------------------------------------
    def _ahead_now(self) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """The forecast's steps, and what's been worked out from them; kept for AHEAD_EVERY seconds. No steps
        without a forecast."""
        now = int(self.clock())
        if self._ahead is None or now - self._ahead[0] >= AHEAD_EVERY:
            steps: list[dict[str, Any]] | None = None
            if self.forecast is not None:
                try:
                    steps = self.forecast.steps(now, days=2)
                except Exception:  # no location or weather yet: only spare solar now makes a car ready
                    log.debug("No forecast for the Teslas", exc_info=True)
            self._ahead = (now, steps or [], {})
        return self._ahead[1], self._ahead[2]

    def _home_soc(self) -> float | None:
        soc = (self.live.latest or {}).get("battery_soc")
        return soc / 100 if soc is not None else None

    def _share(self) -> tuple[float, float]:
        """Shared: the home battery's share of the sun it could take, and what it needs (control.battery_share)."""
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
        """The forecast's spare solar for a car, step by step (control.spare_ahead). Empty without a forecast."""
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

    def _recent_spare(self, vin: str, average: int) -> float | None:
        """The power there's been for the car over the last `average` seconds (W); None until known."""
        now = int(self.clock())
        recent = [w for ts, w in self._samples.get(vin) or () if ts > now - average - 30]
        return sum(recent) / len(recent) if recent else None

    def _follow(self, vin: str, v: dict[str, Any]) -> tuple[str, int | None, int | None]:
        """How closely to follow a car now (control.readiness); when spare solar is next expected for it; and, while
        it's left to sleep, when it'll be made ready (woken) for that."""
        s = self._states.get(vin)
        cfg = v["control"]
        spec = self._charger(vin)
        need = spec.watts(spec.min_amps) if spec else None
        now = int(self.clock())
        chance = None
        if need is not None and cfg["mode"] == "solar":
            chance = control.next_chance(self._spare_ahead(cfg["first"]), now, need)
        held = self._memory(vin).hold is not None
        timing = control.Timing.of(cfg)
        spare = self._recent_spare(vin, timing.average)
        follow = control.readiness(s, cfg["mode"], held, chance, spare, need, now, timing.lead)
        wake_at = None
        if follow == "quiet" and chance is not None:
            at = chance - timing.lead
            if control.readiness(s, cfg["mode"], held, chance, None, need, at, timing.lead) == "ready":
                wake_at = at
        return follow, chance, wake_at

    def _poll_after(self, c: dict[str, Any]) -> float:
        """Seconds until the cars should next be read: as often as it can be while one is charging at home
        (POLL_CHARGING), each minute while one is charging elsewhere or ready, else every five (every half hour at
        night over Bluetooth), and in time to make a car ready before spare solar is expected for it."""
        now = self.clock()
        after = float(POLL_NIGHT if c.get("provider") == "bluetooth" and self._night() else POLL_IDLE)
        for vin, v in c["vehicles"].items():
            follow, _, wake_at = self._follow(vin, v)
            s = self._states.get(vin)
            if follow == "active" and s is not None and s.at_home:
                after = min(after, POLL_CHARGING.get(c.get("provider") or "", POLL_ACTIVE))
            elif follow != "quiet":
                after = min(after, POLL_ACTIVE)
            elif wake_at is not None:
                after = min(after, max(1.0, wake_at - now))
        return after

    def _measure(self, vin: str, c: dict[str, Any]) -> None:
        """Keep the phases and volts the car charges on at home, as it reports them (control.measured)."""
        s = self._states[vin]
        if not s.at_home:
            return
        phases, volts = control.measured(s)
        v = c["vehicles"][vin]
        old = v.get("measured") or {}
        new = {"phases": phases or old.get("phases"), "volts": round(volts) if volts else old.get("volts")}
        if new != {k: old.get(k) for k in new}:
            if phases and phases != old.get("phases"):
                self._note(vin, f"Charging on {phases} {'phase' if phases == 1 else 'phases'}"
                                f"{f' at {round(volts)} V' if volts else ''}", "mode")  # fmt: skip
            v["measured"] = new
            self._put(CONN_KEY, c)

    def _level(self, vin: str, v: dict[str, Any]) -> None:
        """Record the car's level (for its dashboard car, else by its VIN), as it changes (and now and then while it
        doesn't); and while it's asleep, the level it holds every half hour (LEVEL_ASLEEP)."""
        s = self._states[vin]
        if s.soc is None:
            return
        now = int(self.clock())
        ts = s.as_of or now
        source = self._conn().get("provider") or "tesla"
        store, key = self._levels(vin, v)
        try:
            last = store.level(key, ts)
        except NoSuchCar:
            return
        if not (
            last
            and last.get("given_at")
            and (ts <= last["given_at"] or (abs(last["given"] - s.soc) < 1 and ts - last["given_at"] < LEVEL_EVERY))
        ):
            store.record_level(key, ts, s.soc, source)
        if s.asleep:
            held = store.level(key, now)
            if held and now - held["given_at"] >= LEVEL_ASLEEP:
                store.record_level(key, now, held["given"], source + ASLEEP)

    # -- following the sun ---------------------------------------------------------------------
    def _spare(self, vin: str, s: CarState, cfg: dict[str, Any], mem: Memory, spec: Charger) -> float | None:
        """The power there is for the car, averaged over the last few inverter readings (control.spare_w)."""
        reading = self.live.latest
        now = int(self.clock())
        timing = control.Timing.of(cfg)
        samples = self._samples.setdefault(vin, deque(maxlen=SAMPLES))
        if reading and reading.get("ts") and now - int(reading["ts"]) <= STALE_READING:
            ts = int(reading["ts"])
            # Only readings taken once the car had settled after the last command: it ramps over a few seconds.
            settled = ts >= max(mem.amps_at, mem.command_at) + SETTLE
            if settled and (not samples or samples[-1][0] < ts):
                # What the car draws: as it last said, unless the dashboard set a current since then.
                car_w = control.car_watts(s, spec)
                if s.charging and mem.amps is not None and (s.as_of or 0) < mem.amps_at + 30:
                    car_w = spec.watts(mem.amps)
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
        recent = [w for ts, w in samples if ts > now - timing.average - 30]
        return sum(recent) / len(recent) if recent else None

    def _send(self, vin: str, client: Client, d: Decision, mem: Memory, now: int) -> None:
        if mem.failures and now - mem.failed_at < BACKOFF[min(mem.failures, len(BACKOFF)) - 1]:
            return
        try:
            if d.action == "start":
                if d.amps is not None and d.amps != self._states[vin].request_amps:
                    client.command(vin, "set_charging_amps", amps=d.amps)
                ok = client.command(vin, "start_charging")
            elif d.action == "stop":
                ok = client.command(vin, "stop_charging")
            else:
                ok = client.command(vin, "set_charging_amps", amps=d.amps)
        except TeslaError as e:
            ok, why = False, str(e)
        else:
            why = "the car didn't take it"
        if ok and self._states[vin].asleep:
            self._woke(vin, "solar")
        if not ok:
            mem.failures, mem.failed_at = mem.failures + 1, now
            if mem.failures == 1:
                self._note(vin, f"Couldn't {'start' if d.action == 'start' else 'stop' if d.action == 'stop' else 'change'}"
                                f" charging: {why}. Trying again shortly", "error")  # fmt: skip
            return
        mem.failures = 0
        self._samples.pop(vin, None)  # what was spare before the change doesn't say what's spare after it
        if d.action in ("start", "stop"):
            mem.command, mem.command_at = d.action, now
            mem.enough_since = mem.short_since = None
        elif mem.command is None:
            mem.command, mem.command_at = "start", now  # it started by itself on plugging in: it's the dashboard's now
        if d.amps is not None:
            mem.amps, mem.amps_at = d.amps, now
        self._took(vin, "set_charging_amps" if d.amps is not None else d.action, {"amps": d.amps})
        text = {
            "start": f"Started charging at {d.amps} A: {d.why}",
            "stop": f"Stopped charging: {d.why}",
            "amps": f"{d.amps} A: {d.why}",
        }[d.action]
        self._note(vin, text, "solar")
        self._next_read = min(self._next_read, max(self._retry_at, self.clock() + AFTER_COMMAND))

    def _steer(self, vin: str, v: dict[str, Any], client: Client) -> None:
        """Tell one car what to do, if anything (see control)."""
        s = self._states.get(vin)
        if s is None:
            return
        now = int(self.clock())
        mem = self._memory(vin)
        changed = False
        if not s.plugged and s.in_range is not False and mem != Memory():
            if mem.hold:
                self._note(vin, "Unplugged: the dashboard is in charge of charging again", "mode")
            mem, changed = Memory(), True
            self._samples.pop(vin, None)
        cfg = v["control"]
        spec = self._charger(vin)
        if cfg["mode"] == "off" or spec is None or not s.plugged or not s.at_home or s.fast_charger:
            if changed:
                self._remember(vin, mem)
            return
        spare = self._spare(vin, s, cfg, mem, spec)
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
        d = control.decide(cfg["mode"], s, spec, spare, cfg["grid_w"], mem, now, control.Timing.of(cfg))
        if d is not None:
            self._send(vin, client, d, mem, now)
        if changed or mem.dump() != before:
            self._remember(vin, mem)

    def tick(self) -> None:
        """One turn of the loop: read the cars when it's time (without holding the lock), then steer each. Blocking."""
        with self._lock:
            c = self._conn()
            if not self._is_connected(c):
                return
            if c.get("provider") == "bluetooth" and self._pairing and self._pairing["step"] in ("looking", "tap"):
                return  # the radio is busy pairing, for a couple of minutes at most
            due = self.clock() >= self._next_read
        if due:
            self.read()
        with self._lock:
            c = self._conn()
            if not self._is_connected(c):
                return
            if self._error is not None and not self._states:
                return
            try:
                client = self._client(c)
            except TeslaError:
                return
            for vin, v in c["vehicles"].items():
                try:
                    self._steer(vin, v, client)
                except Exception:
                    log.exception("Steering Tesla %s failed", vin[-6:])
                try:
                    self._track(vin, v)
                except Exception:
                    log.exception("Keeping Tesla %s's history failed", vin[-6:])
            # Spare solar sooner than forecast makes a car ready now, rather than at its next quiet read (but a
            # failed read isn't tried again sooner than _read_failed said).
            self._next_read = min(self._next_read, max(self._retry_at, self.clock() + self._poll_after(c)))

    # -- in and out (app.features.tesla.history) -------------------------------------------------
    def _all_tracks(self) -> dict[str, dict[str, Any]]:
        if self._tracks is None:
            self._tracks = self._kv(TRACK_KEY) or {}
        return self._tracks

    def _odometer(self, vin: str) -> tuple[int, float | None]:
        """The car's odometer (km), from its driving details, and when it was read."""
        g = self._all_details().get(vin, {}).get("driving") or {}
        return int(g.get("as_of") or 0), (g.get("data") or {}).get("odometer_km")

    def _battery_kwh(self, vin: str) -> float | None:
        try:
            return float(self._figures(vin)["car_battery_kwh"])
        except (KeyError, TypeError, ValueError):
            return None

    def _track(self, vin: str, v: dict[str, Any]) -> None:
        """Keep the car's in and out: time away (leaving with its last level at home, back once its level's been read
        since), and what it draws while charging at home. Each turn of the loop."""
        s = self._states.get(vin)
        if s is None:
            return
        now = int(self.clock())
        tracks = self._all_tracks()
        t = dict(tracks.get(vin) or {})
        km_at, km = self._odometer(vin)
        away = self.history.open(vin, "away")
        if s.at_home:
            t.pop("gone_since", None)
            if away is not None and s.soc is not None and (s.as_of or 0) > away["start"]:
                done = self.history.finish(
                    away["id"], int(s.as_of or now), s.soc, km if km_at > away["start"] else None
                )
                if done:
                    self._note(vin, self._back(done, vin), "trip")
                away = None
            if away is None:  # what's read at home now is its level at home (not one from before it left)
                if s.soc is not None and (s.as_of or 0) >= t.get("soc_at", 0):
                    t.update(soc=s.soc, soc_at=s.as_of or now)
                if km is not None:
                    t["km"] = km
                t["home_at"] = now
        elif s.at_home is False and away is None:
            gone = t.setdefault("gone_since", now)
            if now - gone >= history.AWAY_AFTER and t.get("soc") is not None:
                self.history.start(vin, "away", int(t.get("home_at") or gone), t["soc"], t.get("km"))
                self._note(vin, f"Left home at {t['soc']:.0f}%", "trip")
        if t != tracks.get(vin):
            tracks[vin] = t
            self._put(TRACK_KEY, tracks)
        self._charging(vin, s)

    def _charging(self, vin: str, s: CarState) -> None:
        """Count what the car draws while charging at home (ev_energy, and the charge's session), and end the
        session once it's stopped."""
        now = self.clock()
        last = self._charge_tick.get(vin)
        self._charge_tick[vin] = now
        charge = self.history.open(vin, "charge")
        if s.charging and s.at_home:
            if charge is None:
                self.history.start(vin, "charge", int(now), s.soc, None)
                return
            if last is None:
                return
            dt = min(history.MAX_STEP, now - last)
            spec = self._charger(vin)
            w = control.car_watts(s, spec) if spec else (s.power_kw or 0) * 1000
            reading = self.live.latest or {}
            fresh = reading.get("ts") and now - int(reading["ts"]) <= STALE_READING
            grid = reading.get("grid_power") if fresh else None
            # From the grid: as much of it as the house is importing (all of it, when that isn't known).
            grid_w = min(w, max(0.0, float(grid))) if grid is not None else w
            self.history.add_energy(vin, now, w * dt / 3600, grid_w * dt / 3600)
            self.history.add_charge(charge["id"], w * dt / 3.6e6, grid_w * dt / 3.6e6)
        elif charge is not None and (s.as_of or now) > charge["start"]:
            done = self.history.finish(charge["id"], int(now), s.soc, None)
            if done:
                d = history.describe(done, self._battery_kwh(vin))
                share = f", {d['solar_share']:.0%} from solar or the battery" if d["solar_share"] is not None else ""
                levels = (f"{d['soc_start']:.0f}% → {d['soc_end']:.0f}%: "
                          if d["soc_start"] is not None and d["soc_end"] is not None else "")  # fmt: skip
                self._note(vin, f"Charged {levels}{d['kwh']:.1f} kWh from the house{share}", "charge")

    def _back(self, done: dict[str, Any], vin: str) -> str:
        d = history.describe(done, self._battery_kwh(vin))
        change = d["soc_change"] or 0
        used = (f"used {-change:.0f}%" if change <= 0 else f"gained {change:.0f}%") + (
            f" (about {abs(d['used_kwh']):.0f} kWh)" if d["used_kwh"] else ""
        )
        km = f", {d['km']:.0f} km" if d["km"] else ""
        return f"Back home at {d['soc_end']:.0f}%: {used}{km}"

    def car_history(self, vin: str, days: int = 30) -> dict[str, Any]:
        """The car's in and out over the last `days`: its sessions (newest first), and their totals."""
        c = self._conn()
        if vin not in c["vehicles"]:
            raise TeslaSetupError("No such car.", 404)
        days = max(1, min(int(days), 366))
        now = int(self.clock())
        battery = self._battery_kwh(vin)
        sessions = [history.describe(s, battery) for s in self.history.sessions(vin, now - days * 86400, now + 1)]
        charges = [s for s in sessions if s["kind"] == "charge" and s["end"]]
        trips = [s for s in sessions if s["kind"] == "away" and s["end"]]
        kwh = sum(s["kwh"] for s in charges)
        grid = sum(s["grid_kwh"] for s in charges)
        km = sum(s["km"] or 0 for s in trips)
        used = sum(s["used_kwh"] or 0 for s in trips if s["km"])
        t = self._all_tracks().get(vin) or {}
        return {
            "vin": vin,
            "days": days,
            "battery_kwh": battery,
            "sessions": sessions,
            "totals": {
                "charged_kwh": round(kwh, 1),
                "grid_kwh": round(grid, 1),
                "solar_share": round(max(0.0, 1 - grid / kwh), 3) if kwh > 0 else None,
                "charges": len(charges),
                "trips": len(trips),
                "km": round(km) if km else None,
                "kwh_per_100km": round(used / km * 100, 1) if km >= 20 and used > 0 else None,
            },
            # Its last level at home, and since when it's been gone (not yet counted as away).
            "home": {"soc": t.get("soc"), "soc_at": t.get("soc_at"), "gone_since": t.get("gone_since")},
        }

    def car_levels(self, vin: str, start: int, end: int) -> dict[str, Any]:
        """The car's day: its level through [start, end), as recorded (each change of a percent, every 15 minutes
        it's read, and every half hour while it's asleep, as it holds), with the readings either side; when it was
        away and when it charged at home, to shade; what it drew while charging at home, every five minutes, and of
        that what came from the grid; each time the dashboard woke it; and everything the dashboard did with it or saw
        done (the activity). Between readings far apart (away), the page draws a straight line, as estimated."""
        c = self._conn()
        if vin not in c["vehicles"]:
            raise TeslaSetupError("No such car.", 404)
        if end <= start or end - start > 8 * 86400:
            raise TeslaSetupError("Choose up to 8 days.")
        store, key = self._levels(vin, c["vehicles"][vin])
        try:
            points = store.levels(key, start, end)
        except NoSuchCar:
            points = []
        now = int(self.clock())
        sessions = self.history.sessions(vin, start, end)
        limit = self._states[vin].limit if vin in self._states else None
        return {
            "vin": vin,
            "start": start,
            "end": end,
            # Each point; one logged while it slept (its level held, not read) is marked asleep.
            "points": [
                {"t": t, "soc": round(soc, 1)} | ({"asleep": True} if src.endswith(ASLEEP) else {})
                for t, soc, src in points
            ],
            "away": [{"start": s["start"], "end": s["end"] or now} for s in sessions if s["kind"] == "away"],
            "charging": [{"start": s["start"], "end": s["end"] or now} for s in sessions if s["kind"] == "charge"],
            "wakes": self.history.wakes(vin, start, end),
            "power": self.history.power(vin, start, end),
            "events": self.history.events(vin, start, end),
            "limit": limit,
        }

    # -- views -----------------------------------------------------------------------------------
    def _doing(self, s: CarState, v: dict[str, Any], mem: Memory, spec: Charger | None) -> tuple[str, str]:
        """What the car is doing, as a short state and a sentence."""
        mode = v["control"]["mode"]
        amps = s.request_amps
        if s.in_range is False:
            return "away", "Not heard over Bluetooth: away from home, or out of the server's range"
        if not s.charging_state:  # neither its charge nor its charge port read since the dashboard started
            return "unknown", "Not read since the dashboard started: its level is as last read"
        if not s.plugged:
            return "unplugged", "Not plugged in"
        if s.fast_charger:
            return "away", "Fast charging away from home"
        if s.at_home is False:
            return (
                "charging" if s.charging else "away"
            ), "Charging away from home" if s.charging else "Plugged in away from home"
        if s.full and not s.charging:
            return "complete", f"Charged to its limit ({s.limit:.0f}%)" if s.limit is not None else "Charged"
        if mode != "off" and s.at_home is None:
            return ("charging" if s.charging else "waiting"), "The car's location isn't known, so it's left alone"
        if mem.hold and mode != "off":
            return ("charging" if s.charging else "hold"), f"{mem.hold}: on hold until it's unplugged"
        if s.charging:
            if mode == "off":
                return "charging", f"Charging at {amps} A" if amps else "Charging"
            return "charging", f"Charging at {amps} A from spare solar"
        if mode == "off":
            return "stopped", "Plugged in, not charging"
        if spec is None:
            return "waiting", "Tie it to a car on the dashboard to charge from solar"
        return "waiting", "Waiting for spare solar"

    def _spare_now(
        self, vin: str, v: dict[str, Any], s: CarState | None, mem: Memory, spec: Charger | None
    ) -> float | None:
        """The power there's been for the car lately, as the loop works it out each turn; and when it hasn't yet (the
        page's just been opened, or how the car charges has just changed, which starts the average afresh), from the
        latest inverter reading now, so the page needn't wait a turn of the loop to show it."""
        cfg = v["control"]
        spare = self._recent_spare(vin, control.Timing.of(cfg).average)
        plugged_at_home = s is not None and s.plugged and s.at_home and not s.fast_charger
        if spare is None and plugged_at_home and spec is not None and cfg["mode"] == "solar":
            spare = self._spare(vin, s, cfg, mem, spec)  # type: ignore[arg-type]
        return spare

    def vehicle(self, vin: str, v: dict[str, Any]) -> dict[str, Any]:
        s = self._states.get(vin)
        mem = self._memory(vin)
        spec = self._charger(vin)
        spare = self._spare_now(vin, v, s, mem, spec)
        follow, chance, wake_at = self._follow(vin, v)
        status, doing = self._doing(s, v, mem, spec) if s else ("unknown", "Not read yet")
        # Not read since the dashboard started (an asleep car isn't woken for it): the level last logged, and when.
        logged = self._logged_level(vin, v) if s is not None and s.soc is None else None
        return {
            "vin": vin,
            "make": MAKE,
            # Which model and its model year: what Tesla calls it, else from the VIN (as is the year).
            "model": control.MODEL_NAMES.get((s.model if s else None) or bluetooth.car_type(vin) or ""),
            "year": control.model_year(vin),
            # Its paint, when Tesla says (through Tessie): the Overview draws it in it.
            "colour": control.paint(self._raw.get(vin, {}).get("last_state") or {}),
            "name": v.get("name") or (s.name if s else None),
            "car": self._car_of(v),
            # With each timing (control.TIMING) as set, or its default.
            "control": {**v["control"], **asdict(control.Timing.of(v["control"]))},
            "home": v.get("home"),
            "paired_at": v.get("paired_at"),
            # When it was last read (heard, over Bluetooth); its charge reading's own time is state.as_of.
            "seen_at": self._seen.get(vin),
            # Over Bluetooth: the link to it is held open since its last read (plugged in at home by day), so the
            # dashboard keeps its place among the few connections the car takes.
            "linked": bool(self._raw.get(vin, {}).get("linked")),
            # Over Bluetooth, after it didn't wake: until when it isn't woken again (unix seconds).
            "no_wake_until": u if (u := self._no_wake.get(vin)) and u > self.clock() else None,
            "status": status,
            "doing": doing,
            "hold": mem.hold if v["control"]["mode"] != "off" else None,
            "spare_w": round(spare) if spare is not None else None,
            # How closely it's followed (control.readiness): active, ready (read each minute, kept awake over
            # Bluetooth) or quiet (left to sleep); when spare solar is next expected for it; and, while it's left
            # to sleep, when it'll be made ready for that.
            "follow": follow,
            # Over Bluetooth with the sun down and it not charging: never woken or read in the background, only
            # checked every half hour whether it's asleep or plugged in (it's woken from the EV page, if asked).
            "night": follow != "active" and self._conn().get("provider") == "bluetooth" and self._night(),
            "solar_from": chance,
            "wake_at": wake_at,
            # Shared: the home battery's share of the sun it could take, and what it still needs (kWh), to be full
            # by the end of the day's sun.
            "share": self._share_brief() if v["control"]["first"] == "shared" else None,
            "min_w": round(spec.watts(spec.min_amps)) if spec else None,
            "max_amps": min(spec.max_amps, s.max_amps or spec.max_amps)
            if spec and s
            else spec.max_amps
            if spec
            else None,
            "min_amps": spec.min_amps if spec else None,
            "phases": spec.phases if spec else None,
            "volts": spec.volts if spec else None,
            # The current spare solar alone would charge at (0: not enough for its lowest), as it's followed.
            "solar_amps": None
            if spec is None or spare is None
            else (lambda a: a if a >= spec.min_amps else 0)(min(spec.amps_for(spare), spec.max_amps)),
            "state": None
            if s is None
            else {
                "as_of": s.as_of or (logged or {}).get("given_at"),
                "asleep": s.asleep,
                "charging_state": s.charging_state,
                "plugged": s.plugged,
                "charging": s.charging,
                "soc": s.soc if s.soc is not None else (logged or {}).get("given"),
                "limit": s.limit,
                "range_km": s.range_km,
                "amps": s.request_amps,
                "actual_amps": s.actual_amps,
                "power_kw": round(control.car_watts(s, spec) / 1000, 2) if spec else s.power_kw,
                "energy_added": s.energy_added,
                "minutes_to_full": s.minutes_to_full,
                "at_home": s.at_home,
                "in_range": s.in_range,
            },
        }

    def _logged_level(self, vin: str, v: dict[str, Any]) -> dict[str, Any] | None:
        """The level last read for a Tesla (its dashboard car's, else its own), as logged ({given, given_at}), if
        any."""
        store, key = self._levels(vin, v)
        try:
            read = store.last_read(key, int(self.clock()))
        except NoSuchCar:
            return None
        return {"given": read[1], "given_at": read[0]} if read else None

    def status(self) -> dict[str, Any]:
        """How the cars are reached and each car, as the EV page shows them. The token and key never leave in
        full."""
        c = self._conn()
        token = c.get("token")
        key = self._key()
        connected = self._is_connected(c)
        return {
            "provider": c.get("provider") if connected else None,
            "connected": connected,
            "token": mask(token) if token else None,
            "bluetooth": {
                "key": bluetooth.fingerprint(key) if key else None,
                "role": self._key_role(),  # charging_manager (can't wake the car) or driver
                "pairing": self._pairing,
                "mock_vin": DEMO_VIN if self.config.mock else None,  # the made-up car to pair in mock mode
            },
            "error": self._error,
            # Why the last read failed, when it's a known kind: "busy", the car's taking no more Bluetooth
            # connections (phones with its key near it); reads are eased off until it does (BUSY_BACKOFF).
            "error_kind": "busy" if self._error is not None and self._busy else None,
            "read_at": self._read_at,
            # When the cars are next read (after a failed read: tried again), unix seconds; and whether a read is
            # under way now. The loop turns every TICK seconds, so it's up to that much later.
            "next_read": max(math.ceil(self._next_read), int(self.clock())) if connected else None,
            "reading": self._reading,
            "tick": TICK,
            # Each timing a car's solar charging can be given (control.TIMING): its default, lowest and highest.
            "timing": {k: {"default": d, "min": lo, "max": hi} for k, (d, lo, hi, _) in control.TIMING.items()},
            "home": list(home) if (home := self.home()) else None,
            "vehicles": [self.vehicle(vin, v) for vin, v in c["vehicles"].items()] if connected else [],
        }

    def summary(self) -> list[dict[str, Any]] | None:
        """Each car in brief, for every page (the live status's `ev`); None when not connected."""
        c = self._conn()
        if not self._is_connected(c):
            return None
        out = []
        for vin, v in c["vehicles"].items():
            full = self.vehicle(vin, v)
            st = full["state"] or {}
            out.append({k: full[k] for k in ("vin", "make", "model", "year", "colour", "name", "car", "status", "doing")} | {
                "mode": v["control"]["mode"], "soc": st.get("soc"), "limit": st.get("limit"),
                "power_kw": st.get("power_kw"), "amps": st.get("amps"), "at_home": st.get("at_home"),
            })  # fmt: skip
        return out

    # -- the loop --------------------------------------------------------------------------------
    def wake(self) -> None:
        if self._wake is not None:
            self._wake.set()

    async def publish(self) -> None:
        summary = await asyncio.to_thread(self.summary)
        if self.live.set_ev("tesla", summary):
            self.live.publish()

    async def start(self) -> None:
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _run(self) -> None:
        assert self._wake is not None
        while True:
            try:
                await asyncio.to_thread(self.tick)
                await self.publish()
            except Exception:
                log.exception("Checking the Teslas failed")
            self._wake.clear()
            # Every TICK, or sooner when the next read's due sooner (every few seconds while a car charges at home).
            due = self._next_read - self.clock()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), min(TICK, due) if due > 0 else TICK)
