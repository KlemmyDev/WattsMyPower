"""
Victoria's five networks: CitiPower (inner Melbourne), Powercor (the west and centre of the state), Jemena (Melbourne's
north-west), United Energy (Melbourne's south-east and the Mornington Peninsula) and AusNet Services (the east and
north-east, and Melbourne's outer east and north).

None has an API: these are the feeds behind each network's own outage map, public and the same for everyone, and can
change without notice. Times are Melbourne's.

AusNet         outagetrackerservice.ausnetservices.com.au/api/v1/outages/combinedoutage   everything, planned and not
               …/outageboundary/{id}   an outage's area, asked for only for those near the house. The feed is on its
               own host: the main site's robots.txt asks robots to keep out of its /api/, which isn't asked of here
CitiPower and  s3-ap-southeast-2.amazonaws.com/cppc-outage/outages.json   both networks' outages now, with their areas
Powercor       (there's no feed of their planned work to come)
Jemena         poweroutages.jemena.com.au/data/all-outages.json   outages now; a job's areas are its History's parts
               www.jemena.com.au/api/ElectricityOutage/electricity-outage   planned work to come, street by street: no
               place, no year, no id, so it's matched only to the house's own street
United Energy  ds5ykmduea4ri.cloudfront.net/outages-v2.json   outages now, with their areas
               …/network-locator.json   every suburb (and postcode) with its network, for telling which serves a house
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.features.grid.outages.base import (
    MELBOURNE,
    Around,
    Get,
    House,
    OutageFeedError,
    Provider,
    Ring,
    ask,
    gone,
    in_bounds,
    job,
    kept,
    leftover,
    outage,
    ring_of,
    rings_of,
    split,
    suburb_of,
    to_float,
    when,
    with_query,
)

LOCATOR = "https://ds5ykmduea4ri.cloudfront.net/network-locator.json"
DISTRIBUTORS = {
    "CITIPOWER": "citipower",
    "POWERCOR": "powercor",
    "JEMENA": "jemena",
    "UNITED ENERGY": "united",
    "AUSNET SERVICES": "ausnet",
    "AUSNET": "ausnet",
}


def locator(data: Any) -> dict[str, list[str]]:
    """Each suburb (capitals) and the networks that serve some of it."""
    out: dict[str, list[str]] = {}
    for row in data if isinstance(data, list) else []:
        if not isinstance(row, dict):
            continue
        suburb = " ".join(str(row.get("suburb") or "").upper().split())
        net = DISTRIBUTORS.get(" ".join(str(row.get("distributor") or "").upper().split()))
        if suburb and net and net not in out.setdefault(suburb, []):
            out[suburb].append(net)
    return out


@dataclass(frozen=True)
class Victorian(Provider):
    """A Victorian network: which serves a house is in the networks' suburb list, shared by all five."""

    @property
    def where_key(self) -> str:
        return "vic-locator"

    def where(self, get: Get) -> dict[str, list[str]]:
        return locator(ask("Victoria's network finder", get, LOCATOR))

    def serves(self, house: House, where: Any) -> bool | None:
        nets = where.get(house.suburb) if isinstance(where, dict) and house.suburb else None
        if nets:  # a suburb split between networks: each of them might
            return (True if len(nets) == 1 else None) if self.id in nets else False
        return None if in_bounds(self.bounds, house.lat, house.lon) else False


# ---------------------------------------------------------------------- AusNet Services
AUSNET_FEED = "https://outagetrackerservice.ausnetservices.com.au/api/v1/outages"
AUSNET_TIME = "%Y-%m-%d %I:%M%p"  # "2026-10-10 06:24PM"


