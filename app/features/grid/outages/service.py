"""
Power outages around the house, from its electricity network (the distributor that owns the poles and wires, not the
retailer): outages now within a radius, planned work coming up, and which of them reach the house's own street.

Only Queensland's networks so far (energyq.py: Energex and Ergon Energy); others slot in as providers with the same
shape. The network is worked out from where the house is (its service area), or chosen in Settings → Integrations →
Electricity network. An outage "affects you" when it lists the house's street in its suburb (home_street, home_suburb:
the street's name only, no number, entered there), or, for an outage drawn as an area, when the area covers the
house's location.

Fetched every 15 minutes (the networks refresh as often), planned work to come every hour, a network's service area
once a day. Kept in memory only.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import re
import threading
import time
from collections.abc import Callable
from typing import Any

from app.core.http import get_json
from app.features.grid.outages.energyq import NETWORKS, EnergyQueensland, OutageFeedError, Ring
from app.features.settings.store import SettingsStore

log = logging.getLogger(__name__)

EVERY = 15 * 60
FUTURE_EVERY = 3600
AREA_EVERY = 24 * 3600
PLANNED_AHEAD = 14 * 86400  # planned work nearby is listed this far ahead (work at the house's street, however far)
SOON = 86400  # planned work at the house starting within this is a warning, not just worth knowing
WIDESPREAD = (5, 2000)  # this many outages, or homes off, within the radius is more than the usual

# The kinds of street the networks abbreviate (as Australia Post does), so "Beatrice Court" matches "BEATRICE CT".
STREET_TYPES = {
    "ALLEY": ("ALLY",), "ARCADE": ("ARC",), "AVENUE": ("AVE", "AV"), "BOULEVARD": ("BVD", "BLVD"),
    "CIRCUIT": ("CCT", "CRT"), "CIRCLE": ("CIR",), "CLOSE": ("CL",), "COURT": ("CT",), "CRESCENT": ("CRES", "CR"),
    "DRIVE": ("DR",), "ESPLANADE": ("ESP",), "GARDENS": ("GDNS",), "GROVE": ("GR",), "HEIGHTS": ("HTS",),
    "HIGHWAY": ("HWY",), "LANE": ("LN",), "MEWS": ("MEWS",), "MOTORWAY": ("MWY",), "PARADE": ("PDE",),
    "PARKWAY": ("PKWY",), "PLACE": ("PL",), "PROMENADE": ("PROM",), "RIDGE": ("RDG",), "ROAD": ("RD",),
    "SQUARE": ("SQ",), "STREET": ("ST",), "TERRACE": ("TCE",), "TRACK": ("TRK",), "VIEW": ("VW",), "WAY": ("WY",),
}  # fmt: skip
_TYPE = {abbr: full for full, abbrs in STREET_TYPES.items() for abbr in (full, *abbrs)}


def street_key(s: str | None) -> str:
    """A street's name to compare: capitals, no punctuation, its type spelled out ("BEATRICE COURT")."""
    words = re.sub(r"[^A-Z0-9 ]+", " ", (s or "").upper()).split()
    if len(words) > 1 and words[-1] in _TYPE:
        words[-1] = _TYPE[words[-1]]
    return " ".join(words)


def suburb_key(s: str | None) -> str:
    return " ".join(re.sub(r"[^A-Z0-9 ]+", " ", (s or "").upper()).split())


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    """Which way from the first place the second is: N, NE, E…"""
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    deg = math.degrees(
        math.atan2(
            math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
        )
    )
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][round(((deg + 360) % 360) / 45) % 8]


def inside(lat: float, lon: float, ring: Ring) -> bool:
    """Whether a point is inside a polygon's ring (of (lon, lat)), by counting the edges a ray east of it crosses."""
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


