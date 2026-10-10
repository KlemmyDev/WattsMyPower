"""The electricity network's outages around the house (app.features.grid.outages), with the networks' maps made up."""

from __future__ import annotations

import time
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.grid.outages.energyq import CHROME, browser_headers, outage, qld_time
from app.features.grid.outages.service import OutageService, bearing, distance_km, inside, next_wait, street_key
from app.features.settings.store import SettingsStore

HOME = (-27.6215, 153.1350)  # Springwood
NOW = qld_time("10:00AM 08 Oct 2026") or 0


def _feature(oid: str, kind: str, start: str, end: str, streets: str, suburbs: str, point: tuple[float, float],
             area: list[list[float]] | None = None, customers: str = "27") -> dict[str, Any]:  # fmt: skip
    geometry: dict[str, Any] = {"type": "Point", "coordinates": [point[1], point[0]]}
    if area:
        geometry = {"type": "GeometryCollection", "geometries": [geometry, {"type": "Polygon", "coordinates": [area]}]}
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "EVENT_ID": oid, "TYPE": kind, "CUSTOMERS_AFFECTED": customers, "REASON": "Emergency repairs in-progress",
            "STATUS": "Awaiting", "START": start, "EST_FIX_TIME": end, "STREETS": streets, "SUBURBS": suburbs,
        },
    }  # fmt: skip


# A small square around the house: the area an unplanned outage is off.
SQUARE = [[153.13, -27.625], [153.14, -27.625], [153.14, -27.618], [153.13, -27.618], [153.13, -27.625]]

FILES = {
    "ex_map_current_unplanned": [
        _feature("INCD-1", "UNPLANNED", "9:34AM 08 Oct 2026", "12:00PM 08 Oct 2026", "BEATRICE CT, DELILAH ST",
                 "SPRINGWOOD", (-27.6215, 153.1352), SQUARE),
        _feature("INCD-2", "UNPLANNED", "9:00AM 08 Oct 2026", "Under Investigation", "MAIN RD", "WELLINGTON POINT",
                 (-27.48, 153.24), customers="350"),
        _feature("INCD-3", "UNPLANNED", "9:00AM 08 Oct 2026", "1:00PM 08 Oct 2026", "ARUNDELL AVE", "NAMBOUR",
                 (-26.63, 152.96)),
    ],
    "ex_map_current_planned": [
        _feature("INCD-4", "PLANNED", "8:00AM 08 Oct 2026", "3:00PM 08 Oct 2026", "LOGAN RD", "UNDERWOOD",
                 (-27.61, 153.11)),
    ],
    "ex_map_future_planned": [
        # Already under way (it's in the current file too): listed once, as an outage now.
        _feature("INCD-4", "PLANNED", "8:00AM 08 Oct 2026", "3:00PM 08 Oct 2026", "LOGAN RD", "UNDERWOOD",
                 (-27.61, 153.11)),
        _feature("INCD-5", "PLANNED", "8:00AM 09 Oct 2026", "2:00PM 09 Oct 2026", "DESIREE CT, DELILAH ST",
                 "SPRINGWOOD", (-27.62, 153.13)),
        _feature("INCD-6", "PLANNED", "8:00AM 30 Oct 2026", "2:00PM 30 Oct 2026", "RIVER RD", "DAISY HILL",
                 (-27.63, 153.15)),
    ],
}  # fmt: skip


def _get(url: str, **_: Any) -> Any:
    name = url.rsplit("/", 1)[-1].removesuffix(".geojson")
    if name.endswith("servicearea"):
        raise OSError("not in this test")  # fall back to the networks' bounds
    return {"type": "FeatureCollection", "features": FILES.get(name, [])}


