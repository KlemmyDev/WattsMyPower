"""
What every home integration speaks: the kinds of device, a device's reading as the dashboard needs it, and the
contract an integration (a smart-appliance cloud, smart plugs on the network…) fulfils.

An integration only translates. It signs in, and on each poll says what every device on the account is doing now,
in the terms below. Turning those readings into energy, runs of an appliance and the home's breakdown is done once,
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
    "plug": Kind("Smart plug"),
    "other": Kind("Other"),
}


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
    # from 0 each time a cycle starts. A counter is used over power when there's both.
    energy_kwh: float | None = None
    counter: Literal["total", "cycle"] = "total"
    running: bool | None = None  # a cycle under way (None: it doesn't say; power decides, for kinds with cycles)
    program: str | None = None  # the program or mode, in words ("Cotton 40°", "Eco")
    phase: str | None = None  # where the cycle is ("Washing", "Spinning", "Drying")
    remaining_min: float | None = None
    # Anything else worth showing, in words: {"Door": "Closed", "Temperature": "4 °C"}.
    details: Mapping[str, str] = field(default_factory=dict)
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
    icon: ClassVar[str] = "plug"  # one of the web app's icons
    kinds: ClassVar[tuple[str, ...]]  # the kinds of device it can bring
    fields: ClassVar[tuple[Field, ...]]  # what the connect form asks for
    poll_seconds: ClassVar[int] = 60
    demo: ClassVar[bool] = False  # only offered in mock mode (MOCK=1)

    def __init__(self, saved: dict[str, Any]):
        self.saved = saved

    @classmethod
    @abstractmethod
    def sign_in(cls, form: dict[str, str]) -> dict[str, Any]:
        """Check what was entered in the connect form (signing in, if there's an account) and return what to keep
        for polling. Raises IntegrationError, in words, if it can't be used."""

    @abstractmethod
    def poll(self) -> list[Reading]:
        """Every device on the account, now. Raises IntegrationError when it can't be read."""

    def label(self) -> str:
        """What the account is, for the settings page ("matt@example.com"). Never a secret."""
        return ""

    def past(self, start: int, end: int) -> list[tuple[int, list[Reading]]]:
        """Readings from before the account was connected, oldest first, for integrations that can look back (most
        can't: the default is none). Asked once, when the account is connected."""
        return []


def mask(secret: str) -> str:
    """Enough of a secret to recognise it, not to use it."""
    return f"{secret[:2]}…{secret[-2:]}" if len(secret) >= 12 else "••••"
