"""Tesla through Tessie or over Bluetooth: the clients, reading a car's state, spare power, the charging decisions, and
the service that connects, follows the sun, and never fights the household, the same whichever way the car is
reached. Every request to Tessie, and the radio, is faked."""

from __future__ import annotations

import io
import json
import threading
import time
import urllib.error
from email.message import Message
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.car.service import CarService
from app.features.settings.store import SettingsStore
from app.features.tesla import control, details
from app.features.tesla.bluetooth import BluetoothClient, ble_name, car_type
from app.features.tesla.client import TeslaError
from app.features.tesla.control import Charger, Memory
from app.features.tesla.service import POLL_IDLE, TeslaService, TeslaSetupError, guess_model
from app.features.tesla.tessie import TessieClient
from app.main import create_app

VIN = "7SAYGDEF1PA000001"
TOKEN = "tessie_0123456789abcdef"
HOME = (-27.47, 153.02)
THREE = Charger(phases=3, volts=230, min_amps=5, max_amps=16)  # 3.45 kW at 5 A, 690 W an amp


def last_state(**charge: Any) -> dict[str, Any]:
    cs = {
        "timestamp": 1_800_000_000_000,
        "charging_state": "Stopped",
        "battery_level": 50,
        "battery_range": 150,
        "charge_limit_soc": 80,
        "charge_current_request": 16,
        "charge_current_request_max": 16,
        "charger_actual_current": 0,
        "charger_voltage": 2,
        "fast_charger_present": False,
    } | charge
    return {
        "display_name": "Zappy",
        "state": "online",
        "vehicle_config": {"car_type": "modely", "trim_badging": "74d"},
        "drive_state": {"latitude": HOME[0], "longitude": HOME[1]},
        "charge_state": cs,
    }


def car(**charge: Any) -> control.CarState:
    return control.parse(VIN, last_state(**charge), HOME)


# -- the client ----------------------------------------------------------------------------------------


def test_the_client_sends_the_token_and_reads_the_cars() -> None:
    calls: list[tuple[Any, ...]] = []

    def request(method: str, url: str, body: Any, headers: dict[str, str], timeout: float) -> Any:
        calls.append((method, url, headers))
        if url.endswith("/vehicles"):
            return {"results": [{"vin": VIN, "last_state": {}}, {"vin": "not-a-vin"}]}
        return {"result": True}

    client = TessieClient(TOKEN, request)
    assert [v["vin"] for v in client.vehicles()] == [VIN]
    assert client.command(VIN, "set_charging_amps", amps=7) is True
    assert calls[0][2]["Authorization"] == f"Bearer {TOKEN}"
    assert calls[1][:2] == ("POST", f"https://api.tessie.com/{VIN}/command/set_charging_amps?amps=7")
    with pytest.raises(ValueError):
        client.command(VIN, "honk_horn")


def test_the_client_explains_a_refused_token() -> None:
    def request(*_: Any) -> Any:
        raise urllib.error.HTTPError("u", 401, "no", Message(), io.BytesIO(b""))

    with pytest.raises(TeslaError) as e:
        TessieClient(TOKEN, request).vehicles()
    assert e.value.refused and "access token" in str(e.value)


# -- the car's state and spare power --------------------------------------------------------------------


def test_a_cars_state_is_read_from_tessie() -> None:
    s = car(charging_state="Charging", charger_actual_current=10, charger_voltage=235)
    assert (s.plugged, s.charging, s.full, s.at_home) == (True, True, False, True)
    assert s.range_km == 241 and s.as_of == 1_800_000_000 and s.model == "modely"
    assert control.car_watts(s, THREE) == pytest.approx(10 * 235 * 3)
    assert not car(charging_state="Disconnected").plugged
    assert car(battery_level=80).full
    away = control.parse(VIN, last_state(), (-33.86, 151.21))
    assert away.at_home is False


def test_spare_power_with_the_home_battery_first() -> None:
    # Exporting 4 kW while the battery charges at its full 5 kW: 4 kW is spare.
    r = {"grid_power": -4000, "battery_power": -5000}
    assert control.spare_w(r, 0, first="battery", home_soc=60, battery_max_w=5000) == 4000
    # The car took 3.45 kW of it; the battery still gets its 5 kW: still 4 kW for the car.
    r = {"grid_power": -550, "battery_power": -5000}
    assert control.spare_w(r, 3450, first="battery", home_soc=60, battery_max_w=5000) == 4000
    # The battery charging at 2 kW when it could take 5: nothing for the car.
    r = {"grid_power": 0, "battery_power": -2000}
    assert control.spare_w(r, 0, first="battery", home_soc=60, battery_max_w=5000) == -3000
    # Full: what would be exported is the car's.
    r = {"grid_power": -2500, "battery_power": 0}
    assert control.spare_w(r, 0, first="battery", home_soc=99, battery_max_w=5000) == 2500


def test_spare_power_with_the_car_first() -> None:
    # What the battery is charging with is the car's too; what it gives isn't.
    assert control.spare_w({"grid_power": -500, "battery_power": -3000}, 0, first="car", home_soc=40,
                           battery_max_w=5000) == 3500  # fmt: skip
    assert control.spare_w({"grid_power": 0, "battery_power": 1200}, 3450, first="car", home_soc=40,
                           battery_max_w=5000) == 2250  # fmt: skip
    assert control.spare_w({"battery_power": 0}, 0, first="car", home_soc=40, battery_max_w=0) is None


# -- deciding ----------------------------------------------------------------------------------------------


def test_it_starts_only_after_spare_power_has_lasted() -> None:
    mem, s = Memory(), car()
    assert control.decide("solar", s, THREE, 4200, 300, mem, 1000) is None
    assert control.decide("solar", s, THREE, 4200, 300, mem, 1000 + control.START_AFTER - 1) is None
    d = control.decide("solar", s, THREE, 4200, 300, mem, 1000 + control.START_AFTER)
    assert d is not None and (d.action, d.amps) == ("start", 6)  # 4200 / 690 = 6 A


def test_the_current_follows_whatever_is_spare() -> None:
    # On one phase at 240 V each amp is 240 W: 1.5 kW charges at 6 A, 2.6 kW at 10 A, 4.1 kW at 17 A, and so on.
    one = Charger(phases=1, volts=240, min_amps=5, max_amps=32)
    mem = Memory(command="start", command_at=0, amps=5, amps_at=0)
    s = car(charging_state="Charging", charge_current_request=5, charge_current_request_max=32)
    for spare, amps in ((1500, 6), (2600, 10), (4100, 17), (9000, 32)):
        d = control.decide("solar", s, one, spare, 0, mem, 10_000 + amps * 100)
        assert d is not None and d.amps == amps
        mem.amps, mem.amps_at = amps, 10_000 + amps * 100
    # On three phases each amp is 690 W: 1.5 kW isn't enough for 5 A (3.45 kW) at all.
    assert control.decide("solar", car(), THREE, 1500, 0, Memory(), 10**6) is None