class OutageService:
    def __init__(
        self,
        settings: SettingsStore,
        region: Callable[[], str | None],
        get: Callable[[str], Any] = lambda url: get_json(url, timeout=30),
        clock: Callable[[], float] = time.time,
        networks: dict[str, EnergyQueensland] = NETWORKS,
    ):
        self.settings = settings
        self.region = region  # the house's NEM region (GridService), to know it's in Queensland
        self.get = get
        self.clock = clock
        self.networks = networks
        self._lock = threading.Lock()
        self._areas: dict[str, tuple[float, list[Ring]]] = {}  # network -> (fetched, rings)
        self._current: list[dict[str, Any]] = []
        self._future: list[dict[str, Any]] = []
        self._network: str | None = None  # whose outages these are
        self._fetched_at: float | None = None
        self._future_at: float | None = None
        self._error: str | None = None
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    # ------------------------------------------------------------------ which network
    def network(self) -> tuple[EnergyQueensland | None, bool]:
        """The house's network, and whether it was worked out (True) rather than chosen."""
        choice = self.settings.get_choice("power_network")
        if choice == "none":
            return None, False
        if choice != "auto":
            return self.networks.get(choice), False
        if self.region() != "QLD1":
            return None, True  # only Queensland's networks so far
        lat, lon = self.settings.get("latitude"), self.settings.get("longitude")
        with self._lock:
            areas = dict(self._areas)
        for net in self.networks.values():  # Energex first: Ergon's area surrounds it
            rings = areas.get(net.id, (0, []))[1]
            if rings:
                if any(inside(lat, lon, r) for r in rings):
                    return net, True
            else:
                s, w, n, e = net.bounds
                if s <= lat <= n and w <= lon <= e:
                    return net, True
        return None, True

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
        """Fetch now (the network or the location changed). Call from the event loop."""
        if self._wake:
            self._wake.set()

    async def _run(self) -> None:
        await asyncio.sleep(5)  # after GridService has had a moment, so the region is known
        while True:
            try:
                await asyncio.to_thread(self.refresh)
            except Exception:  # a failed fetch must never end the loop
                log.exception("Fetching power outages failed")
            assert self._wake is not None
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=EVERY)
            self._wake.clear()

    def refresh(self) -> None:
        """Fetch the network's outages now, its planned work when due, and the service areas once a day."""
        now = self.clock()
        if self.settings.get_choice("power_network") == "auto" and self.region() == "QLD1":
            for each in self.networks.values():
                with self._lock:
                    fetched = self._areas.get(each.id, (0.0, []))[0]
                if now - fetched >= AREA_EVERY:
                    try:
                        rings = each.area(self.get)
                        with self._lock:
                            self._areas[each.id] = (now, rings)
                    except OutageFeedError as e:
                        log.warning("Power outages: %s", e)
        net, _ = self.network()
        if net is None:
            with self._lock:
                self._current, self._future, self._network, self._error = [], [], None, None
            return
        try:
            current = net.outages("current_unplanned", self.get) + net.outages("current_planned", self.get)
            due = net.id != self._network or self._future_at is None or now - self._future_at >= FUTURE_EVERY
            future = net.outages("future_planned", self.get) if due else None
            with self._lock:
                if net.id != self._network:
                    self._future = []
                self._current, self._network, self._fetched_at, self._error = current, net.id, now, None
                if future is not None:
                    self._future, self._future_at = future, now
        except OutageFeedError as e:
            with self._lock:
                self._error = str(e)
            log.warning("Power outages: %s", e)

    # ------------------------------------------------------------------ around the house
    def _place(self, o: dict[str, Any], lat: float, lon: float, street: str, suburb: str) -> dict[str, Any]:
        """An outage as the house sees it: how far, which way, and whether it reaches the house."""
        affects = None
        if (
            street
            and street in {street_key(s) for s in o["streets"]}
            and (not suburb or suburb in {suburb_key(s) for s in o["suburbs"]})
        ):
            affects = "street"
        elif any(inside(lat, lon, r) for r in o["area"]):
            affects = "area"
        return {
            **{k: v for k, v in o.items() if k != "area"},
            "distance_km": round(distance_km(lat, lon, o["lat"], o["lon"]), 1),
            "direction": bearing(lat, lon, o["lat"], o["lon"]),
            "affects": affects,
        }

    def around(self, now: float | None = None) -> dict[str, Any]:
        """Outages now that reach the house or are within the radius, nearest first, and planned work to come that
        reaches the house (however far ahead) or is within the radius in the next two weeks, soonest first."""
        now = self.clock() if now is None else now
        lat, lon = self.settings.get("latitude"), self.settings.get("longitude")
        radius = self.settings.get("outage_radius_km")
        street = street_key(self.settings.get_text("home_street"))
        suburb = suburb_key(self.settings.get_text("home_suburb"))
        with self._lock:
            current, future = list(self._current), list(self._future)
        placed = [self._place(o, lat, lon, street, suburb) for o in current]
        on_now = [
            o
            for o in placed
            if (o["affects"] or o["distance_km"] <= radius)
            and not (o["planned"] and o["start"] is not None and o["start"] > now)  # planned, but not started yet
        ]
        # The networks' planned work to come includes today's, already in the current file: each once, and only
        # what hasn't started (what has is an outage now).
        known = {o["id"] for o in current}
        later = [self._place(o, lat, lon, street, suburb) for o in future if o["id"] not in known] + [
            o for o in placed if o["planned"] and o["start"] is not None and o["start"] > now
        ]
        later = [o for o in later if o["start"] is None or o["start"] > now]
        ahead = [
            o
            for o in later
            if o["affects"] or (o["distance_km"] <= radius and (o["start"] or now) - now <= PLANNED_AHEAD)
        ]
        on_now.sort(key=lambda o: (o["affects"] is None, o["planned"], o["distance_km"]))
        ahead.sort(key=lambda o: (o["start"] or 0, o["distance_km"]))
        return {"now": on_now, "planned": ahead}

    def view(self) -> dict[str, Any]:
        now = self.clock()
        net, auto = self.network()
        around = self.around(now) if net else {"now": [], "planned": []}
        with self._lock:
            fetched_at, planned_at, error = self._fetched_at, self._future_at, self._error
        unplanned = [o for o in around["now"] if not o["planned"]]
        return {
            "network": {"id": net.id, "name": net.name, "site": net.site} if net else None,
            "network_auto": auto,
            "supported": self.region() == "QLD1" or self.settings.get_choice("power_network") not in ("auto", "none"),
            "radius_km": self.settings.get("outage_radius_km"),
            "street": self.settings.get_text("home_street"),
            "suburb": self.settings.get_text("home_suburb"),
            "now": around["now"],
            "planned": around["planned"],
            "summary": {
                "outages": len(unplanned),
                "customers": sum(o["customers"] or 0 for o in unplanned),
                "nearest_km": min((o["distance_km"] for o in unplanned), default=None),
            },
            "fetched_at": fetched_at if net else None,
            "planned_at": planned_at if net else None,  # planned work to come is fetched hourly, apart
            "error": error if net else None,
        }

    # ------------------------------------------------------------------ for the outlook and alerts
    def reasons(self, now: float | None = None) -> list[dict[str, Any]]:
        """What the outages mean for the grid's outlook (GridService.outlook)."""
        now = self.clock() if now is None else now
        if self.network()[0] is None:
            return []
        around = self.around(now)
        radius = self.settings.get("outage_radius_km")
        out: list[dict[str, Any]] = []
        for o in around["now"]:
            if o["affects"] and not o["planned"]:
                out.append(
                    {
                        "kind": "outage_here",
                        "level": "outage",
                        "title": "Power outage at your street" if o["affects"] == "street" else "Power outage here",
                        "detail": f"{_where(o)}: {_why(o)}{_until(o)}",
                        "at": o["start"],
                        "id": o["id"],
                    }
                )
        for o in around["now"] + around["planned"]:
            if o["affects"] and o["planned"]:
                started = o["start"] is not None and o["start"] <= now
                soon = o["start"] is not None and o["start"] - now <= SOON
                out.append(
                    {
                        "kind": "planned_here",
                        "level": "outage" if started else "warning" if soon else "watch",
                        "title": "Planned outage under way at your street"
                        if started
                        else f"Planned outage at your street {_day(o['start'], now)}",
                        "detail": f"{_span(o)}. {_where(o)}, for {(o['reason'] or 'maintenance').lower()}.",
                        "at": o["start"],
                        "id": o["id"],
                        "started": started,
                    }
                )
        nearby = [o for o in around["now"] if not o["planned"] and not o["affects"]]
        if nearby:
            homes = sum(o["customers"] or 0 for o in nearby)
            near = nearby[0]
            many = len(nearby) >= WIDESPREAD[0] or homes >= WIDESPREAD[1]
            out.append(
                {
                    "kind": "outages_nearby",
                    "level": "warning" if many else "watch",
                    "title": f"{len(nearby)} power {'outage' if len(nearby) == 1 else 'outages'} within {radius:g} km",
                    "detail": f"{homes:,} {'home' if homes == 1 else 'homes'} without power. The nearest is "
                    f"{near['distance_km']:g} km {near['direction']}, in {_suburbs(near)}.",
                    "count": len(nearby),
                    "alert": many,  # widespread: the blackout risk alert tells of it
                }
            )
        return out


