"""
The Bureau of Meteorology's warnings for where the house is: severe thunderstorms, severe weather (damaging winds,
heavy rain), tropical cyclones, floods and fire weather, the weather that takes power lines down.

From the Bureau's anonymous FTP service, the channel it offers for automated access (its website turns automated
requests away). Free, under the Bureau's default copyright terms: http://www.bom.gov.au/catalogue/anon-ftp.shtml

    /anon/gen/fwo/ID{state}*.cap.xml         each warning in force, in CAP-AU (the Common Alerting Protocol): what,
                                             how severe, until when, and the areas it's for, by their AMOC codes
    /anon/home/adfd/spatial/IDM00013.dbf     the Bureau's forecast towns, with where each is and the public weather
                                             (PW), fire weather (FW) and metropolitan (ME) districts it's in
    /anon/home/adfd/spatial/IDM00018.dbf     river gauges, with where each is and its river catchment (RC), for flood
                                             warnings
    /anon/home/adfd/spatial/IDM00014.shp     the metropolitan and council areas (ME) the Bureau's detailed storm
                     and .dbf                warnings are for (Ipswich, Moreton Bay...), with their outlines

A warning is for the house when one of its area codes is one of the house's (the districts of its nearest forecast
town, the council area it's in, and the catchments of rivers gauged nearby), or when it comes with a polygon around
the house. A warning for only part of a district names the places it may affect: when none of them is near the house,
it's somewhere else in the district (see reach).
"""

from __future__ import annotations

import datetime as dt
import ftplib
import io
import itertools
import math
import re
import struct
import xml.etree.ElementTree as ET
from collections.abc import Callable
from typing import Any

HOST = "ftp.bom.gov.au"
WARNINGS = "/anon/gen/fwo"
SPATIAL = "/anon/home/adfd/spatial"
TOWNS = "IDM00013.dbf"
GAUGES = "IDM00018.dbf"
METRO = ("IDM00014.shp", "IDM00014.dbf")
GAUGE_NEAR_KM = 15  # a flood warning for a river gauged this close counts

# Each state's product ID prefix.
PREFIX = {"QLD": "IDQ", "NSW": "IDN", "ACT": "IDN", "VIC": "IDV", "SA": "IDS", "TAS": "IDT", "WA": "IDW", "NT": "IDD"}

CAP = {"c": "urn:oasis:names:tc:emergency:cap:1.2"}

# Warnings that say nothing about the power: for farmers, for the sea and the road.
IGNORED = re.compile(r"sheep|grazier|frost|marine|coastal waters|road weather|surf|swell|tsunami test", re.I)


def read_dbf(data: bytes) -> list[dict[str, str]]:
    """A dBase table (a shapefile's attributes) as rows of text."""
    count, header, size = struct.unpack("<4xIHH", data[:12])
    fields: list[tuple[str, int]] = []
    i = 32
    while data[i] != 0x0D:
        fields.append((data[i : i + 11].split(b"\0")[0].decode("latin1"), data[i + 16]))
        i += 32
    rows = []
    for r in range(count):
        at = header + r * size
        if data[at : at + 1] == b"*":  # deleted
            continue
        at += 1
        row: dict[str, str] = {}
        for name, length in fields:
            row[name] = data[at : at + length].decode("latin1").strip()
            at += length
        rows.append(row)
    return rows


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _float(s: str | None) -> float | None:
    try:
        return float(s) if s else None
    except ValueError:
        return None


