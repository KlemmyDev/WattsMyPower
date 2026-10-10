"""
Western Australia's networks: Western Power (the South West Interconnected System: Perth, the south west, the Wheatbelt
and the Goldfields to Kalgoorlie) and Horizon Power (everywhere else: the Pilbara, Kimberley, Gascoyne, Esperance…).

No API: these are the feeds behind each network's own outage map, public and the same for everyone, and can change
without notice. Times are Perth's.

Western Power  www.westernpower.com.au/api/corp/outage/all-outages   outages now and planned work: outageType U
               (unplanned), P (planned, under way) or F (planned, to come); a centre, no area, no cause; times like
               "20261017T073000+08:00"
Horizon Power  www.horizonpower.com.au/api/outage/getdetailedoutages   outages now and planned work, each a centre and
               a radius (metres), local times without an offset. It keeps a job long after it's done, still Started
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.features.grid.outages.base import (
    PERTH,
    Around,
    Get,
    House,
    Provider,
    Ring,
    ask,
    circle,
    gone,
    in_bounds,
    inside,
    job,
    kept,
    leftover,
    outage,
    split,
    to_float,
    when,
    with_query,
)

# Western Power's grid, roughly (lon, lat): Kalbarri to Kalgoorlie to Albany. Esperance, east of it, is Horizon's.
SWIS: Ring = [(113.5, -28.0), (117.5, -28.0), (122.0, -30.3), (122.0, -31.5), (120.0, -33.0), (119.5, -35.2),
              (114.5, -35.2), (113.5, -28.0)]  # fmt: skip


def _point(lat: Any, lon: Any) -> tuple[float, float] | None:
    y, x = to_float(lat), to_float(lon)
    return (x, y) if x is not None and y is not None else None


def westernpower_outage(o: dict[str, Any], now: float) -> dict[str, Any] | None:
    """One of Western Power's. Its map leaves out the jobs marked onMap false (a single house's, mostly): so does
    this."""
    if o.get("onMap") is False:
        return None
    kind = str(o.get("outageType") or "").upper()
    out = outage(
        "westernpower",
        o.get("outageId"),
        planned=kind in ("P", "F"),
        status=o.get("status"),
        customers=o.get("affectedCustomers"),
        start=when(o.get("startTime"), PERTH),
        end=when(o.get("restorationTime"), PERTH),
        suburbs=split(o.get("areas")),
        point=_point(o.get("latitudeCentroid"), o.get("longitudeCentroid")),
    )
    return None if out is None or gone(o.get("status")) or leftover(out, now) else out


@dataclass(frozen=True)
class WesternPower(Provider):
    def link(self, o: Mapping[str, Any]) -> tuple[str, bool]:
        """Western Power's outage page opens an outage by its number."""
        return with_query(f"{self.site}/outages", outageId=job(o)), True

    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future" or around is None:
            return []  # the one feed has planned work to come too
        data = ask(self.name, get, f"{self.site}/api/corp/outage/all-outages")
        return (
            kept(westernpower_outage(o, around.now) for o in data if isinstance(o, dict))
            if isinstance(data, list)
            else []
        )

    def serves(self, house: House, where: Any) -> bool | None:
        return inside(house.lat, house.lon, SWIS)


def horizon_outage(o: dict[str, Any], now: float) -> dict[str, Any] | None:
    if gone(o.get("status")):
        return None
    point = _point(o.get("centerLatitude"), o.get("centerLongitude"))
    radius = to_float(o.get("radius"))
    area = [circle(point[0], point[1], radius)] if point and radius and radius > 0 else []
    out = outage(
        "horizon",
        o.get("externalId") or o.get("entityId"),
        planned=str(o.get("outageType") or "").lower() == "planned",
        status=o.get("status"),
        customers=o.get("customersAffected"),
        start=when(o.get("startDateTime"), PERTH),
        end=when(o.get("endDate"), PERTH) or when(o.get("estimatedFixDateTime"), PERTH),
        suburbs=[s for s in (str(o.get("serviceArea") or "").strip(),) if s],
        point=point,
        area=area,
    )
    return None if out is None or leftover(out, now) else out


@dataclass(frozen=True)
class Horizon(Provider):
    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future" or around is None:
            return []
        data = ask(self.name, get, f"{self.site}/api/outage/getdetailedoutages")
        items = (data.get("result") or {}).get("outages") if isinstance(data, dict) else None
        return kept(horizon_outage(o, around.now) for o in items or [] if isinstance(o, dict))

    def serves(self, house: House, where: Any) -> bool | None:
        # Everywhere in the state but Western Power's grid.
        return in_bounds(self.bounds, house.lat, house.lon) and not inside(house.lat, house.lon, SWIS)


WESTERNPOWER = WesternPower(
    "westernpower", "Western Power", "https://www.westernpower.com.au", "WA", (-35.2, 113.5, -28.0, 122.0)
)
HORIZON = Horizon(
    "horizon",
    "Horizon Power",
    "https://www.horizonpower.com.au",
    "WA",
    (-35.2, 112.9, -13.6, 129.0),
    outages_page="/outages",
)
