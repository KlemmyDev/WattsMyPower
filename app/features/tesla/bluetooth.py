"""
A Tesla over this server's Bluetooth: read and commanded locally, with no account or cloud in between. The car's own
vehicle-command protocol (signed and encrypted sessions over BLE), through tesla-fleet-api.

Pairing: the dashboard makes a key of its own (kept in the database, never shown), and asks the car to add it in one
of two roles (ROLES): a *charging manager*, which can read the car's charge and start, stop and set charging, and
nothing else (no unlocking, no driving), but can't wake the car; or a *driver*, as a phone key is, which can wake it
(so charging from solar can start a car that's fallen asleep plugged in), and could also unlock and drive it. The car
only takes it once someone sitting in the car taps a key card on the console. A car is found by
the name it broadcasts, worked out from its VIN, so the VIN is all there is to type.

Its security computer always answers without waking it (whether it's asleep, and whether its charge port is open);
its charge is read only from an awake car, and reading it keeps the car awake. So how much is read follows how
closely the service follows the car (app.features.tesla.control.readiness):

    active  charging (so awake anyway): its charge every read
    ready   it could start charging soon: its charge every read, woken if it's asleep (and its port isn't closed),
            so it starts and follows the sun without waiting on it to wake
    quiet   no chance of charging soon: left to sleep. Its charge is read at most every QUIET_READ seconds, and
            only while it's awake, or when its charge port has opened or closed since (plugged in or out)
    night   quiet, with the sun down: never woken, and checked every half hour. Its charge is read only while it's
            awake and plugged in (charging, say on a schedule: then it's followed as active), or when it's just come
            back in range, been sent a command, or been plugged in or out; an asleep car is left be. The household
            wakes it from the EV page if they want it read (refresh_details)

Asleep, its last charge reading stands, and a closed charge port says it's unplugged. A car with no charge reading
yet (the dashboard has just started) is woken once to be read, unless its port is closed. A command wakes the car
first. A car that doesn't wake (a charging manager's key may not be allowed to wake it) isn't woken again for
WAKE_BACKOFF seconds: until then it's only checked without waking it, and its charge is read once it's awake anyway
(charging, in use, or woken from the Tesla app). A car that isn't heard is out of range: not at home, or too far from the server.

Each read or command is one conversation: find the car, connect, talk, disconnect; one at a time with anything else
on the radio (app.core.bluetooth). One whose link couldn't be made, or dropped before anything reached the car, is had
again once from the start (ATTEMPTS). Everything here is blocking.
"""

from __future__ import annotations

import asyncio
import contextvars
import hashlib
import itertools
import logging
import re
import time
from collections.abc import Callable
from typing import Any, Protocol

from app.core.bluetooth import run_alone, unavailable
from app.features.tesla import details
from app.features.tesla.client import COMMANDS, VIN, CarAsleep, TeslaError
from app.features.tesla.control import QUIET_READ

log = logging.getLogger(__name__)

