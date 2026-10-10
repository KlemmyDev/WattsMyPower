"""
What every electricity network's outages have in common: how a network is asked for them (Network), how it's fetched
(fetch, ask), and the one shape its outages come back in (outage), whatever its own feed looks like.

An outage, as the service and the Grid page see it:

    id          "{network}:{the network's own job number}", unique across networks
    network     the network's id
    planned     planned work (True) or an outage nobody chose (False)
    status      the network's own word for where the job's at, or None
    reason      why, in the network's words ("Vehicle hit a pole", "Maintenance"), or None
    customers   homes and businesses off, or None
    start, end  epoch seconds, or None; end is when power's expected back (or planned work ends)
    end_text    the network's words for the end when it isn't a time ("Under investigation")
    streets     the streets it lists (as written by the network), and suburbs
    lon, lat    where to put it: the network's marker, or the middle of its area. None for planned work a network
                lists only by street (Jemena's): it counts only when it lists the house's own street
    area        the area that's off, as polygons' outer rings of (lon, lat); empty when the network draws no area

The networks' feeds are the ones behind each network's own public outage map. None of them is an official API, so any
can change or move without notice: each provider reads its feed defensively and leaves out what it can't place.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import urllib.error
import urllib.request
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.http import USER_AGENT, read_body

Ring = list[tuple[float, float]]  # (lon, lat), as GeoJSON has them


def zone(name: str, standard_hours: float) -> dt.tzinfo:
    """A state's time zone, daylight saving and all; its standard time all year on a system without the time zone
    database (better a time an hour out in summer than no outages)."""
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return dt.timezone(dt.timedelta(hours=standard_hours))


# Each network's times are its own state's (where a feed doesn't say which zone it means). The ACT keeps Sydney's.
BRISBANE = zone("Australia/Brisbane", 10)
SYDNEY = zone("Australia/Sydney", 10)
MELBOURNE = zone("Australia/Melbourne", 10)
ADELAIDE = zone("Australia/Adelaide", 9.5)
HOBART = zone("Australia/Hobart", 10)
PERTH = zone("Australia/Perth", 8)


class OutageFeedError(Exception):
    """A network's outage map couldn't be fetched or read."""


@dataclass(frozen=True)
class Around:
    """Where the house is and how far around it outages matter, and the time: for the feeds asked for an area (not
    the whole network), and for telling a job that's finished from one that's on."""

    lat: float
    lon: float
    km: float
    now: float

    def bbox(self, margin_km: float = 5) -> tuple[float, float, float, float]:
        """West, south, east, north around the house, the radius and a little more."""
        km = self.km + margin_km
        dlat = km / 111.32
        dlon = km / (111.32 * max(0.1, math.cos(math.radians(self.lat))))
        return (self.lon - dlon, self.lat - dlat, self.lon + dlon, self.lat + dlat)


@dataclass(frozen=True)
class House:
    """What tells which network serves the house: where it is, its suburb (in capitals, from Manage → Integrations →
    Grid or the location's place name; "" when neither says) and its state when the place name says ("…, ACT")."""

    lat: float
    lon: float
    suburb: str = ""
    state: str | None = None


class Get(Protocol):
    """How a provider asks for its feed: JSON back (or the page's text), sent with a JSON body as a POST."""

    def __call__(
        self, url: str, *, headers: Mapping[str, str] | None = None, json_body: Any = None, text: bool = False
    ) -> Any: ...


def fetch(
    url: str,
    *,
    headers: Mapping[str, str] | None = None,
    json_body: Any = None,
    text: bool = False,
    timeout: float = 30,
) -> Any:
    """A network's feed, as the dashboard (by name) asks for it, compressed where the network will: some are a
    megabyte or two."""
    h = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html" if text else "application/json",
        "Accept-Encoding": "gzip",
        **(headers or {}),
    }
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode()
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET", headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = read_body(resp)
    return body.decode("utf-8", "replace") if text else json.loads(body)


