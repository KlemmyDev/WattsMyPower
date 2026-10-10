"""
Power outages around the house, from its electricity network (the distributor that owns the poles and wires, not the
retailer): outages now within a radius, planned work coming up, and which of them reach the house's own street.

Every state's and territory's networks but the Northern Territory's (networks.py: one module per state, each network a
provider with the same shape, base.py). The network is worked out from where the house is, or chosen in Manage →
Integrations → Grid. Worked out, the house's state comes from its NEM region (or, in Western Australia, its place name
or longitude), and each of that state's networks is asked whether it serves the house: from its service area (Energex,
Ergon, Ausgrid), Victoria's suburb list (the house's suburb), the place name (the ACT), or else its rough bounds. The
first that's sure is followed alone; when none is (a house near where two networks meet, or in a suburb split between
them), every one that might is followed, and their outages are matched to the house together.

An outage "affects you" when it lists the house's street in its suburb (home_street, home_suburb: the street's name
only, no number, entered there), or, for an outage drawn as an area, when the area covers the house's location.

Fetched about every 15 minutes (the networks refresh as often; give or take a few, at random), planned work to come
every hour, what tells where a network is once a day, and the areas of outages near the house that a feed only draws
when asked, once each (an hour for outages now, whose area changes as power comes back). Kept in memory only.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import random
import re
import threading
import time
from collections.abc import Callable
from typing import Any

from app.features.grid.outages.base import (
    Around,
    Get,
    House,
    OutageFeedError,
    Provider,
    Ring,
    distance_km,
    fetch,
    inside,
)
from app.features.grid.outages.networks import NETWORKS, place_state, place_suburb, states_for
from app.features.settings.store import SettingsStore

log = logging.getLogger(__name__)

EVERY = 15 * 60
JITTER = 0.2  # each wait is EVERY give or take this much, so the fetches don't land like clockwork
FUTURE_EVERY = 3600
AREA_EVERY = 24 * 3600
PLANNED_AHEAD = 14 * 86400  # planned work nearby is listed this far ahead (work at the house's street, however far)
SOON = 86400  # planned work at the house starting within this is a warning, not just worth knowing
WIDESPREAD = (5, 2000)  # this many outages, or homes off, within the radius is more than the usual
AREAS_EACH_TIME = 20  # outages' areas asked for at most per fetch (the nearest first)
AREA_KEPT = 3600  # an outage's area, asked for, is asked for again after this while it's on (planned work's isn't)

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

__all__ = ["NETWORKS", "OutageService", "bearing", "distance_km", "inside", "next_wait", "street_key", "suburb_key"]


def street_key(s: str | None) -> str:
    """A street's name to compare: capitals, no punctuation, its type spelled out ("BEATRICE COURT")."""
    words = re.sub(r"[^A-Z0-9 ]+", " ", (s or "").upper()).split()
    if len(words) > 1 and words[-1] in _TYPE:
        words[-1] = _TYPE[words[-1]]
    return " ".join(words)


def suburb_key(s: str | None) -> str:
    return " ".join(re.sub(r"[^A-Z0-9 ]+", " ", (s or "").upper()).split())


def bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    """Which way from the first place the second is: N, NE, E…"""
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    deg = math.degrees(
        math.atan2(
            math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
        )
    )
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][round(((deg + 360) % 360) / 45) % 8]


def next_wait(rand: Callable[[float, float], float] = random.uniform) -> float:
    """Seconds until the next fetch: EVERY, give or take JITTER (12 to 18 minutes)."""
    return EVERY * rand(1 - JITTER, 1 + JITTER)


