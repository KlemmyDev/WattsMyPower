"""
Place search and reverse lookup for the forecast location, using OpenStreetMap's
Nominatim service (free, no key). Per its usage policy we identify ourselves,
send at most one request a second, and only search when asked (no search-as-
you-type). Results are cached.

Names are kept at suburb level ("Paddington, QLD") even when an exact address
was searched, so a home address isn't stored or shown anywhere.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request

BASE = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "WattsMyPower/1.0 (self-hosted solar dashboard)", "Accept-Language": "en-AU,en"}
CACHE_SECONDS = 24 * 3600

_lock = threading.Lock()
_last = 0.0
_cache: dict[str, tuple[float, object]] = {}


def _get(path: str, params: dict):
    global _last
    url = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    with _lock:  # at most one request a second
        wait = 1.0 - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=10) as r:
                data = json.load(r)
        finally:
            _last = time.time()
    _cache[url] = (time.time(), data)
    return data


def _place(a: dict) -> str:
    """Suburb-level name: "Paddington, QLD" (state as its short code where there is one)."""
    town = a.get("suburb") or a.get("town") or a.get("village") or a.get("hamlet") or a.get("city_district") or a.get("city") or a.get("county")
    region = (a.get("ISO3166-2-lvl4") or "").split("-")[-1] or a.get("state")
    return ", ".join(p for p in (town, region) if p) or a.get("country", "")


def search(query: str) -> list[dict]:
    q = (query or "").strip()
    if len(q) < 3:
        raise ValueError("Enter at least three letters of a suburb, town or address.")
    rows = _get("search", {"q": q[:200], "format": "jsonv2", "addressdetails": 1, "limit": 6})
    out, seen = [], set()
    for r in rows:
        a = r.get("address") or {}
        street = " ".join(p for p in (a.get("house_number"), a.get("road")) if p)
        place = _place(a)
        lat, lon = round(float(r["lat"]), 4), round(float(r["lon"]), 4)
        key = (street, place, a.get("postcode"))  # the same suburb often comes back twice, a few metres apart
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "label": f"{street}, {place}" if street else place,
            "detail": ", ".join(p for p in (a.get("postcode"), a.get("country")) if p),
            "name": place,  # what gets saved
            "latitude": lat, "longitude": lon,
        })
    return out


def reverse(lat: float, lon: float) -> str | None:
    """Suburb-level name for coordinates, or None if the lookup fails."""
    try:
        r = _get("reverse", {"lat": round(lat, 4), "lon": round(lon, 4), "format": "jsonv2", "addressdetails": 1, "zoom": 14})
        return _place(r.get("address") or {}) or None
    except Exception:
        return None
