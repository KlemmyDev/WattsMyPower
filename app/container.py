"""
The composition root: every service, built once per app from the config.

Routers reach these through `ServicesDep` (app.dependencies) rather than importing
module-level state, so each feature can be built, replaced or tested on its own.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Config
from app.core.database import Database
from app.features.auth.service import AuthService
from app.features.forecast.service import ForecastService
from app.features.insights.service import InsightsService
from app.features.live.poller import Poller
from app.features.plans.service import PlansService
from app.features.readings.repository import ReadingsRepository
from app.features.savings.service import SavingsService
from app.features.settings.geocode import Geocoder
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore


@dataclass
class Services:
    config: Config
    db: Database
    readings: ReadingsRepository
    settings: SettingsStore
    tariffs: TariffStore
    geocoder: Geocoder
    plans: PlansService
    forecast: ForecastService
    insights: InsightsService
    savings: SavingsService
    auth: AuthService
    poller: Poller


def build_services(config: Config) -> Services:
    db = Database(config.db_path)
    readings = ReadingsRepository(db, config.poll_interval, config.raw_retention_days)
    settings = SettingsStore(db, config)
    tariffs = TariffStore(db, config)
    plans = PlansService(tariffs)
    return Services(
        config=config,
        db=db,
        readings=readings,
        settings=settings,
        tariffs=tariffs,
        geocoder=Geocoder(),
        plans=plans,
        forecast=ForecastService(config, readings, settings),
        insights=InsightsService(db, readings, settings),
        savings=SavingsService(db, readings, settings, tariffs, plans),
        auth=AuthService(db, enabled=config.auth),
        poller=Poller(config, db, readings, settings, tariffs),
    )
