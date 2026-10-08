"""
Official warnings for where the house is, as early signs the power may go: the Bureau of Meteorology's (bom.py) for
severe thunderstorms, severe weather, cyclones, floods and fire weather, and in Queensland the Fire Department's
bushfire warnings and incidents (qfd.py). They feed the Grid page's outlook and its blackout risk alert.

Matched here, on the dashboard: the Bureau's by the house's districts (from its nearest forecast town, looked up once
a day) and any polygon around it; fires by their warning area around the house, or how far away they are. Fetched
every 10 minutes, kept in memory. Turned off with the hazard_warnings setting.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import threading
import time
from collections.abc import Callable
from typing import Any

from app.features.grid.warnings import bom, qfd
from app.features.settings.store import SettingsStore

log = logging.getLogger(__name__)

EVERY = 600
PLACES_EVERY = 24 * 3600
FIRE_INFO_KM = 10  # a fire with no warning (Information) counts only this close; warnings count within the radius

# What each kind of Bureau warning means for the power: how serious for the outlook, and whether it's one the blackout
# risk alert tells of.
SEVERE = ("thunderstorm", "severe weather", "cyclone", "damaging wind", "destructive")


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _direction(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    deg = math.degrees(
        math.atan2(
            math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
        )
    )
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][round(((deg + 360) % 360) / 45) % 8]


def weather_level(w: dict[str, Any]) -> str:
    """How serious a Bureau warning is for the power: warning (keep the battery charged) or watch."""
    text = f"{w['event']} {w['headline']}".lower()
    if any(k in text for k in SEVERE):
        return "warning"
    if "flood" in text and ("major" in text or w.get("severity") in ("Severe", "Extreme")):
        return "warning"
    if "fire weather" in text and ("catastrophic" in text or w.get("severity") == "Extreme"):
        return "warning"
    return "watch"


class HazardService:
    def __init__(
        self,
        settings: SettingsStore,
        region: Callable[[], str | None],
        ftp: bom.BomFtp | None = None,
        fires: Callable[[], list[dict[str, Any]]] = qfd.fetch,
        clock: Callable[[], float] = time.time,
    ):
        self.settings = settings
        self.region = region  # the house's NEM region (GridService): fires are only fetched in Queensland
        self.ftp = ftp or bom.BomFtp()
        self.fires = fires
        self.clock = clock
        self._lock = threading.Lock()
        self._places: tuple[float, list[dict[str, str]], list[dict[str, str]]] | None = None  # fetched, towns, gauges
        self._place: dict[str, Any] | None = None
        self._place_for: tuple[float, float] | None = None
        self._weather: list[dict[str, Any]] = []
        self._fire: list[dict[str, Any]] = []
        self._fetched_at: float | None = None
        self._error: str | None = None
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    def enabled(self) -> bool:
        return bool(self.settings.get("hazard_warnings"))

    # ------------------------------------------------------------------ fetching
    async def start(self) -> None:
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def wake(self) -> None:
        """Fetch now (the location or the setting changed). Call from the event loop."""
        if self._wake:
            self._wake.set()

    async def _run(self) -> None:
        await asyncio.sleep(8)
        while True:
            if self.enabled():
                try:
                    await asyncio.to_thread(self.refresh)
                except Exception:  # a failed fetch must never end the loop
                    log.exception("Fetching weather and fire warnings failed")
            assert self._wake is not None
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=EVERY)
            self._wake.clear()

    def place(self) -> dict[str, Any] | None:
        """Where the house is in the Bureau's areas (its nearest forecast town, districts and catchments)."""
        now = self.clock()
        lat, lon = self.settings.get("latitude"), self.settings.get("longitude")
        with self._lock:
            places = self._places
        if places is None or now - places[0] >= PLACES_EVERY:
            files = self.ftp.files(bom.SPATIAL, lambda n: n in (bom.TOWNS, bom.GAUGES))
            towns = bom.read_dbf(files[bom.TOWNS])
            gauges = bom.read_dbf(files[bom.GAUGES]) if bom.GAUGES in files else []
            places = (now, towns, gauges)
            with self._lock:
                self._places, self._place_for = places, None
        with self._lock:
            if self._place_for != (lat, lon):
                self._place, self._place_for = bom.districts_at(lat, lon, places[1], places[2]), (lat, lon)
            return self._place

    def refresh(self) -> None:
        errors = []
        try:
            place = self.place()
            prefix = bom.PREFIX.get((place or {}).get("state") or "")
            weather: list[dict[str, Any]] = []
            if prefix:
                files = self.ftp.files(bom.WARNINGS, lambda n: n.startswith(prefix) and n.endswith(".cap.xml"))
                weather = [w for w in (bom.parse_cap(b.decode("utf-8", "replace")) for b in files.values()) if w]
            with self._lock:
                self._weather = weather
        except Exception as e:  # FTP and parsing errors alike: keep what was there
            log.warning("Bureau of Meteorology warnings: %s", e)
            errors.append("The Bureau of Meteorology's warnings couldn't be fetched right now.")
        if self.region() == "QLD1":
            try:
                fires = self.fires()
                with self._lock:
                    self._fire = fires
            except qfd.FireFeedError as e:
                errors.append(str(e))
        else:
            with self._lock:
                self._fire = []
        with self._lock:
            self._fetched_at, self._error = self.clock(), " ".join(errors) or None

    # ------------------------------------------------------------------ around the house
    def around(self, now: float | None = None) -> dict[str, Any]:
        """The Bureau's warnings for the house's districts (or drawn around it), and fires with a warning within the
        radius (or whose warning area covers the house), or without one, close by. Most serious first."""
        now = self.clock() if now is None else now
        if not self.enabled():
            return {"weather": [], "fires": []}
        lat, lon = self.settings.get("latitude"), self.settings.get("longitude")
        radius = self.settings.get("outage_radius_km")
        with self._lock:
            place, weather, fires = self._place, list(self._weather), list(self._fire)
        codes = set((place or {}).get("codes") or [])
        mine = []
        for w in weather:
            if w.get("expires") and w["expires"] < now:
                continue
            here = any(bom.inside(lat, lon, r) for r in w["polygons"])
            if here or codes & set(w["codes"]):
                mine.append(
                    {
                        **{k: v for k, v in w.items() if k not in ("polygons", "codes")},
                        "level": weather_level(w),
                        "here": here,
                    }
                )
        near = []
        for f in fires:
            here = any(bom.inside(lat, lon, r) for r in f["polygons"])
            km = 0.0 if here else _km(lat, lon, f["lat"], f["lon"])
            warned = f["level"] != "Information"
            if here or km <= (radius if warned else min(radius, FIRE_INFO_KM)):
                near.append(
                    {
                        **{k: v for k, v in f.items() if k != "polygons"},
                        "here": here,
                        "distance_km": round(km, 1),
                        "direction": None if here else _direction(lat, lon, f["lat"], f["lon"]),
                    }
                )
        mine.sort(key=lambda w: (w["level"] != "warning", -(w.get("effective") or 0)))
        near.sort(key=lambda f: (-qfd.LEVELS.index(f["level"]), f["distance_km"]))
        return {"weather": mine, "fires": near}

    def view(self) -> dict[str, Any]:
        around = self.around()
        with self._lock:
            place, fetched_at, error = self._place, self._fetched_at, self._error
        return {
            "enabled": self.enabled(),
            "town": (place or {}).get("town"),
            "fires_followed": self.region() == "QLD1",
            "radius_km": self.settings.get("outage_radius_km"),
            **around,
            "fetched_at": fetched_at,
            "error": error if self.enabled() else None,
        }

    def reasons(self, now: float | None = None) -> list[dict[str, Any]]:
        """What the warnings mean for the grid's outlook (GridService.outlook)."""
        around = self.around(now)
        out: list[dict[str, Any]] = []
        for w in around["weather"]:
            until = f" until {time.strftime('%-I:%M %p', time.localtime(w['expires']))}" if w.get("expires") else ""
            out.append(
                {
                    "kind": "bom",
                    "id": w["id"],
                    "level": w["level"],
                    "title": w["headline"] or w["event"],
                    "detail": f"From the Bureau of Meteorology{until}. Storms, wind and floods are what bring power "
                    "lines down.",
                    "at": w.get("effective"),
                    "alert": w["level"] == "warning",
                }
            )
        for f in around["fires"]:
            if f["level"] == "Information":
                continue  # a fire with no warning: on the page, not the outlook
            serious = f["level"] in ("Watch and Act", "Emergency Warning")
            where = "your area" if f["here"] else f"{f['area'] or 'a fire'}, {f['distance_km']:g} km {f['direction']}"
            out.append(
                {
                    "kind": "fire",
                    "id": f["id"],
                    "level": "warning" if serious else "watch",
                    "title": f"Bushfire {f['level'].lower()}: {f['area']}"
                    if f["area"]
                    else f"Bushfire {f['level'].lower()}",
                    "detail": f"Queensland Fire Department, for {where}. "
                    + (f"{f['action']}. " if f["action"] else "")
                    + "Fires can bring power lines down, or have them turned off.",
                    "at": f.get("at"),
                    "alert": serious,
                }
            )
        return out