def test_the_supply_is_measured_from_the_car() -> None:
    # 5 A at 241 V drawing 1 kW (Tesla rounds to whole kW): one phase. At 3 kW+: three.
    one = car(charging_state="Charging", charger_actual_current=5, charger_voltage=241, charger_power=1)
    three = car(charging_state="Charging", charger_actual_current=6, charger_voltage=238, charger_power=4)
    assert control.measured(one) == (1, 241)
    assert control.measured(three) == (3, 238)
    assert control.measured(car()) == (None, None)
    # On one phase at 240 V, 1.2 kW spare is enough for 5 A.
    assert Charger(phases=1, volts=240, min_amps=5, max_amps=32).amps_for(1200) == 5


def test_a_dip_resets_the_wait_to_start() -> None:
    mem, s = Memory(), car()
    control.decide("solar", s, THREE, 4200, 300, mem, 1000)
    control.decide("solar", s, THREE, 2000, 300, mem, 1100)
    assert control.decide("solar", s, THREE, 4200, 300, mem, 1200) is None
    assert control.decide("solar", s, THREE, 4200, 300, mem, 1200 + control.START_AFTER) is not None


def test_charging_follows_the_sun_and_stops_when_its_short() -> None:
    mem = Memory(command="start", command_at=0, amps=6, amps_at=0)
    s = car(charging_state="Charging", charge_current_request=6, charger_actual_current=6)
    d = control.decide("solar", s, THREE, 9000, 300, mem, 1000)
    assert d is not None and (d.action, d.amps) == ("amps", 13)
    mem.amps, mem.amps_at = 13, 1000
    # Within its allowance (3.2 kW + 300 W covers 5 A): it keeps going at its lowest.
    d = control.decide("solar", s, THREE, 3200, 300, mem, 1100)
    assert d is not None and (d.action, d.amps) == ("amps", 5)
    mem.amps, mem.amps_at = 5, 1100
    # Short by more than that: it stops once it's been short a while.
    assert control.decide("solar", s, THREE, 2000, 300, mem, 1200) is None
    d = control.decide("solar", s, THREE, 2000, 300, mem, 1200 + control.STOP_AFTER)
    assert d is not None and d.action == "stop"


def test_a_car_that_starts_on_plugging_in_is_stopped_without_spare_solar() -> None:
    s = car(charging_state="Charging", charger_actual_current=16)
    d = control.decide("solar", s, THREE, 200, 300, Memory(), 1000)
    assert d is not None and d.action == "stop"


def test_a_full_car_is_left_alone() -> None:
    assert control.decide("solar", car(battery_level=80), THREE, 9000, 0, Memory(), 10**6) is None


def test_the_household_taking_over_is_noticed() -> None:
    mem = Memory(command="stop", command_at=1000)
    charging = car(charging_state="Charging", timestamp=1_500_000)
    assert control.taken_over(charging, mem, 1000 + control.GRACE - 1) is None
    assert "started outside" in (control.taken_over(charging, mem, 1000 + control.GRACE) or "")
    mem = Memory(command="start", command_at=1000, amps=8, amps_at=1000)
    assert "stopped outside" in (control.taken_over(car(timestamp=1_900_000), mem, 2000) or "")
    changed = car(charging_state="Charging", charge_current_request=12, timestamp=1_900_000)
    assert "to 12 A" in (control.taken_over(changed, mem, 2000) or "")
    assert control.taken_over(car(charging_state="Complete", battery_level=80, timestamp=1_900_000), mem, 2000) is None
    # What Tessie has from before the command says nothing about it.
    assert control.taken_over(car(timestamp=500), mem, 2000) is None


def test_settings_are_checked() -> None:
    assert control.clean({"mode": "solar"})["mode"] == "solar"
    for bad in ({"mode": "turbo"}, {"grid_w": -1}, {"grid_w": True}, {"first": "yes"}):
        with pytest.raises(ValueError):
            control.clean(bad)


def test_settings_kept_before_sharing_carry_on() -> None:
    assert control.clean({}, {"mode": "solar", "battery_first": False, "grid_w": 300}) == {
        "mode": "solar", "first": "car", "grid_w": 300}  # fmt: skip
    assert control.clean({}, {"battery_first": True})["first"] == "battery"
    assert control.clean({"first": "shared"}, {"battery_first": True})["first"] == "shared"


def test_models_are_guessed_from_teslas_names() -> None:
    assert guess_model("modely", "74d") == "tesla-model-y-lr"
    assert guess_model("model3", "p74d") == "tesla-model-3-perf"
    assert guess_model("modely", "50") == "tesla-model-y-rwd"
    assert guess_model("models", "100d") is None


# -- Bluetooth -----------------------------------------------------------------------------------------------


def test_a_car_is_found_by_the_name_its_vin_makes() -> None:
    assert ble_name(VIN) == "S" + __import__("hashlib").sha1(VIN.encode()).hexdigest()[:16] + "C"
    assert car_type("7SAYGDEF1PA000001") == "modely" and car_type("5YJ3E1EA7KF000001") == "model3"


class ScriptedRadio:
    """Answers each read as told, and records what was asked."""

    def __init__(self, *answers: dict[str, Any]) -> None:
        self.answers = list(answers)
        self.asked: list[tuple[bool, bool, bool | None]] = []

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
        self.asked.append((charge, wake, plugged))
        return self.answers.pop(0)

    def command(self, vin: str, key: str, name: str, params: dict[str, Any]) -> bool:
        return True


def test_bluetooth_keeps_the_last_charge_while_the_car_sleeps() -> None:
    clock = Clock()
    charge = last_state(charging_state="Stopped", battery_level=61)["charge_state"]
    radio = ScriptedRadio(
        {"heard": True, "asleep": False, "port_open": True, "charge_state": charge},
        {"heard": True, "asleep": True, "port_open": True, "charge_state": None},
        {"heard": True, "asleep": True, "port_open": False, "charge_state": None},
        {"heard": False},
    )
    client = BluetoothClient("key", lambda: [VIN], radio, clock)  # type: ignore[arg-type]
    [awake] = client.vehicles()
    assert awake["in_range"] and awake["last_state"]["charge_state"]["battery_level"] == 61
    assert radio.asked[0] == (True, True, None)  # nothing read yet: read it, waking it if it must
    clock.t += 60
    asleep = client.vehicles()[0]["last_state"]
    assert asleep["state"] == "asleep" and asleep["charge_state"]["charging_state"] == "Stopped"
    assert asleep["charge_state"]["timestamp"] == 1_800_000_000_000  # when it was read, not now
    assert radio.asked[1] == (False, False, True)  # quiet, and read lately: not again, and never woken for it
    clock.t += 60
    closed = client.vehicles()[0]
    assert closed["last_state"]["charge_state"]["charging_state"] == "Disconnected"  # the port's shut
    away = control.parse(VIN, client.vehicles()[0]["last_state"], HOME, in_range=False)
    assert away.at_home is False and away.in_range is False


