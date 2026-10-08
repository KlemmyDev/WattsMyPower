"""Weather and fire warnings for the house (app.features.grid.warnings), with the Bureau's FTP and QFD's feed made up."""

from __future__ import annotations

import struct
from collections.abc import Callable
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.grid.warnings import bom, qfd
from app.features.grid.warnings.service import HazardService
from app.features.settings.store import SettingsStore

HOME = (-27.6466, 152.8665)  # Redbank Plains
NOW = 1_791_420_000


def dbf(fields: list[str], rows: list[dict[str, str]]) -> bytes:
    """A small dBase table, as the Bureau's spatial files are."""
    width = 40
    header = 32 + 32 * len(fields) + 1
    size = 1 + width * len(fields)
    out = bytearray(struct.pack("<4xIHH20x", len(rows), header, size))
    for name in fields:
        out += name.encode().ljust(11, b"\0") + b"C" + b"\0" * 4 + bytes([width]) + b"\0" * 15
    out += b"\x0d"
    for r in rows:
        out += b" " + b"".join(r.get(f, "").encode().ljust(width) for f in fields)
    return bytes(out)


TOWNS = dbf(
    ["PT_NAME", "STATE_CODE", "LAT", "LON", "LAND_FLAG", "AAC_PW", "AAC_FW", "AAC_ME"],
    [
        {"PT_NAME": "Ipswich", "STATE_CODE": "QLD", "LAT": "-27.6161", "LON": "152.7607", "LAND_FLAG": "1",
         "AAC_PW": "QLD_PW015", "AAC_FW": "QLD_FW015"},
        {"PT_NAME": "Toowoomba", "STATE_CODE": "QLD", "LAT": "-27.5598", "LON": "151.9507", "LAND_FLAG": "1",
         "AAC_PW": "QLD_PW014", "AAC_FW": "QLD_FW014"},
    ],
)  # fmt: skip
GAUGES = dbf(
    ["AAC", "AAC_SRC", "LAT", "LON"],
    [{"AAC": "QLD_RS027", "AAC_SRC": "QLD_RC097", "LAT": "-27.62", "LON": "152.88"}],
)


def cap(
    event: str, headline: str, codes: list[str], polygon: str = "", msg: str = "Alert", severity: str = "Severe"
) -> bytes:
    geo = "".join(f"<geocode><valueName>AMOC-AreaCode</valueName><value>{c}</value></geocode>" for c in codes)
    poly = f"<polygon>{polygon}</polygon>" if polygon else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>AusBoM-{event}</identifier><msgType>{msg}</msgType>
  <info><event>{event}</event><severity>{severity}</severity>
    <effective>2026-10-08T00:00:00+00:00</effective><expires>2026-10-08T12:00:00+00:00</expires>
    <headline>{headline}</headline><description>Damaging winds and large hail.</description>
    <area><areaDesc>Queensland: South East Coast</areaDesc>{geo}{poly}</area>
  </info>
