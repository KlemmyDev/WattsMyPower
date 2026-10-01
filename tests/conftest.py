from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.readings.repository import ReadingsRepository


@pytest.fixture
def config(tmp_path: Path) -> Config:
    return Config(db_path=str(tmp_path / "test.db"), mock=True, auth=False)


@pytest.fixture
def db(config: Config) -> Database:
    database = Database(config.db_path)
    database.migrate()
    return database


@pytest.fixture
def readings(db: Database, config: Config) -> ReadingsRepository:
    return ReadingsRepository(db, config.poll_interval, config.raw_retention_days)
