"""
Energy Queensland's two networks, Energex (South East Queensland) and Ergon Energy (the rest of the state): their
power outages, current and planned.

There's no API: these are the GeoJSON files behind each network's own outage map (Outage finder → Map), public and
the same for everyone, refreshed by the networks every 15 minutes. As an unofficial source they can change or move
without notice. The whole network's outages are fetched and matched to the house here, so the address never leaves
the dashboard.

    /static/PRD/{prefix}_map_current_unplanned.geojson   outages now: a point and, mostly, the area that's off
    /static/PRD/{prefix}_map_current_planned.geojson     planned work under way today: a point
    /static/PRD/{prefix}_map_future_planned.geojson      planned work to come (a few weeks): a point
    /static/PRD/{prefix}_map_servicearea.geojson         the network's area (one polygon), to tell which serves a house

Each outage's properties: EVENT_ID, TYPE (PLANNED/UNPLANNED), CUSTOMERS_AFFECTED, REASON, STATUS, START and
EST_FIX_TIME ("9:34AM 08 Oct 2026", Queensland time, or words: "Under Investigation"), STREETS and SUBURBS (comma
separated, in capitals).

Both sites sit behind Cloudflare, whose browser check turns away clients that don't look like a browser (error 1010),
and the networks can't let the dashboard through themselves (their sites are run by a contractor). Energex agreed
(October 2026) to the dashboard asking for these files the way their own outage map does in Chrome: browser_headers.
"""

from __future__ import annotations

import datetime as dt
import urllib.parse
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.features.grid.outages import base
from app.features.grid.outages.base import (
    Around,
    Get,
    House,
    OutageFeedError,
    Provider,
    Ring,
    ask,
    in_bounds,
    inside,
    job,
    rings_of,
    split,
    suburb_of,
    with_query,
)

QLD_TIME = dt.timezone(dt.timedelta(hours=10))  # Queensland has no daylight saving

# A recent stable Chrome on Windows, the most common browser there is. Keep the three in step when it's moved on: an
# old version stands out too.
CHROME = "151"
CHROME_UA = (
    f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{CHROME}.0.0.0 "
    "Safari/537.36"
)
CHROME_CH_UA = f'"Chromium";v="{CHROME}", "Google Chrome";v="{CHROME}", "Not.A/Brand";v="99"'


def browser_headers(url: str) -> dict[str, str]:
    """What Chrome sends when a network's outage map, open on its own site, fetches one of these files."""
    u = urllib.parse.urlsplit(url)
    return {
        "User-Agent": CHROME_UA,
        "Accept": "*/*",
        "Accept-Language": "en-AU,en-GB;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Referer": f"{u.scheme}://{u.netloc}/",
        "sec-ch-ua": CHROME_CH_UA,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
    }


def qld_time(s: str | None) -> int | None:
    """ "9:34AM 08 Oct 2026" (Queensland time) as epoch seconds; None for anything else ("Under Investigation")."""
    if not s:
        return None
    try:
        t = dt.datetime.strptime(s.strip().upper(), "%I:%M%p %d %b %Y")
    except ValueError:
        return None
    return int(t.replace(tzinfo=QLD_TIME).timestamp())


def outage(network: str, feature: dict[str, Any]) -> dict[str, Any] | None:
    """One outage from a map file, or None if it can't be placed or named."""
    p = feature.get("properties") or {}
    if str(p.get("STATUS") or "").strip().lower().startswith("cancel"):
        return None  # planned work called off: the map keeps it, marked Cancelled, until its day has passed
    point, rings = rings_of(feature.get("geometry"))
    if point is None and not rings:
        return None
    end_text = p.get("EST_FIX_TIME")
    return base.outage(
        network,
        p.get("EVENT_ID"),
        planned=str(p.get("TYPE") or "").upper() == "PLANNED",
        status=p.get("STATUS"),
        reason=p.get("REASON"),
        customers=p.get("CUSTOMERS_AFFECTED"),
        start=qld_time(p.get("START")),
        end=qld_time(end_text),
        end_text=end_text,
        streets=split(p.get("STREETS")),
        suburbs=split(p.get("SUBURBS")),
        point=point,
        area=rings,
    )


@dataclass(frozen=True)
class EnergyQueensland(Provider):
    """One of Energy Queensland's networks, with the prefix of its map files. Energex's bounds are its map's extent;
    Ergon's are the rest of Queensland, and its service area surrounds Energex's, so Energex is asked first."""

    prefix: str = ""

    def _get(self, get: Get, name: str) -> Any:
        url = f"{self.site}/static/PRD/{self.prefix}_map_{name}.geojson"
        return ask(self.name, get, url, headers=browser_headers(url))

    def _file(self, get: Get, name: str) -> list[dict[str, Any]]:
        data = self._get(get, name)
        out = [outage(self.id, f) for f in (data.get("features") or [])] if isinstance(data, dict) else []
        return [o for o in out if o]

    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future":
            return self._file(get, "future_planned")
        return self._file(get, "current_unplanned") + self._file(get, "current_planned")

    def where(self, get: Get) -> list[Ring]:
        """The network's service area (one polygon)."""
        data = self._get(get, "servicearea")
        rings: list[Ring] = []
        for f in (data.get("features") or []) if isinstance(data, dict) else []:
            rings += rings_of(f.get("geometry"))[1]
        return rings

    def link(self, o: Mapping[str, Any]) -> tuple[str, bool]:
        """Energex's outage finder opens an outage now by its number; its planned work, and all of Ergon's, only as
        the list filtered to the suburb (Ergon's "next 5 days" list, which has its planned work too)."""
        suburb = suburb_of(o)
        if self.prefix == "ex":
            finder = f"{self.site}/outages/outage-finder"
            if not o["planned"]:
                return with_query(f"{finder}/emergency-outages-text-view", event=job(o)), True
            return with_query(f"{finder}/planned-outages-text-view", **{"suburb-postcode": suburb}), False
        finder = f"{self.site}/network/outages/outage-finder/outage-finder-text-view"
        return with_query(finder, suburb=suburb, source="1074971" if suburb else ""), False

    def serves(self, house: House, where: Any) -> bool | None:
        if where:
            return any(inside(house.lat, house.lon, r) for r in where)
        return in_bounds(self.bounds, house.lat, house.lon)  # before (or without) its service area: its extent will do


ENERGEX = EnergyQueensland(
    "energex", "Energex", "https://www.energex.com.au", "QLD", (-28.37, 151.94, -25.82, 153.56), prefix="ex"
)
ERGON = EnergyQueensland(
    "ergon", "Ergon Energy", "https://www.ergon.com.au", "QLD", (-29.2, 137.9, -9.0, 153.6), prefix="ee"
)

__all__ = ["CHROME", "ENERGEX", "ERGON", "EnergyQueensland", "OutageFeedError", "browser_headers", "outage", "qld_time"]