</alert>""".encode()


WARNINGS = {
    "IDQ21033.cap.xml": cap(
        "Severe Thunderstorm", "Severe Thunderstorm Warning for parts of South East Coast", ["QLD_PW015"]
    ),
    "IDQ21034.cap.xml": cap(
        "Severe Thunderstorm", "Severe Thunderstorm Warning for Darling Downs", ["QLD_PW014"]
    ),  # not ours
    "IDQ20885.cap.xml": cap(
        "Riverine Flood", "Minor Flood Warning for the Bremer River", ["QLD_RC097"], severity="Minor"
    ),
    "IDQ20085.cap.xml": cap("Wind", "Strong Wind Warning for coastal waters", ["QLD_MW012"]),  # the sea: ignored
    "IDQ29000.cap.xml": cap("Sheep Grazier Warning", "Warning to Sheep Graziers", ["QLD_PW015"]),  # ignored
    "IDQ21035.cap.xml": cap(
        "Severe Weather", "Cancellation of Severe Weather Warning", ["QLD_PW015"], msg="Cancel"
    ),  # ignored
    "IDN21033.cap.xml": cap("Severe Thunderstorm", "NSW storm", ["NSW_PW005"]),  # another state's
}


class Ftp:
    def __init__(self) -> None:
        self.asked: list[str] = []

    def files(self, folder: str, match: Callable[[str], bool]) -> dict[str, bytes]:
        self.asked.append(folder)
        source = {bom.TOWNS: TOWNS, bom.GAUGES: GAUGES} if folder == bom.SPATIAL else WARNINGS
        return {n: b for n, b in source.items() if match(n)}


def _fire(oid: str, level: str, area: str, lat: float, lon: float, polygon: list[list[float]] | None = None) -> Any:
    geometry = (
        {"type": "Polygon", "coordinates": [polygon]} if polygon else {"type": "Point", "coordinates": [lon, lat]}
    )
    props = {"UniqueID": oid, "WarningLevel": level, "WarningArea": area, "CallToAction": "Prepare to leave"}
    if not polygon:
        props |= {"Latitude": lat, "Longitude": lon}
    return {"type": "Feature", "geometry": geometry, "properties": props}


FIRES = [
    _fire("F1", "Watch and Act", "COLLINGWOOD PARK", -27.62, 152.84),  # 3 km away
    _fire("F2", "Information", "SPRINGFIELD", -27.66, 152.91),  # 4.5 km, no warning: close enough to list
    _fire("F3", "Information", "TOOWOOMBA", -27.56, 151.95),  # 90 km, no warning: left out
    _fire(
        "F4",
        "Advice",
        "REDBANK PLAINS",
        0,
        0,
        polygon=[[152.85, -27.66], [152.88, -27.66], [152.88, -27.63], [152.85, -27.63], [152.85, -27.66]],
    ),  # its area covers the house
]


@pytest.fixture
def settings(config: Config, db: Database) -> SettingsStore:
    s = SettingsStore(db, config)
    s.load()
    s.save({"latitude": HOME[0], "longitude": HOME[1]})
    return s


def _service(settings: SettingsStore, region: str = "QLD1") -> HazardService:
    fires = [f for f in (qfd.fire(x) for x in FIRES) if f]
    svc = HazardService(settings, lambda: region, ftp=Ftp(), fires=lambda: fires, clock=lambda: NOW)  # type: ignore[arg-type]
    svc.refresh()
    return svc


def test_dbf_and_districts() -> None:
    towns, gauges = bom.read_dbf(TOWNS), bom.read_dbf(GAUGES)
    assert [t["PT_NAME"] for t in towns] == ["Ipswich", "Toowoomba"]
    place = bom.districts_at(*HOME, towns, gauges)
    assert place["town"] == "Ipswich" and place["state"] == "QLD"
    assert place["codes"] == ["QLD_FW015", "QLD_PW015", "QLD_RC097", "QLD_RS027"]


def test_cap_parsing() -> None:
    w = bom.parse_cap(WARNINGS["IDQ21033.cap.xml"].decode())
    assert w and w["event"] == "Severe Thunderstorm" and w["codes"] == ["QLD_PW015"] and w["expires"]
    assert bom.parse_cap(WARNINGS["IDQ20085.cap.xml"].decode()) is None
    assert bom.parse_cap(WARNINGS["IDQ21035.cap.xml"].decode()) is None
    poly = bom.parse_cap(
        cap("Severe Thunderstorm", "x", [], "-27.7,152.8 -27.7,152.9 -27.6,152.9 -27.6,152.8").decode()
    )
    assert poly and poly["polygons"] and bom.inside(*HOME, poly["polygons"][0])


def test_warnings_for_the_house(settings: SettingsStore) -> None:
    v = _service(settings).view()
    assert v["town"] == "Ipswich" and v["fires_followed"]
    assert [w["headline"] for w in v["weather"]] == [
        "Severe Thunderstorm Warning for parts of South East Coast",
        "Minor Flood Warning for the Bremer River",
    ]
    assert [w["level"] for w in v["weather"]] == ["warning", "watch"]
    assert [f["id"] for f in v["fires"]] == ["qfd:F1", "qfd:F4", "qfd:F2"]  # most serious first
    assert v["fires"][1]["here"] and v["fires"][0]["direction"] == "NW"


def test_reasons(settings: SettingsStore) -> None:
    reasons = _service(settings).reasons()
    by = {(r["kind"], r["id"]): r for r in reasons}
    storm = next(r for r in reasons if r["kind"] == "bom" and "Thunderstorm" in r["title"])
    assert storm["level"] == "warning"
    assert by[("fire", "qfd:F1")]["level"] == "warning"
    assert by[("fire", "qfd:F4")]["level"] == "watch" and "your area" in by[("fire", "qfd:F4")]["detail"]
    assert ("fire", "qfd:F2") not in by  # no warning: on the page only


def test_outside_queensland_and_turned_off(settings: SettingsStore) -> None:
    v = _service(settings, region="NSW1").view()
    assert v["fires"] == [] and not v["fires_followed"]
    settings.save({"hazard_warnings": 0})
    v = _service(settings).view()
    assert not v["enabled"] and v["weather"] == [] and v["fires"] == []


def test_each_source_says_whether_it_answered(settings: SettingsStore) -> None:
    class Down:
        def files(self, folder: str, match: Callable[[str], bool]) -> dict[str, bytes]:
            raise OSError("FTP refused")

    fires = [f for f in (qfd.fire(x) for x in FIRES) if f]
    svc = HazardService(settings, lambda: "QLD1", ftp=Down(), fires=lambda: fires, clock=lambda: NOW)  # type: ignore[arg-type]
    assert svc.view()["fetched_at"] is None  # not asked yet: checking
    svc.refresh()
    v = svc.view()
    # The Fire Department answered and the Bureau didn't: "couldn't ask", not "no warnings".
    assert v["sources"]["qfd"] == {"at": NOW, "error": None}
    assert v["sources"]["bom"]["at"] is None and "couldn't be reached" in v["sources"]["bom"]["error"]
    assert v["fetched_at"] is None and v["weather"] == [] and v["fires"]
    svc.ftp = Ftp()  # type: ignore[assignment]
    svc.refresh()
    v = svc.view()
    assert v["fetched_at"] == NOW and v["error"] is None and v["sources"]["bom"]["error"] is None
