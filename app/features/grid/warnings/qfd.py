"""
Queensland Fire Department's current bushfire warnings and incidents: where each fire is, its warning level, and for
the bigger ones the area the warning covers. Fires near the house can bring the power down, or have it turned off.

The public GeoJSON feed behind QFD's own warnings map, on the Queensland Government's public content store:

    https://publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com/content/Feeds/BushfireCurrentIncidents/bushfireAlert.json

Each feature: WarningLevel (Information, Advice, Watch and Act, Emergency Warning), WarningTitle, WarningArea or
Locality, CallToAction, Latitude/Longitude, ItemDateTimeLocal_ISO and ItemExpiryDateTimeLocal_ISO, and a Point or
the warning's Polygon.
"""

from __future__ import annotations

import datetime as dt
import json
import urllib.error
from collections.abc import Callable
from typing import Any

from app.core.http import get_json

URL = "https://publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com/content/Feeds/BushfireCurrentIncidents/bushfireAlert.json"

# Warning levels, least to most serious, as QFD (and the Australian Warning System) has them.
LEVELS = ["Information", "Advice", "Watch and Act", "Emergency Warning"]


class FireFeedError(Exception):
    """QFD's feed couldn't be fetched or read."""


def _time(s: Any) -> int | None:
    try:
        return int(dt.datetime.fromisoformat(str(s)).timestamp()) if s else None
    except ValueError:
        return None


def _level(s: Any) -> str:
    text = str(s or "").strip().lower()
    for level in LEVELS[::-1]:
        if level.lower() in text:
            return level
    return "Information"


def fire(feature: dict[str, Any]) -> dict[str, Any] | None:
    """One fire or warning from the feed, or None if it can't be placed."""
    p = feature.get("properties") or {}
    g = feature.get("geometry") or {}
    rings: list[list[tuple[float, float]]] = []
    if g.get("type") == "Polygon":
        try:
            rings = [[(float(y), float(x)) for x, y, *_ in g["coordinates"][0]]]  # (lat, lon)
        except (KeyError, TypeError, ValueError, IndexError):
            rings = []
    try:
        lat, lon = float(p["Latitude"]), float(p["Longitude"])
    except (KeyError, TypeError, ValueError):
        if g.get("type") == "Point":
            try:
                lon, lat = float(g["coordinates"][0]), float(g["coordinates"][1])
            except (KeyError, TypeError, ValueError, IndexError):
                return None
        elif rings:
            lat = sum(y for y, _ in rings[0]) / len(rings[0])
            lon = sum(x for _, x in rings[0]) / len(rings[0])
        else:
            return None
    area = str(p.get("WarningArea") or p.get("Locality") or "").strip()
    return {
        "id": f"qfd:{p.get('UniqueID') or p.get('OBJECTID')}",
        "level": _level(p.get("WarningLevel")),
        "title": str(p.get("WarningTitle") or "").strip(),
        "area": area.title() if area.isupper() else area,
        "action": str(p.get("CallToAction") or "").strip() or None,
        "status": str(p.get("CurrentStatus") or "").strip() or None,
        "kind": str(p.get("GroupedType") or p.get("EventType") or "Fire").strip(),
        "at": _time(p.get("ItemDateTimeLocal_ISO")),
        "lat": lat,
        "lon": lon,
        "polygons": rings,
    }


def fetch(get: Callable[[str], Any] = lambda url: get_json(url, timeout=30)) -> list[dict[str, Any]]:
    try:
        data = get(URL)
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError) as e:
        raise FireFeedError("Queensland Fire Department's warnings couldn't be fetched right now.") from e
    out = [fire(f) for f in (data.get("features") or [])] if isinstance(data, dict) else []
    return [f for f in out if f]
