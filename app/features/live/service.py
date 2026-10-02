"""
The live status: the latest reading, the system's details, and whether data is arriving.
Fed by the ingest loop (or the simulator in mock mode) and fanned out to the event stream.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.config import Config
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
        self.info: dict[str, Any] = {}  # the hybrid's details: model, serial, battery capacity, reserve
        # The second inverter, when the collector has one configured.
        self.pv2: dict[str, Any] | None = None
        self._subscribers: set[asyncio.Queue[Status]] = set()

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
        return self.config.battery_kwh or self.info.get("battery_kwh") or 0.0

    def reserve(self) -> float:
        r: float | None = self.info.get("reserve")
        return r if r is not None else self.config.battery_reserve

    def system(self) -> dict[str, Any]:
        cfg, info = self.config, self.info
        return {
            "brand": info.get("brand"),
            "model": info.get("model"),
            "serial": info.get("serial"),
            "nominal_kw": info.get("nominal_kw"),
            "phases": info.get("phases"),
            "pv_kw": cfg.pv_kw,
            "battery_kwh": self.battery_kwh(),
            "battery_reserve": self.reserve(),
            "battery_max_kw": cfg.battery_max_kw,
            "forecast": cfg.forecast,
            "tariff": self.tariffs.get(),
            "pv2": None if self.pv2 is None else {"behind_meter": cfg.pv2_behind_meter, **self.pv2},
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
            "error": self.last_error,
        }
