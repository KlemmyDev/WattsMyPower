"""The electricity network's outages around the house (app.features.grid.outages), with the networks' maps made up."""

from __future__ import annotations

import time
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.alerts.rules import BY_ID, Facts, RuleState
from app.features.grid.outages.energyq import outage, qld_time
from app.features.grid.outages.service import OutageService, bearing, distance_km, inside, street_key
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


def _get(url: str) -> Any:
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


# -- alerts --------------------------------------------------------------------------------------
def _facts(reasons: list[dict[str, Any]], soc: float = 55.0) -> Facts:
    return Facts(
        now=NOW,
        snapshot={"ts": NOW, "battery_soc": soc},
        hybrid_connected=True,
        last_success=NOW,
        error=None,
        poll_interval=60,
        pv2=None,
        reserve=5.0,
        sun=30.0,
        daylight_since=NOW - 4 * 3600,
        grid=lambda: {"level": "watch", "reasons": reasons},
    )


def test_outage_alerts(settings: SettingsStore) -> None:
    reasons = _service(settings).reasons()
    out = BY_ID["power_outage"].check(_facts(reasons), {}, RuleState("power_outage"))
    assert out.state == "bad" and out.title == "Power outage at your street"
    assert BY_ID["power_outage"].check(_facts([]), {}, RuleState("power_outage")).state == "ok"

    rule = BY_ID["planned_outage"]
    told = rule.check(_facts(reasons), rule.values(), RuleState("planned_outage"))
    assert told.state == "report" and "charge it from the grid" in told.message
    again = rule.check(_facts(reasons), rule.values(), RuleState("planned_outage", data=told.data or {}))
    assert again.state == "unknown"  # told once
    assert rule.check(_facts(reasons), {"hours": 6}, RuleState("planned_outage")).state == "unknown"  # not yet

    nearby = [
        {"kind": "outages_nearby", "level": "watch", "title": "4 power outages within 15 km", "detail": "x", "count": 4}
    ]
    rule = BY_ID["outages_nearby"]
    assert rule.check(_facts(nearby), rule.values(), RuleState("outages_nearby")).state == "bad"
    assert rule.check(_facts(nearby), {"count": 5}, RuleState("outages_nearby")).state == "unknown"
