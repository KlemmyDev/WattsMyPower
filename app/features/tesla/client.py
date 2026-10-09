"""
What the Tesla service asks of a way to reach the cars (app.features.tesla.tessie, app.features.tesla.bluetooth), so
charging from spare solar works the same through either.

    vehicles(want)                  each car, as {vin, last_state, in_range}: `last_state` shaped as Tesla's vehicle
                                    data (charge_state, drive_state, vehicle_config…, as Tessie keeps it), which
                                    app.features.tesla.control.parse reads; `in_range` is True when the car was
                                    reached over this server's Bluetooth (so it's at home), False when it wasn't
                                    heard, and absent when the way it's reached says nothing about where it is.
                                    `want` is how closely each car is followed (control.readiness, by VIN): a
                                    way that reads the car itself (Bluetooth) lets a "quiet" car sleep and wakes a
                                    "ready" one; Tessie's copy of the car's state is read the same either way
                                    Each also has `details` (app.features.tesla.details): every group known of it,
                                    and `woke` (why) when reading it woke it (over Bluetooth: ready, first)
    command(vin, name, **params)    start_charging, stop_charging, set_charging_amps (amps), set_charge_limit (percent),
                                    waking the car first; whether it worked
    refresh_details(vin, wake)      one car, read in full now: woken only with `wake` (CarAsleep otherwise)

Both are blocking, and raise TeslaError, in words.
"""

from __future__ import annotations

import re
from typing import Any, Protocol

VIN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
COMMANDS = ("start_charging", "stop_charging", "set_charging_amps", "set_charge_limit")


class TeslaError(Exception):
    """A request the car (or the service in between) refused, or that didn't get through. `status` is the HTTP status
    a cloud service answered with, if it did. `refused`: the credentials were turned down (Tessie's access token, or
    this server's key, which the car doesn't know), so trying again won't help until they're set up again."""

    def __init__(self, message: str, status: int | None = None, *, refused: bool = False):
        super().__init__(message)
        self.status = status
        self.refused = refused or status in (401, 403)

    def __reduce__(self) -> tuple[Any, ...]:  # so it comes back from a process of its own as it was (bluetooth)
        return _tesla_error, (str(self), self.status, self.refused)


def _tesla_error(message: str, status: int | None, refused: bool) -> TeslaError:
    return TeslaError(message, status, refused=refused)


class CarAsleep(TeslaError):
    """The car is asleep, and reading what was asked would wake it: ask first (refresh_details with wake)."""

    def __init__(self, row: dict[str, Any] | None = None, message: str = "The car is asleep. Refreshing wakes it."):
        super().__init__(message)
        self.row = row  # what could be read without waking it, as vehicles() gives a car


class Client(Protocol):
    def vehicles(self, want: dict[str, str] | None = None) -> list[dict[str, Any]]: ...

    def command(self, vin: str, name: str, **params: Any) -> bool: ...

    def refresh_details(self, vin: str, wake: bool) -> dict[str, Any]:
        """Read everything about one car now (as vehicles() gives it, details and all), waking it only with `wake`.
        Raises CarAsleep when it's asleep and `wake` isn't given."""
        ...
