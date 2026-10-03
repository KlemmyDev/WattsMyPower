"""Weather history: storing it, filling in past days, a day's summary, and the forecast learning from it."""

from __future__ import annotations

import datetime as dt
import math
import time
from dataclasses import replace
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.forecast import learning
from app.features.forecast.service import MODEL_KEY, ForecastService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.weather import openmeteo
from app.features.weather.repository import WeatherRepository, local_date
from app.features.weather.service import WeatherService
from app.features.weather.sun import Panels, hour_sun, position

LAT, LON = -27.47, 153.03
NOW = int(time.mktime(time.strptime("2026-10-02 20:00", "%Y-%m-%d %H:%M")))
NOW -= NOW % 3600


@pytest.fixture
def settings(db: Database, config: Config) -> SettingsStore:
    s = SettingsStore(db, replace(config, latitude=LAT, longitude=LON, pv_kw=6.6))
    s.seed_system()
    s.load()
    return s


def open_meteo(times: list[int], **values: list[Any]) -> dict[str, Any]:
    return {"hourly": {"time": times, **values}}


# ---------------------------------------------------------------------------------------- the sun


def test_the_sun_is_where_it_should_be_over_brisbane() -> None:
    noon = time.mktime((2026, 6, 21, 2, 0, 0, 0, 0, 0)) - time.timezone  # 12:00 AEST is 02:00 UTC
    elevation, azimuth = position(noon, LAT, LON)
    assert elevation == pytest.approx(39, abs=1.5)  # 90 - 27.5 - 23.4
    assert azimuth == pytest.approx(0, abs=5) or azimuth == pytest.approx(360, abs=5)  # due north


def test_panels_facing_the_winter_sun_catch_more_than_flat_ground() -> None:
    ts = int(time.mktime((2026, 6, 21, 1, 30, 0, 0, 0, 0)) - time.timezone)  # 11:30 AEST
    flat = hour_sun(ts, 600, None, None, Panels(LAT, LON, 0, 0)).poa
    north = hour_sun(ts, 600, None, None, Panels(LAT, LON, 25, 0)).poa
    south = hour_sun(ts, 600, None, None, Panels(LAT, LON, 25, 180)).poa
    assert flat == 600 and north > 1.2 * flat and south < 0.7 * flat


# ---------------------------------------------------------------------------------------- Open-Meteo


def test_rows_take_each_hours_sunlight_rain_and_code_from_the_next_stamp() -> None:
    data = open_meteo(
        [0, 3600, 7200],
        shortwave_radiation=[0, 300, 500],
        temperature_2m=[10, 11, 12],
        weather_code=[0, 61, 3],
        precipitation=[0, 2.5, 0],
    )
    rows = openmeteo.rows(data)
    assert [r["ts"] for r in rows] == [0, 3600]
    assert rows[0]["ghi"] == 300 and rows[0]["temp"] == 10 and rows[0]["code"] == 61 and rows[0]["precip"] == 2.5
    assert rows[0]["dni"] is None  # not asked for: worked out later if needed


def test_older_days_come_from_the_archive_and_newer_from_the_historical_forecast() -> None:
    old = openmeteo.history_url(LAT, LON, "ecmwf_ifs025", dt.date(2021, 3, 1), dt.date(2021, 3, 31))
    new = openmeteo.history_url(LAT, LON, "ecmwf_ifs025", dt.date(2024, 3, 1), dt.date(2024, 3, 31))
    assert old.startswith(openmeteo.ARCHIVE) and "models=" not in old and "precipitation_probability" not in old
    assert new.startswith(openmeteo.HISTORICAL) and "models=ecmwf_ifs025" in new


# ---------------------------------------------------------------------------------------- storing


def test_the_forecast_replaces_hours_but_history_only_fills_gaps(db: Database) -> None:
    repo = WeatherRepository(db)
    repo.write([{"ts": 0, "ghi": 100, "temp": 20}, {"ts": 3600, "ghi": 200, "temp": 21}], LAT, LON, now=1800)
    assert [h["source"] for h in repo.hours(0, 7200)] == ["recent", "forecast"]
    repo.write([{"ts": 0, "ghi": 999, "temp": 1}, {"ts": 7200, "ghi": 50, "temp": 19}], LAT, LON, 9000, history=True)
    hours = repo.hours(0, 10800)
    assert [(h["ts"], h["ghi"], h["source"]) for h in hours] == [
        (0, 100, "recent"),
        (3600, 200, "forecast"),
        (7200, 50, "archive"),
    ]
    repo.write([{"ts": 0, "ghi": 120, "temp": 20}], LAT, LON, now=9000)  # a newer estimate does replace it
    assert repo.hours(0, 3600)[0]["ghi"] == 120


