"""
The composition root: every service, built once per app from the config.

Routers reach these through `ServicesDep` (app.dependencies) rather than importing
module-level state, so each feature can be built, replaced or tested on its own.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Config
from app.core.database import Database
from app.features.alerts.service import AlertsService
from app.features.amber.service import AmberService
from app.features.auth.service import AuthService
from app.features.bills.service import BillsService
from app.features.car.service import CarService
from app.features.forecast.service import ForecastService
from app.features.imports.service import ImportService
from app.features.insights.service import InsightsService
from app.features.integrations.service import IntegrationsService
from app.features.live.client import CollectorClient
from app.features.live.ingest import CollectorIngest
from app.features.live.service import LiveService
from app.features.live.simulator import Simulator
from app.features.meter.service import MeterService
from app.features.onboarding.service import OnboardingService
from app.features.plans.service import PlansService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.geocode import Geocoder
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore
from app.features.weather.service import WeatherService


@dataclass
class Services:
    config: Config
    db: Database
    readings: ReadingsRepository
    settings: SettingsStore
    tariffs: TariffStore
    amber: AmberService
    geocoder: Geocoder
    plans: PlansService
    weather: WeatherService
    forecast: ForecastService
    insights: InsightsService
    car: CarService
    meter: MeterService
    bills: BillsService
    imports: ImportService
    auth: AuthService
    integrations: IntegrationsService
    onboarding: OnboardingService
    live: LiveService
    alerts: AlertsService
    # What feeds `live`: the collector's feed, or generated readings in mock mode.
    source: CollectorIngest | Simulator


def build_services(config: Config) -> Services:
    db = Database(config.db_path)
    readings = ReadingsRepository(db, config.poll_interval, config.raw_retention_days)
    settings = SettingsStore(db, config)
    tariffs = TariffStore(db, config)
    amber = AmberService(db, tariffs)
    plans = PlansService(tariffs)
    meter = MeterService(db, readings)
    live = LiveService(config, settings, tariffs)
    collector = None if config.mock else CollectorClient(config.collector_url, config.collector_token)
    source: CollectorIngest | Simulator = (
        CollectorIngest(config, db, readings, live, collector) if collector else Simulator(config, db, readings, live)
    )
    weather = WeatherService(config, db, settings)
    car = CarService(db, settings)
    forecast = ForecastService(config, readings, settings, weather, car)
    insights = InsightsService(db, readings, settings, weather, forecast, tariffs, amber.repo)
    weather.after_refresh.append(forecast.tick)  # learn and keep the day-ahead forecast as the weather updates
    integrations = IntegrationsService(config, collector, live)
    return Services(
        config=config,
        db=db,
        readings=readings,
        settings=settings,
        tariffs=tariffs,
        amber=amber,
        geocoder=Geocoder(),
        plans=plans,
        weather=weather,
        forecast=forecast,
        insights=insights,
        car=car,
        meter=meter,
        bills=BillsService(db, readings, settings, tariffs, meter, amber.repo),
        imports=ImportService(db),
        auth=AuthService(db, enabled=config.auth),
        integrations=integrations,
        onboarding=OnboardingService(config, db, integrations),
        live=live,
        alerts=AlertsService(db, live, settings, readings, tariffs, insights, prices=amber.repo),
        source=source,
    )
