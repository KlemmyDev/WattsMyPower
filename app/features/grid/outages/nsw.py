"""
New South Wales' three networks, and the ACT's: Ausgrid (Sydney's east and north, the Central Coast and the Hunter),
Endeavour Energy (Greater Western Sydney, the Blue Mountains, Southern Highlands, Illawarra and South Coast),
Essential Energy (the rest of the state) and Evoenergy (the ACT).

None has an API: these are the feeds behind each network's own outage map, public and the same for everyone, and can
change without notice. Times are Sydney's (the ACT keeps them too), where a feed doesn't give its offset.

Ausgrid    /api/outages-map/outages/list?futureDayLimit=N   outages now and planned work N days ahead (0: today's)
           /api/outages-map/outages/details-batch           an outage's area, asked for only for those near the house
           /api/outages-map/network-area                    the network's area (one polygon), to tell if it serves a house
Endeavour  /api/public/outage-areas-fast                    outages now and planned work, each with its area. Never its
                                                            single-premise jobs, nor /api/outage-points: one house each
Essential  ee-ai-api.pollen.au/v3/outages/{active|future}   GeoJSON for a box: one fixed box over its whole area
                                                            (a contractor's server, the one Essential's map uses)
Evoenergy  /outages                                         the page itself: its map's outages are in its script
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from app.features.grid.outages.base import (
    SYDNEY,
    Around,
    Get,
    House,
    OutageFeedError,
    Provider,
    Ring,
    ask,
    gone,
    in_bounds,
    inside,
    kept,
    outage,
    ring_of,
    rings_of,
    split,
    to_float,
    when,
    words,
)

AUSGRID_SITE = "https://www.ausgrid.com.au"
# Its firewall turns away a POST without what its own map sends.
AUSGRID_POST = {"x-csrf-token": "1", "Origin": AUSGRID_SITE, "Referer": f"{AUSGRID_SITE}/"}
AREAS_AT_ONCE = 10


def _point(p: Any) -> tuple[float, float] | None:
    if not isinstance(p, dict):
        return None
    lat, lon = to_float(p.get("lat")), to_float(p.get("lng"))
    return (lon, lat) if lat is not None and lon is not None else None


def ausgrid_outage(o: dict[str, Any]) -> dict[str, Any] | None:
    """One of Ausgrid's: OutageDisplayType U (unplanned) or P (planned), PowerStatus InProgress, Planned,
    ProceedingAsScheduled, RestorationHasCommenced, or Restored, Cancelled, Completed (left out). Times in UTC."""
    if gone(o.get("PowerStatus")):
        return None
    return outage(
        "ausgrid",
        o.get("EventId"),
        planned=o.get("OutageDisplayType") == "P",
        status=o.get("PowerStatus"),
        reason=o.get("Cause") or o.get("Reason"),
        customers=o.get("AffectedCustomers"),
        start=when(o.get("StartDateTime"), SYDNEY),
        end=when(o.get("EstRestTime"), SYDNEY),
        streets=split(o.get("StreetsAffected")),
        suburbs=split(o.get("Area")),
        point=_point(o.get("MarkerLocation")),
    )


@dataclass(frozen=True)
class Ausgrid(Provider):
    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        # Today's every 15 minutes (a few kilobytes); the 90 days ahead (a megabyte) hourly, with the rest's.
        days = 90 if which == "future" else 0
        data = ask(self.name, get, f"{self.site}/api/outages-map/outages/list?futureDayLimit={days}")
        return kept(ausgrid_outage(o) for o in data) if isinstance(data, list) else []

    def where(self, get: Get) -> list[Ring]:
        data = ask(self.name, get, f"{self.site}/api/outages-map/network-area")
        ring = ring_of(data) if isinstance(data, list) else []
        return [ring] if ring else []

    def serves(self, house: House, where: Any) -> bool | None:
        if where:
            return any(inside(house.lat, house.lon, r) for r in where)
        return None if in_bounds(self.bounds, house.lat, house.lon) else False

    def areas(self, outages: list[dict[str, Any]], get: Get) -> dict[str, list[Ring]]:
        """Each outage's area from its details, ten at a time."""
        out: dict[str, list[Ring]] = {}
        for i in range(0, len(outages), AREAS_AT_ONCE):
            items = [
                {"id": int(o["id"].split(":", 1)[1]), "type": "P" if o["planned"] else "U"}
                for o in outages[i : i + AREAS_AT_ONCE]
                if o["id"].split(":", 1)[1].isdigit()
            ]
            if not items:
                continue
            data = ask(
                self.name,
                get,
                f"{self.site}/api/outages-map/outages/details-batch",
                headers=AUSGRID_POST,
                json_body={"items": items},
            )
            for pair in data if isinstance(data, list) else []:
                if not (isinstance(pair, list) and len(pair) == 2 and isinstance(pair[1], dict)):
                    continue
                d = pair[1]
                polys = [*(d.get("Polygons") or []), d.get("Polygon") or {}]
                rings = [r for r in (ring_of(p.get("Coords") or []) for p in polys if isinstance(p, dict)) if r]
                out[f"ausgrid:{pair[0]}"] = rings
        return out