def ask(name: str, get: Get, url: str, **kw: Any) -> Any:
    """One of a network's feeds, its failures put in words for the Grid page."""
    try:
        return get(url, **kw)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 429):  # its site's protection (Cloudflare, Imperva) turns some servers away
            raise OutageFeedError(f"{name}'s outage map isn't letting the dashboard in right now.") from e
        raise OutageFeedError(f"{name}'s outage map isn't answering right now.") from e
    except (urllib.error.URLError, OSError) as e:
        raise OutageFeedError(f"Couldn't reach {name}'s outage map.") from e
    except (ValueError, json.JSONDecodeError) as e:
        raise OutageFeedError(f"{name}'s outage map couldn't be read.") from e


@dataclass(frozen=True)
class Provider:
    """A network whose outages can be followed. Each network's module fills in outages(), and where it can tell more
    than its rough bounds about which houses it serves, where() and serves(); and areas() where its feed draws an
    outage's area only when asked for that outage."""

    id: str
    name: str
    site: str
    state: str  # QLD, NSW, ACT, VIC, SA, TAS or WA
    # Roughly where it is (south, west, north, east): for telling which network serves a house when nothing better
    # (its service area, a suburb list) says.
    bounds: tuple[float, float, float, float]

    def outages(self, which: str, get: Get, around: Around) -> list[dict[str, Any]]:
        """`which`: "current", what's on now (and, from a feed that lists everything at once, what's planned too), or
        "future", planned work to come, asked for hourly, apart, from the networks that keep it in a feed of its own
        (the rest give nothing)."""
        raise NotImplementedError

    @property
    def where_key(self) -> str:
        """Networks that share what tells where they are (Victoria's suburb list) share this, so it's fetched once."""
        return self.id

    def where(self, get: Get) -> Any:
        """What tells which houses the network serves (its service area, a suburb list), fetched once a day; None
        when there's nothing but its bounds."""
        return None

    def serves(self, house: House, where: Any) -> bool | None:
        """Whether the network serves the house: True or False when it can tell, None when it only might (the house
        is inside its rough bounds)."""
        return None if in_bounds(self.bounds, house.lat, house.lon) else False

    def areas(self, outages: list[dict[str, Any]], get: Get) -> dict[str, list[Ring]]:
        """The areas of these outages (id -> rings), for a feed that draws them only when asked, outage by outage."""
        return {}


def in_bounds(bounds: tuple[float, float, float, float], lat: float, lon: float) -> bool:
    s, w, n, e = bounds
    return s <= lat <= n and w <= lon <= e


# ---------------------------------------------------------------------- reading the feeds
def when(s: Any, tz: dt.tzinfo, *formats: str) -> int | None:
    """A feed's time as epoch seconds: ISO 8601 (in its own offset if it has one, else the network's local time), or
    one of `formats` (local time). None for blanks, words, and the placeholders feeds use for "not known"
    (0001-01-01, 1970-01-01)."""
    text = str(s or "").strip()
    if not text:
        return None
    t: dt.datetime | None = None
    try:
        t = dt.datetime.fromisoformat(text)
    except ValueError:
        for f in formats:
            try:
                t = dt.datetime.strptime(text.upper(), f)
                break
            except ValueError:
                continue
    if t is None or t.year < 2000:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=tz)
    return int(t.timestamp())


def words(s: Any) -> str | None:
    """A feed's text, or None when it says nothing ("", "None", "null")."""
    text = " ".join(str(s or "").split())
    return text if text and text.lower() not in ("none", "null", "n/a") else None


def split(s: Any) -> list[str]:
    """A comma-separated list (or a list already) as its non-empty items."""
    items = s if isinstance(s, list) else str(s or "").split(",")
    return [str(p).strip() for p in items if str(p).strip()]


def to_int(s: Any) -> int | None:
    try:
        return int(float(str(s).strip()))
    except (TypeError, ValueError):
        return None


