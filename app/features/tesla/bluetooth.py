"""
A Tesla over this server's Bluetooth: read and commanded locally, with no account or cloud in between. The car's own
vehicle-command protocol (signed and encrypted sessions over BLE), through tesla-fleet-api.

Pairing: the dashboard makes a key of its own (kept in the database, never shown), and asks the car to add it as a
*charging manager*, which can read the car's charge and start, stop and set charging, and nothing else (no unlocking,
no driving). The car only takes it once someone sitting in the car taps a key card on the console. A car is found by
the name it broadcasts, worked out from its VIN, so the VIN is all there is to type.

Its security computer always answers without waking it (whether it's asleep, and whether its charge port is open);
its charge is read only from an awake car, and reading it keeps the car awake. So how much is read follows how
closely the service follows the car (app.features.tesla.control.readiness):

    active  charging (so awake anyway): its charge every read
    ready   it could start charging soon: its charge every read, woken if it's asleep (and its port isn't closed),
            so it starts and follows the sun without waiting on it to wake
    quiet   no chance of charging soon: left to sleep. Its charge is read at most every QUIET_READ seconds, and
            only while it's awake, or when its charge port has opened or closed since (plugged in or out)

Asleep, its last charge reading stands, and a closed charge port says it's unplugged. A car with no charge reading
yet (the dashboard has just started) is woken once to be read, unless its port is closed. A command wakes the car
first. A car that isn't heard is out of range: not at home, or too far from the server.

Each read or command is one conversation: find the car, connect, talk, disconnect; one at a time with anything else
on the radio (app.core.bluetooth). Everything here is blocking.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections.abc import Callable
from typing import Any, Protocol

from app.core.bluetooth import run_alone, unavailable
from app.features.tesla.client import COMMANDS, VIN, TeslaError
from app.features.tesla.control import QUIET_READ

log = logging.getLogger(__name__)

SCAN_SECONDS = 12  # to hear the car's broadcast
PAIR_SECONDS = 150  # to get in the car and tap the key card
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

    def read(self, vin: str, key: str, charge: bool, wake: bool, plugged: bool | None) -> dict[str, Any]:
        """{heard, asleep, port_open, charge_state}: whether it was heard; whether it's asleep and its charge port is
        open (None when unknown); and its charge (Tesla's charge_state) when it's awake and either `charge` or its
        port no longer says what `plugged` (what was last known) does, or with `wake`, when it's asleep with the port
        not closed (waking it)."""
        ...

    def command(self, vin: str, key: str, name: str, params: dict[str, Any]) -> bool: ...

    def probe(self, vin: str, key: str) -> bool:
        """Whether the car already knows the key. Raises TeslaError when it isn't heard."""
        ...

    def pair(self, vin: str, key: str, seconds: float) -> str | None:
        """Ask the car to add the key, and wait for the key card to be tapped: the car's name, if it says."""
        ...


class BluetoothClient:
    """The cars paired with this server, read and commanded over Bluetooth (app.features.tesla.client). Keeps each
    car's last charge reading, which stands while the car sleeps."""

    def __init__(self, key: str, vins: Callable[[], list[str]], radio: Radio, clock: Callable[[], float] = time.time):
        self.key = key
        self.vins = vins
        self.radio = radio
        self.clock = clock
        self.names: dict[str, str] = {}
        self._charge: dict[str, tuple[float, dict[str, Any]]] = {}  # vin -> (when, charge_state)

    def vehicles(self, want: dict[str, str] | None = None) -> list[dict[str, Any]]:
        return [self._vehicle(vin, (want or {}).get(vin, "quiet")) for vin in self.vins()]

    def _vehicle(self, vin: str, want: str) -> dict[str, Any]:
        now = self.clock()
        at, charge = self._charge.get(vin, (0.0, None))
        plugged = None if charge is None else charge.get("charging_state") not in ("", "Disconnected")
        if want == "quiet":
            read, wake = charge is None or now - at >= QUIET_READ, charge is None
        else:
            read, wake = True, want == "ready" or charge is None
        r = self.radio.read(vin, self.key, read, wake, plugged)
        if r.get("charge_state") is not None:
            at, charge = now, r["charge_state"]
            self._charge[vin] = (at, charge)
        state = dict(charge or {})
        if state:
            state["timestamp"] = int(at * 1000)
        if r.get("port_open") is False:
            state["charging_state"] = "Disconnected"  # a closed charge port: nothing's plugged in
        last: dict[str, Any] = {
            "display_name": self.names.get(vin),
            "state": "asleep" if r.get("asleep") else "online",
            "vehicle_config": {"car_type": car_type(vin)},
            "charge_state": state,
        }
        return {"vin": vin, "last_state": last, "in_range": bool(r.get("heard"))}

    def command(self, vin: str, name: str, **params: Any) -> bool:
        if name not in COMMANDS or not VIN.match(vin):
            raise ValueError(f"Unknown command: {name}")
        ok = self.radio.command(vin, self.key, name, params)
        if ok:
            self._charge.pop(vin, None)  # what it was doing before isn't what it's doing now: read it again
        return ok


# -- the real radio ---------------------------------------------------------------------------------------------------


def _explain(e: BaseException) -> TeslaError:
    """A TeslaError, in words, for whatever went wrong talking to the car."""
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
    if named("BluetoothTransportError"):
        return TeslaError("The car couldn't be connected to over Bluetooth. It may be at the edge of range.")
    if named("BluetoothTimeout"):
        return TeslaError("The car didn't answer over Bluetooth in time. It may be at the edge of range.")
    if named("TeslaFleetError"):
        return TeslaError(f"The car turned it down ({type(e).__name__}).")
    if isinstance(e, BleakError | OSError):
        return TeslaError(unavailable(e))
    return TeslaError(f"Bluetooth went wrong ({type(e).__name__}: {e}).")


async def _find(vin: str) -> Any:
    """The car's Bluetooth device, or None when it isn't heard."""
    from bleak import BleakScanner

    return await BleakScanner.find_device_by_name(ble_name(vin), timeout=SCAN_SECONDS)


async def _talk(vin: str, key: str, then: Callable[[Any], Any], *, wake: bool) -> Any:
    """Find the car, connect, `await then(car)`, and disconnect. None when it isn't heard."""
    from cryptography.hazmat.primitives import serialization
    from tesla_fleet_api.tesla.bluetooth import TeslaBluetooth

    device = await _find(vin)
    if device is None:
        return None
    car = TeslaBluetooth().vehicles.create(
        vin,
        serialization.load_pem_private_key(key.encode(), None),  # type: ignore[arg-type]
        device,
        keepalive_interval=None,  # one conversation, then let it sleep
        wake_if_asleep=wake,
    )
    await car.connect()
    try:
        return await then(car)
    finally:
        await car.disconnect()


def _converse(coro: Callable[[], Any]) -> Any:
    """Run one conversation in an event loop of its own, every failure turned into a TeslaError (which, unlike
    tesla-fleet-api's, pickles, for a Mac's process of its own)."""
    try:
        return asyncio.run(coro())
    except BaseException as e:  # tesla-fleet-api's errors are BaseExceptions
        if isinstance(e, KeyboardInterrupt | SystemExit):
            raise
        raise _explain(e) from None


def _read_now(vin: str, key: str, charge: bool, wake: bool, plugged: bool | None) -> dict[str, Any]:
    from google.protobuf.json_format import MessageToDict  # type: ignore[import-untyped]
    from tesla_protocol.command.vcsec_pb2 import ClosureState_E, VehicleSleepStatus_E

    async def then(car: Any) -> dict[str, Any]:
        status = await car.vehicle_state()  # the security computer: answers without waking the car
        asleep = status.vehicleSleepStatus == VehicleSleepStatus_E.VEHICLE_SLEEP_STATUS_ASLEEP
        port = status.closureStatuses.chargePort if status.HasField("closureStatuses") else None
        port_open = (
            None if port in (None, ClosureState_E.CLOSURESTATE_UNKNOWN) else port != ClosureState_E.CLOSURESTATE_CLOSED
        )
        out: dict[str, Any] = {"heard": True, "asleep": asleep, "port_open": port_open, "charge_state": None}
        moved = port_open is not None and plugged is not None and port_open != plugged  # plugged in or out since
        if (not asleep and (charge or moved)) or (asleep and wake and port_open is not False):
            cs = await car.charge_state()
            state = MessageToDict(cs, preserving_proto_field_name=True)
            state["charging_state"] = cs.charging_state.WhichOneof("type") or ""
            out["charge_state"] = state
        return out

    return _converse(lambda: _talk(vin, key, then, wake=wake)) or {"heard": False}


def _command_now(vin: str, key: str, name: str, params: dict[str, Any]) -> bool:
    async def then(car: Any) -> bool:
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


def _pair_now(vin: str, key: str, seconds: float) -> str | None:
    from tesla_fleet_api import exceptions as x
    from tesla_protocol.command.keys_pb2 import Role

    async def then(car: Any) -> dict[str, Any]:
        try:
            await car.pair(Role.ROLE_CHARGING_MANAGER, timeout=seconds)
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

    def read(self, vin: str, key: str, charge: bool, wake: bool, plugged: bool | None) -> dict[str, Any]:
        return run_alone(_read_now, vin, key, charge, wake, plugged, refused=TeslaError)

    def command(self, vin: str, key: str, name: str, params: dict[str, Any]) -> bool:
        return run_alone(_command_now, vin, key, name, params, refused=TeslaError)

    def probe(self, vin: str, key: str) -> bool:
        return run_alone(_probe_now, vin, key, refused=TeslaError)

    def pair(self, vin: str, key: str, seconds: float) -> str | None:
        return run_alone(_pair_now, vin, key, seconds, refused=TeslaError)