def _suburbs(o: dict[str, Any]) -> str:
    names = [s.title() for s in o["suburbs"]] or ["the area"]
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def _where(o: dict[str, Any]) -> str:
    homes = o["customers"]
    return f"{_suburbs(o)}{f', {homes:,} homes' if homes and homes > 1 else ''}"


def _why(o: dict[str, Any]) -> str:
    return (o["reason"] or "cause not known yet").rstrip(". ").lower()


def _clock(ts: float) -> str:
    return time.strftime("%-I:%M %p", time.localtime(ts)).replace(":00 ", " ").lower()


def _day(ts: float | None, now: float) -> str:
    if ts is None:
        return "soon"
    days = (time.localtime(ts).tm_yday - time.localtime(now).tm_yday) % 366
    return "today" if days == 0 else "tomorrow" if days == 1 else time.strftime("on %A %-d %B", time.localtime(ts))


def _until(o: dict[str, Any]) -> str:
    if o["end"]:
        return f", expected back by {_clock(o['end'])}."
    return f" ({o['end_text'].lower()})." if o.get("end_text") else "."


def _span(o: dict[str, Any]) -> str:
    start, end = o["start"], o["end"]
    if start is None:
        return "Time not given"
    s = time.strftime("%A %-d %B", time.localtime(start)) + f", {_clock(start)}"
    return f"{s} to {_clock(end)}" if end else s