def to_float(s: Any) -> float | None:
    try:
        x = float(s)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def ring_of(points: Iterable[Any], lat: str = "lat", lon: str = "lng") -> Ring:
    """A ring from a list of {lat, lng} (or other keys), skipping what isn't a number."""
    out: Ring = []
    for p in points or []:
        if isinstance(p, Mapping):
            x, y = to_float(p.get(lon)), to_float(p.get(lat))
            if x is not None and y is not None:
                out.append((x, y))
    return out if len(out) >= 3 else []


def rings_of(geometry: Mapping[str, Any] | None) -> tuple[tuple[float, float] | None, list[Ring]]:
    """A GeoJSON geometry's point (lon, lat) and its polygons' outer rings."""
    if not geometry:
        return None, []
    kind = geometry.get("type")
    if kind == "Feature":
        return rings_of(geometry.get("geometry"))
    if kind == "GeometryCollection":
        point, rings = None, []
        for g in geometry.get("geometries") or []:
            p, r = rings_of(g)
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


def middle(ring: Ring) -> tuple[float, float]:
    xs, ys = [x for x, _ in ring], [y for _, y in ring]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def circle(lon: float, lat: float, metres: float, sides: int = 24) -> Ring:
    """A circle as a ring, for a network that gives an outage's centre and radius rather than its area."""
    dlat = metres / 111_320
    dlon = metres / (111_320 * max(0.1, math.cos(math.radians(lat))))
    return [
        (lon + dlon * math.cos(2 * math.pi * i / sides), lat + dlat * math.sin(2 * math.pi * i / sides))
        for i in range(sides + 1)
    ]


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


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


GONE = ("cancel", "complete", "restored", "finished", "delog")


def gone(status: Any) -> bool:
    """A job the network has finished with: called off, done, or power back on (the maps keep them for a while)."""
    s = str(status or "").strip().lower()
    return any(s.startswith(g) for g in GONE)


# A job whose end passed this long ago is a feed's leftover, not an outage (some feeds keep jobs for weeks, still
# marked as started): planned work an hour after it was due to finish, an outage half a day after its estimate.
LEFTOVER_PLANNED = 3600
LEFTOVER_UNPLANNED = 12 * 3600


def leftover(o: Mapping[str, Any], now: float) -> bool:
    end = o.get("end")
    if end is None:
        return False
    return end < now - (LEFTOVER_PLANNED if o.get("planned") else LEFTOVER_UNPLANNED)


def outage(
    network: str,
    oid: Any,
    *,
    planned: bool,
    status: Any = None,
    reason: Any = None,
    customers: Any = None,
    start: int | None = None,
    end: int | None = None,
    end_text: Any = None,
    streets: Iterable[str] = (),
    suburbs: Iterable[str] = (),
    point: tuple[float, float] | None = None,
    area: list[Ring] | None = None,
) -> dict[str, Any] | None:
    """One outage in the shape every network's are given in, or None if it has no id or nowhere to put it."""
    oid = str(oid or "").strip()
    rings = [r for r in (area or []) if len(r) >= 3]
    streets, suburbs = list(dict.fromkeys(streets)), list(dict.fromkeys(suburbs))
    if not oid:
        return None
    if point is None and rings:  # no marker: the middle of its area
        point = middle(rings[0])
    if point is None and not streets:
        return None
    return {
        "id": f"{network}:{oid}",
        "network": network,
        "planned": planned,
        "status": words(status),
        "reason": words(reason),
        "customers": to_int(customers),
        "start": start,
        "end": end,
        "end_text": None if end else words(end_text),
        "streets": streets,
        "suburbs": suburbs,
        "lon": point[0] if point else None,
        "lat": point[1] if point else None,
        "area": rings,
    }


def kept(items: Iterable[dict[str, Any] | None]) -> list[dict[str, Any]]:
    return [o for o in items if o]