def endeavour_outage(o: dict[str, Any]) -> dict[str, Any] | None:
    """One of Endeavour Energy's: outage_type UNPLANNED, PLANNED or SINGLE_PREMISE (one house: left out). Its
    street_name is the address the job was raised at, not the streets off, so it isn't matched to the house's."""
    kind = str(o.get("outage_type") or "").upper()
    if kind not in ("UNPLANNED", "PLANNED") or gone(o.get("incident_status")):
        return None
    lat, lon = to_float(o.get("center_lat")), to_float(o.get("center_lng"))
    end = when(o.get("etr"), SYDNEY) or when(o.get("end_date_time"), SYDNEY)
    return outage(
        "endeavour",
        o.get("incident_id"),
        planned=kind == "PLANNED",
        status=o.get("incident_status"),
        reason=words(o.get("sub_cause")) or words(o.get("cause")),
        customers=o.get("customers_affected"),
        start=when(o.get("start_date_time"), SYDNEY),
        end=end,
        suburbs=split(o.get("cityname_list") or o.get("cityname")),
        point=(lon, lat) if lat is not None and lon is not None else None,
        area=rings_of(o.get("polygon_geojson"))[1],
    )


@dataclass(frozen=True)
class Endeavour(Provider):
    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future":
            return []  # the one feed has planned work too
        data = ask(self.name, get, f"{self.site}/api/public/outage-areas-fast?includeInactive=false")
        items = data.get("data") if isinstance(data, dict) else None
        return kept(endeavour_outage(o) for o in items or [] if isinstance(o, dict))


def essential_outage(f: dict[str, Any]) -> dict[str, Any] | None:
    """One of Essential Energy's GeoJSON features: kind planned/unplanned, status current/future, times
    "dd/mm/yyyy HH:MM:SS" (Sydney time). No suburbs or streets: its area tells if it reaches the house."""
    p = f.get("properties") or {}
    if gone(p.get("status")):
        return None
    label = p.get("labelPoint")
    point = None
    if (
        isinstance(label, list)
        and len(label) >= 2
        and to_float(label[0]) is not None
        and to_float(label[1]) is not None
    ):
        point = (float(label[0]), float(label[1]))
    fmt = "%d/%m/%Y %H:%M:%S"
    return outage(
        "essential",
        p.get("incidentId") or f.get("id"),
        planned=str(p.get("kind") or "").lower() == "planned",
        status=p.get("status"),
        reason=p.get("reason"),
        customers=p.get("customersAffected"),
        start=when(p.get("timeOff"), SYDNEY, fmt),
        end=when(p.get("estTimeOn"), SYDNEY, fmt),
        point=point,
        area=rings_of(f.get("geometry"))[1],
    )