def test_bluetooth_reads_a_car_back_in_range_at_once() -> None:
    clock = Clock()
    charge = last_state(charging_state="Disconnected")["charge_state"]
    awake = {"heard": True, "asleep": False, "port_open": False, "charge_state": charge}
    radio = ScriptedRadio(awake, {"heard": False}, awake)
    client = BluetoothClient("key", lambda: [VIN], radio, clock)  # type: ignore[arg-type]
    client.vehicles({VIN: "quiet"})
    clock.t += 600
    client.vehicles({VIN: "quiet"})  # gone
    clock.t += 600
    client.vehicles({VIN: "quiet"})  # back, ten minutes later: read now, not in an hour
    assert radio.asked[2][0] is True


def test_bluetooth_reads_as_closely_as_the_car_is_followed() -> None:
    clock = Clock()
    charge = last_state(charging_state="Disconnected")["charge_state"]
    awake = {"heard": True, "asleep": False, "port_open": False, "charge_state": charge}
    radio = ScriptedRadio(*[awake] * 5)
    client = BluetoothClient("key", lambda: [VIN], radio, clock)  # type: ignore[arg-type]
    client.vehicles()
    clock.t += 60
    client.vehicles({VIN: "quiet"})
    clock.t += control.QUIET_READ
    client.vehicles({VIN: "quiet"})  # an hour on: its charge, if it's awake, but it isn't woken for it
    client.vehicles({VIN: "ready"})  # read every time, and woken if it sleeps
    client.vehicles({VIN: "active"})
    assert radio.asked == [
        (True, True, None),
        (False, False, False),
        (True, False, False),
        (True, True, False),
        (True, False, False),
    ]


# -- the service, through each way of reaching the car ----------------------------------------------------------


class FakeTessie:
    def __init__(self) -> None:
        self.state = last_state()
        self.commands: list[tuple[str, dict[str, Any]]] = []
        self.fail: TeslaError | None = None
        self.clock: Clock | None = None  # stamps each reading with the time, as Tessie does
        self.refreshed: list[bool] = []

    def charge(self, **kw: Any) -> None:
        self.state["charge_state"].update(kw)

    def vehicles(self, want: dict[str, str] | None = None) -> list[dict[str, Any]]:
        if self.fail:
            raise self.fail
        if self.clock:
            self.state["charge_state"]["timestamp"] = int(self.clock() * 1000)
        last = json.loads(json.dumps(self.state))
        return [{"vin": VIN, "last_state": last, "details": details.from_fleet(last)}]

    def refresh_details(self, vin: str, wake: bool) -> dict[str, Any]:
        from app.features.tesla.client import CarAsleep

        self.refreshed.append(wake)
        row = self.vehicles()[0] | {"vin": vin}
        row["details"] = details.from_fleet(row["last_state"])
        if self.state.get("state") == "asleep" and not wake:
            raise CarAsleep(row)
        return row

    def command(self, vin: str, name: str, **params: Any) -> bool:
        self.commands.append((name, params))
        if name == "start_charging":
            self.charge(charging_state="Charging")
        elif name == "stop_charging":
            self.charge(charging_state="Stopped")
        elif name == "set_charging_amps":
            self.charge(charge_current_request=params["amps"])
        cs = self.state["charge_state"]
        on = cs["charging_state"] == "Charging"
        self.charge(charger_actual_current=cs["charge_current_request"] if on else 0, charger_voltage=230 if on else 2)
        return True


# Each group of details as the car gives it over Bluetooth (MessageToDict's shapes).
BLE_EXTRAS: dict[str, dict[str, Any]] = {
    "schedule": {"charge_schedule_state": {"charge_schedules": [
        {"name": "Nights", "days_of_week": 0b0111110, "start_enabled": True, "start_time": 1320, "enabled": True}
    ]}},
    "climate": {"climate_state": {"inside_temp_celsius": 41.0, "outside_temp_celsius": 30.5, "is_climate_on": False,
                                  "climate_keeper_mode": {"Off": {}},
                                  "cabin_overheat_protection": "CabinOverheatProtectionOn"}},
    "security": {"closures_state": {"sentry_mode_state": {"Armed": {}}, "window_open_driver_rear": True}},
    "tyres": {"tire_pressure_state": {"tpms_pressure_fl": 2.9, "tpms_pressure_rr": 2.4, "tpms_soft_warning_rr": True}},
    "driving": {"drive_state": {"odometer_in_hundredths_of_a_mile": 1_000_000, "shift_state": {"P": {}}}},
    "software": {"software_update_state": {"status": {"Downloading": {}}, "version": "2026.38.1", "download_perc": 40},
                 "legacy_vehicle_state": {"car_version": "2026.32.6 abc"}},
    "media": {"media_state": {"media_playback_status": "Stopped"}},
}  # fmt: skip


class FakeRadio:
    """The same car, over Bluetooth: heard while it's at home (where its location says it is)."""

    def __init__(self, car: FakeTessie) -> None:
        self.car = car
        self.keys: set[str] = set()
        self.taps = 0
        self.fail: TeslaError | None = None
        self.asleep = False  # it stays so until it's woken, or a command wakes it
        self.asked: list[tuple[bool, bool]] = []
        self.extras_asked: list[tuple[str, ...]] = []
        self.refuse: set[str] = set()  # groups the key may not read

    def _home(self) -> bool:
        ds = self.car.state.get("drive_state") or {}
        return control.distance_m((ds["latitude"], ds["longitude"]), HOME) < 500

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
        self.asked.append((charge, wake))
        self.extras_asked.append(extras)
        if not self._home():
            return {"heard": False}
        if key not in self.keys:
            raise TeslaError("The car doesn't know this server's key.", refused=True)
        cs = json.loads(json.dumps(self.car.state["charge_state"]))
        port = cs["charging_state"] != "Disconnected"
        status = {"locked": True, "open": ["Charge port"] if port else [], "user_present": False, "gear": "P"}
        woke = self.asleep and ((wake and port) or wake_for_extras)
        if woke:
            self.asleep = False
        if self.asleep:
            return {"heard": True, "asleep": True, "port_open": port, "status": status, "charge_state": None}
        got = {g: BLE_EXTRAS[g] for g in extras if g not in self.refuse}
        refused = {g: "Not for this key" for g in extras if g in self.refuse}
        return {"heard": True, "asleep": False, "port_open": port, "status": status, "charge_state": cs,
                "extras": got, "refused": refused, "woke": woke}  # fmt: skip

    def command(self, vin: str, key: str, name: str, params: dict[str, Any]) -> bool:
        self.asleep = False
        return self.car.command(vin, name, **params)

    def probe(self, vin: str, key: str) -> bool:
        if self.fail:
            raise self.fail
        return key in self.keys

    def pair(self, vin: str, key: str, seconds: float) -> str | None:
        self.taps += 1
        self.keys.add(key)
        return "Zappy"


