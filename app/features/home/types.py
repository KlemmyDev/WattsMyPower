"""
What every home integration speaks: the kinds of device, a device's reading as the dashboard needs it, and the
contract an integration (a smart-appliance cloud, smart plugs on the network…) fulfils.

An integration only translates. It signs in (or finds its devices on the network), and on each poll says what every
device is doing now, in the terms below. Prefer reading devices directly on the home network; a vendor's cloud only
when there's no other way. Turning those readings into energy, runs of an appliance and the home's breakdown is done once,
for all of them (app.features.home.energy, app.features.home.service).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal


@dataclass(frozen=True)
class Kind:
    label: str
    # It runs in cycles you start (a wash, a dry), so its runs are recorded: when, how long, how much.
    cycles: bool = False
    # Drawing more than this (W) counts as running, for a device that doesn't say (a smart plug on an older washer).
    running_w: float = 10.0


KINDS: dict[str, Kind] = {
    "washer": Kind("Washing machine", cycles=True, running_w=5),
    "dryer": Kind("Dryer", cycles=True, running_w=20),
    "washer_dryer": Kind("Washer-dryer", cycles=True, running_w=5),
    "dishwasher": Kind("Dishwasher", cycles=True, running_w=5),
    "oven": Kind("Oven", cycles=True, running_w=50),
    "fridge": Kind("Fridge"),
    "freezer": Kind("Freezer"),
    "air_conditioner": Kind("Air conditioner", running_w=50),
    "hot_water": Kind("Hot water", running_w=100),
    "pool_pump": Kind("Pool pump", running_w=50),
    # A battery of its own in a room (a portable power station): charged from the house or its own panels, powering
    # what's plugged into it. What it draws from the house is its use.
    "power_station": Kind("Portable battery"),
    "plug": Kind("Smart plug"),
    "other": Kind("Other"),
}


@dataclass(frozen=True)
class Category:
    """A sort of device the integrations bring, as Manage → Integrations → Smart home groups them."""

    label: str
    about: str  # what it covers, in a line under its heading


# In the order they're shown.
CATEGORIES: dict[str, Category] = {
    "plugs": Category(
        "Smart plugs and meters",
        "Plugs, relays and meters that measure whatever's plugged into them or wired through them.",
    ),
    "appliances": Category(
        "Appliances",
        "White goods that report on themselves: washers, dryers, dishwashers, fridges, ovens and air conditioners.",
    ),
    "batteries": Category(
        "Portable batteries",
        "Power stations in a room: their charge, and what they're charging from and powering.",
    ),
    "hubs": Category("Home hubs", "Whatever your smart-home hub already measures, whatever the brand."),
}


@dataclass(frozen=True)
class Battery:
    """A device that holds charge (a portable power station): how full it is and where its power is going. Its
    Reading's power_w is what it's drawing from the house; these are the rest."""

    soc: float | None = None  # % charged
    capacity_kwh: float | None = None  # what it holds full (None: not known)
    solar_w: float | None = None  # coming in from its own panels, not the house
    output_w: float | None = None  # what it's powering, from its outlets


@dataclass(frozen=True)
class Reading:
    """One device on an account, as it is now. Everything but `key`, `name` and `kind` is optional: say what the
    device reports and leave the rest None."""

    key: str  # the device's id at its integration: stable, so it's the same device next time
    name: str  # what it's called in its own app
    kind: str  # a key of KINDS
    model: str | None = None
    online: bool = True
    power_w: float | None = None  # what it's drawing now
    # An energy counter, kWh. "total": only ever goes up (it may reset to 0 if the device is reset). "cycle": counts
    # from 0 again each time it starts over (each cycle, or each day). A counter is used over power when there's both.
    energy_kwh: float | None = None
    counter: Literal["total", "cycle"] = "total"
    running: bool | None = None  # a cycle under way (None: it doesn't say; power decides, for kinds with cycles)
    program: str | None = None  # the program or mode, in words ("Cotton 40°", "Eco")
    phase: str | None = None  # where the cycle is ("Washing", "Spinning", "Drying")
    remaining_min: float | None = None
    switched_on: bool | None = None  # for a device that can be switched (a smart plug): whether it's on
    battery: Battery | None = None  # for a device that holds charge
    # Anything else worth showing, in words: {"Door": "Closed", "Temperature": "4 °C"}.
    details: Mapping[str, str] = field(default_factory=dict)
    # About the device itself rather than what it's doing, for its own page: {"Signal": "Good", "Firmware": "1.4.8"}.
    info: Mapping[str, str] = field(default_factory=dict)
    # The device's own properties as its integration sent them, for diagnosing a mapping (never shown to others).
    raw: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Field:
    """Something the connect form asks for."""

    key: str
    label: str
    type: Literal["text", "email", "password", "url"] = "text"
    help: str = ""
    # Kept on the server and never sent back to the browser (shown masked, or not at all).
    secret: bool = False
    placeholder: str = ""
    optional: bool = False


@dataclass(frozen=True)
class Hints:
    """What the dashboard knows that may help an integration find its devices."""

    # The home network, e.g. "192.168.0.0/24": where the inverters are, else where the dashboard was opened from.
    network: str | None = None


class IntegrationError(Exception):
    """Something an integration couldn't do, in words the household can act on. `signed_out`: the saved sign-in no
    longer works (a changed password), so it needs signing in again rather than retrying. `retry_after`: seconds to
    wait before asking again (a rate limit)."""

    def __init__(self, message: str, *, signed_out: bool = False, retry_after: int | None = None):
        super().__init__(message)
        self.signed_out = signed_out
        self.retry_after = retry_after


class Integration(ABC):
    """One kind of integration. Subclass it, fill in the class attributes, and add it to app.features.home.registry.

    An instance is one connected account, built from what `sign_in` returned (and was saved). It may update
    `self.saved` as it goes (a refreshed token), and the service keeps the new version.
    """

    id: ClassVar[str]  # short and stable: it's stored with each account ("connectlife")
    name: ClassVar[str]  # the brand, as the household knows it ("Hisense")
    via: ClassVar[str]  # how it's reached, in words ("the ConnectLife app")
    about: ClassVar[str]  # a line on what it brings
    category: ClassVar[str]  # the sort of device it brings, a key of CATEGORIES: what it's listed under
    icon: ClassVar[str] = "plug"  # one of the web app's icons
    kinds: ClassVar[tuple[str, ...]]  # the kinds of device it can bring
    fields: ClassVar[tuple[Field, ...]]  # what the connect form asks for
    poll_seconds: ClassVar[int] = 60
    demo: ClassVar[bool] = False  # only offered in mock mode (MOCK=1)
    # The settings page's button to look for devices added since it was connected ("Look for new plugs"), for an
    # integration that can (see `find`). None: it can't, or doesn't need to (its account lists them every poll).
    find_label: ClassVar[str | None] = None
    # Its devices can be switched on and off (see `switch`).
    can_switch: ClassVar[bool] = False
    # Read through its maker's cloud rather than from the devices on the home network (or over Bluetooth): shown on
    # Manage → Integrations, as a cloud can be slower, go down, or change without notice.
    cloud: ClassVar[bool] = False

    def __init__(self, saved: dict[str, Any]):
        self.saved = saved

    @classmethod
    @abstractmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        """Check what was entered in the connect form (signing in, if there's an account; finding devices, if they're
        on the network) and return what to keep for polling. Raises IntegrationError, in words, if it can't be used."""

    @abstractmethod
    def poll(self) -> list[Reading]:
        """Every device on the account, now. Raises IntegrationError when it can't be read."""

    def label(self) -> str:
        """What the account is, for the settings page ("matt@example.com"). Never a secret."""
        return ""

    def find(self) -> tuple[int, int]:
        """Look for devices added since it was connected, with what's saved (no sign-in), and keep any new ones in
        `self.saved` so the next poll reads them. Returns how many are new, and how many answered in all. Only for an
        integration with a find_label."""
        raise NotImplementedError

    def switch(self, key: str, on: bool) -> None:
        """Switch the device `key` on or off. Raises IntegrationError, in words, when it can't. It may update
        `self.saved` (kept by the service). Only for an integration with can_switch."""
        raise NotImplementedError

    def past(self, start: int, end: int) -> list[tuple[int, list[Reading]]]:
        """Readings from before the account was connected, oldest first, for integrations that can look back (most
        can't: the default is none). Asked once, when the account is connected."""
        return []


def mask(secret: str) -> str:
    """Enough of a secret to recognise it, not to use it."""
    return f"{secret[:2]}…{secret[-2:]}" if len(secret) >= 12 else "••••"