# Essential's whole area (west, south, east, north): NSW outside Sydney, and the Queensland towns over the border it
# serves. Its feed answers only for a box; one fixed box for everyone, so where the house is never leaves the
# dashboard. Its planned work to come is half a megabyte (compressed) for all of it, fetched hourly.
ESSENTIAL_BOX = (140.9, -37.6, 153.7, -27.9)


@dataclass(frozen=True)
class Essential(Provider):
    feed: str = "https://ee-ai-api.pollen.au/v3/outages"

    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        box = ",".join(f"{x:g}" for x in ESSENTIAL_BOX)
        url = f"{self.feed}/{'future' if which == 'future' else 'active'}?bbox={box}"
        data = ask(self.name, get, url, headers={"Accept": "application/geo+json"})
        feats = data.get("features") if isinstance(data, dict) else None
        return kept(essential_outage(f) for f in feats or [] if isinstance(f, dict))


def evoenergy_list(page: str) -> list[dict[str, Any]]:
    """The outages Evoenergy's page gives its map: `var outagesViewModel = [...]` in its script."""
    mark = "var outagesViewModel ="
    at = page.find(mark)
    if at < 0:
        raise ValueError("no outages on the page")
    rest = page[at + len(mark) :].lstrip()
    items, _ = json.JSONDecoder().raw_decode(rest)
    return [o for o in items if isinstance(o, dict)] if isinstance(items, list) else []


def _json(s: Any) -> Any:
    try:
        return json.loads(s) if isinstance(s, str) else s
    except ValueError:
        return None


def evoenergy_outage(o: dict[str, Any]) -> dict[str, Any] | None:
    """One of Evoenergy's: Type planned/unplanned, Status Scheduled, Restored, Completed, Cancelled… Times are local
    (Canberra's, Sydney's), the area and its middle JSON strings of {lat, lng}."""
    if gone(o.get("Status")):
        return None
    ring = ring_of(_json(o.get("PolygonCoordinates")) or [])
    return outage(
        "evoenergy",
        o.get("OutageID"),
        planned=str(o.get("Type") or "").lower() == "planned",
        status=o.get("StatusDescription") or o.get("Status"),
        reason=o.get("Description"),
        customers=o.get("AffectedCustomersCount"),
        start=when(o.get("ActualStartDateTime"), SYDNEY) or when(o.get("ScheduledStartDateTime"), SYDNEY),
        end=when(o.get("ExpectedRestorationDateTime"), SYDNEY) or when(o.get("ScheduledEndDateTime"), SYDNEY),
        suburbs=split(o.get("AffectedSuburbs")),
        point=_point(_json(o.get("PolygonCentroidCoordinate"))),
        area=[ring] if ring else [],
    )


@dataclass(frozen=True)
class Evoenergy(Provider):
    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future":
            return []  # the page has planned work too
        page = ask(self.name, get, f"{self.site}/outages", text=True)
        try:
            items = evoenergy_list(str(page))
        except ValueError as e:
            raise OutageFeedError(f"{self.name}'s outage map couldn't be read.") from e
        return kept(evoenergy_outage(o) for o in items)

    def serves(self, house: House, where: Any) -> bool | None:
        # The ACT's box takes in Queanbeyan (Essential Energy's): only the place name ("…, ACT") is sure.
        return True if house.state == "ACT" else None if in_bounds(self.bounds, house.lat, house.lon) else False


AUSGRID = Ausgrid("ausgrid", "Ausgrid", AUSGRID_SITE, "NSW", (-34.18, 150.0, -31.55, 152.21))
EVOENERGY = Evoenergy("evoenergy", "Evoenergy", "https://www.evoenergy.com.au", "ACT", (-35.93, 148.76, -35.12, 149.4))
ENDEAVOUR = Endeavour(
    "endeavour", "Endeavour Energy", "https://www.endeavourenergy.com.au", "NSW", (-35.6, 149.9, -32.8, 151.15)
)
ESSENTIAL = Essential(
    "essential", "Essential Energy", "https://www.essentialenergy.com.au", "NSW", (-37.6, 140.9, -28.0, 153.7)
)