class Clock:
    def __init__(self) -> None:
        self.t = 1_800_000_000.0

    def __call__(self) -> float:
        return self.t


class FakeLive:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.latest: dict[str, Any] | None = None
        self.ev: Any = None

    def reading(self, grid: float, battery: float = 0, soc: float = 100) -> None:
        self.latest = {"ts": int(self.clock()), "grid_power": grid, "battery_power": battery, "battery_soc": soc}

    def battery_kwh(self) -> float:
        return 10.0

    def reserve(self) -> float:
        return 10.0

    def publish(self) -> None:
        pass


@pytest.fixture
def tessie() -> FakeTessie:
    return FakeTessie()


@pytest.fixture
def radio(tessie: FakeTessie) -> FakeRadio:
    return FakeRadio(tessie)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def live(clock: Clock) -> FakeLive:
    return FakeLive(clock)


@pytest.fixture(params=["tessie", "bluetooth"])
def provider(request: pytest.FixtureRequest) -> str:
    return str(request.param)


@pytest.fixture
def svc(
    db: Database, config: Config, tessie: FakeTessie, radio: FakeRadio, live: FakeLive, clock: Clock
) -> TeslaService:
    tessie.clock = clock
    settings = SettingsStore(db, config)
    settings.load()
    settings.save({"latitude": HOME[0], "longitude": HOME[1]})
    return TeslaService(
        config, db, live, CarService(db), settings,  # type: ignore[arg-type]
        tessie=lambda _: tessie, radio=radio, clock=clock, spawn=lambda fn: fn(),  # type: ignore[arg-type]
    )  # fmt: skip


def connect(svc: TeslaService, provider: str) -> dict[str, Any]:
    """Connect the car through Tessie, or pair it over Bluetooth (the pairing runs at once here)."""
    if provider == "tessie":
        return svc.connect(TOKEN)
    svc.pair(VIN.lower())
    status = svc.status()
    assert status["bluetooth"]["pairing"]["step"] == "done", status["bluetooth"]["pairing"]
    return status


def svc_car(svc: TeslaService) -> dict[str, Any]:
    """What the (fake) car is really doing."""
    fake: FakeTessie = svc._tessie("")  # type: ignore[assignment]
    cs: dict[str, Any] = fake.state["charge_state"]
    return cs


def minutes(
    svc: TeslaService, live: FakeLive, clock: Clock, n: int, grid: float | None = None, spare: float | None = None
) -> None:
    """Run the loop for `n` minutes with a new inverter reading each minute: the grid's power as given, or from
    what's `spare` less what the car draws."""
    for _ in range(n):
        clock.t += 60
        if spare is not None:
            cs = svc_car(svc)
            draw = cs.get("charge_current_request", 0) * 230 * 3 if cs.get("charging_state") == "Charging" else 0
            grid = draw - spare
        assert grid is not None
        live.reading(grid)
        svc.tick()


def test_connecting_ties_the_tesla_to_a_new_car(svc: TeslaService, provider: str) -> None:
    status = connect(svc, provider)
    assert status["connected"] and status["provider"] == provider
    [v] = status["vehicles"]
    details = svc.cars.view(v["car"])
    # Tessie says it's a dual-motor Model Y; over Bluetooth only the VIN says what it is.
    model = "tesla-model-y-lr" if provider == "tessie" else "tesla-model-y-rwd"
    assert details["name"] == "Zappy" and details["model"]["id"] == model
    assert v["control"]["mode"] == "off"
    # Connecting again keeps the same car.
    assert connect(svc, provider)["vehicles"][0]["car"] == v["car"]


def test_the_token_and_key_only_show_masked(svc: TeslaService, provider: str) -> None:
    status = connect(svc, provider)
    if provider == "tessie":
        assert status["token"] == "tess…cdef"
    else:
        assert status["token"] is None and len(status["bluetooth"]["key"]) == 8
        assert "PRIVATE" not in json.dumps(status)


def test_a_bad_token_isnt_kept(svc: TeslaService, tessie: FakeTessie) -> None:
    tessie.fail = TeslaError("Tessie didn't accept the access token.", 401)
    with pytest.raises(TeslaSetupError) as e:
        svc.connect(TOKEN)
    assert e.value.status == 400 and not svc.connected
    with pytest.raises(TeslaSetupError):
        svc.connect("x")


def test_pairing_takes_a_tap_once(svc: TeslaService, radio: FakeRadio) -> None:
    with pytest.raises(TeslaSetupError):
        svc.pair("not a vin")
    connect(svc, "bluetooth")
    assert radio.taps == 1
    svc.disconnect()
    connect(svc, "bluetooth")  # the car still has the key: no tap
    assert radio.taps == 1


def test_a_failed_pairing_says_why(svc: TeslaService, radio: FakeRadio) -> None:
    radio.fail = TeslaError("The car wasn't heard over Bluetooth.")
    status = svc.pair(VIN)
    assert status["bluetooth"]["pairing"]["step"] == "failed"
    assert "wasn't heard" in svc.status()["bluetooth"]["pairing"]["error"] and not svc.connected


def test_switching_keeps_each_cars_settings(svc: TeslaService, radio: FakeRadio, live: FakeLive,
                                            clock: Clock) -> None:  # fmt: skip
    car_id = connect(svc, "tessie")["vehicles"][0]["car"]
    svc.configure(VIN, {"mode": "solar", "grid_w": 800})
    status = connect(svc, "bluetooth")
    [v] = status["vehicles"]
    assert status["provider"] == "bluetooth" and status["token"] is None
    assert (v["car"], v["control"]["mode"], v["control"]["grid_w"]) == (car_id, "solar", 800)
    minutes(svc, live, clock, 1, grid=0)
    assert svc.status()["vehicles"][0]["state"]["in_range"] is True
    # And back again.
    assert connect(svc, "tessie")["vehicles"][0]["control"]["mode"] == "solar"


def test_off_never_commands_but_records_the_level(svc: TeslaService, provider: str, tessie: FakeTessie,
                                                  live: FakeLive, clock: Clock) -> None:  # fmt: skip
    car_id = connect(svc, provider)["vehicles"][0]["car"]
    minutes(svc, live, clock, 10, grid=-8000)
    assert tessie.commands == []
    level = svc.cars.level(car_id, int(clock()))
    assert level is not None and level["given"] == 50