@pytest.fixture(autouse=True)
def brisbane(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Times are written in the house's time: Queensland's, here."""
    monkeypatch.setenv("TZ", "Australia/Brisbane")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


@pytest.fixture
def settings(config: Config, db: Database) -> SettingsStore:
    s = SettingsStore(db, config)
    s.load()
    s.save({"latitude": HOME[0], "longitude": HOME[1], "home_street": "Delilah Street", "home_suburb": "Springwood"})
    return s


def _service(settings: SettingsStore, region: str | None = "QLD1") -> OutageService:
    svc = OutageService(settings, lambda: region, get=_get, clock=lambda: NOW)
    svc.refresh()
    return svc


def test_reading_the_map_files() -> None:
    o = outage("energex", FILES["ex_map_current_unplanned"][1])
    assert o and o["id"] == "energex:INCD-2" and not o["planned"] and o["customers"] == 350
    assert o["end"] is None and o["end_text"] == "Under Investigation"
    assert o["streets"] == ["MAIN RD"] and (o["lat"], o["lon"]) == (-27.48, 153.24)
    assert qld_time("9:34AM 08 Oct 2026") == qld_time("09:34am 08 OCT 2026")
    assert qld_time("Under Investigation") is None


def test_cancelled_work_is_left_out() -> None:
    called_off = _feature(
        "INCD-9", "PLANNED", "8:00AM 09 Oct 2026", "2:00PM 09 Oct 2026", "BOYNE ST", "ELLEN GROVE", (-27.61, 152.94)
    )
    called_off["properties"]["STATUS"] = "Cancelled"
    assert outage("energex", called_off) is None


def test_streets_compare_however_theyre_written() -> None:
    assert street_key("Delilah Street") == street_key("DELILAH ST") == "DELILAH STREET"
    assert street_key("St Lucia Rd") == "ST LUCIA ROAD"  # only the last word is the street's type
    assert street_key("Beatrice Ct.") == street_key("BEATRICE COURT")


def test_geometry() -> None:
    assert inside(HOME[0], HOME[1], [(x, y) for x, y in SQUARE])
    assert not inside(-27.5, 153.0, [(x, y) for x, y in SQUARE])
    assert 15 < distance_km(*HOME, -27.48, 153.24) < 20
    assert bearing(*HOME, -27.48, 153.24) == "NE"


def test_outages_around_the_house(settings: SettingsStore) -> None:
    svc = _service(settings)
    v = svc.view()
    assert v["network"]["id"] == "energex" and v["network_auto"]
    now = [o["id"] for o in v["now"]]
    # Ours first (it lists our street), then the planned work under way nearby; Wellington Point is 18 km away
    # (beyond the 15 km radius) and Nambour much further.
    assert now == ["energex:INCD-1", "energex:INCD-4"]
    assert v["now"][0]["affects"] == "street" and v["now"][1]["affects"] is None
    assert [o["id"] for o in v["planned"]] == ["energex:INCD-5"]  # INCD-6 is more than two weeks off
    assert v["planned"][0]["affects"] == "street"
    assert v["summary"] == {"outages": 1, "customers": 27, "nearest_km": 0.0}
    assert v["fetched_at"] == v["planned_at"] == NOW and v["error"] is None
    settings.save({"outage_radius_km": 25})
    assert "energex:INCD-2" in [o["id"] for o in svc.view()["now"]]


def test_the_area_counts_without_a_street(settings: SettingsStore) -> None:
    settings.save({"home_street": "", "home_suburb": ""})
    svc = _service(settings)
    first = svc.view()["now"][0]
    assert first["id"] == "energex:INCD-1" and first["affects"] == "area"
    assert svc.view()["planned"][0]["affects"] is None  # planned work has no area: only a street can match it


def test_outside_queensland_or_turned_off(settings: SettingsStore) -> None:
    assert _service(settings, region="NSW1").view()["network"] is None
    settings.save({"power_network": "none"})
    v = _service(settings).view()
    assert v["network"] is None and v["now"] == [] and v["planned"] == []
    settings.save({"power_network": "ergon"})
    assert _service(settings, region="NSW1").view()["network"]["id"] == "ergon"


def test_reasons_for_the_outlook(settings: SettingsStore) -> None:
    kinds = {r["kind"]: r for r in _service(settings).reasons()}
    assert kinds["outage_here"]["level"] == "outage" and "expected back by 12 pm" in kinds["outage_here"]["detail"]
    assert kinds["planned_here"]["level"] == "warning"  # tomorrow
    assert kinds["planned_here"]["title"] == "Planned outage at your street tomorrow"
    assert "outages_nearby" not in kinds  # the only unplanned one within the radius is ours


def test_feeds_are_asked_for_as_a_browser_would() -> None:
    h = browser_headers("https://www.energex.com.au/static/PRD/ex_map_current_unplanned.geojson")
    assert h["User-Agent"].startswith("Mozilla/5.0") and f"Chrome/{CHROME}." in h["User-Agent"]
    assert f'v="{CHROME}"' in h["sec-ch-ua"] and h["Referer"] == "https://www.energex.com.au/"
    assert "gzip" in h["Accept-Encoding"] and h["Sec-Fetch-Site"] == "same-origin"


def test_compressed_answers_are_unpacked(monkeypatch: pytest.MonkeyPatch) -> None:
    import gzip
    import io
    import urllib.request
    from email.message import Message

    from app.core import http

    class Resp(io.BytesIO):
        headers = Message()

    resp = Resp(gzip.compress(b'{"features": []}'))
    resp.headers["Content-Encoding"] = "gzip"
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: resp)
    assert http.get_json("https://example.invalid/x.geojson") == {"features": []}


def test_fetches_are_spread_out() -> None:
    assert next_wait(lambda lo, hi: lo) == 12 * 60 and next_wait(lambda lo, hi: hi) == 18 * 60
    waits = {next_wait() for _ in range(20)}
    assert len(waits) > 1 and all(12 * 60 <= w <= 18 * 60 for w in waits)


def test_each_outage_says_where_to_see_it_and_its_area(settings: SettingsStore) -> None:
    v = _service(settings).view()
    ours, underway = v["now"]
    # Energex opens an outage now by its number; planned work only as the list for its suburb.
    assert ours["url"] == (
        "https://www.energex.com.au/outages/outage-finder/emergency-outages-text-view?event=INCD-1"
    ) and ours["url_exact"]
    assert underway["url"].endswith("planned-outages-text-view?suburb-postcode=UNDERWOOD")
    assert not underway["url_exact"]
    # The area comes along, roughly, for the radar: [lon, lat] corners.
    assert ours["area"] == [[list(p) for p in SQUARE]] and underway["area"] == []


def test_rough_areas_keep_their_largest_rings_and_few_corners() -> None:
    from app.features.grid.outages.base import rough

    big = [(153 + i / 1000, -27 - i / 1000) for i in range(500)]
    small = [(1.0, 2.0), (1.1, 2.0), (1.1, 2.1)]
    out = rough([small, big], points=48, most=1)
    assert len(out) == 1 and len(out[0]) <= 48 and out[0][0] == [153.0, -27.0]