SCAN_SECONDS = 12  # to hear the car's broadcast
# How long the car gets to answer each message (tesla-fleet-api waits 5 s for a reading and 2 s for a command's
# acknowledgement): longer, as the server may be some way from the car, through walls.
REPLY_SECONDS = 12
ACK_SECONDS = 8
# A link that couldn't be made or dropped (the car heard, but busy, or the server's Bluetooth still letting go of the
# last one) is tried again, after a pause: nothing reached the car, so a command can't happen twice.
ATTEMPTS = 2
RETRY_PAUSE = 3.0
HANG_UP_SECONDS = 5.0  # to disconnect once done: what was read stands whether or not it went cleanly
WAKE_BACKOFF = 1800  # seconds the car isn't woken again after it didn't wake (the key may not be allowed to wake it)
WEAK_RSSI = -85  # dBm: a signal below this is weak (the car at the edge of range)
FAIR_RSSI = -72
PAIR_SECONDS = 150  # to get in the car and tap the key card
ROLES = ("charging_manager", "driver")  # the key's role in the car (see the module's docstring)
DETAILS_EVERY = 900  # seconds between reads of a car's details (app.features.tesla.details) while it's awake
DETAILS_ACTIVE = 300  # while it's charging or ready to (awake anyway)
EXTRAS_PER_READ = 2  # groups of details read at most with each read, so a command never waits long behind one
# What a command the car took changes in its charge reading, kept until it's read again: the field, and the param.
TOOK = {"set_charging_amps": ("charge_current_request", "amps"), "set_charge_limit": ("charge_limit_soc", "percent")}
REFUSED_RETRY = 86400  # a group the key may not read is asked for again after this
# Each group of details over Bluetooth: the car's own vehicle-data requests, one at a time (two at once can be more
# than a Bluetooth message holds), and where each answer is.
READS: dict[str, tuple[tuple[str, str], ...]] = {
    "schedule": (
        ("CHARGE_SCHEDULE_STATE", "charge_schedule_state"),
        ("PRECONDITIONING_SCHEDULE_STATE", "preconditioning_schedule_state"),
    ),
    "climate": (("CLIMATE_STATE", "climate_state"),),
    "security": (("CLOSURES_STATE", "closures_state"),),
    "tyres": (("TIRE_PRESSURE_STATE", "tire_pressure_state"),),
    "driving": (("DRIVE_STATE", "drive_state"),),
    "software": (("SOFTWARE_UPDATE_STATE", "software_update_state"), ("LEGACY_VEHICLE_STATE", "legacy_vehicle_state")),
    "media": (("MEDIA_STATE", "media_state"),),
}
MODELS = {"3": "model3", "Y": "modely", "S": "models", "X": "modelx", "C": "cybertruck"}  # the VIN's 4th letter


def ble_name(vin: str) -> str:
    """The name a car broadcasts over Bluetooth: from its VIN, so it can be found without being told its address."""
    return "S" + hashlib.sha1(vin.encode()).hexdigest()[:16] + "C"


def car_type(vin: str) -> str | None:
    """Tesla's car_type from the VIN (Bluetooth doesn't say): "modely" for a 7SAY… or 5YJY… VIN."""
    return MODELS.get(vin[3]) if len(vin) == 17 else None


