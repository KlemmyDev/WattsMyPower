"""
Tasmania's network, TasNetworks: the state's outages now, planned work under way among them.

No API: this is the feed behind its own outage map, public and the same for everyone, and can change without notice.

    www.tasnetworks.com.au/api/odata/GetPowerOutages   a list, empty when nothing's off

Each, as its map's script reads them: jobId, reason ("Planned maintenance work" for planned work), customersAffected,
affectedAreas (the suburbs, comma separated), postcodes, outageCentroid_WKT ("POINT (lon lat)"), outagePolygon_WKT
("POLYGON ((lon lat, …))") and estimatedTimeOfRestoration, shown on its map as it comes: read as a time where it's one,
else kept as words. There's no feed of planned work to come.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.features.grid.outages.base import HOBART, Around, Get, Provider, Ring, ask, gone, kept, outage, split, when

FEED = "https://www.tasnetworks.com.au/api/odata/GetPowerOutages"
PLANNED = "planned maintenance work"
# The ways a time might be written, besides ISO 8601 ("10/10/2026 5:30 PM", "17:30 10/10/2026"…).
TIMES = ("%d/%m/%Y %I:%M %p", "%d/%m/%Y %I:%M:%S %p", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%H:%M %d/%m/%Y",
         "%I:%M %p %d/%m/%Y")  # fmt: skip
_PAIR = re.compile(r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)")


def wkt(text: Any) -> tuple[tuple[float, float] | None, list[Ring]]:
    """A WKT POINT's (lon, lat), or a POLYGON's (or MULTIPOLYGON's) outer rings."""
    s = str(text or "").strip().upper()
    if s.startswith("POINT"):
        m = _PAIR.search(s)
        return ((float(m[1]), float(m[2])) if m else None), []
    rings: list[Ring] = []
    # Each polygon's outer ring is the first parenthesised list after its opening "((".
    for body in re.findall(r"\(\(\s*([^()]*)\)", s):
        ring = [(float(x), float(y)) for x, y in _PAIR.findall(body)]
        if len(ring) >= 3:
            rings.append(ring)
    return None, rings


def tas_outage(o: dict[str, Any]) -> dict[str, Any] | None:
    if gone(o.get("status")):
        return None
    point, _ = wkt(o.get("outageCentroid_WKT"))
    _, rings = wkt(o.get("outagePolygon_WKT"))
    etr = o.get("estimatedTimeOfRestoration")
    return outage(
        "tasnetworks",
        o.get("jobId"),
        planned=str(o.get("reason") or "").strip().lower() == PLANNED,
        status=o.get("status"),
        reason=o.get("reason"),
        customers=o.get("customersAffected"),
        start=when(o.get("startTime") or o.get("outageStartTime"), HOBART, *TIMES),
        end=when(etr, HOBART, *TIMES),
        end_text=etr,
        suburbs=split(o.get("affectedAreas")),
        point=point,
        area=rings,
    )


@dataclass(frozen=True)
class TasNetworks(Provider):
    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        if which == "future":
            return []
        data = ask(self.name, get, FEED)
        if isinstance(data, dict):  # OData wraps its lists in {"value": [...]}
            data = data.get("value")
        return kept(tas_outage(o) for o in data if isinstance(o, dict)) if isinstance(data, list) else []


TASNETWORKS = TasNetworks(
    "tasnetworks", "TasNetworks", "https://www.tasnetworks.com.au", "TAS", (-43.8, 143.5, -39.2, 148.6)
)
