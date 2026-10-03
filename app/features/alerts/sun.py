"""
Where the sun is, for alerts that only make sense in daylight.

A string inverter like the SG5K-D powers down after dark and wakes once its panels make enough
voltage, so "it isn't answering" only means something while the sun is well up. The clock can't
say when that is (sunrise in Brisbane moves by 70 minutes over the year, and differs by location),
so this works it out from the forecast location. The formula is the usual low-precision one from
the Astronomical Almanac: within a degree or so, which is plenty here, and needs no network.
"""

from __future__ import annotations

import math

STEP = 300  # seconds between checks when looking back for sunrise

# The sun's height (degrees above the horizon) from which it counts as daylight for alerts: a
# little after sunrise, when panels make enough voltage to wake a string inverter.
DAYLIGHT = 10.0


def elevation(lat: float, lon: float, ts: float) -> float:
    """The sun's height above the horizon in degrees (negative below it) at unix time `ts`."""
    d = ts / 86400 - 10957.5  # days since 2000-01-01 12:00 UTC
    g = math.radians((357.529 + 0.98560028 * d) % 360)  # mean anomaly
    q = (280.459 + 0.98564736 * d) % 360  # mean longitude
    ecliptic = math.radians(q + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    tilt = math.radians(23.439 - 0.00000036 * d)
    ra = math.atan2(math.cos(tilt) * math.sin(ecliptic), math.cos(ecliptic))
    dec = math.asin(math.sin(tilt) * math.sin(ecliptic))
    sidereal = math.radians(((18.697374558 + 24.06570982441908 * d) % 24) * 15 + lon)
    hour_angle = sidereal - ra
    phi = math.radians(lat)
    sin_alt = math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(hour_angle)
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))


def daylight_since(lat: float, lon: float, now: float, above: float = DAYLIGHT) -> float | None:
    """When the sun last rose above `above` degrees, to within STEP; None if it's below that now."""
    if elevation(lat, lon, now) < above:
        return None
    t = now
    while t > now - 86400:  # the midnight sun never sets: call it a day
        if elevation(lat, lon, t - STEP) < above:
            return t
        t -= STEP
    return now - 86400