def new_key() -> str:
    """A new private key for this server (NIST P-256, as the car's protocol wants), as PEM."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()


def fingerprint(pem: str) -> str:
    """A short name for the key, to tell it apart in the car's list of keys: the start of its public key's hash."""
    from cryptography.hazmat.primitives import serialization

    key = serialization.load_pem_private_key(pem.encode(), None)
    raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return hashlib.sha256(raw).hexdigest()[:8]


class Radio(Protocol):
    """Conversations with a car (Bleak, below; app.features.tesla.mock in mock mode). Each raises TeslaError."""

    def read(
        self,
        vin: str,
        key: str,
        charge: bool,
        wake: bool,
        plugged: bool | None,
        extras: tuple[str, ...] = (),
        wake_for_extras: bool = False,
    ) -> dict[str, Any]:
        """{heard, asleep, port_open, status, charge_state, extras, refused}: whether it was heard; whether it's asleep
        and its charge port is open (None when unknown); its security computer's status, in words (details' status
        group); its charge (Tesla's charge_state) when it's awake and either `charge` or its port no longer says
        what `plugged` (what was last known) does, or with `wake`, when it's asleep with the port not closed (waking
        it); and the details groups in `extras` ({group: {field: message as a dict}}), read only while it's awake,
        unless `wake_for_extras` (then it's woken), with those its key may not read in `refused` ({group: why})."""
        ...

    def command(self, vin: str, key: str, name: str, params: dict[str, Any]) -> bool: ...

    def probe(self, vin: str, key: str) -> bool:
        """Whether the car already knows the key. Raises TeslaError when it isn't heard."""
        ...

    def pair(self, vin: str, key: str, seconds: float, role: str = "charging_manager") -> str | None:
        """Ask the car to add the key in `role` (ROLES), and wait for the key card to be tapped: the car's name, if it
        says."""
        ...


class BluetoothClient:
    """The cars paired with this server, read and commanded over Bluetooth (app.features.tesla.client). Keeps each
    car's last charge reading and details, which stand while the car sleeps. Details are read along with the charge,
    only while the car is awake: every DETAILS_ACTIVE seconds while it's charging or ready to, else with the quiet
    hourly read, so they never keep it awake on their own."""

    def __init__(
        self,
        key: str,
        vins: Callable[[], list[str]],
        radio: Radio,
        clock: Callable[[], float] = time.time,
        kept: dict[str, Any] | None = None,
        keep: Callable[[dict[str, Any]], None] | None = None,
    ):
        """`kept`: each car's last charge reading, as `keep` was last given it ({vin: [when, charge_state]}), so after
        a restart the car's level, limit and current still show (an asleep car isn't woken to read them)."""
        self.key = key
        self.vins = vins
        self.radio = radio
        self.clock = clock
        self.keep = keep
        self.names: dict[str, str] = {}
        self._charge: dict[str, tuple[float, dict[str, Any]]] = {  # vin -> (when, charge_state)
            vin: (float(at), dict(charge)) for vin, (at, charge) in (kept or {}).items()
        }
        self._status: dict[str, tuple[float, dict[str, Any]]] = {}  # vin -> (when, the security computer's status)
        self._extras: dict[str, dict[str, tuple[int, dict[str, Any]]]] = {}  # vin -> group -> (when, raw)
        self._refused: dict[str, dict[str, tuple[int, str]]] = {}  # vin -> group -> (when, why)
        self._gone: set[str] = set()  # cars not heard last time: back in range, their charge is read at once
        self._no_wake: dict[str, float] = {}  # vin -> until when it isn't woken (it didn't wake last time)
        self._stale: set[str] = set()  # cars sent a command since their charge was read: read it at the next read

    def vehicles(self, want: dict[str, str] | None = None) -> list[dict[str, Any]]:
        return [self._vehicle(vin, (want or {}).get(vin, "quiet")) for vin in self.vins()]

    def _due(self, vin: str, every: float) -> tuple[str, ...]:
        """The details groups to read with this read, if the car's awake: those not read for `every` seconds (and
        not refused lately)."""
        now = self.clock()
        have = self._extras.get(vin, {})
        refused = self._refused.get(vin, {})
        return tuple(
            g
            for g in details.EXTRAS
            if now - have.get(g, (0, {}))[0] >= every and now - refused.get(g, (0, ""))[0] >= REFUSED_RETRY
        )

    def _vehicle(self, vin: str, want: str) -> dict[str, Any]:
        now = self.clock()
        at, charge = self._charge.get(vin, (0.0, None))
        plugged = None if charge is None else charge.get("charging_state") not in ("", "Disconnected")
        extras: tuple[str, ...] = ()
        if want == "night":
            read = plugged is not False or vin in self._gone or vin in self._stale  # only read if it's awake
            wake = False
        elif want == "quiet":
            read = charge is None or now - at >= QUIET_READ or vin in self._gone or vin in self._stale
            wake = charge is None
            extras = self._due(vin, 0) if read else ()  # along with the hourly read, never on their own
        else:
            read, wake = True, want == "ready" or charge is None
            extras = self._due(vin, DETAILS_ACTIVE if want == "active" else DETAILS_EVERY)[:EXTRAS_PER_READ]
        if wake and now < self._no_wake.get(vin, 0):
            wake = False  # it didn't wake last time: left asleep, its charge read once it's awake anyway
        r = self.radio.read(vin, self.key, read, wake, plugged, extras)
        if r.get("wake_failed"):
            self._no_wake[vin] = now + WAKE_BACKOFF
        elif r.get("charge_state") is not None:
            self._no_wake.pop(vin, None)
        return self._row(vin, r, "ready" if want == "ready" else "first")

    def _row(self, vin: str, r: dict[str, Any], why: str | None = None) -> dict[str, Any]:
        """What was read of a car (radio.read's answer), with what's kept from before, as vehicles() gives it. With
        `woke`: why, when reading it woke it (the service logs it)."""
        now = self.clock()
        at, charge = self._charge.get(vin, (0.0, None))
        if not r.get("heard"):
            self._gone.add(vin)  # it's left (or out of range): what's kept is from before
        if r.get("charge_state") is not None:
            at, charge = now, r["charge_state"]
            self._charge[vin] = (at, charge)
            self._kept()
            self._gone.discard(vin)
            self._stale.discard(vin)
        if r.get("status"):
            self._status[vin] = (now, r["status"])
        for g, raw in (r.get("extras") or {}).items():
            self._extras.setdefault(vin, {})[g] = (int(now), raw)
            self._refused.get(vin, {}).pop(g, None)
        for g, why in (r.get("refused") or {}).items():
            self._refused.setdefault(vin, {})[g] = (int(now), why)
        state = dict(charge or {})
        if state:
            state["timestamp"] = int(at * 1000)
        if r.get("port_open") is False:
            state["charging_state"] = "Disconnected"  # a closed charge port: nothing's plugged in
        elif r.get("port_open") and not state.get("charging_state"):
            state["charging_state"] = "Stopped"  # its charge not read yet, but its port's open: plugged in
        last: dict[str, Any] = {
            "display_name": self.names.get(vin),
            "state": "asleep" if r.get("asleep") else "online",
            "vehicle_config": {"car_type": car_type(vin)},
            "charge_state": state,
        }
        status_at, status = self._status.get(vin, (0.0, None))
        found = details.from_ble(
            status,
            int(status_at) or None,
            charge,
            int(at) or None,
            self._extras.get(vin, {}),
            self._refused.get(vin, {}),
        )
        row = {"vin": vin, "last_state": last, "in_range": bool(r.get("heard")), "details": found}
        if r.get("woke") and why:
            row["woke"] = why
        if r.get("wake_failed"):
            row["wake_failed"] = int(self._no_wake.get(vin, now))  # until when it's left asleep
        return row

    def refresh_details(self, vin: str, wake: bool) -> dict[str, Any]:
        """Read everything about the car now: its charge and every group of details, waking it only with `wake`."""
        r = self.radio.read(vin, self.key, True, False, None, details.EXTRAS, wake)
        if not r.get("heard"):
            raise TeslaError("The car wasn't heard over Bluetooth. Is it home, and in range of the server?")
        if r.get("asleep") and not wake:
            raise CarAsleep(self._row(vin, r))  # what its security computer said still counts
        return self._row(vin, r)

    def command(self, vin: str, name: str, **params: Any) -> bool:
        if name not in COMMANDS or not VIN.match(vin):
            raise ValueError(f"Unknown command: {name}")
        ok = self.radio.command(vin, self.key, name, params)
        if ok:
            # What it was doing before isn't what it's doing now: read again at the next read. Until then, what was
            # read stands (so the page keeps showing it), with what the command set; its time stays the reading's.
            self._stale.add(vin)
            if vin in self._charge and name in TOOK:
                at, charge = self._charge[vin]
                field, param = TOOK[name]
                self._charge[vin] = (at, {**charge, field: params[param]})
                self._kept()
        return ok

    def _kept(self) -> None:
        """Keep each car's last charge reading (see __init__)."""
        if self.keep is not None:
            self.keep({vin: [at, charge] for vin, (at, charge) in self._charge.items()})


# -- the real radio ---------------------------------------------------------------------------------------------------


# The conversation under way: what it's doing ("reading its charge") and how strongly the car was heard (dBm), so a
# failure can say where it failed and whether the car's at the edge of range.
_TALK: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar("tesla_talk")


def _step(text: str) -> None:
    if (t := _TALK.get(None)) is not None:
        t["step"] = text
        t["steps"].append((text, time.monotonic()))


def _timings(talk: dict[str, Any]) -> str:
    """How long each step of a conversation took: "listening for the car 1.2 s, connecting 3.4 s, …"."""
    marks = [*talk["steps"], ("", time.monotonic())]
    return ", ".join(f"{a} {b_t - a_t:.1f} s" for (a, a_t), (_, b_t) in itertools.pairwise(marks))


def signal(rssi: int | None) -> str:
    """How strongly the car was heard, in words: "strong (−64 dBm)"."""
    if rssi is None:
        return "unknown"
    word = "weak" if rssi < WEAK_RSSI else "fair" if rssi < FAIR_RSSI else "strong"
    return f"{word} ({rssi} dBm)".replace("-", "−")


def _where(talk: dict[str, Any] | None) -> str:
    """Where a conversation failed, and the car's signal, for its error: " while reading its charge. Its signal was
    weak (−91 dBm): …"."""
    if not talk:
        return "."
    out = f" while {talk['step']}." if talk.get("step") else "."
    rssi = talk.get("rssi")
    if rssi is not None:
        out += f" Its signal was {signal(rssi)}"
        out += (
            ": the server's Bluetooth adapter may be too far from the car (a USB extension lead helps)."
            if rssi < WEAK_RSSI
            else "."
        )
    return out


def _cause(e: BaseException) -> str:
    """What Bluetooth itself said, underneath tesla-fleet-api's error, for the error's end: " (Bluetooth said:
    le-connection-abort-by-local)"; "" when it said nothing."""
    said = ""
    seen: set[int] = set()
    while (e := e.__cause__ or e.__context__) is not None and id(e) not in seen:  # type: ignore[assignment]
        seen.add(id(e))
        if text := str(e).strip():
            said = text
    if not said:
        return ""
    said = re.sub(r"^\[org\.bluez[^]]*\]\s*", "", said)  # "[org.bluez.Error.Failed] le-connection-abort-by-local"
    return f" (Bluetooth said: {said[:120]})"


def _explain(e: BaseException, talk: dict[str, Any] | None = None) -> TeslaError:
    """A TeslaError, in words, for whatever went wrong talking to the car (`talk`: where, and its signal)."""
    from bleak.exc import BleakError
    from tesla_fleet_api import exceptions as x

    def named(*names: str) -> bool:
        return any(isinstance(e, c) for n in names if isinstance(c := getattr(x, n, None), type))

    if isinstance(e, TeslaError):
        return e
    if named("NotOnWhitelistFault", "SignedMessageInformationFaultNotOnWhitelist", "SigningDisabled"):
        return TeslaError(
            "The car doesn't know this server's key. Pair it again (Manage → Integrations → Tesla).", refused=True
        )
    if named("WhitelistOperationLocalEntityAuthFailedTimedOutWaitingForTap"):
        return TeslaError("The key card wasn't tapped in time. Try again, sitting in the car with the card ready.")
    if named("WhitelistOperationLocalEntityAuthFailedUIDenied", "WhitelistOperationLocalEntityAuthFailedCancelled"):
        return TeslaError("Adding the key was declined on the car's screen.")
    if named("WhitelistOperationWhitelistFull", "WhitelistOperationKeychainWhileFSFull"):
        return TeslaError("The car has no room for another key. Remove one in the car (Controls → Locks), then retry.")
    if named("WhitelistOperationStatus"):
        return TeslaError(f"The car didn't add the key ({type(e).__name__.removeprefix('WhitelistOperation')}).")
    if named("TeslaFleetMessageFaultInsufficientPrivileges"):
        return TeslaError("The car won't let this server's key do that.")
    waking = str((talk or {}).get("step") or "").startswith("waking")
    if waking and (named("BluetoothTimeout", "BluetoothCommandFailed") or isinstance(e, TimeoutError)):
        return TeslaError(
            "The car is asleep and didn't wake up for the dashboard's key. A charging-only key can't wake it: pair it "
            "again as a driver (Manage → Integrations → Tesla), or wake it in the Tesla app, then try again."
        )
    if named("BluetoothTransportError"):
        # Heard, but the link to it couldn't be made, or dropped: not range, when its signal was good.
        connecting = (talk or {}).get("step") == "connecting"
        what = "wouldn't take a Bluetooth connection" if connecting else "dropped the Bluetooth connection"
        return TeslaError(f"The car was heard, but {what} (tried {ATTEMPTS} times){_where(talk)}{_cause(e)}")
    if named("BluetoothTimeout") or isinstance(e, TimeoutError):
        return TeslaError(f"The car didn't answer over Bluetooth in time{_where(talk)}")
    if named("TeslaFleetError"):
        return TeslaError(f"The car turned it down ({type(e).__name__}).")
    if isinstance(e, BleakError | OSError):
        return TeslaError(unavailable(e))
    return TeslaError(f"Bluetooth went wrong ({type(e).__name__}: {e}).")


async def _talk(vin: str, key: str, then: Callable[[Any], Any], *, wake: bool) -> Any:
    """Find the car, connect, `await then(car)`, and disconnect. None when it isn't heard.

    The scan runs until the conversation's over. BlueZ forgets a car it's only heard in passing as soon as scanning
    stops, unless the last broadcast it heard said it takes connections; a Tesla also sends ones that don't (its
    beacon), so with the scan stopped first, connecting could fail with the car "not found" however well it was heard."""
    from bleak import BleakScanner
    from cryptography.hazmat.primitives import serialization
    from tesla_fleet_api.tesla.bluetooth import TeslaBluetooth

    name = ble_name(vin)
    talk = _TALK.get(None)
    heard: asyncio.Future[Any] = asyncio.get_running_loop().create_future()

    def hear(device: Any, adv: Any) -> None:
        if (adv.local_name or device.name) != name or heard.done():
            return
        if talk is not None:
            talk["rssi"] = adv.rssi  # how strongly it was heard, for an error's sake
        heard.set_result(device)

    _step("listening for the car")
    scanner = BleakScanner(hear)
    await scanner.start()
    try:
        try:
            device = await asyncio.wait_for(heard, SCAN_SECONDS)
        except TimeoutError:
            return None
        _step("connecting")
        car = TeslaBluetooth().vehicles.create(
            vin,
            serialization.load_pem_private_key(key.encode(), None),  # type: ignore[arg-type]
            device,
            keepalive_interval=None,  # one conversation, then let it sleep
            wake_if_asleep=wake,
        )
        car._default_timeout, car._actuation_timeout = REPLY_SECONDS, ACK_SECONDS
        await car.connect()
        try:
            return await then(car)
        finally:
            try:
                async with asyncio.timeout(HANG_UP_SECONDS):
                    await car.disconnect()
            except Exception as e:  # the car's already gone, say: what it said still counts
                log.info("Tesla over Bluetooth: disconnecting went wrong (%s: %s)", type(e).__name__, e)
    finally:
        try:
            await scanner.stop()
        except Exception as e:  # what was said still counts
            log.info("Tesla over Bluetooth: stopping the scan went wrong (%s: %s)", type(e).__name__, e)


def _converse(coro: Callable[[], Any], sleep: Callable[[float], None] = time.sleep) -> Any:
    """Run one conversation in an event loop of its own, every failure turned into a TeslaError (which, unlike
    tesla-fleet-api's, pickles, for a Mac's process of its own). One whose link couldn't be made or dropped is had
    again from the start (ATTEMPTS)."""
    from tesla_fleet_api.exceptions import BluetoothTransportError

    for attempt in range(1, ATTEMPTS + 1):
        talk: dict[str, Any] = {"step": None, "rssi": None, "steps": []}
        token = _TALK.set(talk)
        start = time.monotonic()
        try:
            out = asyncio.run(coro())
            log.info("Tesla over Bluetooth: done in %.1f s (%s; signal %s)", time.monotonic() - start,
                     _timings(talk), signal(talk["rssi"]))  # fmt: skip
            return out
        except BaseException as e:  # tesla-fleet-api's errors are BaseExceptions
            if isinstance(e, KeyboardInterrupt | SystemExit):
                raise
            log.info("Tesla over Bluetooth: %s after %.1f s (%s; signal %s)%s", type(e).__name__,
                     time.monotonic() - start, _timings(talk), signal(talk["rssi"]), _cause(e))  # fmt: skip
            if isinstance(e, BluetoothTransportError) and attempt < ATTEMPTS:
                sleep(RETRY_PAUSE)
                continue
            raise _explain(e, talk) from None
        finally:
            _TALK.reset(token)
    raise AssertionError("unreachable")


CLOSURES = {"frontDriverDoor": "Driver door", "frontPassengerDoor": "Passenger door", "rearDriverDoor": "Rear left door",
            "rearPassengerDoor": "Rear right door", "frontTrunk": "Frunk", "rearTrunk": "Boot",
            "chargePort": "Charge port"}  # fmt: skip


def _status(status: Any) -> dict[str, Any]:
    """The security computer's status, in words (details' status group): locked, what's open, someone in it, gear."""
    from tesla_protocol.command import vcsec_pb2 as vc

    closures = status.closureStatuses if status.HasField("closureStatuses") else None
    shut = (vc.ClosureState_E.CLOSURESTATE_CLOSED, vc.ClosureState_E.CLOSURESTATE_UNKNOWN)
    presence = {vc.UserPresence_E.VEHICLE_USER_PRESENCE_PRESENT: True,
                vc.UserPresence_E.VEHICLE_USER_PRESENCE_NOT_PRESENT: False}  # fmt: skip
    gears = {vc.Gear_E.GEAR_PARK: "P", vc.Gear_E.GEAR_DRIVE: "D", vc.Gear_E.GEAR_REVERSE: "R",
             vc.Gear_E.GEAR_NEUTRAL: "N"}  # fmt: skip
    locked = (vc.VehicleLockState_E.VEHICLELOCKSTATE_LOCKED, vc.VehicleLockState_E.VEHICLELOCKSTATE_INTERNAL_LOCKED)
    return {
        "locked": status.vehicleLockState in locked,
        "open": [name for f, name in CLOSURES.items() if closures is not None and getattr(closures, f) not in shut],
        "user_present": presence.get(status.userPresence),
        "gear": gears.get(status.gear),
    }


async def _extras(car: Any, groups: tuple[str, ...]) -> tuple[dict[str, Any], dict[str, str]]:
    """The details groups asked for ({group: {field: message as a dict}}), and those the key may not read."""
    from google.protobuf.json_format import MessageToDict  # type: ignore[import-untyped]
    from tesla_fleet_api import exceptions as x
    from tesla_fleet_api.const import BluetoothVehicleData

    got: dict[str, Any] = {}
    refused: dict[str, str] = {}
    for g in groups:
        raw: dict[str, Any] = {}
        try:
            for request, field in READS[g]:
                data = await car.vehicle_data([getattr(BluetoothVehicleData, request)])
                raw[field] = MessageToDict(getattr(data, field), preserving_proto_field_name=True)
        except x.TeslaFleetMessageFaultInsufficientPrivileges:
            refused[g] = "The car doesn't share this with the dashboard's key (a charging manager)"
            continue
        except (x.BluetoothTransportError, x.BluetoothTimeout):
            break  # the connection's gone or the car's gone quiet: the rest wait for the next read
        except x.TeslaFleetError as e:
            log.info("Tesla %s: couldn't read its %s (%s)", car.vin[-6:], g, type(e).__name__)
            continue
        got[g] = raw
    return got, refused


def _read_now(
    vin: str,
    key: str,
    charge: bool,
    wake: bool,
    plugged: bool | None,
    extras: tuple[str, ...] = (),
    wake_for_extras: bool = False,
) -> dict[str, Any]:
    from google.protobuf.json_format import MessageToDict
    from tesla_fleet_api import exceptions as x
    from tesla_protocol.command.vcsec_pb2 import ClosureState_E, VehicleSleepStatus_E

    async def then(car: Any) -> dict[str, Any]:
        _step("asking whether it's asleep")
        status = await car.vehicle_state()  # the security computer: answers without waking the car
        asleep = status.vehicleSleepStatus == VehicleSleepStatus_E.VEHICLE_SLEEP_STATUS_ASLEEP
        port = status.closureStatuses.chargePort if status.HasField("closureStatuses") else None
        port_open = (
            None if port in (None, ClosureState_E.CLOSURESTATE_UNKNOWN) else port != ClosureState_E.CLOSURESTATE_CLOSED
        )
        out: dict[str, Any] = {"heard": True, "asleep": asleep, "port_open": port_open, "status": _status(status),
                               "charge_state": None, "extras": {}, "refused": {}}  # fmt: skip
        if asleep and wake_for_extras:  # asked for: a refresh the household said may wake it
            _step("waking it")
            await car.wake_up(wait=True)
            asleep = out["asleep"] = False
            out["woke"] = True
        moved = port_open is not None and plugged is not None and port_open != plugged  # plugged in or out since
        if (not asleep and (charge or moved)) or (asleep and wake and port_open is not False):
            _step("waking it to read its charge" if asleep else "reading its charge")
            try:
                cs = await car.charge_state()
            except (x.BluetoothTimeout, x.BluetoothCommandFailed):
                if not asleep:
                    raise
                out["wake_failed"] = True  # it didn't wake: what its security computer said still counts
                return out
            state = MessageToDict(cs, preserving_proto_field_name=True)
            state["charging_state"] = cs.charging_state.WhichOneof("type") or ""
            out["charge_state"] = state
            if asleep:
                out["woke"] = True  # it was asleep: reading its charge woke it
            asleep = False
        if extras and not asleep:
            _step("reading its details")
            out["extras"], out["refused"] = await _extras(car, extras)
        return out

    return _converse(lambda: _talk(vin, key, then, wake=wake)) or {"heard": False}


STEPS = {"start_charging": "starting it charging", "stop_charging": "stopping its charging",
         "set_charging_amps": "setting its charging current", "set_charge_limit": "setting its charge limit"}  # fmt: skip


def _command_now(vin: str, key: str, name: str, params: dict[str, Any]) -> bool:
    from tesla_protocol.command.vcsec_pb2 import VehicleSleepStatus_E

    async def then(car: Any) -> bool:
        _step("asking whether it's asleep")
        status = await car.vehicle_state()
        asleep = status.vehicleSleepStatus == VehicleSleepStatus_E.VEHICLE_SLEEP_STATUS_ASLEEP
        _step("waking it first" if asleep else STEPS.get(name, "sending it a command"))
        if name == "start_charging":
            r = await car.charge_start()
        elif name == "stop_charging":
            r = await car.charge_stop()
        elif name == "set_charging_amps":
            r = await car.set_charging_amps(int(params["amps"]))
        else:
            r = await car.set_charge_limit(int(params["percent"]))
        return bool(((r or {}).get("response") or {}).get("result", True))

    out = _converse(lambda: _talk(vin, key, then, wake=True))
    if out is None:
        raise TeslaError("The car wasn't heard over Bluetooth. Is it home, and in range of the server?")
    return bool(out)


def _probe_now(vin: str, key: str) -> bool:
    from tesla_fleet_api import exceptions as x

    async def then(car: Any) -> bool:
        try:
            await car.vehicle_state()
        except (x.NotOnWhitelistFault, x.SignedMessageInformationFaultNotOnWhitelist):
            return False
        return True

    out = _converse(lambda: _talk(vin, key, then, wake=False))
    if out is None:
        raise TeslaError(
            "The car wasn't heard over Bluetooth. Check the VIN, and that the car is parked within range of the "
            "server (Bluetooth reaches about 10 m, less through walls)."
        )
    return bool(out)


def _pair_now(vin: str, key: str, seconds: float, role: str = "charging_manager") -> str | None:
    from tesla_fleet_api import exceptions as x
    from tesla_protocol.command.keys_pb2 import Role

    async def then(car: Any) -> dict[str, Any]:
        try:
            await car.pair(Role.ROLE_DRIVER if role == "driver" else Role.ROLE_CHARGING_MANAGER, timeout=seconds)
        except x.WhitelistOperationAttemptingToAddExistingKey:
            pass  # it has it already
        except x.BluetoothTimeout as e:  # neither the car's answer nor the key working came in time
            raise TeslaError(
                "The key card wasn't tapped in time. Try again, sitting in the car with the card ready."
            ) from e
        try:
            name = await car.query_display_name(max_attempts=2)
        except Exception:
            name = None
        return {"name": name}

    out = _converse(lambda: _talk(vin, key, then, wake=False))
    if out is None:
        raise TeslaError("The car wasn't heard over Bluetooth any more. Try again closer to the server.")
    return out["name"]


class Bleak:
    """The real radio, one conversation at a time (app.core.bluetooth)."""

    def read(
        self,
        vin: str,
        key: str,
        charge: bool,
        wake: bool,
        plugged: bool | None,
        extras: tuple[str, ...] = (),
        wake_for_extras: bool = False,
    ) -> dict[str, Any]:
        return run_alone(_read_now, vin, key, charge, wake, plugged, extras, wake_for_extras, refused=TeslaError)

    def command(self, vin: str, key: str, name: str, params: dict[str, Any]) -> bool:
        return run_alone(_command_now, vin, key, name, params, refused=TeslaError)

    def probe(self, vin: str, key: str) -> bool:
        return run_alone(_probe_now, vin, key, refused=TeslaError)

    def pair(self, vin: str, key: str, seconds: float, role: str = "charging_manager") -> str | None:
        return run_alone(_pair_now, vin, key, seconds, role, refused=TeslaError)