def test_solar_mode_starts_follows_and_stops(svc: TeslaService, provider: str, tessie: FakeTessie, live: FakeLive,
                                             clock: Clock) -> None:  # fmt: skip
    connect(svc, provider)
    svc.cars.update(svc.status()["vehicles"][0]["car"], {"car_phases": 3, "car_min_amps": 5, "car_amps": 16})
    svc.configure(VIN, {"mode": "solar"})
    minutes(svc, live, clock, 5, spare=5000)
    assert tessie.commands[:2] == [("set_charging_amps", {"amps": 7}), ("start_charging", {})]  # 5 kW / 690 W
    # More sun: taken up to 11 A (8 kW), an amp change a minute at most, settling there.
    minutes(svc, live, clock, 6, spare=8000)
    assert tessie.commands[-1] == ("set_charging_amps", {"amps": 11})
    assert tessie.state["charge_state"]["charge_current_request"] == 11
    # Clouds: the house draws from the grid for long enough, and it stops.
    minutes(svc, live, clock, 8, spare=-2000)
    assert tessie.commands[-1] == ("stop_charging", {})
    kinds = [e["kind"] for e in svc.log()]
    assert kinds[:2] == ["charge", "solar"]  # the charge, summed up once it's stopped; the stop
    assert svc.log()[0]["text"].startswith("Charged 50% → 50%: ")


def test_starting_in_the_tesla_app_puts_it_on_hold_until_unplugged(svc: TeslaService, provider: str,
                                                                   tessie: FakeTessie, live: FakeLive,
                                                                   clock: Clock) -> None:  # fmt: skip
    connect(svc, provider)
    svc.configure(VIN, {"mode": "solar"})
    tessie.charge(charging_state="Charging", charger_actual_current=16)
    minutes(svc, live, clock, 1, grid=8000)  # started by itself on plugging in, with no sun: stopped
    assert tessie.commands[-1] == ("stop_charging", {})
    tessie.charge(charging_state="Charging")  # started again in the app
    n = len(tessie.commands)
    minutes(svc, live, clock, 15, grid=8000)
    assert len(tessie.commands) == n  # left alone
    v = svc.status()["vehicles"][0]
    assert v["hold"] and "started outside" in v["hold"] and v["status"] == "charging"
    tessie.charge(charging_state="Disconnected")
    minutes(svc, live, clock, 1, grid=0)
    assert svc.status()["vehicles"][0]["hold"] is None


def test_charging_away_from_home_is_left_alone(svc: TeslaService, provider: str, tessie: FakeTessie,
                                               live: FakeLive, clock: Clock) -> None:  # fmt: skip
    connect(svc, provider)
    svc.configure(VIN, {"mode": "solar"})
    tessie.state["drive_state"] = {"latitude": -33.86, "longitude": 151.21}
    tessie.charge(charging_state="Charging")
    minutes(svc, live, clock, 10, grid=8000)
    assert tessie.commands == []
    v = svc.status()["vehicles"][0]
    # Through Tessie it's seen charging elsewhere; over Bluetooth it simply isn't heard.
    assert v["status"] == ("charging" if provider == "tessie" else "away")


def test_what_the_car_measures_sets_the_amps(svc: TeslaService, provider: str, tessie: FakeTessie, live: FakeLive,
                                             clock: Clock) -> None:  # fmt: skip
    connect(svc, provider)  # a Model Y from the catalog: three phases at 230 V in its details
    svc.configure(VIN, {"mode": "solar"})
    tessie.charge(charging_state="Charging", charger_actual_current=8, charge_current_request=8, charger_voltage=240,
                  charger_power=2)  # fmt: skip
    clock.t += 60
    svc.tick()
    v = svc.status()["vehicles"][0]
    assert (v["phases"], v["volts"], v["min_w"]) == (1, 240, 1200)
    assert "Charging on 1 phase at 240 V" in svc.log()[0]["text"]


def test_a_command_from_the_page_holds_and_resume_lets_go(svc: TeslaService, provider: str,
                                                          tessie: FakeTessie) -> None:  # fmt: skip
    connect(svc, provider)
    svc.configure(VIN, {"mode": "solar"})
    v = svc.command(VIN, {"action": "start"})["vehicles"][0]
    assert tessie.commands == [("start_charging", {})] and v["hold"] == "Charging now, started here"
    assert v["make"] == "Tesla"
    assert svc.command(VIN, {"action": "resume"})["vehicles"][0]["hold"] is None
    svc.read()
    svc.command(VIN, {"action": "limit", "percent": 90})
    assert tessie.commands[-1] == ("set_charge_limit", {"percent": 90})
    # What the car took shows at once, before it's next read: the page steps on from it.
    v = svc.command(VIN, {"action": "amps", "amps": 6})["vehicles"][0]
    assert (v["state"]["amps"], v["state"]["limit"]) == (6, 90)
    assert svc.command(VIN, {"action": "amps", "amps": 7})["vehicles"][0]["state"]["amps"] == 7
    for bad in ({"action": "amps", "amps": 40}, {"action": "limit", "percent": 20}, {"action": "honk"}):
        with pytest.raises(TeslaSetupError):
            svc.command(VIN, bad)


def test_a_car_can_be_left_out(svc: TeslaService, provider: str) -> None:
    connect(svc, provider)
    assert svc.remove(VIN)["vehicles"] == []
    with pytest.raises(TeslaSetupError):
        svc.remove(VIN)


def test_the_api_never_shows_the_token(config: Config, tessie: FakeTessie, radio: FakeRadio) -> None:
    app = create_app(config, poll=False, serve_dashboard=False)
    tesla = app.state.services.tesla
    tesla._tessie, tesla._radio, tesla._spawn = (lambda _: tessie), radio, (lambda fn: fn())
    with TestClient(app) as client:
        assert client.get("/api/tesla").json()["connected"] is False
        r = client.put("/api/tesla/tessie", json={"token": TOKEN})
        assert r.status_code == 200 and TOKEN not in r.text
        r = client.put(f"/api/tesla/vehicles/{VIN}", json={"mode": "solar"})
        assert r.json()["vehicles"][0]["control"]["mode"] == "solar"
        assert client.put(f"/api/tesla/vehicles/{VIN}", json={"mode": "plan"}).status_code == 422
        assert client.put(f"/api/tesla/vehicles/{VIN}", json={"mode": "x"}).status_code == 422
        assert client.get("/api/live").json()["system"]["ev_connected"] is True
        r = client.post("/api/tesla/bluetooth", json={"vin": VIN})
        assert r.status_code == 200 and "PRIVATE KEY" not in r.text
        status = client.get("/api/tesla").json()
        assert status["provider"] == "bluetooth" and status["vehicles"][0]["control"]["mode"] == "solar"
        assert client.post("/api/tesla/bluetooth", json={"vin": "nope"}).status_code == 422
        assert client.delete("/api/tesla").json()["connected"] is False


# -- following a car only as closely as it could charge ------------------------------------------------------------


