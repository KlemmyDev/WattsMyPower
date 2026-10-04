"""
Open-Meteo (free, no API key): the forecast, and weather history for days already past.

Three of its services are used, all answering in the same shape:
  - the forecast, with the last week as it estimated it (`past_days`), every half hour or so;
  - the historical forecast, the same models' output for any day since 2022, to fill in older days
    the dashboard has readings for (the closest match to what a forecast would have said);
  - the ERA5 archive, for days before that.

Sunlight, rain, its chance and the weather code describe the hour *before* their timestamp, while
temperature, cloud and wind are at the timestamp. Rows are keyed by the start of the hour, so they
take the first kind from the next stamp.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from typing import Any
from urllib.parse import urlencode

from app.core.http import get_json

FORECAST = "https://api.open-meteo.com/v1/forecast"
HISTORICAL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
HISTORICAL_FROM = dt.date(2022, 1, 1)  # the historical forecast's first day (older days use the archive)

HOURLY = [
    "shortwave_radiation", "direct_normal_irradiance", "diffuse_radiation", "temperature_2m", "cloud_cover",
    "weather_code", "precipitation", "precipitation_probability", "wind_speed_10m", "is_day",
]  # fmt: skip
# The archive has no precipitation probability (it's what happened, not a forecast).
ARCHIVE_HOURLY = [h for h in HOURLY if h != "precipitation_probability"]

# Row field -> Open-Meteo variable.
FIELDS = {
    "ghi": "shortwave_radiation",
    "dni": "direct_normal_irradiance",
    "dhi": "diffuse_radiation",
    "temp": "temperature_2m",
    "cloud": "cloud_cover",
    "code": "weather_code",
    "precip": "precipitation",
    "precip_prob": "precipitation_probability",
    "wind": "wind_speed_10m",
    "is_day": "is_day",
}
PRECEDING = {"ghi", "dni", "dhi", "precip", "precip_prob", "code"}  # about the hour before the stamp

Row = dict[str, Any]
Fetch = Callable[[str], Any]


def _url(base: str, latitude: float, longitude: float, model: str, hourly: list[str], **extra: Any) -> str:
    params: dict[str, Any] = {
        "latitude": f"{latitude:.4f}",
        "longitude": f"{longitude:.4f}",
        "hourly": ",".join(hourly),
        "timezone": "auto",
        "timeformat": "unixtime",
        **extra,
    }
    if model != "best_match" and base != ARCHIVE:
        params["models"] = model
    return f"{base}?{urlencode(params)}"


FORECAST_DAYS = 7  # today and the next six: the Plan page shows three, and car charges can be planned over a week


def forecast_url(latitude: float, longitude: float, model: str) -> str:
    return _url(FORECAST, latitude, longitude, model, HOURLY, past_days=7, forecast_days=FORECAST_DAYS)


def history_url(latitude: float, longitude: float, model: str, start: dt.date, end: dt.date) -> str:
    """
    Days `start` to `end` inclusive, from the historical forecast, or the archive before it begins. A day more
    is asked for: the last hour takes its sunshine from the next day's first stamp (see rows).
    """
    through = end + dt.timedelta(days=1)
    if start >= HISTORICAL_FROM:
        return _url(HISTORICAL, latitude, longitude, model, HOURLY, start_date=start, end_date=through)
    return _url(ARCHIVE, latitude, longitude, model, ARCHIVE_HOURLY, start_date=start, end_date=through)


def rows(data: dict[str, Any]) -> list[Row]:
    """One row per hour, keyed by the hour's start (see the module docstring). Missing variables are None."""
    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    out: list[Row] = []
    for i in range(len(times) - 1):
        row: Row = {"ts": int(times[i])}
        for field, var in FIELDS.items():
            values = hourly.get(var)
            j = i + 1 if field in PRECEDING else i
            row[field] = values[j] if values is not None and j < len(values) else None
        out.append(row)
    return out


def fetch(url: str, get: Fetch = lambda u: get_json(u, timeout=20)) -> list[Row]:
    return rows(get(url))
