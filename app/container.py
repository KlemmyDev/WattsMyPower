"""
The composition root: every service, built once per app from the config.

Routers reach these through `ServicesDep` (app.dependencies) rather than importing
module-level state, so each feature can be built, replaced or tested on its own.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.config import Config
from app.core.database import Database
from app.features.amber.service import AmberService
from app.features.auth.service import AuthService
from app.features.battery.service import BatteryService, CollectorRegisters, ForecastPlanner
from app.features.bills.service import BillsService
from app.features.car.service import CarService
from app.features.forecast.service import ForecastService
from app.features.grid.outages.service import OutageService
from app.features.grid.service import GridService
from app.features.grid.warnings.service import HazardService
from app.features.home import insights as home_insights
from app.features.home.service import HomeService
from app.features.imports.service import ImportService
from app.features.insights.service import InsightsService
from app.features.integrations.service import IntegrationsService
from app.features.inverters.sungrow.mock import MockRegisters
from app.features.live.client import CollectorClient
from app.features.live.ingest import CollectorIngest
from app.features.live.service import LiveService
from app.features.live.simulator import Simulator
from app.features.meter.service import MeterService
from app.features.onboarding.service import OnboardingService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.geocode import Geocoder
from app.features.settings.store import SettingsStore
from app.features.storage.service import StorageService
from app.features.tariffs.store import TariffStore
from app.features.tesla.service import TeslaService
from app.features.updates.service import UpdateService
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
    weather: WeatherService
    forecast: ForecastService
    insights: InsightsService
    car: CarService
    home: HomeService
    meter: MeterService
    bills: BillsService
    imports: ImportService
    auth: AuthService
    integrations: IntegrationsService
    storage: StorageService
    onboarding: OnboardingService
    live: LiveService
    battery: BatteryService
    updates: UpdateService
    grid: GridService
    outages: OutageService
    hazards: HazardService
    tesla: TeslaService
    # What feeds `live`: the collector's feed, or generated readings in mock mode.
    source: CollectorIngest | Simulator


def build_services(config: Config) -> Services:
    db = Database(config.db_path)
    readings = ReadingsRepository(db, config.poll_interval, config.raw_retention_days)
    settings = SettingsStore(db, config)
    tariffs = TariffStore(db, config)
    amber = AmberService(db, tariffs)
    meter = MeterService(db, readings)
    bills = BillsService(db, readings, settings, tariffs, meter, amber.repo)
    live = LiveService(config, settings, tariffs)
    collector = None if config.mock else CollectorClient(config.collector_url, config.collector_token)
    source: CollectorIngest | Simulator = (
        CollectorIngest(config, db, readings, live, collector) if collector else Simulator(config, db, readings, live)
    )
    weather = WeatherService(config, db, settings)
    car = CarService(db)
    forecast = ForecastService(config, readings, settings, weather)
    insights = InsightsService(db, readings, settings, weather, forecast, tariffs, amber.repo)
    weather.after_refresh.append(forecast.tick)  # learn and keep the day-ahead forecast as the weather updates
    integrations = IntegrationsService(config, collector, live)
    outages = OutageService(settings, lambda: grid.region()[0])  # which state? (grid is set by the time it asks)
    hazards = HazardService(settings, lambda: grid.region()[0])
    grid = GridService(settings, weather, lambda: live.latest, outages=outages, hazards=hazards)
    return Services(
        config=config,
        db=db,
        readings=readings,
        settings=settings,
        tariffs=tariffs,
        amber=amber,
        geocoder=Geocoder(),
        weather=weather,
        forecast=forecast,
        insights=insights,
        car=car,
        home=HomeService(config, db, conditions=lambda: home_insights.conditions(readings, tariffs, amber.repo)),
        meter=meter,
        bills=bills,
        imports=ImportService(db),
        auth=AuthService(db, enabled=config.auth),
        integrations=integrations,
        storage=StorageService(config, db, collector),
        onboarding=OnboardingService(config, db, integrations),
        live=live,
        battery=BatteryService(
            db,
            live,
            CollectorRegisters(collector) if collector else MockRegisters(source.inverter),  # type: ignore[union-attr]
            planner=ForecastPlanner(forecast, tariffs, amber.repo, settings),
        ),
        updates=UpdateService(settings, Path(config.db_path).parent / "update"),
        grid=grid,
        outages=outages,
        hazards=hazards,
        tesla=TeslaService(config, db, live, car, settings, forecast),
        source=source,
    )