def steps(start: float, hours: list[tuple[float, float]]) -> list[dict[str, Any]]:
    """Hourly forecast steps from `start`: (solar kW, home use kW) each."""
    return [
        {"start": int(start) + 3600 * i, "dur": 3600, "pv_kw": pv, "load_kw": load}
        for i, (pv, load) in enumerate(hours)
    ]


def test_with_the_home_battery_first_the_car_waits_for_it_to_fill() -> None:
    morning = steps(0, [(0, 0.5), (3, 0.5), (8, 0.5), (8, 0.5)])
    car_first = control.spare_ahead(morning, first="car", soc=0.5, cap=10, reserve=0.1, max_kw=5)
    assert control.next_chance(car_first, 0, 3450) == 7200  # 7.5 kW over in the third hour
    first = control.spare_ahead(morning, first="battery", soc=0.2, cap=10, reserve=0.1, max_kw=5)
    # The battery (at 40% by then) takes 5 kW of the third hour and the last 1 kWh of the fourth: the car's chance
    # is the fourth.
    assert [round(w) for _, _, w in first] == [0, 0, 2500, 6500]
    assert control.next_chance(first, 0, 3450) == 10800
    assert control.next_chance(first, 0, 9000) is None


def test_shared_the_home_battery_keeps_just_what_it_needs_to_be_full_by_the_end_of_the_day() -> None:
    # Night, then 2.5, 7.5 and 7.5 kW over the home's use, then night again and the next day's sun.
    day = steps(0, [(0, 0.5), (3, 0.5), (8, 0.5), (8, 0.5), (0, 0.5), (5, 0.5)])
    # At 80% of 10 kWh it needs 2.2 kWh (with the margin), of the 12.5 kWh it could take before the sun's gone
    # (at most 5 kW an hour): 17.6% of the sun it could take is kept for it, the rest is the car's.
    share, need = control.battery_share(day, 0, soc=0.8, cap=10, max_kw=5)
    assert (round(share, 3), round(need, 1)) == (0.176, 2.2)
    ahead = control.spare_ahead(day, first="shared", soc=0.8, cap=10, reserve=0.1, max_kw=5, share=share)
    assert [round(w) for _, _, w in ahead][1:4] == [2060, 6620, 6620]
    # Not enough sun to fill it: it's all the battery's, as with the battery first. Full, or no battery: none.
    assert control.battery_share(day, 0, soc=0.0, cap=20, max_kw=5)[0] == 1
    assert control.battery_share([], 0, soc=0.5, cap=10, max_kw=5)[0] == 1
    assert control.battery_share(day, 0, soc=0.99, cap=10, max_kw=5)[0] == 0
    assert control.battery_share(day, 0, soc=0.5, cap=0, max_kw=5)[0] == 0
    # Now: 5 kW over (2 kW exported, 3 kW into the battery), a fifth of what the battery could take kept for it.
    r = {"grid_power": -2000, "battery_power": -3000}
    assert control.spare_w(r, 0, first="shared", home_soc=50, battery_max_w=5000, share=0.2) == 4000
    assert control.spare_w(r, 0, first="shared", home_soc=50, battery_max_w=5000, share=1) == 0


def test_readiness() -> None:
    plugged = car(charging_state="Stopped")
    now = 1_800_000_000
    assert control.readiness(car(charging_state="Charging"), "off", False, None, None, None, now) == "active"
    assert control.readiness(plugged, "off", False, now, 5000, 3450, now) == "quiet"
    assert control.readiness(plugged, "solar", True, now, 5000, 3450, now) == "quiet"  # on hold
    assert control.readiness(car(charging_state="Disconnected"), "solar", False, now, 5000, 3450, now) == "quiet"
    assert control.readiness(plugged, "solar", False, None, 5000, 3450, now) == "ready"  # spare solar now
    assert control.readiness(plugged, "solar", False, now + control.LEAD, None, 3450, now) == "ready"
    assert control.readiness(plugged, "solar", False, now + control.LEAD + 60, None, 3450, now) == "quiet"


class FakeForecast:
    def __init__(self, clock: Clock, hours: list[tuple[float, float]]) -> None:
        self.start = clock()
        self.hours = hours

    def steps(self, now: int, days: int = 2) -> list[dict[str, Any]]:
        return [s for s in steps(self.start, self.hours) if s["start"] + s["dur"] > now]


@pytest.fixture
def ble(svc: TeslaService, radio: FakeRadio, tessie: FakeTessie, live: FakeLive, clock: Clock) -> TeslaService:
    """Paired over Bluetooth, plugged in and not charging, in solar mode, at night."""
    connect(svc, "bluetooth")
    svc.cars.update(svc.status()["vehicles"][0]["car"], {"car_phases": 3, "car_min_amps": 5, "car_amps": 16})
    svc.configure(VIN, {"mode": "solar", "first": "car"})
    live.reading(grid=500)
    clock.t += 1
    svc.tick()
    radio.asleep = True
    return svc


def test_with_no_chance_of_charging_the_car_is_left_to_sleep(ble: TeslaService, radio: FakeRadio, live: FakeLive,
                                                              clock: Clock) -> None:  # fmt: skip
    radio.asked.clear()
    minutes(ble, live, clock, 30, grid=500)
    assert len(radio.asked) == 6  # every five minutes
    assert all(not wake for _, wake in radio.asked)
    assert ble.history.wakes(VIN, 0, 2**40) == []  # not woken all night
    v = ble.status()["vehicles"][0]
    assert (v["follow"], v["solar_from"], v["wake_at"]) == ("quiet", None, None)
    assert v["state"]["asleep"] and v["state"]["plugged"]  # its last reading stands


def test_the_car_is_woken_ahead_of_spare_solar(ble: TeslaService, radio: FakeRadio, tessie: FakeTessie,
                                               live: FakeLive, clock: Clock) -> None:  # fmt: skip
    ble.forecast = FakeForecast(clock, [(0, 0.5)] * 3 + [(6, 0.5)] * 3)  # spare from three hours on
    ble._ahead = None
    sun = int(clock.t) + 3 * 3600  # the fourth hour
    v = ble.status()["vehicles"][0]
    assert v["follow"] == "quiet" and v["solar_from"] == sun and v["wake_at"] == sun - control.LEAD
    radio.asked.clear()
    minutes(ble, live, clock, 155, grid=500)  # to five minutes after it's due to be woken (2½ hours on)
    woken = [i for i, (_, wake) in enumerate(radio.asked) if wake]
    assert woken and not radio.asleep
    assert len(radio.asked[: woken[0]]) <= 30  # left alone until then, read every five minutes
    assert ble.status()["vehicles"][0]["follow"] == "ready"
    [wake] = ble.history.wakes(VIN, 0, 2**40)
    assert wake["reason"] == "ready" and "Woke the car ready for spare solar" in [e["text"] for e in ble.log()]
    n = len(radio.asked)
    minutes(ble, live, clock, 5, grid=500)
    assert len(radio.asked) - n == 5  # each minute, kept awake
    # The sun comes up: it starts once it has lasted, already awake.
    minutes(ble, live, clock, 6, spare=5000)
    assert ("start_charging", {}) in tessie.commands
    minutes(ble, live, clock, 1, spare=5000)  # read again after the command
    assert ble.status()["vehicles"][0]["follow"] == "active"


