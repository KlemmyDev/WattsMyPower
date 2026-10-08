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
"""

from __future__ import annotations

import datetime as dt
import json
import urllib.error
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.core.http import get_json

QLD_TIME = dt.timezone(dt.timedelta(hours=10))  # Queensland has no daylight saving


class OutageFeedError(Exception):
    """A network's outage files couldn't be fetched or read."""


def qld_time(s: str | None) -> int | None:
    """ "9:34AM 08 Oct 2026" (Queensland time) as epoch seconds; None for anything else ("Under Investigation")."""
    if not s:
        return None
    try:
        t = dt.datetime.strptime(s.strip().upper(), "%I:%M%p %d %b %Y")
    except ValueError:
        return None
    return int(t.replace(tzinfo=QLD_TIME).timestamp())


def _list(s: Any) -> list[str]:
    return [p.strip() for p in str(s or "").split(",") if p.strip()]


def _int(s: Any) -> int | None:
    try:
        return int(str(s).strip())
    except (TypeError, ValueError):
        return None


Ring = list[tuple[float, float]]  # (lon, lat), as GeoJSON has them


def _rings(geometry: dict[str, Any] | None) -> tuple[tuple[float, float] | None, list[Ring]]:
    """A geometry's point (lon, lat) and its polygons' outer rings."""
    if not geometry:
        return None, []
    kind = geometry.get("type")
    if kind == "GeometryCollection":
        point, rings = None, []
        for g in geometry.get("geometries") or []:
            p, r = _rings(g)
            point = point or p
            rings += r
        return point, rings
    c: Any = geometry.get("coordinates") or []
    try:
        if kind == "Point":
            return (float(c[0]), float(c[1])), []
        if kind == "Polygon":
            return None, [[(float(x), float(y)) for x, y, *_ in c[0]]]
        if kind == "MultiPolygon":
            return None, [[(float(x), float(y)) for x, y, *_ in poly[0]] for poly in c]
    except (TypeError, ValueError, IndexError):
        pass
    return None, []


def outage(network: str, feature: dict[str, Any]) -> dict[str, Any] | None:
    """One outage from a map file, or None if it can't be placed or named."""
    p = feature.get("properties") or {}
    oid = str(p.get("EVENT_ID") or "").strip()
    point, rings = _rings(feature.get("geometry"))
    if not oid:
        return None
    if str(p.get("STATUS") or "").strip().lower().startswith("cancel"):
        return None  # planned work called off: the map keeps it, marked Cancelled, until its day has passed
    if point is None and rings:  # no marker: the middle of its area
        xs, ys = [x for x, _ in rings[0]], [y for _, y in rings[0]]
        point = (sum(xs) / len(xs), sum(ys) / len(ys))
    if point is None:
        return None
    end_text = str(p.get("EST_FIX_TIME") or "").strip()
    return {
        "id": f"{network}:{oid}",
        "network": network,
        "planned": str(p.get("TYPE") or "").upper() == "PLANNED",
        "status": str(p.get("STATUS") or "").strip() or None,
        "reason": str(p.get("REASON") or "").strip() or None,
        "customers": _int(p.get("CUSTOMERS_AFFECTED")),
        "start": qld_time(p.get("START")),
        "end": qld_time(end_text),
        "end_text": None if qld_time(end_text) else (end_text or None),
        "streets": _list(p.get("STREETS")),
        "suburbs": _list(p.get("SUBURBS")),
        "lon": point[0],
        "lat": point[1],
        "area": rings,
    }


Get = Callable[[str], Any]


@dataclass(frozen=True)
class EnergyQueensland:
    """One of Energy Queensland's networks: its id, name, site, and the prefix of its map files."""

    id: str
    name: str
    site: str
    prefix: str
    # Roughly where it is (south, west, north, east), for telling which network serves a house before (or without)
    # its service area: Energex's map extent; Ergon is the rest of Queensland.
    bounds: tuple[float, float, float, float]

    def _get(self, get: Get, name: str) -> Any:
        try:
            return get(f"{self.site}/static/PRD/{self.prefix}_map_{name}.geojson")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 429):  # its site's protection (Cloudflare) turns some servers away
                raise OutageFeedError(f"{self.name}'s outage map isn't letting the dashboard in right now.") from e
            raise OutageFeedError(f"{self.name}'s outage map isn't answering right now.") from e
        except (urllib.error.URLError, OSError) as e:
            raise OutageFeedError(f"Couldn't reach {self.name}'s outage map.") from e
        except (ValueError, json.JSONDecodeError) as e:
            raise OutageFeedError(f"{self.name}'s outage map couldn't be read.") from e

    def outages(self, which: str, get: Get = get_json) -> list[dict[str, Any]]:
        """`which`: current_unplanned, current_planned or future_planned."""
        data = self._get(get, which)
        out = [outage(self.id, f) for f in (data.get("features") or [])] if isinstance(data, dict) else []
        return [o for o in out if o]

    def area(self, get: Get = get_json) -> list[Ring]:
        data = self._get(get, "servicearea")
        rings: list[Ring] = []
        for f in (data.get("features") or []) if isinstance(data, dict) else []:
            rings += _rings(f.get("geometry"))[1]
        return rings


NETWORKS: dict[str, EnergyQueensland] = {
    "energex": EnergyQueensland(
        "energex", "Energex", "https://www.energex.com.au", "ex", (-28.37, 151.94, -25.82, 153.56)
    ),
    "ergon": EnergyQueensland("ergon", "Ergon Energy", "https://www.ergon.com.au", "ee", (-29.2, 137.9, -9.0, 153.6)),
}
