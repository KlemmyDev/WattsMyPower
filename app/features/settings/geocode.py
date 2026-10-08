"""
Place search and reverse lookup for the forecast location, using OpenStreetMap's
Nominatim service (free, no key). Per its usage policy we identify ourselves, send at
most one request a second, and only search when asked (no search-as-you-type).
Results are cached.

Names are kept at suburb level ("Paddington, QLD") even when an exact address was
searched, so a home address isn't stored or shown anywhere. The one exception is opt-in:
the street's name (never its number) and suburb, saved for matching the electricity
network's outages (Settings → Integrations → Electricity network).
"""

from __future__ import annotations

import threading
import time
import urllib.parse
from typing import Any

from app.core.cache import TTLCache
from app.core.http import get_json

BASE = "https://nominatim.openstreetmap.org"
CACHE_SECONDS = 24 * 3600


def town_of(a: dict[str, Any]) -> str | None:
    """The suburb, town or village of an address."""
    return (
        a.get("suburb") or a.get("town") or a.get("village") or a.get("hamlet")
        or a.get("city_district") or a.get("city") or a.get("county")
    )  # fmt: skip


def place_name(a: dict[str, Any]) -> str:
    """Suburb-level name: "Paddington, QLD" (state as its short code where there is one)."""
    town = town_of(a)
    region = (a.get("ISO3166-2-lvl4") or "").split("-")[-1] or a.get("state")
    return ", ".join(p for p in (town, region) if p) or a.get("country", "")


class Geocoder:
    def __init__(self) -> None:
        self._cache = TTLCache()
        self._lock = threading.Lock()
        self._last = 0.0

    def _get(self, path: str, params: dict[str, Any]) -> Any:
        url = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"

        def fetch() -> Any:
            with self._lock:  # at most one request a second
                wait = 1.0 - (time.time() - self._last)
                if wait > 0:
                    time.sleep(wait)
                try:
                    return get_json(url, headers={"Accept-Language": "en-AU,en"}, timeout=10)
                finally:
                    self._last = time.time()

        return self._cache.get_or_load(url, CACHE_SECONDS, fetch)

    def search(self, query: str) -> list[dict[str, Any]]:
        q = (query or "").strip()
        if len(q) < 3:
            raise ValueError("Enter at least three letters of a suburb, town or address.")
        rows = self._get("search", {"q": q[:200], "format": "jsonv2", "addressdetails": 1, "limit": 6})
        out, seen = [], set()
        for r in rows:
            a = r.get("address") or {}
            street = " ".join(p for p in (a.get("house_number"), a.get("road")) if p)
            place = place_name(a)
            key = (street, place, a.get("postcode"))  # the same suburb often comes back twice, a few metres apart
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "label": f"{street}, {place}" if street else place,
                    "detail": ", ".join(p for p in (a.get("postcode"), a.get("country")) if p),
                    "name": place,  # what gets saved
                    # For the electricity network's outages, when chosen there: the street's name and suburb.
                    "road": a.get("road"),
                    "suburb": town_of(a),
                    "latitude": round(float(r["lat"]), 4),
                    "longitude": round(float(r["lon"]), 4),
                }
            )
        return out

    def reverse(self, lat: float, lon: float) -> str | None:
        """Suburb-level name for coordinates, or None if the lookup fails."""
        try:
            params = {"lat": round(lat, 4), "lon": round(lon, 4), "format": "jsonv2", "addressdetails": 1, "zoom": 14}
            r = self._get("reverse", params)
            return place_name(r.get("address") or {}) or None
        except Exception:
            return None