# -- details beyond the charge --------------------------------------------------------------------------------------


def test_details_from_tessie() -> None:
    last = last_state(scheduled_charging_mode="StartAt", scheduled_charging_start_time_minutes=1320,
                      charger_pilot_current=16, conn_charge_cable="IEC")  # fmt: skip
    last |= {
        "climate_state": {"inside_temp": 22.5, "outside_temp": 18.0, "climate_keeper_mode": "dog",
                          "cabin_overheat_protection": "FanOnly"},
        "vehicle_state": {"timestamp": 1_800_000_000_000, "locked": False, "df": 1, "rp_window": 1,
                          "sentry_mode": True, "odometer": 1000, "car_version": "2026.32.6 abc",
                          "tpms_pressure_fl": 2.9, "tpms_hard_warning_rr": True,
                          "software_update": {"status": "available", "version": "2026.38.1 def"},
                          "media_info": {"media_playback_status": "Playing", "now_playing_title": "Song"}},
    }  # fmt: skip
    d = details.from_fleet(last)
    assert d["status"]["data"] == {"locked": False, "open": ["Driver door"], "user_present": None, "gear": "P"}
    assert d["charging"]["data"]["pilot_amps"] == 16 and d["charging"]["data"]["cable"] == "IEC"
    assert d["schedule"]["data"]["mode"] == "start_at" and d["schedule"]["data"]["start_minutes"] == 1320
    assert "Scheduled charging is on" in (details.overrides_solar(d["schedule"]["data"]) or "")
    assert d["security"]["data"] == {"sentry": "Armed", "sentry_available": None, "valet": None,
                                     "windows_open": ["Rear right"]}  # fmt: skip
    assert d["driving"]["data"]["odometer_km"] == 1609.3
    assert d["software"]["data"] == {"version": "2026.32.6", "update": {"status": "available", "version": "2026.38.1",
                                     "download_pct": None, "install_pct": None, "scheduled_at": None, "minutes": None}}  # fmt: skip
    assert d["tyres"]["data"]["warnings"] == ["rr"] and d["media"]["data"]["title"] == "Song"
    assert details.parked_draw(d) == ["Sentry mode (about 250 W)", "Dog mode"]


def test_details_over_bluetooth() -> None:
    charge = last_state(scheduled_charging_mode="ScheduledChargingModeOff")["charge_state"]
    extras = {g: (100, raw) for g, raw in BLE_EXTRAS.items() if g != "media"}
    d = details.from_ble({"locked": True, "open": [], "user_present": False, "gear": "P"}, 90, charge, 80, extras,
                         {"media": (100, "Not for this key")})  # fmt: skip
    assert d["status"]["as_of"] == 90 and d["charging"]["as_of"] == 80
    assert d["schedule"]["data"]["mode"] == "off"
    assert d["schedule"]["data"]["charge_schedules"] == [
        {"name": "Nights", "days": ["Mon", "Tue", "Wed", "Thu", "Fri"], "start": 1320, "end": None,
         "one_time": False, "enabled": True}
    ]  # fmt: skip
    assert "charge schedule" in (details.overrides_solar(d["schedule"]["data"]) or "")
    assert d["climate"]["data"]["cabin_overheat"] == "on" and d["security"]["data"]["sentry"] == "Armed"
    assert d["driving"]["data"]["odometer_km"] == 16093.4 and d["driving"]["data"]["gear"] == "P"
    assert d["software"]["data"]["update"]["status"] == "downloading"
    assert d["media"] == {"as_of": 100, "refused": "Not for this key"}
    # 41 °C inside: cabin overheat protection is running, and sentry's on.
    assert details.parked_draw(d) == ["Sentry mode (about 250 W)", "Cabin overheat protection"]


def test_details_are_read_only_while_the_car_is_awake(ble: TeslaService, radio: FakeRadio, live: FakeLive,
                                                       clock: Clock) -> None:  # fmt: skip
    radio.extras_asked.clear()
    minutes(ble, live, clock, 30, grid=500)  # asleep all along
    assert all(not e for e in radio.extras_asked)  # quiet and asleep: nothing more is asked of it
    d = ble.details(VIN)
    assert d["refresh_wakes"] and d["groups"]["status"]["data"]["locked"] is True  # its free status, still read
    assert "climate" in d["groups"]  # what was read when it was paired, while it was awake, stands


def test_a_refresh_asks_before_waking(ble: TeslaService, radio: FakeRadio) -> None:
    with pytest.raises(TeslaSetupError) as e:
        ble.refresh_details(VIN, False)
    assert e.value.status == 409 and radio.asleep
    d = ble.refresh_details(VIN, True)
    assert not radio.asleep and not d["refresh_wakes"]
    assert set(d["groups"]) == set(details.GROUPS)
    assert ble.log()[0]["text"] == "Woke the car to read its details"
    assert [w["reason"] for w in ble.history.wakes(VIN, 0, 2**40)] == ["refresh"]


def test_groups_the_key_may_not_read_are_said_so(svc: TeslaService, radio: FakeRadio) -> None:
    radio.refuse = {"media"}
    connect(svc, "bluetooth")
    d = svc.refresh_details(VIN, True)
    assert "refused" in d["groups"]["media"] and "data" in d["groups"]["tyres"]


def test_details_through_tessie(svc: TeslaService, tessie: FakeTessie) -> None:
    tessie.state["vehicle_state"] = {"locked": True, "sentry_mode": False, "odometer": 10}
    connect(svc, "tessie")
    assert svc.details(VIN)["groups"]["driving"]["data"]["odometer_km"] == 16.1
    tessie.state["state"] = "asleep"
    with pytest.raises(TeslaSetupError):
        svc.refresh_details(VIN, False)
    svc.refresh_details(VIN, True)
    assert tessie.refreshed == [False, True]


# -- in and out ------------------------------------------------------------------------------------------------------


def leave(tessie: FakeTessie) -> None:
    tessie.charge(charging_state="Disconnected")
    tessie.state["drive_state"] = {"latitude": -33.86, "longitude": 151.21}  # Sydney: away (and out of range)


def come_home(tessie: FakeTessie, soc: float, odometer_mi: float) -> None:
    tessie.charge(battery_level=soc)
    tessie.state["drive_state"] = {"latitude": HOME[0], "longitude": HOME[1]}
    tessie.state["vehicle_state"] = {"odometer": odometer_mi}