def areas_at(lat: float, lon: float, shp: bytes, rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    """The areas of a polygon shapefile (and its table's rows, in the same order) that hold a point, smallest first.
    Only the records whose bounding box holds it are read in full."""
    out = []
    at, i = 100, 0
    while at + 8 <= len(shp) and i < len(rows):
        length = struct.unpack(">i", shp[at + 4 : at + 8])[0] * 2
        rec, at, row = shp[at + 8 : at + 8 + length], at + 8 + length, rows[i]
        i += 1
        if len(rec) < 44 or struct.unpack("<i", rec[:4])[0] not in (5, 15, 25):  # polygons (plain, Z, M)
            continue
        x0, y0, x1, y1 = struct.unpack("<4d", rec[4:36])
        if not (x0 <= lon <= x1 and y0 <= lat <= y1):
            continue
        nparts, npoints = struct.unpack("<2i", rec[36:44])
        starts = [*struct.unpack(f"<{nparts}i", rec[44 : 44 + 4 * nparts]), npoints]
        xy = struct.unpack(f"<{2 * npoints}d", rec[44 + 4 * nparts : 44 + 4 * nparts + 16 * npoints])
        hit = False
        for a, b in itertools.pairwise(starts):  # rings: an outline, or a hole in one
            if inside(lat, lon, [(xy[2 * k + 1], xy[2 * k]) for k in range(a, b)]):
                hit = not hit
        if hit:
            out.append({"code": row.get("AAC", ""), "name": row.get("DIST_NAME", ""), "size": (x1 - x0) * (y1 - y0)})
    return sorted(out, key=lambda a: a["size"])


def districts_at(
    lat: float,
    lon: float,
    towns: list[dict[str, str]],
    gauges: list[dict[str, str]],
    metro: tuple[bytes, list[dict[str, str]]] | None = None,
) -> dict[str, Any]:
    """The house's place in the Bureau's areas: its nearest forecast town, that town's districts, the council and
    metropolitan areas it's in (from their outlines), the catchments of rivers gauged nearby, and its state."""
    best: tuple[float, dict[str, str]] | None = None
    for t in towns:
        if t.get("LAND_FLAG") == "0":
            continue
        tlat, tlon = _float(t.get("LAT")), _float(t.get("LON"))
        if tlat is None or tlon is None:
            continue
        d = _km(lat, lon, tlat, tlon)
        if best is None or d < best[0]:
            best = (d, t)
    if best is None:
        return {"town": None, "state": None, "codes": []}
    town = best[1]
    # A field can hold several codes ("NSW_ME001 NSW_ME008"): a town in more than one metropolitan area.
    codes = {c for k in ("AAC_PW", "AAC_FW", "AAC_ME") for c in town.get(k, "").split()}
    for g in gauges:
        glat, glon = _float(g.get("LAT")), _float(g.get("LON"))
        if glat is not None and glon is not None and _km(lat, lon, glat, glon) <= GAUGE_NEAR_KM:
            codes |= {c for k in ("AAC_SRC", "AAC") for c in g.get(k, "").split()}
    areas = areas_at(lat, lon, *metro) if metro else []
    codes |= {a["code"] for a in areas if a["code"]}
    return {
        "town": town.get("PT_NAME"),
        "town_km": round(best[0], 1),
        # The council (or metropolitan) area the house is in, the smallest that holds it: the Bureau's detailed
        # storm warnings are for these.
        "area": areas[0]["name"] if areas else None,
        "state": town.get("STATE_CODE"),
        "codes": sorted(codes),
    }


def gazetteer(towns: list[dict[str, str]], state: str | None) -> dict[str, tuple[float, float]]:
    """Where each of a state's forecast towns is, by name (lower case): to find the places a warning names."""
    out = {}
    for t in towns:
        tlat, tlon = _float(t.get("LAT")), _float(t.get("LON"))
        if tlat is not None and tlon is not None and t.get("STATE_CODE") == state and t.get("PT_NAME"):
            out[t["PT_NAME"].lower()] = (tlat, tlon)
    return out


def named_places(text: str) -> list[str]:
    """The places a warning for part of a district names: "Locations which may be affected include Caboolture and
    Redcliffe." Empty when it names none."""
    m = re.search(r"locations which may be affected include (.+?)(?:\.(?:\s|$)|$)", " ".join(text.split()), re.I)
    if not m:
        return []
    return [p.strip() for p in re.split(r",|\band\b", m.group(1)) if p.strip()]


def _segment_km(lat: float, lon: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    """How far a point is from the line between two places (flat, near enough at these distances)."""
    k = math.cos(math.radians(lat))
    ax, ay, bx, by = (a[1] - lon) * k, a[0] - lat, (b[1] - lon) * k, b[0] - lat
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
    return math.hypot(ax + t * dx, ay + t * dy) * 111.2


def reach(lat: float, lon: float, text: str, places: dict[str, tuple[float, float]]) -> dict[str, Any] | None:
    """For a warning that names the places it may affect: those found, and how far the house is from them (the
    nearest, or the line between two, as the area takes in what's between). None when it names none we know."""
    found = [(n, places[n.lower()]) for n in named_places(text) if n.lower() in places]
    if not found:
        return None
    nearest = min(found, key=lambda f: _km(lat, lon, *f[1]))
    km = _km(lat, lon, *nearest[1])
    for i, (_, a) in enumerate(found):
        for _, b in found[i + 1 :]:
            km = min(km, _segment_km(lat, lon, a, b))
    return {"near": [n for n, _ in found], "distance_km": round(km), "toward": nearest[1]}


def _time(s: str | None) -> int | None:
    if not s:
        return None
    try:
        return int(dt.datetime.fromisoformat(s.strip()).timestamp())
    except ValueError:
        return None


def parse_cap(xml: str) -> dict[str, Any] | None:
    """A CAP-AU warning: what it is, how severe, when, and its areas (codes and any polygons). None for one that's
    been cancelled, or isn't about anything that touches the power."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    msg_type = (root.findtext("c:msgType", "", CAP) or "").strip()
    info = root.find("c:info", CAP)
    if info is None or msg_type == "Cancel":
        return None
    event = (info.findtext("c:event", "", CAP) or "").strip()
    headline = (info.findtext("c:headline", "", CAP) or "").strip()
    if IGNORED.search(event) or IGNORED.search(headline) or headline.lower().startswith("cancellation"):
        return None
    codes: list[str] = []
    polygons: list[list[tuple[float, float]]] = []
    areas: list[str] = []
    for area in info.findall("c:area", CAP):
        areas.append((area.findtext("c:areaDesc", "", CAP) or "").strip())
        for g in area.findall("c:geocode", CAP):
            if (g.findtext("c:valueName", "", CAP) or "") == "AMOC-AreaCode":
                codes.append((g.findtext("c:value", "", CAP) or "").strip())
        for p in area.findall("c:polygon", CAP):
            ring = []
            for pair in (p.text or "").split():
                try:
                    a, b = pair.split(",")[:2]
                    ring.append((float(a), float(b)))  # CAP polygons are latitude,longitude
                except ValueError:
                    continue
            if len(ring) >= 3:
                polygons.append(ring)
    web = (info.findtext("c:web", "", CAP) or "").strip()
    return {
        "id": (root.findtext("c:identifier", "", CAP) or "").strip(),
        "event": event,
        "severity": (info.findtext("c:severity", "", CAP) or "").strip(),
        "headline": headline,
        "description": (info.findtext("c:description", "", CAP) or "").strip(),
        "effective": _time(info.findtext("c:effective", None, CAP)),
        "expires": _time(info.findtext("c:expires", None, CAP)),
        "areas": [a for a in areas if a],
        # The Bureau's page for it (its warnings page, as it gives it), over https.
        "url": re.sub(r"^http://", "https://", web) if web.startswith(("http://", "https://")) else None,
        "codes": codes,
        "polygons": polygons,
    }


def inside(lat: float, lon: float, ring: list[tuple[float, float]]) -> bool:
    """Whether a point is inside a ring of (lat, lon)."""
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        yi, xi = ring[i]
        yj, xj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


class BomFtp:
    """The Bureau's anonymous FTP: list a folder, fetch a file. One connection per call, closed after."""

    def __init__(self, connect: Callable[[], ftplib.FTP] = lambda: ftplib.FTP(HOST, timeout=30)):
        self._connect = connect

    def _session(self) -> ftplib.FTP:
        ftp = self._connect()
        ftp.login()
        return ftp

    def files(self, folder: str, match: Callable[[str], bool]) -> dict[str, bytes]:
        """Every file in `folder` whose name `match`es, by name."""
        ftp = self._session()
        try:
            ftp.cwd(folder)
            out = {}
            for name in [n for n in ftp.nlst() if match(n)]:
                buf = io.BytesIO()
                ftp.retrbinary(f"RETR {name}", buf.write)
                out[name] = buf.getvalue()
            return out
        finally:
            try:
                ftp.quit()
            except ftplib.all_errors:
                ftp.close()