class OutageService:
    def __init__(
        self,
        settings: SettingsStore,
        region: Callable[[], str | None],
        get: Get = fetch,
        clock: Callable[[], float] = time.time,
        networks: dict[str, Provider] = NETWORKS,
    ):
        self.settings = settings
        self.region = region  # the house's NEM region (GridService), to know which state's networks to ask
        self.get = get
        self.clock = clock
        self.networks = networks
        self._lock = threading.Lock()
        self._where: dict[str, tuple[float, Any]] = {}  # where_key -> (fetched, what tells where the network is)
        self._current: dict[str, list[dict[str, Any]]] = {}  # network -> its outages now
        self._future: dict[str, list[dict[str, Any]]] = {}  # network -> its planned work to come
        self._fetched_at: dict[str, float] = {}
        self._future_at: dict[str, float] = {}
        self._areas: dict[str, tuple[float, list[Ring]]] = {}  # outage -> (asked, its area), for feeds drawn apart
        self._error: str | None = None
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    # ------------------------------------------------------------------ which network
    def _house(self) -> House | None:
        """The house, for telling its network: None until its location has been chosen."""
        where = self.settings.location()
        if where is None:
            return None
        place = self.settings.get_text("location_name")
        suburb = suburb_key(self.settings.get_text("home_suburb")) or place_suburb(place)
        return House(where[0], where[1], suburb, place_state(place))

    def _candidates(self) -> list[Provider]:
        """The networks in the house's state (and the ACT with NSW), in the order they're asked."""
        h = self._house()
        if h is None:
            return []
        states = states_for(self.region(), self.settings.get_text("location_name"), h.lat, h.lon)
        return [n for n in self.networks.values() if n.state in states]

    def followed(self) -> tuple[Provider | None, list[Provider], bool]:
        """The house's network, every network whose outages are followed (it first), and whether they were worked
        out (True) rather than chosen. None until the house's location has been chosen: what's around it can't be
        told without it."""
        choice = self.settings.get_choice("power_network")
        house = self._house()
        if choice == "none" or (house is None and choice != "auto"):
            return None, [], False
        if choice != "auto":
            net = self.networks.get(choice)
            return net, [net] if net else [], False
        if house is None:
            return None, [], True
        with self._lock:
            where = {k: v for k, (_, v) in self._where.items()}
        maybe: list[Provider] = []
        for net in self._candidates():
            serves = net.serves(house, where.get(net.where_key))
            if serves:
                return net, [net], True
            if serves is None:
                maybe.append(net)
        return (maybe[0] if maybe else None), maybe, True

    def network(self) -> tuple[Provider | None, bool]:
        """The house's network, and whether it was worked out (True) rather than chosen."""
        net, _, auto = self.followed()
        return net, auto

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
        """Fetch now (the network, the location or the radius changed). Call from the event loop."""
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
                await asyncio.wait_for(self._wake.wait(), timeout=next_wait())
            self._wake.clear()

    def _refresh_where(self, now: float) -> None:
        """What tells where each of the state's networks is, once a day (shared ones once)."""
        for net in self._candidates():
            with self._lock:
                fetched = self._where.get(net.where_key, (0.0, None))[0]
            if now - fetched < AREA_EVERY:
                continue
            try:
                found = net.where(self.get)
            except OutageFeedError as e:
                log.warning("Power outages: %s", e)
                continue
            with self._lock:
                self._where[net.where_key] = (now, found)

    def refresh(self) -> None:
        """Fetch the followed networks' outages now, their planned work when due, where they are once a day, and the
        areas of outages near the house that their feeds draw apart."""
        now = self.clock()
        if self.settings.get_choice("power_network") == "auto":
            self._refresh_where(now)
        _, nets, _ = self.followed()
        where = self.settings.location()
        if where is None:
            nets = []  # (followed() gives none until there's a location)
        around = Around(*(where or (0.0, 0.0)), self.settings.get("outage_radius_km"), now)
        errors: list[str] = []
        for net in nets:
            try:
                current = net.outages("current", self.get, around)
                with self._lock:
                    due = net.id not in self._future_at or now - self._future_at[net.id] >= FUTURE_EVERY
                future = net.outages("future", self.get, around) if due else None
            except OutageFeedError as e:
                errors.append(str(e))
                log.warning("Power outages: %s", e)
                continue
            with self._lock:
                self._current[net.id], self._fetched_at[net.id] = current, now
                if future is not None:
                    self._future[net.id], self._future_at[net.id] = future, now
        ids = {n.id for n in nets}
        with self._lock:
            for kept in (self._current, self._future, self._fetched_at, self._future_at):
                for k in [k for k in kept if k not in ids]:  # no longer followed: its outages aren't the house's
                    del kept[k]
            self._error = " ".join(errors) or None
        for net in nets:
            self._fill_areas(net, around)

    def _fill_areas(self, net: Provider, around: Around) -> None:
        """Ask for the areas of the network's outages near the house that its feed doesn't draw: those within the
        radius on now or starting in the next day or two, nearest first, each once (an hour, while it's on)."""
        now = around.now
        with self._lock:
            mine = self._current.get(net.id, []) + self._future.get(net.id, [])
            asked = dict(self._areas)
        want: list[tuple[float, dict[str, Any]]] = []
        for o in mine:
            if o["area"] or o["lat"] is None:
                continue
            if o["planned"] and o["start"] is not None and o["start"] - now > 2 * SOON:
                continue
            at = asked.get(o["id"])
            if at and (o["planned"] or now - at[0] < AREA_KEPT):
                continue
            km = distance_km(around.lat, around.lon, o["lat"], o["lon"])
            if km <= around.km:
                want.append((km, o))
        want.sort(key=lambda w: w[0])
        ask = [o for _, o in want[:AREAS_EACH_TIME]]
        found: dict[str, list[Ring]] | None = {}
        if ask:
            try:
                found = net.areas(ask, self.get)
            except OutageFeedError as e:
                found = None  # tried again next time
                log.warning("Power outages: %s", e)
        live = {o["id"] for o in mine}
        with self._lock:
            for o in ask if found is not None else []:  # one it gave no area for isn't asked about again for a while
                self._areas[o["id"]] = (now, found.get(o["id"], []) if found else [])
            for oid in [k for k, (_, _r) in self._areas.items() if k.split(":", 1)[0] == net.id and k not in live]:
                del self._areas[oid]  # over: no longer on the map

    # ------------------------------------------------------------------ around the house
    def _place(
        self, o: dict[str, Any], lat: float, lon: float, street: str, suburb: str, areas: dict[str, Any]
    ) -> dict[str, Any] | None:
        """An outage as the house sees it: how far, which way, and whether it reaches the house. None for one listed
        only by street (no place on the map) that doesn't list the house's."""
        area = o["area"] or areas.get(o["id"], (0, []))[1]
        affects = None
        if (
            street
            and street in {street_key(s) for s in o["streets"]}
            and (not suburb or suburb in {suburb_key(s) for s in o["suburbs"]})
        ):
            affects = "street"
        elif any(inside(lat, lon, r) for r in area):
            affects = "area"
        if o["lat"] is None:  # nowhere to put it but the street it lists: the house's, or it doesn't count
            if affects != "street":
                return None
            o = {**o, "lat": lat, "lon": lon}
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
        where = self.settings.location()
        if where is None:
            return {"now": [], "planned": []}
        lat, lon = where
        radius = self.settings.get("outage_radius_km")
        street = street_key(self.settings.get_text("home_street"))
        suburb = suburb_key(self.settings.get_text("home_suburb"))
        _, nets, _ = self.followed()
        with self._lock:
            current = [o for n in nets for o in self._current.get(n.id, [])]
            future = [o for n in nets for o in self._future.get(n.id, [])]
            areas = dict(self._areas)

        def place(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [p for p in (self._place(o, lat, lon, street, suburb, areas) for o in items) if p]

        placed = place(current)
        on_now = [
            o
            for o in placed
            if (o["affects"] or o["distance_km"] <= radius)
            and not (o["planned"] and o["start"] is not None and o["start"] > now)  # planned, but not started yet
        ]
        # The networks' planned work to come includes today's, already in the current file: each once, and only
        # what hasn't started (what has is an outage now).
        known = {o["id"] for o in current}
        later = place([o for o in future if o["id"] not in known]) + [
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
        net, nets, auto = self.followed()
        around = self.around(now) if net else {"now": [], "planned": []}
        with self._lock:
            fetched_at = self._fetched_at.get(net.id) if net else None
            planned_at = self._future_at.get(net.id) if net else None
            error = self._error
        unplanned = [o for o in around["now"] if not o["planned"]]
        choice = self.settings.get_choice("power_network")
        return {
            "network": {"id": net.id, "name": net.name, "site": net.site} if net else None,
            # Every network followed, the house's first: more than one where it can't be told which serves it.
            "networks": [{"id": n.id, "name": n.name, "site": n.site} for n in nets],
            "network_auto": auto,
            # Whether the house's location has been chosen: no outages are followed until it is.
            "location_set": self.settings.location_set(),
            "supported": bool(self._candidates()) or choice not in ("auto", "none"),
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
            "fetched_at": fetched_at,
            "planned_at": planned_at,  # planned work to come is fetched hourly, apart
            "error": error if net else None,
        }

    # ------------------------------------------------------------------ for the outlook
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