def ausnet_outage(o: dict[str, Any], now: float) -> dict[str, Any] | None:
    """One of AusNet's: type Planned/Unplanned, incidentStatus In Progress, Pre-Arranged, Awaiting, or Cancelled,
    Completed (left out). The feed keeps jobs for months and years, some still Pre-Arranged or In Progress with
    nobody off (nmiCount 0): those, and the restored, are left out too."""
    if gone(o.get("incidentStatus")) or gone(o.get("status")) or o.get("actualTimeOfRestoration"):
        return None
    if not (o.get("nmiCount") or 0):
        return None
    planned = str(o.get("type") or "").lower() == "planned"
    lat, lon = to_float(o.get("latitude")), to_float(o.get("longitude"))
    start = when(o.get("plannedStartTime"), MELBOURNE, AUSNET_TIME) if planned else None
    end = when(o.get("plannedEndTime"), MELBOURNE, AUSNET_TIME) if planned else None
    details = [d for d in o.get("details") or [] if isinstance(d, dict)]
    out = outage(
        "ausnet",
        o.get("id") or o.get("incident"),
        planned=planned,
        status=o.get("incidentStatus"),
        reason=o.get("cause"),
        customers=o.get("nmiCount"),
        start=start or when(o.get("unplannedStartTime"), MELBOURNE, AUSNET_TIME),
        end=end or when(o.get("latestEstimatedTimeToRestoration"), MELBOURNE, AUSNET_TIME),
        suburbs=[str(d.get("townName") or "").strip() for d in details if d.get("townName")],
        point=(lon, lat) if lat is not None and lon is not None else None,
    )
    return None if out is None or leftover(out, now) else out


@dataclass(frozen=True)
class AusNet(Victorian):
    def link(self, o: Mapping[str, Any]) -> tuple[str, bool]:
        """AusNet's outage tracker opens an outage by its incident number."""
        return with_query("https://www.outagetracker.com.au/", incident=job(o)), True

    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future" or around is None:
            return []  # the one feed has planned work too
        data = ask(self.name, get, f"{AUSNET_FEED}/combinedoutage")
        items = data.get("data") if isinstance(data, dict) else None
        return kept(ausnet_outage(o, around.now) for o in items or [] if isinstance(o, dict))

    def areas(self, outages: list[dict[str, Any]], get: Get) -> dict[str, list[Ring]]:
        """Each outage's area, one at a time (an outage the feed can't draw just now is tried again later)."""
        out: dict[str, list[Ring]] = {}
        for o in outages:
            oid = o["id"].split(":", 1)[1]
            try:
                data = ask(self.name, get, f"{AUSNET_FEED}/outageboundary/{oid}")
            except OutageFeedError:
                continue  # it answers some with an error, then draws them next time
            ring = ring_of((data.get("data") if isinstance(data, dict) else None) or [], "latitude", "longitude")
            out[o["id"]] = [ring] if ring else []
        return out


# ---------------------------------------------------------------------- CitiPower and Powercor
CPPC_FEED = "https://s3-ap-southeast-2.amazonaws.com/cppc-outage/outages.json"
CPPC_TIME = "%H:%M %d-%m-%Y"  # "18:30 10-10-2026"


def cppc_outage(network: str, o: dict[str, Any]) -> dict[str, Any] | None:
    """One of CitiPower's or Powercor's: CREW_STATUS (Outage Reported, Partially Restored…), CAUSE ("Planned outage"
    for planned work under way), PRIVATISED the streets off and the town ("GLENCAIRN AVENUE, CAMBERWELL")."""
    if gone(o.get("CREW_STATUS")):
        return None
    town = str(o.get("TOWN") or "").strip()
    streets = [s for s in split(o.get("PRIVATISED")) if s.upper() != town.upper()]
    point, rings = rings_of(o.get("geometry"))
    centre = o.get("centre")
    if isinstance(centre, list) and len(centre) >= 2 and to_float(centre[0]) and to_float(centre[1]):
        point = (float(centre[0]), float(centre[1]))
    return outage(
        network,
        o.get("ORDER_ID"),
        planned="planned" in str(o.get("CAUSE") or "").lower(),
        status=o.get("CREW_STATUS"),
        reason=o.get("CAUSE"),
        customers=o.get("CUSTOMERS"),
        start=when(o.get("START_TIME"), MELBOURNE, CPPC_TIME),
        end=when(o.get("ETR"), MELBOURNE, CPPC_TIME),
        end_text=o.get("ETR"),
        streets=streets,
        suburbs=[town] if town else [],
        point=point,
        area=rings,
    )