def test_a_day_ahead_forecast_is_kept_as_it_stood_the_day_before(db: Database) -> None:
    repo = WeatherRepository(db)
    hour = 100 * 3600
    repo.log_forecast([(hour, 2.0)], issued_at=hour - 30 * 3600, model="simple")
    repo.log_forecast([(hour, 2.5)], issued_at=hour - 13 * 3600, model="simple")  # still a day-ahead forecast
    repo.log_forecast([(hour, 4.0)], issued_at=hour - 2 * 3600, model="simple")  # too close to count
    assert repo.forecasts(hour, hour + 1) == {hour: 2.5}
    repo.log_forecast([(hour + 3600, 1.0)], issued_at=hour, model="simple")  # first seen late: kept anyway
    assert repo.forecasts(hour + 3600, hour + 7200) == {hour + 3600: 1.0}


# ---------------------------------------------------------------------------------------- filling in


def days_ago(n: int) -> int:
    lt = time.localtime(NOW)
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday - n, 0, 0, 0, 0, 0, -1)))


def history_answer(url: str) -> dict[str, Any]:
    """Open-Meteo's answer for a history URL: every hour of the days asked for, at 400 W/m²."""
    q = dict(p.split("=", 1) for p in url.split("?", 1)[1].split("&"))
    start = dt.date.fromisoformat(q["start_date"])
    end = dt.date.fromisoformat(q["end_date"])
    first = int(time.mktime((start.year, start.month, start.day, 0, 0, 0, 0, 0, -1)))
    hours = ((end - start).days + 1) * 24 + 1
    times = [first + i * 3600 for i in range(hours)]
    return open_meteo(times, shortwave_radiation=[400] * hours, temperature_2m=[20] * hours, weather_code=[1] * hours)


def test_past_weather_is_filled_in_for_days_with_readings(
    db: Database, config: Config, settings: SettingsStore
) -> None:
    with db.writing() as conn:
        conn.executemany(
            "INSERT INTO samples_5m (ts, pv_power) VALUES (?, 1000)", [(days_ago(n) + 43200,) for n in (40, 39, 12)]
        )
    urls: list[str] = []

    def get(url: str) -> dict[str, Any]:
        urls.append(url)
        return history_answer(url)

    weather = WeatherService(config, db, settings, get=get, clock=lambda: NOW)
    assert len(weather.missing_days(dt.date.fromtimestamp(NOW))) == 3
    assert weather.backfill() == 3
    assert len(urls) == 1  # all three days fit in one request
    assert weather.missing_days(dt.date.fromtimestamp(NOW)) == []
    assert weather.status()["backfill"]["remaining"] == 0
    assert weather.backfill() == 0 and len(urls) == 1  # nothing left to ask for


def test_a_failed_fill_is_reported_and_tried_again(db: Database, config: Config, settings: SettingsStore) -> None:
    with db.writing() as conn:
        conn.execute("INSERT INTO samples_5m (ts, pv_power) VALUES (?, 1000)", (days_ago(30) + 43200,))

    def down(url: str) -> dict[str, Any]:
        raise TimeoutError

    weather = WeatherService(config, db, settings, get=down, clock=lambda: NOW)
    assert weather.backfill() == 0
    assert "couldn't be reached" in weather.status()["backfill"]["error"]
    weather._get = history_answer
    assert weather.backfill() == 1 and weather.status()["backfill"]["error"] is None


def test_a_model_open_meteo_cant_serve_falls_back_to_its_best_match(
    db: Database, config: Config, settings: SettingsStore
) -> None:
    times = [NOW - 3600 + i * 3600 for i in range(30)]
    asked: list[str] = []

    def get(url: str) -> dict[str, Any]:
        asked.append(url)
        if "models=gfs" in url:
            raise OSError("400 Bad Request")
        if "models=icon" in url:  # answers, but with nothing in it
            return open_meteo(times, shortwave_radiation=[None] * 30, temperature_2m=[None] * 30)
        return open_meteo(times, shortwave_radiation=[500] * 30, temperature_2m=[22] * 30)

    weather = WeatherService(config, db, settings, get=get, clock=lambda: NOW)
    for model in ("gfs_seamless", "icon_seamless"):
        settings.save({"weather_model": model})
        weather.invalidate()
        weather.ensure_fresh()
        assert weather.status()["model_unavailable"] == model
        assert len(weather.hours(NOW, NOW + 86400)) == 24
    settings.save({"weather_model": "best_match"})
    weather.invalidate()
    weather.ensure_fresh()
    assert weather.status()["model_unavailable"] is None


