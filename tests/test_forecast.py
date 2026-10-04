"""The forecast's fits stay close to what the system really does, despite odd days and bad readings."""

from __future__ import annotations

import math
import time
from dataclasses import replace

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.forecast.service import ForecastService, day_start, solar_range, trimmed_mean
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.weather.service import WeatherService

DAYS = 14
NOW = int(time.mktime(time.strptime("2026-10-02 20:00", "%Y-%m-%d %H:%M")))


@pytest.fixture
def service(db: Database, config: Config, readings: ReadingsRepository) -> ForecastService:
    config = replace(config, pv_kw=13.2)
    settings = SettingsStore(db, config)
    settings.load()
    return ForecastService(config, readings, settings, WeatherService(config, db, settings))


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


def test_the_home_use_basis_lists_whole_days_and_the_typical_day(db: Database, service: ForecastService) -> None:
    rows = history()
    patchy = day_start(NOW, -5)  # a day with only a few hours of readings isn't shown as a day
    rows = [r for r in rows if not (patchy <= r[0] < patchy + 86400 and time.localtime(r[0]).tm_hour >= 6)]
    write_5m(db, rows)
    basis = service.load_basis(NOW)
    dates = [d["date"] for d in basis["days"]]
    assert time.strftime("%Y-%m-%d", time.localtime(patchy)) not in dates
    assert time.strftime("%Y-%m-%d", time.localtime(NOW)) not in dates  # today isn't over
    assert len(dates) == DAYS - 2 and all(d["kwh"] == pytest.approx(24 * 0.8) for d in basis["days"])
    assert basis["hours_known"] == 24 and basis["typical_kwh"] == pytest.approx(24 * 0.8)
    assert basis["window_days"] == 14
    assert basis["profile_kw"] == [pytest.approx(0.8)] * 24


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


# ------------------------------------------------------------------ the days ahead
def outlook_weather(now: int) -> dict[str, object]:
    """Open-Meteo's hourly weather from a little before now to past the day after tomorrow: sun by day."""
    t = [now - now % 3600 + h * 3600 for h in range(-2, 80)]
    lit = [6 <= time.localtime(ts).tm_hour < 18 for ts in t]
    return {
        "hourly": {
            "time": t,
            "shortwave_radiation": [round(sun(ts) * 1000) for ts in t],
            "temperature_2m": [15 + time.localtime(ts).tm_hour / 2 for ts in t],
            # Two hours of rain the day after tomorrow, one stray shower tomorrow.
            "weather_code": [
                61
                if (d := ts - day_start(now)) // 86400 == 2 and 12 <= time.localtime(ts).tm_hour < 14
                else 80
                if d // 86400 == 1 and time.localtime(ts).tm_hour == 9
                else 1
                for ts in t
            ],
            "is_day": [int(x) for x in lit],
            "precipitation_probability": [0] * len(t),
        }
    }


def test_the_outlook_sums_up_today_and_the_next_two_days(
    db: Database, config: Config, readings: ReadingsRepository
) -> None:
    now = int(time.time())
    settings = SettingsStore(db, replace(config, pv_kw=6.6))
    settings.load()
    data = outlook_weather(now)
    forecast = ForecastService(config, readings, settings, WeatherService(config, db, settings, get=lambda _: data))
    out = forecast.build({"battery_soc": 30.0}, 10.0, 10.0)
    assert out is not None
    days = out["days"]
    assert [d["start"] for d in days] == [day_start(now, n) for n in range(3)]
    # The steps run to the end of the day after tomorrow, and no further.
    assert out["hours"][-1]["ts"] + 3600 == day_start(now, 3)
    # Today starts now; the other days at midnight. Each day's totals are its hours'.
    assert days[0]["from"] == now and days[1]["from"] == days[1]["start"]
    for d in days:
        hrs = [h for h in out["hours"] if d["start"] <= h["start"] < d["start"] + 86400]
        assert d["pv_kwh"] == pytest.approx(sum(h["pv_kwh"] for h in hrs), abs=0.05)
        assert d["import_kwh"] - d["export_kwh"] == pytest.approx(sum(h["grid_kwh"] for h in hrs), abs=0.05)
    # A sunny day fills a 10 kWh battery from the night's low, in daylight.
    tomorrow = days[1]
    assert tomorrow["full_at"] is not None and 6 <= time.localtime(tomorrow["full_at"]).tm_hour < 18
    assert tomorrow["max_soc"] == 100 and tomorrow["min_soc"] < 100
    # One shower doesn't make a day wet; two hours of rain do.
    assert tomorrow["code"] == 1 and days[2]["code"] == 61


def test_a_full_battery_is_full_now_rather_than_filling(
    db: Database, config: Config, readings: ReadingsRepository
) -> None:
    now = int(time.time())
    settings = SettingsStore(db, config)
    settings.load()
    data = outlook_weather(now)
    forecast = ForecastService(config, readings, settings, WeatherService(config, db, settings, get=lambda _: data))
    out = forecast.build({"battery_soc": 100.0}, 10.0, 10.0)
    assert out is not None
    assert out["days"][0]["full_now"] and out["days"][0]["full_at"] is None


def test_the_likely_range_needs_a_week_of_days() -> None:
    def days(ratios: list[float]) -> list[dict[str, float]]:
        return [{"forecast_kwh": 20.0, "actual_kwh": 20.0 * r} for r in ratios]

    assert solar_range(days([1.0] * 6)) is None
    # Ten days: the second-lowest and second-highest ratios bound 8 in 10 of them.
    out = solar_range(days([0.4, 0.7, 0.8, 0.9, 0.95, 1.0, 1.0, 1.05, 1.1, 1.3]))
    assert out == {"low": 0.7, "high": 1.1, "days": 10}
    # Days too dull to compare don't count, and the range always includes the forecast itself.
    assert solar_range([*days([1.1] * 8), {"forecast_kwh": 0.2, "actual_kwh": 2.0}]) == {
        "low": 1.0,
        "high": 1.1,
        "days": 8,
    }
