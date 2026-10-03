"""
Where the sun is, and how much of an hour's sunshine lands on the panels.

Weather services give sunlight on flat ground: global (GHI), and its two parts, the direct beam
measured square-on (DNI) and the diffuse light from the rest of the sky (DHI). Panels are tilted
and face a direction, so what reaches them depends on where the sun is through the hour. This
works that out with the usual textbook formulas (NOAA's sun position, the isotropic sky model,
and the Erbs split when a service gives only the global figure). All angles are in degrees.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

J2000 = 946_728_000  # 2000-01-01 12:00 UTC
SOLAR_CONSTANT = 1367.0  # W/m² above the atmosphere
ALBEDO = 0.2  # share of sunlight the ground reflects onto tilted panels
SUBSTEPS = 6  # points through an hour where the sun's position is taken


@dataclass(frozen=True)
class Panels:
    """Where the system is and how its panels sit: tilt from flat, and the compass bearing they face (0 = north)."""

    latitude: float
    longitude: float
    tilt: float = 0.0
    bearing: float = 0.0


def position(ts: float, latitude: float, longitude: float) -> tuple[float, float]:
    """(elevation above the horizon, compass bearing from north) of the sun at unix time `ts`."""
    n = (ts - J2000) / 86400
    mean_long = math.radians((280.460 + 0.9856474 * n) % 360)
    anomaly = math.radians((357.528 + 0.9856003 * n) % 360)
    ecliptic = mean_long + math.radians(1.915 * math.sin(anomaly) + 0.020 * math.sin(2 * anomaly))
    obliquity = math.radians(23.439 - 0.0000004 * n)
    right_ascension = math.atan2(math.cos(obliquity) * math.sin(ecliptic), math.cos(ecliptic))
    declination = math.asin(math.sin(obliquity) * math.sin(ecliptic))
    sidereal = math.radians(((18.697374558 + 24.06570982441908 * n) % 24) * 15 + longitude)
    hour_angle = sidereal - right_ascension
    lat = math.radians(latitude)
    sin_elev = math.sin(lat) * math.sin(declination) + math.cos(lat) * math.cos(declination) * math.cos(hour_angle)
    elevation = math.asin(max(-1.0, min(1.0, sin_elev)))
    azimuth = math.atan2(
        -math.sin(hour_angle), math.tan(declination) * math.cos(lat) - math.sin(lat) * math.cos(hour_angle)
    )
    return math.degrees(elevation), math.degrees(azimuth) % 360


def _cos_incidence(elevation: float, azimuth: float, panels: Panels) -> float:
    """Cosine of the angle between the sun and the panels' face (negative when the sun is behind them)."""
    zenith = math.radians(90 - elevation)
    tilt = math.radians(panels.tilt)
    return math.cos(zenith) * math.cos(tilt) + math.sin(zenith) * math.sin(tilt) * math.cos(
        math.radians(azimuth - panels.bearing)
    )


def _extraterrestrial(ts: float) -> float:
    day = ((ts - J2000) / 86400) % 365.25
    return SOLAR_CONSTANT * (1 + 0.033 * math.cos(2 * math.pi * day / 365.25))


def split(ghi: float, ts: float, cos_zenith: float) -> tuple[float, float]:
    """(DNI, DHI) from global sunlight alone (Erbs), for services that only give the global figure."""
    if ghi <= 0 or cos_zenith < 0.02:
        return 0.0, max(ghi, 0.0)
    kt = min(ghi / (_extraterrestrial(ts) * cos_zenith), 1.0)
    if kt <= 0.22:
        kd = 1 - 0.09 * kt
    elif kt <= 0.8:
        kd = 0.9511 - 0.1604 * kt + 4.388 * kt**2 - 16.638 * kt**3 + 12.336 * kt**4
    else:
        kd = 0.165
    dhi = kd * ghi
    return (ghi - dhi) / cos_zenith, dhi


@dataclass(frozen=True)
class HourSun:
    """The sun through one hour: its position at the middle, and sunlight on the panels."""

    elevation: float
    azimuth: float
    poa: float  # mean W/m² on the panels' plane over the hour


def hour_sun(ts: int, ghi: float | None, dni: float | None, dhi: float | None, panels: Panels) -> HourSun:
    """
    The hour starting at `ts`: the sun's position at its middle, and the mean sunlight on the panels.

    The sunlight figures are the hour's means on flat ground (W/m²). The sun moves a fair way in an
    hour, so the direct beam's angle onto the panels is averaged over several points through it.
    """
    points = [position(ts + (i + 0.5) * 3600 / SUBSTEPS, panels.latitude, panels.longitude) for i in range(SUBSTEPS)]
    elevation, azimuth = position(ts + 1800, panels.latitude, panels.longitude)
    up = [(e, a) for e, a in points if e > 0]
    g = max(ghi or 0.0, 0.0)
    if not up or g <= 0:
        return HourSun(elevation, azimuth, 0.0)
    cos_zenith = sum(math.sin(math.radians(e)) for e, _ in points if e > 0) / SUBSTEPS
    if dni is None or dhi is None:
        dni, dhi = split(g, ts + 1800, cos_zenith)
    beam = sum(max(_cos_incidence(e, a, panels), 0.0) for e, a in up) / SUBSTEPS
    tilt = math.radians(panels.tilt)
    poa = max(dni, 0.0) * beam + max(dhi, 0.0) * (1 + math.cos(tilt)) / 2 + g * ALBEDO * (1 - math.cos(tilt)) / 2
    if panels.tilt == 0:
        poa = g  # flat panels see exactly the global figure
    return HourSun(elevation, azimuth, max(poa, 0.0))