def test_a_days_weather_is_summed_up(db: Database, config: Config, settings: SettingsStore) -> None:
    start = days_ago(1)
    rows = [
        {
            "ts": start + h * 3600,
            "ghi": 500 if 7 <= h < 17 else 0,
            "temp": 15 + h / 2,
            "cloud": 40,
            "code": 61 if h in (13, 14) else 1,
            "precip": 1.5 if h in (13, 14) else 0,
            "is_day": 1 if 6 <= h < 18 else 0,
        }
        for h in range(24)
    ]
    weather = WeatherService(config, db, settings, clock=lambda: NOW)
    weather.repo.write(rows, LAT, LON, NOW, history=True)
    weather.repo.log_forecast([(start + 12 * 3600, 3.0)], issued_at=start - 86400, model="simple")
    out = weather.day(dt.date.fromtimestamp(start))
    s = out["summary"]
    assert len(out["hours"]) == 24 and out["hours"][12]["pv_forecast"] == 3.0
    assert s["temp_min"] == 15 and s["temp_max"] == 26.5 and s["rain_mm"] == 3.0
    assert s["code"] == 61 and s["sunlight_kwh_m2"] == 5.0 and s["pv_forecast_kwh"] == 3.0


# ---------------------------------------------------------------------------------------- learning

TRUE_ROOF = Panels(LAT, LON, tilt=20, bearing=45)  # north-east
DAYS = 45


def shaded(ts: int) -> bool:
    """The roof's west side is shaded once the afternoon sun drops behind a tree."""
    elevation, azimuth = position(ts + 1800, LAT, LON)
    return 240 <= azimuth <= 320 and elevation < 35


def synthetic_history(db: Database) -> None:
    """DAYS days of weather, and what a 6.6 kW north-east roof with an afternoon tree made in it."""
    repo = WeatherRepository(db)
    start = days_ago(DAYS)
    weather, made = [], []
    for h in range(DAYS * 24):
        ts = start + h * 3600
        elevation, _ = position(ts + 1800, LAT, LON)
        day = h // 24
        cloud = (day * 37) % 100  # a different sky each day
        ghi = max(0.0, 1000 * math.sin(math.radians(max(elevation, 0))) ** 1.15) * (1 - 0.7 * cloud / 100)
        weather.append({"ts": ts, "ghi": ghi, "temp": 25.0, "cloud": cloud, "code": 1})
        poa = hour_sun(ts, ghi, None, None, TRUE_ROOF).poa / 1000
        kwh = min(5.0, 6.6 * 0.85 * poa * (0.3 if shaded(ts) else 1.0))
        made += [(ts + i * 300, kwh * 1000, 50.0) for i in range(12)]
    repo.write(weather, LAT, LON, NOW, history=True)
    with db.writing() as conn:
        conn.executemany("INSERT INTO samples_5m (ts, pv_power, battery_soc) VALUES (?, ?, ?)", made)


def test_the_learned_model_finds_the_roofs_direction_and_shade_and_beats_the_plain_forecast(
    db: Database, config: Config, readings: ReadingsRepository, settings: SettingsStore
) -> None:
    synthetic_history(db)
    weather = WeatherService(config, db, settings, clock=lambda: NOW)
    forecast = ForecastService(config, readings, settings, weather)
    saved = forecast.train(NOW)
    test = saved["backtest"]
    assert saved["days"] >= DAYS - 1 and test["days"] >= learning.MIN_BACKTEST_DAYS
    assert test["learned_mae"] < 0.5 * test["simple_mae"], test
    assert saved["better"] and forecast._active_model() is not None

    model = learning.SolarModel.from_json(saved["model"])
    afternoon = [s for s in forecast._samples(days_ago(3), days_ago(2)) if s.actual and shaded(s.ts)]
    assert afternoon and all(abs(model.predict(s) - s.actual) < 0.3 for s in afternoon if s.actual)

    settings.save({"forecast_learning": 0})
    assert forecast._active_model() is None  # switched off in Settings
    settings.save({"forecast_learning": 1, "panel_tilt": 20})
    assert forecast._active_model() is None  # the panels changed: not used until it's retrained
    with db.reading() as conn:
        assert conn.execute("SELECT 1 FROM kv WHERE key = ?", (MODEL_KEY,)).fetchone()


def test_with_too_little_history_nothing_is_learned(
    db: Database, config: Config, readings: ReadingsRepository, settings: SettingsStore
) -> None:
    forecast = ForecastService(config, readings, settings, WeatherService(config, db, settings, clock=lambda: NOW))
    saved = forecast.train(NOW)
    assert saved["model"] is None and not saved["better"] and forecast._active_model() is None


def test_hours_the_battery_was_full_and_output_held_back_are_left_out() -> None:
    def hour(ts: int, actual: float, full: bool) -> learning.Sample:
        return learning.Sample(ts, local_date(ts), 0.5, 0.5, "3:0", 10, 25, actual, full)

    good = [hour(i * 3600, 3.0, False) for i in range(80)]
    held = [hour((100 + i) * 3600, 0.5, True) for i in range(40)]
    model = learning.fit(good + held, 6.6)
    assert model is not None and model.cells["3:0"] == pytest.approx(6.0, rel=0.05)