@dataclass(frozen=True)
class Cppc(Victorian):
    """CitiPower or Powercor: one company, one feed, each job marked with its network (BUSINESS)."""

    business: str = ""

    def link(self, o: Mapping[str, Any]) -> tuple[str, bool]:
        """CitiPower's and Powercor's map can't open an outage, only zoom to its suburb."""
        return with_query(f"{self.site}/outages/live-outage-map", suburb=suburb_of(o)), False

    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future":
            return []
        data = ask(self.name, get, CPPC_FEED)
        rows = (data.get("ROWSET") or {}).get("ROW") if isinstance(data, dict) else None
        if isinstance(rows, dict):
            rows = [rows]  # one job is written on its own, not in a list
        mine = [r for r in rows or [] if isinstance(r, dict) and str(r.get("BUSINESS") or "").lower() == self.business]
        return kept(cppc_outage(self.id, r) for r in mine)


# ---------------------------------------------------------------------- Jemena
JEMENA_FEED = "https://poweroutages.jemena.com.au/data/all-outages.json"
JEMENA_PLANNED = "https://www.jemena.com.au/api/ElectricityOutage/electricity-outage"


def _off(part: dict[str, Any]) -> bool:
    """A part of a job still off: not marked as restored."""
    return not part.get("RestorationTime")


def jemena_outage(o: dict[str, Any]) -> dict[str, Any] | None:
    """One of Jemena's jobs: Type Planned/Unplanned, Status In Progress (…), Completed, Complete, Cancelled. The
    job's own area, suburbs and homes off are often empty: its History holds each part of it that went off, each with
    its area and streets, and RestorationTime once it's back. Only the parts still off count; when none are, it's
    over (whatever its status says)."""
    if gone(o.get("Status")):
        return None
    top = o.get("ImpactedAreaGeoJson") or o.get("LocationGeoJson") or o.get("ImpactedSuburbs")
    parts = [o] if top and _off(o) else [h for h in o.get("History") or [] if isinstance(h, dict) and _off(h)]
    if not parts:
        return None
    point, rings, streets, suburbs, homes = None, [], [], [], 0
    for p in parts:
        rings += rings_of(p.get("ImpactedAreaGeoJson"))[1]
        loc = p.get("Location") or {}
        lat, lon = to_float(loc.get("Latitude")), to_float(loc.get("Longitude"))
        if point is None and lat is not None and lon is not None:
            point = (lon, lat)
        for s in p.get("ImpactedSuburbs") or []:
            if isinstance(s, dict):
                suburbs.append(str(s.get("SuburbName") or "").strip())
                streets += split(s.get("Streets"))
        homes += int(p.get("ImpactedCustomers") or 0)
    planned = str(o.get("Type") or "").lower() == "planned"
    start = when(o.get("PlannedStartTime"), MELBOURNE) if planned else None
    end = when(o.get("PlannedEndTime"), MELBOURNE) if planned else None
    return outage(
        "jemena",
        o.get("EventId"),
        planned=planned,
        status=o.get("Status"),
        reason=o.get("Cause"),
        customers=o.get("ImpactedCustomers") or homes or None,
        start=start or when(o.get("StartTime"), MELBOURNE),
        end=end or when(o.get("EstimatedRestorationTime"), MELBOURNE),
        streets=streets,
        suburbs=[s for s in suburbs if s],
        point=point,
        area=rings,
    )


def _day(text: str, now: float) -> dt.date | None:
    """ "15-Oct", in the year that puts it nearest today (the list has no year)."""
    try:
        d = dt.datetime.strptime(f"{text.strip()}-2000", "%d-%b-%Y")
    except ValueError:
        return None
    today = dt.datetime.fromtimestamp(now, MELBOURNE).date()
    days = []
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            days.append(dt.date(y, d.month, d.day))
        except ValueError:  # 29 February
            continue
    return min(days, key=lambda x: abs((x - today).days)) if days else None


