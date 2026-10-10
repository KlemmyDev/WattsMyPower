"""The collector's configuration, read once from environment variables."""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    # The inverters are connected in the dashboard (Manage → Integrations) and stored in the
    # database. These settings are only read the first time the collector starts with a database
    # from before that, to move an existing install's inverters into it (Store.seed_devices).
    # Which reader to use for each inverter (see devices/drivers.py).
    inverter_driver: str = "sungrow.sh_rs"
    pv2_driver: str = "sungrow.sg_d"

    # IP address of the hybrid inverter's WiNet-S dongle.
    inverter_host: str = ""
    inverter_port: int = 502
    inverter_unit: int = 1

    # Optional second, AC-coupled system on an older Sungrow string inverter (e.g. SG5K-D)
    # with an encrypted Wi-Fi dongle. Empty = not fitted.
    pv2_host: str = ""
    pv2_port: int = 502
    pv2_unit: int = 1
    # Where the second system connects (true: on the house side of the hybrid's meter). Stored with
    # it as a setting for the API.
    pv2_behind_meter: bool = True

    # The WiNet-S2 gets unhappy under aggressive polling and only refreshes most registers
    # every ~30-60 s anyway, so 60 s is both the default and the floor.
    poll_interval: int = 60
    # Upper bound for exponential backoff when the hybrid stops answering.
    max_backoff: int = 300

    db_path: str = "/data/collector.db"
    # Rows older than this are deleted (hourly). 0 = keep forever.
    retention_days: int = 365

    # Shared secret for /v1/*. Empty = the feed refuses every request (503) until one is set.
    token: str = ""
    port: int = 8081

    # Fake inverters instead of real ones, to run the whole pipeline locally without hardware.
    mock: bool = False

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Config:
        e = os.environ if env is None else env

        def text(name: str, default: str = "") -> str:
            return e.get(name, default).strip()

        def flag(name: str, default: bool) -> bool:
            return e.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")

        problems: list[str] = []

        def integer(name: str, default: int) -> int:
            return _parse(e, name, default, int, "a whole number", problems)

        d = cls()
        config = cls(
            inverter_driver=text("INVERTER_DRIVER", d.inverter_driver),
            pv2_driver=text("PV2_DRIVER", d.pv2_driver),
            inverter_host=text("INVERTER_HOST"),
            inverter_port=integer("INVERTER_PORT", d.inverter_port),
            inverter_unit=integer("INVERTER_UNIT", d.inverter_unit),
            pv2_host=text("PV2_HOST"),
            pv2_port=integer("PV2_PORT", d.pv2_port),
            pv2_unit=integer("PV2_UNIT", d.pv2_unit),
            pv2_behind_meter=flag("PV2_BEHIND_METER", d.pv2_behind_meter),
            poll_interval=max(60, integer("POLL_INTERVAL", d.poll_interval)),
            max_backoff=integer("MAX_BACKOFF", d.max_backoff),
            db_path=text("COLLECTOR_DB_PATH", d.db_path),
            retention_days=integer("COLLECTOR_RETENTION_DAYS", d.retention_days),
            token=text("COLLECTOR_TOKEN"),
            port=integer("COLLECTOR_PORT", d.port),
            mock=flag("COLLECTOR_MOCK", d.mock),
        )
        if problems:
            raise ConfigError(problems)
        return config


class ConfigError(ValueError):
    """Settings in the environment that can't be read, each named with what it should look like."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__(
            "Can't read the settings in the environment (.env next to docker-compose.yml):\n"
            + "\n".join(f"  - {p}" for p in problems)
        )


def _parse[T](
    env: Mapping[str, str], name: str, default: T, kind: Callable[[str], T], what: str, problems: list[str]
) -> T:
    """`name` read as `kind` (int or float), or `default` when it isn't set (or is blank). A value that doesn't read
    as one is added to `problems`, naming the variable and an example, and the default stands in for it."""
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        return kind(raw)
    except ValueError:
        problems.append(f"{name} is {raw!r}, which isn't {what}. Set it to one, e.g. {name}={default}")
        return default
