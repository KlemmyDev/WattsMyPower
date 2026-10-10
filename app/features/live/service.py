"""
The live status: the latest reading, the system's details, and whether data is arriving.
Fed by the ingest loop (or the simulator in mock mode) and fanned out to the event stream.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.config import Config
from app.core.timezone import site_zone
from app.core.version import about
from app.features.inverters.types import Snapshot
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore

Status = dict[str, Any]


class LiveService:
    def __init__(self, config: Config, settings: SettingsStore, tariffs: TariffStore):
        self.config = config
        self.settings = settings
        self.tariffs = tariffs
        self.latest: Snapshot | None = None
        self.last_success: float | None = None  # when the hybrid was last read
        self.last_error: str | None = None
        # While the hybrid keeps answering with the same words (see transform.Freeze): when the
        # reading it repeats was taken. Those polls aren't stored, so `latest` stays at that reading.
        self.frozen_since: int | None = None
        self.next_poll: float | None = None  # when the collector next reads the inverters (unix seconds)
        self.info: dict[str, Any] = {}  # the hybrid's details: model, serial, battery capacity, reserve
        self.driver: str | None = None  # the hybrid's driver id (e.g. "sungrow.sh_rs"), None until one is connected
        # Whether a main inverter is connected, as the collector last said; None until it's been asked.
        self.inverter: bool | None = None
        # What the battery is set to do, from app.features.battery (BatteryService.summary); None if it can't be told.
        self.battery_mode: dict[str, Any] | None = None
        # Each EV in brief, from every maker's integration (app.features.tesla, app.features.byd: set_ev); None when
        # none is connected.
        self.ev: list[dict[str, Any]] | None = None
        self._ev: dict[str, list[dict[str, Any]] | None] = {}  # each integration's cars (None: not connected)
        # The second inverter, when the collector has one configured.
        self.pv2: dict[str, Any] | None = None
        self._subscribers: set[asyncio.Queue[Status]] = set()

    def set_ev(self, source: str, cars: list[dict[str, Any]] | None) -> bool:
        """One integration's cars in brief (None: it isn't connected), shown after the others' (Teslas first). Whether
        `ev` changed, so the caller publishes."""
        self._ev[source] = cars
        connected = [self._ev[k] for k in sorted(self._ev, key=lambda k: (k != "tesla", k)) if self._ev[k] is not None]
        ev = [car for cs in connected for car in cs or []] if connected else None
        if ev == self.ev:
            return False
        self.ev = ev
        return True

    # -- live fan-out ---------------------------------------------------------
    def subscribe(self) -> asyncio.Queue[Status]:
        q: asyncio.Queue[Status] = asyncio.Queue(maxsize=10)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[Status]) -> None:
        self._subscribers.discard(q)

    def publish(self) -> None:
        msg = self.status()
        for q in list(self._subscribers):
            if q.full():  # slow client: drop its oldest message rather than block everyone
                q.get_nowait()
            q.put_nowait(msg)

    # -- system details -------------------------------------------------------
    @property
    def model(self) -> str | None:
        model: str | None = self.info.get("model")
        return model

    def battery_kwh(self) -> float:
        """The capacity set in Manage → System, or else what the inverter reports."""
        return self.settings.get("battery_kwh_override") or self.info.get("battery_kwh") or 0.0

    def reserve(self) -> float:
        """The backup reserve (%) the inverter reports, or else the one set in Manage → System."""
        r: float | None = self.info.get("reserve")
        return r if r is not None else self.settings.get("battery_reserve_fallback")

    def system(self) -> dict[str, Any]:
        cfg, info, settings = self.config, self.info, self.settings
        return {
            "brand": info.get("brand"),
            "model": info.get("model"),
            "serial": info.get("serial"),
            "nominal_kw": info.get("nominal_kw"),
            "phases": info.get("phases"),
            "pv_kw": settings.get("pv_kw"),
            "battery_kwh": self.battery_kwh(),
            "battery_reserve": self.reserve(),
            "battery_max_kw": settings.get("battery_max_kw"),
            # What the inverter itself reports, so Manage → System can say whether its settings apply.
            "inverter_battery_kwh": info.get("battery_kwh"),
            "inverter_reserve": info.get("reserve"),
            "forecast": cfg.forecast,
            "tariff": self.tariffs.get(),
            "pv2": None if self.pv2 is None else {"behind_meter": cfg.pv2_behind_meter, **self.pv2},
            "ev_connected": self.ev is not None,
            # So pages can tell no inverter (and so no battery) from one not heard from yet.
            "inverter_connected": self.inverter,
            **self.settings.all_values(),
        }

    def status(self) -> Status:
        return {
            "snapshot": self.latest,
            "system": self.system(),
            "model": self.model,
            "mock": self.config.mock,
            "poll_interval": self.config.poll_interval,
            "last_success": self.last_success,
            "next_poll": self.next_poll,
            "error": self.last_error,
            "frozen_since": self.frozen_since,
            "battery_mode": self.battery_mode,
            # Which version this is, shown at the foot of the navigation.
            "app": about(),
            # The zone the days above are kept in, so the dashboard draws times in it whatever the browser's is.
            "time_zone": site_zone(),
            "ev": self.ev,
        }
