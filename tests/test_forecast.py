"""The forecast's fits stay close to what the system really does, despite odd days and bad readings."""

from __future__ import annotations

import math
import time
from dataclasses import replace

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.forecast.service import ForecastService, trimmed_mean
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore

DAYS = 14
NOW = int(time.mktime(time.strptime("2026-10-02 20:00", "%Y-%m-%d %H:%M")))


@pytest.fixture
def service(db: Database, config: Config, readings: ReadingsRepository) -> ForecastService:
    config = replace(config, pv_kw=13.2)
    settings = SettingsStore(db, config)
    settings.load()
    return ForecastService(config, readings, settings)


def sun(ts: int) -> float:
    """Clear-sky-ish radiation in kW/m² for the hour of day."""
    h = time.localtime(ts).tm_hour + time.localtime(ts).tm_min / 60
    return max(0.0, math.sin(math.pi * (h - 6) / 13)) * 0.9


def write_5m(db: Database, rows: list[tuple[int, float | None, float | None]]) -> None:
    with db.writing() as conn:
        conn.executemany("INSERT OR REPLACE INTO samples_5m (ts, pv_power, load_power) VALUES (?, ?, ?)", rows)


def history(k: float = 9.0, load_w: float = 800.0) -> list[tuple[int, float | None, float | None]]:
    start = NOW - DAYS * 86400
    return [(ts, k * sun(ts) * 1000, load_w) for ts in range(start, NOW, 300)]


def test_trimmed_mean_drops_the_extremes() -> None:
    assert trimmed_mean([1.0] * 12 + [50.0, -5.0]) == 1.0
    assert trimmed_mean([2.0, 4.0]) == 3.0  # too few to trim


def test_home_use_ignores_a_day_of_garbled_readings(db: Database, service: ForecastService) -> None:
    rows = history()
    bad_day = NOW - 3 * 86400
    # A day when torn 32-bit reads put tens of kW into home use (e.g. -600 W read as +64,936 W).
    rows = [(ts, pv, 13_000.0 if bad_day <= ts < bad_day + 86400 else load) for ts, pv, load in rows]
    write_5m(db, rows)
    profile = service._load_profile(NOW)
    assert sum(profile) == pytest.approx(24 * 0.8)


def test_home_use_counts_negative_readings_as_zero(db: Database, service: ForecastService) -> None:
    write_5m(db, [(ts, pv, -600.0 if time.localtime(ts).tm_hour == 7 else load) for ts, pv, load in history()])
    assert service._load_profile(NOW)[7] == 0.0


def test_solar_fit_ignores_a_day_of_garbled_readings(db: Database, service: ForecastService) -> None:
    rows = history(k=9.0)
    bad_day = NOW - 2 * 86400
    rows = [(ts, pv * 1.9 if bad_day <= ts < bad_day + 86400 and pv else pv, load) for ts, pv, load in rows]
    rows += [(NOW - 86400 + 12 * 3600 + 7, 4_000_000.0, 800.0)]  # a random 32-bit value: impossible output
    write_5m(db, rows)
    hours = [{"ts": ts, "rad": sun(ts + 1800)} for ts in range(NOW - 7 * 86400, NOW, 3600)]
    k, fitted = service._calibrate(hours, NOW)
    assert k == pytest.approx(9.0, rel=0.05) and fitted > 24
