from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import DEMO_LOCATION, Config
from app.core.database import Database
from app.features.readings.repository import ReadingsRepository


@pytest.fixture
def config(tmp_path: Path) -> Config:
    # As MOCK=1 runs: at the demo's location (tests of a location not chosen yet clear it).
    lat, lon = DEMO_LOCATION
    return Config(db_path=str(tmp_path / "test.db"), mock=True, auth=False, latitude=lat, longitude=lon)


@pytest.fixture
def db(config: Config) -> Database:
    database = Database(config.db_path)
    database.migrate()
    return database


@pytest.fixture
def readings(db: Database, config: Config) -> ReadingsRepository:
    return ReadingsRepository(db, config.poll_interval, config.raw_retention_days)
