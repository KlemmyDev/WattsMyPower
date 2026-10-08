"""Runtime configuration, read once from environment variables (see .env.example)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    # The collector service, which reads the inverters (see collector/PROTOCOL.md), and the
    # token its feed requires. Point COLLECTOR_URL at the server's collector to run the API elsewhere.
    collector_url: str = "http://collector:8081"
    collector_token: str = ""
    # Whether this dashboard may change what the collector reads (connect, remove or scan for inverters
    # in Manage → Integrations). Set false for a dashboard following another server's collector,
    # e.g. while developing, so trying the UI can't disconnect the live system's inverters.
    collector_writes: bool = True

    # Where a second, AC-coupled system (configured on the collector) connects. True (the usual AC-coupled setup): on the house side
    # of the hybrid's meter, so the hybrid sees its output as lower (even negative) home use.
    # False: outside the hybrid's meter, so all its output is exported and home use is right.
    pv2_behind_meter: bool = True

    # The WiNet-S2 gets unhappy under aggressive polling and only refreshes most registers
    # every ~30-60 s anyway, so 60 s is both the default and the floor.
    poll_interval: int = 60
    # Upper bound for exponential backoff when the collector can't be reached.
    max_backoff: int = 300

    db_path: str = "/data/wattsmypower.db"
    # Raw (every-poll) rows older than this are deleted; 5-minute rollups are kept forever.
    # ~20 MB of raw rows at 90 days; rollups add ~18 MB/year. 0 = keep raw rows forever.
    raw_retention_days: int = 90

    # --- system: only read once, to move an older install's values into the database (see
    # SettingsStore.seed_system). They're changed in the dashboard (Manage → System) after that.
    # Solar array size (kW of panels). The inverter doesn't report this.
    pv_kw: float = 6.6
    # Battery capacity in kWh. 0 = read it from the inverter (register 5639).
    battery_kwh: float = 0.0
    # Backup reserve (%) if the inverter doesn't report one, and the battery's max charge/discharge rate.
    battery_reserve: float = 10.0
    battery_max_kw: float = 5.0

    # --- tariffs (AUD): defaults only, until rates are saved on the Settings page
    import_rate: float = 0.32  # per kWh
    feed_in_rate: float = 0.05  # per kWh
    supply_charge: float = 1.05  # per day

    # --- forecast (Open-Meteo, no API key): the location can be changed in Settings
    forecast: bool = True
    latitude: float = -27.47
    longitude: float = 153.03

    # Generate synthetic data instead of following a collector (for local dev and demos).
    mock: bool = False

    # Require signing in to the dashboard (an account is created the first time it's opened).
    # Turn off only if something in front of it already handles sign-in, e.g. a reverse proxy.
    auth: bool = True

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Config:
        e = os.environ if env is None else env

        def text(name: str, default: str = "") -> str:
            return e.get(name, default).strip()

        def flag(name: str, default: bool) -> bool:
            return e.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")

        def integer(name: str, default: int) -> int:
            return int(e.get(name, str(default)))

        def number(name: str, default: float) -> float:
            return float(e.get(name, str(default)))

        d = cls()
        return cls(
            collector_url=text("COLLECTOR_URL", d.collector_url),
            collector_token=text("COLLECTOR_TOKEN"),
            collector_writes=flag("COLLECTOR_WRITES", d.collector_writes),
            pv2_behind_meter=flag("PV2_BEHIND_METER", d.pv2_behind_meter),
            poll_interval=max(60, integer("POLL_INTERVAL", d.poll_interval)),
            max_backoff=integer("MAX_BACKOFF", d.max_backoff),
            db_path=e.get("DB_PATH", d.db_path),
            raw_retention_days=integer("RAW_RETENTION_DAYS", d.raw_retention_days),
            pv_kw=number("PV_KW", d.pv_kw),
            battery_kwh=number("BATTERY_KWH", d.battery_kwh),
            battery_reserve=number("BATTERY_RESERVE", d.battery_reserve),
            battery_max_kw=number("BATTERY_MAX_KW", d.battery_max_kw),
            import_rate=number("IMPORT_RATE", d.import_rate),
            feed_in_rate=number("FEED_IN_RATE", d.feed_in_rate),
            supply_charge=number("SUPPLY_CHARGE", d.supply_charge),
            forecast=flag("FORECAST", d.forecast),
            latitude=number("LATITUDE", d.latitude),
            longitude=number("LONGITUDE", d.longitude),
            mock=flag("MOCK", d.mock),
            auth=flag("AUTH", d.auth),
        )
