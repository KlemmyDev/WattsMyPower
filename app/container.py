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
from app.features.bills.service import BillsService
from app.features.forecast.service import ForecastService
from app.features.insights.service import InsightsService
from app.features.integrations.service import IntegrationsService
from app.features.live.client import CollectorClient
from app.features.live.ingest import CollectorIngest
from app.features.live.service import LiveService
from app.features.live.simulator import Simulator
from app.features.onboarding.service import OnboardingService
from app.features.plans.service import PlansService
from app.features.readings.repository import ReadingsRepository
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
    bills: BillsService
    auth: AuthService
    integrations: IntegrationsService
    onboarding: OnboardingService
    live: LiveService
    # What feeds `live`: the collector's feed, or generated readings in mock mode.
    source: CollectorIngest | Simulator


def build_services(config: Config) -> Services:
    db = Database(config.db_path)
    readings = ReadingsRepository(db, config.poll_interval, config.raw_retention_days)
    settings = SettingsStore(db, config)
    tariffs = TariffStore(db, config)
    plans = PlansService(tariffs)
    live = LiveService(config, settings, tariffs)
    collector = None if config.mock else CollectorClient(config.collector_url, config.collector_token)
    source: CollectorIngest | Simulator = (
        CollectorIngest(config, db, readings, live, collector) if collector else Simulator(config, db, readings, live)
    )
    integrations = IntegrationsService(config, collector, live)
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
        bills=BillsService(db, readings, settings, tariffs),
        auth=AuthService(db, enabled=config.auth),
        integrations=integrations,
        onboarding=OnboardingService(config, db, integrations),
        live=live,
        source=source,
    )