def jemena_planned(rows: list[dict[str, Any]], now: float) -> list[dict[str, Any]]:
    """Jemena's planned work to come: a row per street (Suburb, Street, Date "15-Oct", Time "0730-1700", Status).
    The streets of one suburb at the same time are taken as one job. It has no place to put them, so they're matched
    only to the house's own street."""
    jobs: dict[tuple[str, str, str], dict[str, Any]] = {}
    for r in rows:
        if not isinstance(r, dict) or gone(r.get("Status")):
            continue
        day = _day(str(r.get("Date") or ""), now)
        m = re.fullmatch(r"(\d{2})(\d{2})-(\d{2})(\d{2})", str(r.get("Time") or "").strip())
        suburb = str(r.get("Suburb") or "").strip().upper()
        if not (day and m and suburb):
            continue
        start = dt.datetime.combine(day, dt.time(int(m[1]), int(m[2])), MELBOURNE)
        end = dt.datetime.combine(day, dt.time(int(m[3]), int(m[4])), MELBOURNE)
        if end <= start:  # overnight work: "1930-0530" ends the next morning
            end += dt.timedelta(days=1)
        job = jobs.setdefault(
            (day.isoformat(), m[0], suburb),
            {"start": int(start.timestamp()), "end": int(end.timestamp()), "status": r.get("Status"), "streets": []},
        )
        job["streets"] += split(r.get("Street"))
    return kept(
        outage(
            "jemena",
            f"{day}-{time}-{re.sub(r'[^A-Z0-9]+', '-', suburb)}",
            planned=True,
            status=job["status"],
            start=job["start"],
            end=job["end"],
            streets=job["streets"],
            suburbs=[suburb],
        )
        for (day, time, suburb), job in jobs.items()
    )


@dataclass(frozen=True)
class Jemena(Victorian):
    def link(self, o: Mapping[str, Any]) -> tuple[str, bool]:
        """Jemena's map can't open an outage, only zoom to its suburb."""
        return with_query("https://poweroutages.jemena.com.au/", suburb=suburb_of(o)), False

    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future":
            if around is None:
                return []
            data = ask(self.name, get, JEMENA_PLANNED)
            rows = data.get("Outages") if isinstance(data, dict) else None
            return jemena_planned(rows or [], around.now)
        data = ask(self.name, get, JEMENA_FEED)
        return kept(jemena_outage(o) for o in data if isinstance(o, dict)) if isinstance(data, list) else []


# ---------------------------------------------------------------------- United Energy
UNITED_FEED = "https://ds5ykmduea4ri.cloudfront.net/outages-v2.json"


def united_outage(o: dict[str, Any], now: float) -> dict[str, Any] | None:
    """One of United Energy's: outage_type (Fault, Planned…), etr (local time), its area, centre, suburbs. No start.
    The file isn't always rewritten when a job's done: one long past its estimate is left out."""
    point, rings = rings_of(o.get("geometry"))
    centre = o.get("centre")
    if isinstance(centre, list) and len(centre) >= 2 and to_float(centre[0]) and to_float(centre[1]):
        point = (float(centre[0]), float(centre[1]))
    out = outage(
        "united",
        o.get("outage_id"),
        planned="plan" in str(o.get("outage_type") or "").lower(),
        status=o.get("status"),
        reason=o.get("cause"),
        customers=o.get("customers_off"),
        end=when(o.get("etr"), MELBOURNE),
        end_text=o.get("etr"),
        streets=split(o.get("street_name")),
        suburbs=split(o.get("suburbs")),
        point=point,
        area=rings,
    )
    return None if out is None or gone(o.get("status")) or leftover(out, now) else out


@dataclass(frozen=True)
class United(Victorian):
    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future" or around is None:
            return []
        data = ask(self.name, get, UNITED_FEED)
        items = data.get("outages") if isinstance(data, dict) else None
        return kept(united_outage(o, around.now) for o in items or [] if isinstance(o, dict))


# Smallest first: in Melbourne several boxes overlap, and the suburb list (when the suburb's known) is what decides.
CITIPOWER = Cppc(
    "citipower",
    "CitiPower",
    "https://www.citipower.com.au",
    "VIC",
    (-37.9, 144.89, -37.76, 145.1),
    business="citipower",
)
JEMENA = Jemena("jemena", "Jemena", "https://www.jemena.com.au", "VIC", (-37.86, 144.7, -37.55, 145.1))
UNITED = United(
    "united",
    "United Energy",
    "https://www.unitedenergy.com.au",
    "VIC",
    (-38.5, 144.65, -37.75, 145.35),
    outages_page="/outage-map",
)
AUSNET = AusNet("ausnet", "AusNet Services", "https://www.ausnetservices.com.au", "VIC", (-39.2, 144.85, -35.9, 150.0))
POWERCOR = Cppc(
    "powercor", "Powercor", "https://www.powercor.com.au", "VIC", (-39.2, 140.9, -33.9, 145.6), business="powercor"
)