def test_time_away_is_logged_with_what_it_used(svc: TeslaService, provider: str, tessie: FakeTessie,
                                               radio: FakeRadio, live: FakeLive, clock: Clock) -> None:  # fmt: skip
    tessie.charge(battery_level=70)
    tessie.state["vehicle_state"] = {"odometer": 1000}
    BLE_EXTRAS["driving"] = {"drive_state": {"odometer_in_hundredths_of_a_mile": 100_000}}
    connect(svc, provider)
    svc.cars.update(svc.status()["vehicles"][0]["car"], {"car_battery_kwh": 75})
    minutes(svc, live, clock, 5, grid=500)
    leave(tessie)
    minutes(svc, live, clock, 30, grid=500)
    assert svc.history.open(VIN, "away") is not None
    assert "Left home at 70%" in [e["text"] for e in svc.log()]
    come_home(tessie, 50, 1075)  # 75 miles: 120.7 km
    BLE_EXTRAS["driving"] = {"drive_state": {"odometer_in_hundredths_of_a_mile": 107_500}}
    if provider == "bluetooth":
        svc.refresh_details(VIN, False)  # (its details are otherwise read every 15 minutes)
    minutes(svc, live, clock, 6, grid=500)
    h = svc.car_history(VIN)
    [trip] = [s for s in h["sessions"] if s["kind"] == "away"]
    assert (trip["soc_start"], trip["soc_end"], trip["soc_change"], trip["used_kwh"]) == (70, 50, -20, 15.0)
    assert trip["km"] == 120.7 and trip["kwh_per_100km"] == 12.4
    assert svc.log()[0]["text"] == "Back home at 50%: used 20% (about 15 kWh), 121 km"
    day = svc.car_levels(VIN, int(clock()) - 86400, int(clock()) + 1)
    socs = [p["soc"] for p in day["points"]]
    assert socs[0] == 70 and socs[-1] == 50  # left at 70, back at 50: the page draws the line between
    [away] = day["away"]
    assert away["end"] > away["start"] and day["charging"] == []
    with pytest.raises(TeslaSetupError):
        svc.car_levels(VIN, 0, 10 * 86400)
    BLE_EXTRAS["driving"] = {"drive_state": {"odometer_in_hundredths_of_a_mile": 1_000_000, "shift_state": {"P": {}}}}


def test_a_moment_out_of_range_is_not_a_trip(svc: TeslaService, tessie: FakeTessie, live: FakeLive,
                                             clock: Clock) -> None:  # fmt: skip
    connect(svc, "bluetooth")
    minutes(svc, live, clock, 2, grid=500)
    tessie.state["drive_state"] = {"latitude": -33.86, "longitude": 151.21}  # not heard…
    minutes(svc, live, clock, 5, grid=500)
    tessie.state["drive_state"] = {"latitude": HOME[0], "longitude": HOME[1]}  # …and back within ten minutes
    minutes(svc, live, clock, 30, grid=500)
    assert svc.car_history(VIN)["sessions"] == []


def test_charging_at_home_is_counted_with_its_grid_share(svc: TeslaService, provider: str, tessie: FakeTessie,
                                                          live: FakeLive, clock: Clock) -> None:  # fmt: skip
    connect(svc, provider)
    tessie.charge(charging_state="Charging", charger_actual_current=10, charge_current_request=10,
                  charger_voltage=230, charger_phases=3, charger_power=7, battery_level=40)  # fmt: skip
    start = int(clock())
    minutes(svc, live, clock, 60, grid=1725)  # 6.9 kW into the car, a quarter of it from the grid
    tessie.charge(charging_state="Stopped", battery_level=48)
    minutes(svc, live, clock, 2, grid=0)
    [charge] = svc.car_history(VIN)["sessions"]
    assert charge["kind"] == "charge" and (charge["soc_start"], charge["soc_end"]) == (40, 48)
    assert charge["kwh"] == pytest.approx(6.9, abs=0.3) and charge["solar_share"] == pytest.approx(0.75, abs=0.01)
    assert svc.log()[0]["text"].startswith("Charged 40% → 48%: ")
    # The Home page's car line: what it drew, 5 minutes at a time.
    w = svc.history.charged_w(start, int(clock()))
    assert len(w) >= 11 and all(v == pytest.approx(6900, rel=0.25) for v in list(w.values())[1:-1])


def test_a_command_to_a_sleeping_car_counts_as_a_wake(ble: TeslaService, radio: FakeRadio, live: FakeLive,
                                                      clock: Clock) -> None:  # fmt: skip
    minutes(ble, live, clock, 6, grid=500)  # read again: asleep
    v = ble.command(VIN, {"action": "limit", "percent": 90})["vehicles"][0]
    assert [w["reason"] for w in ble.history.wakes(VIN, 0, 2**40)] == ["command"]
    # It's awake now: another command before it's next read doesn't count as waking it again.
    assert v["state"]["asleep"] is False and ble.details(VIN)["refresh_wakes"] is False
    ble.command(VIN, {"action": "amps", "amps": 6})
    assert len(ble.history.wakes(VIN, 0, 2**40)) == 1


def test_a_change_from_the_page_doesnt_wait_on_a_read(ble: TeslaService, radio: FakeRadio, live: FakeLive,
                                                      clock: Clock) -> None:  # fmt: skip
    # Over Bluetooth a read takes seconds (finding the car, talking to it): the page's changes go ahead meanwhile.
    reading, done = threading.Event(), threading.Event()
    read = radio.read

    def slow(*args: Any, **kwargs: Any) -> dict[str, Any]:
        reading.set()
        done.wait(5)
        return read(*args, **kwargs)

    radio.read = slow  # type: ignore[method-assign]
    clock.t += POLL_IDLE
    loop = threading.Thread(target=ble.tick)
    loop.start()
    assert reading.wait(5)
    t = time.monotonic()
    assert ble.configure(VIN, {"first": "shared"})["vehicles"][0]["control"]["first"] == "shared"
    assert time.monotonic() - t < 1
    done.set()
    loop.join(5)
    assert not loop.is_alive() and ble.status()["vehicles"][0]["control"]["first"] == "shared"


def test_shared_says_what_the_home_battery_keeps(svc: TeslaService, tessie: FakeTessie, live: FakeLive) -> None:
    connect(svc, "tessie")
    assert svc.status()["vehicles"][0]["share"] is None  # the home battery first: nothing to share
    live.reading(grid=0, soc=60)
    v = svc.configure(VIN, {"mode": "solar", "first": "shared"})["vehicles"][0]
    # Without a forecast there's no knowing it'd be full in time: the sun's all the battery's until it is.
    assert v["control"]["first"] == "shared" and v["share"] == {"battery": 1.0, "need_kwh": 4.4}
