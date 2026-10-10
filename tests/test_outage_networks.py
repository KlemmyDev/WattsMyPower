"""The other states' electricity networks (app.features.grid.outages): each feed read from a trimmed copy of the real
thing (tests/fixtures/outages, saved 10 October 2026: a few records each, areas thinned, house numbers left out), and
which network a house is worked out to be served by."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.grid.outages import nsw, sa, tas, vic, wa
from app.features.grid.outages.base import ADELAIDE, BRISBANE, MELBOURNE, PERTH, SYDNEY, Around, inside, when
from app.features.grid.outages.networks import NETWORKS
from app.features.grid.outages.service import OutageService
from app.features.grid.service import region_at
from app.features.settings.store import POWER_NETWORKS, SettingsStore

FIXTURES = Path(__file__).parent / "fixtures" / "outages"
NOW = int(dt.datetime(2026, 10, 10, 8, 0, tzinfo=dt.UTC).timestamp())  # 7 pm in Sydney (daylight saving)


def fixture(name: str) -> Any:
    text = (FIXTURES / name).read_text()
    return text if name.endswith(".html") else json.loads(text)


def at(tz: dt.tzinfo, *when: int) -> int:
    """A local time, as epoch seconds."""
    return int(dt.datetime(*when, tzinfo=tz).timestamp())  # type: ignore[misc]


# Each feed's URL (a part of it) and the fixture it answers with.
FEEDS = [
    ("ausgrid.com.au/api/outages-map/network-area", "ausgrid_area.json"),
    ("ausgrid.com.au/api/outages-map/outages/details-batch", "ausgrid_details.json"),
    ("ausgrid.com.au/api/outages-map/outages/list", "ausgrid_list.json"),
    ("endeavourenergy.com.au/api/public/outage-areas-fast", "endeavour.json"),
    ("ee-ai-api.pollen.au/v3/outages/active", "essential_active.json"),
    ("ee-ai-api.pollen.au/v3/outages/future", "essential_future.json"),
    ("evoenergy.com.au/outages", "evoenergy.html"),
    ("ausnetservices.com.au/api/v1/outages/combinedoutage", "ausnet.json"),
    ("ausnetservices.com.au/api/v1/outages/outageboundary/", "ausnet_boundary.json"),
    ("cppc-outage/outages.json", "cppc.json"),
    ("poweroutages.jemena.com.au/data/all-outages.json", "jemena.json"),
    ("jemena.com.au/api/ElectricityOutage/electricity-outage", "jemena_future.json"),
    ("cloudfront.net/outages-v2.json", "united.json"),
    ("cloudfront.net/network-locator.json", "vic_locator.json"),
    ("GetPublicisedCurrentOutages", "sapn_current.json"),
    ("GetPublicisedPlannedOutages", "sapn_planned.json"),
    ("tasnetworks.com.au/api/odata/GetPowerOutages", "tasnetworks.json"),
    ("westernpower.com.au/api/corp/outage/all-outages", "westernpower.json"),
    ("horizonpower.com.au/api/outage/getdetailedoutages", "horizon.json"),
]


class Feeds:
    """The networks' feeds, answered from the fixtures, remembering what was asked."""

    def __init__(self) -> None:
        self.asked: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, url: str, **kw: Any) -> Any:
        self.asked.append((url, kw))
        if "/static/PRD/" in url:  # Energex and Ergon: an empty map, and no service areas (their bounds will do)
            if url.endswith("servicearea.geojson"):
                raise OSError("not in this test")
            return {"type": "FeatureCollection", "features": []}
        for part, name in FEEDS:
            if part in url:
                return fixture(name)
        raise AssertionError(f"not a feed this test knows: {url}")

    def urls(self) -> list[str]:
        return [u for u, _ in self.asked]


AROUND = Around(-33.87, 151.21, 15, NOW)


def ids(items: list[dict[str, Any]]) -> list[str]:
    return [o["id"] for o in items]


def by_id(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {o["id"]: o for o in items}


def test_times_follow_each_state_and_its_daylight_saving() -> None:
    assert when("2026-10-10T08:00:00", MELBOURNE) == at(dt.UTC, 2026, 10, 9, 21)  # AEDT, +11
    assert when("2026-07-01T08:00:00", MELBOURNE) == at(dt.UTC, 2026, 6, 30, 22)  # AEST, +10
    assert when("2026-10-10T08:00:00", ADELAIDE) == at(dt.UTC, 2026, 10, 9, 21, 30)  # ACDT, +10:30
    assert when("2026-10-10T08:00:00", BRISBANE) == at(dt.UTC, 2026, 10, 9, 22)  # no daylight saving
    assert when("2026-10-10T08:00:00", PERTH) == at(dt.UTC, 2026, 10, 10, 0)
    assert when("2026-10-10 13:30:00+00", SYDNEY) == at(dt.UTC, 2026, 10, 10, 13, 30)  # its own offset wins
    assert when("0001-01-01T00:00:00", SYDNEY) is None and when("Under investigation", SYDNEY) is None


def test_ausgrid() -> None:
    feeds = Feeds()
    out = by_id(nsw.AUSGRID.outages("future", feeds, AROUND))
    # Restored, Cancelled and Completed are left out; planned work under way (restoration has commenced) stays.
    assert set(out) == {"ausgrid:133361", "ausgrid:135222", "ausgrid:142425", "ausgrid:736009999", "ausgrid:736010148"}
    work = out["ausgrid:135222"]
    assert (
        work["planned"] and work["start"] == at(SYDNEY, 2026, 10, 12, 7) and work["end"] == at(SYDNEY, 2026, 10, 12, 17)
    )
    assert work["streets"][:2] == ["Baroona St", "Dangar Island Wharf"] and work["suburbs"] == ["Dangar Island"]
    assert (work["lat"], work["lon"]) == (-33.53944, 151.2394) and work["area"] == []  # drawn only when asked
    off = out["ausgrid:736009999"]
    assert not off["planned"] and off["customers"] == 37 and off["reason"] == "Under investigation"
    assert "futureDayLimit=90" in feeds.urls()[-1]
    nsw.AUSGRID.outages("current", feeds, AROUND)
    assert "futureDayLimit=0" in feeds.urls()[-1]  # today's only, every 15 minutes


def test_ausgrid_draws_areas_when_asked() -> None:
    feeds = Feeds()
    off = by_id(nsw.AUSGRID.outages("current", feeds, AROUND))["ausgrid:736009999"]
    areas = nsw.AUSGRID.areas([off], feeds)
    url, kw = feeds.asked[-1]
    assert url.endswith("/details-batch") and kw["json_body"] == {"items": [{"id": 736009999, "type": "U"}]}
    assert kw["headers"]["x-csrf-token"] == "1" and kw["headers"]["Origin"] == "https://www.ausgrid.com.au"
    assert len(areas["ausgrid:736009999"][0]) >= 3
    ring = nsw.AUSGRID.where(feeds)[0]
    assert inside(-33.8688, 151.2093, ring) and not inside(-33.7507, 150.6877, ring)  # Sydney is, Penrith isn't


def test_endeavour() -> None:
    out = by_id(nsw.ENDEAVOUR.outages("current", Feeds(), AROUND))
    # The single-premise job (one house's) is left out.
    assert set(out) == {"endeavour:INC 1115107991", "endeavour:SP 2133023618", "endeavour:SP 2146029363"}
    off = out["endeavour:INC 1115107991"]
    assert not off["planned"] and off["customers"] == 802 and off["end"] == at(dt.UTC, 2026, 10, 10, 13, 30)
    assert off["suburbs"][0] == "HAMMONDVILLE" and off["streets"] == [] and off["area"]
    assert off["reason"] is None  # "None", in words
    work = out["endeavour:SP 2133023618"]
    assert work["planned"] and work["start"] == at(SYDNEY, 2026, 10, 13, 8) and work["reason"] == "Maintenance Work"


def test_essential_is_asked_for_its_whole_area_never_the_houses() -> None:
    feeds = Feeds()
    now = by_id(nsw.ESSENTIAL.outages("current", feeds, AROUND))
    url, kw = feeds.asked[-1]
    assert url.endswith("/active?bbox=140.9,-37.6,153.7,-27.9") and kw["headers"]["Accept"] == "application/geo+json"
    elsewhere = Feeds()
    nsw.ESSENTIAL.outages("current", elsewhere, Around(-32.2569, 148.6011, 50, NOW))  # Dubbo, a wider radius
    assert elsewhere.urls() == [url]  # the same for every house
    work = now["essential:INCD-43278-w"]
    assert (
        work["planned"] and work["start"] == at(SYDNEY, 2026, 10, 9, 16) and work["end"] == at(SYDNEY, 2026, 10, 12, 7)
    )
    assert work["area"] and work["lon"] == 146.0525567
    assert now["essential:INCD-300749-q"]["end"] is None and not now["essential:INCD-300749-q"]["planned"]
    later = nsw.ESSENTIAL.outages("future", feeds, AROUND)
    assert "/future?bbox=" in feeds.urls()[-1] and all(o["planned"] for o in later) and len(later) == 3


def test_evoenergy_reads_its_page() -> None:
    out = by_id(nsw.EVOENERGY.outages("current", Feeds(), AROUND))
    assert set(out) == {"evoenergy:SP 150019036", "evoenergy:SP 150018874"}  # cancelled, completed, restored left out
    work = out["evoenergy:SP 150019036"]
    assert (
        work["planned"] and work["start"] == at(SYDNEY, 2026, 10, 11, 8) and work["end"] == at(SYDNEY, 2026, 10, 11, 14)
    )
    assert work["suburbs"] == ["FYSHWICK"] and (work["lat"], work["lon"]) == (-35.326853, 149.170766) and work["area"]
    with pytest.raises(ValueError):
        nsw.evoenergy_list("<html>no map today</html>")


def test_ausnet_leaves_out_its_leftovers() -> None:
    feeds = Feeds()
    out = by_id(vic.AUSNET.outages("current", feeds, AROUND))
    # Cancelled, completed, restored, two years old, and "In Progress" with nobody off: all left out.
    assert set(out) == {"ausnet:INCD-138309-W", "ausnet:INCD-221043-U"}
    work = out["ausnet:INCD-138309-W"]
    assert (
        work["planned"]
        and work["start"] == at(MELBOURNE, 2026, 10, 13, 9)
        and work["end"] == at(MELBOURNE, 2026, 10, 13, 15)
    )
    assert work["customers"] == 99 and work["suburbs"][0] == "PANTON HILL"
    off = out["ausnet:INCD-221043-U"]
    assert off["start"] == at(MELBOURNE, 2026, 10, 10, 9, 46) and off["end"] == at(MELBOURNE, 2026, 10, 10, 20, 55)
    areas = vic.AUSNET.areas([off], feeds)
    assert feeds.urls()[-1].endswith("/outageboundary/INCD-221043-U") and len(areas[off["id"]][0]) >= 3


def test_citipower_and_powercor_share_a_feed() -> None:
    citi = vic.CITIPOWER.outages("current", Feeds(), AROUND)
    power = vic.POWERCOR.outages("current", Feeds(), AROUND)
    assert ids(citi) == ["citipower:2396605-1"] and len(power) == 3
    o = citi[0]
    assert o["start"] == at(MELBOURNE, 2026, 10, 10, 15, 20) and o["end"] == at(MELBOURNE, 2026, 10, 10, 18, 30)
    assert o["streets"] == ["GLENCAIRN AVENUE"] and o["suburbs"] == ["CAMBERWELL"]  # the town isn't a street
    assert not o["planned"] and o["area"] and o["lon"] == 145.081306768329


def test_jemena_counts_only_the_parts_still_off() -> None:
    # Edited from the real feed: one part of J.26.0150185 is still off (it was all back on when it was saved).
    out = by_id(vic.JEMENA.outages("current", Feeds(), AROUND))
    assert set(out) == {"jemena:J.26.0150185"}  # Completed and Complete left out
    o = out["jemena:J.26.0150185"]
    assert o["customers"] == 613 and o["suburbs"] == ["GLADSTONE PARK"] and "WOODSTOCK DRIVE" in o["streets"]
    assert o["area"] and o["start"] == at(MELBOURNE, 2026, 10, 10, 4, 22, 44) and o["reason"] == "Animal impact"
    assert vic.jemena_outage({**fixture("jemena.json")[1], "History": []}) is None  # nothing still off: over


def test_jemenas_planned_work_is_by_street() -> None:
    out = by_id(vic.JEMENA.outages("future", Feeds(), AROUND))
    job = out["jemena:2026-10-15-0730-1700-ABERFELDIE"]
    assert job["streets"] == ["ABERFELDIE ST", "WAVERLEY ST"] and job["lat"] is None and job["planned"]
    assert job["start"] == at(MELBOURNE, 2026, 10, 15, 7, 30) and job["end"] == at(MELBOURNE, 2026, 10, 15, 17)
    night = out["jemena:2026-10-08-1930-0530-SPOTSWOOD"]
    assert night["end"] == at(MELBOURNE, 2026, 10, 9, 5, 30)  # overnight: done the next morning
    assert not any("ASCOT" in k for k in out)  # cancelled
    # No year in the list: the nearest one to today.
    later = vic.jemena_planned([{"Suburb": "A", "Street": "B ST", "Date": "05-Jan", "Time": "0800-1200"}], NOW)
    assert dt.datetime.fromtimestamp(later[0]["start"], MELBOURNE).year == 2027


def test_united_energy() -> None:
    out = vic.UNITED.outages("current", Feeds(), AROUND)
    # Glen Iris was due back 18 hours before the file was read, and the file hadn't changed since: a leftover.
    assert ids(out) == ["united:2049607"]
    o = out[0]
    assert o["end"] == at(MELBOURNE, 2026, 10, 11, 17) and o["start"] is None and o["suburbs"] == ["BRIGHTON EAST"]


def test_sa_power_networks() -> None:
    now = by_id(sa.SAPN.outages("current", Feeds(), AROUND))
    o = now["sapn:160107698"]
    assert not o["planned"] and o["customers"] == 13 and o["suburbs"] == ["Happy Valley"] and o["area"]
    assert o["start"] == at(ADELAIDE, 2026, 10, 10, 15, 22, 41) == at(dt.UTC, 2026, 10, 10, 4, 52, 41)  # ACDT
    later = by_id(sa.SAPN.outages("future", Feeds(), AROUND))
    work = later["sapn:177581"]
    assert (
        work["planned"] and work["end"] == at(ADELAIDE, 2026, 10, 12, 15) and work["reason"].startswith("Maintaining")
    )


def test_tasnetworks() -> None:
    assert tas.TASNETWORKS.outages("current", Feeds(), AROUND) == []  # nothing off in Tasmania when it was saved
    # As its map's script reads one.
    o = tas.tas_outage(
        {
            "jobId": "INC-1",
            "reason": "Planned maintenance work",
            "customersAffected": 12,
            "affectedAreas": "Sandy Bay, Dynnyrne",
            "postcodes": ["7005"],
            "outageCentroid_WKT": "POINT (147.32 -42.9)",
            "outagePolygon_WKT": "POLYGON ((147.31 -42.89, 147.33 -42.89, 147.33 -42.91, 147.31 -42.89))",
            "estimatedTimeOfRestoration": "10/10/2026 5:30 PM",
        }
    )
    assert o and o["planned"] and o["suburbs"] == ["Sandy Bay", "Dynnyrne"] and (o["lon"], o["lat"]) == (147.32, -42.9)
    assert len(o["area"][0]) == 4 and o["end"] == int(dt.datetime(2026, 10, 10, 17, 30, tzinfo=tas.HOBART).timestamp())
    words = tas.tas_outage({"jobId": "INC-2", "reason": "Fault", "outageCentroid_WKT": "POINT (147 -42)",
                            "estimatedTimeOfRestoration": "To be advised"})  # fmt: skip
    assert words and words["end"] is None and words["end_text"] == "To be advised" and not words["planned"]


def test_western_power() -> None:
    out = by_id(wa.WESTERNPOWER.outages("current", Feeds(), AROUND))
    assert set(out) == {"westernpower:INCD-2161361-U", "westernpower:INCD-2155331-U", "westernpower:INCD-202784-X"}
    assert not out["westernpower:INCD-2161361-U"]["planned"] and out["westernpower:INCD-2155331-U"]["planned"]
    work = out["westernpower:INCD-202784-X"]  # F: planned, to come
    assert work["planned"] and work["start"] == at(PERTH, 2026, 10, 17, 7, 30) and work["suburbs"] == ["AUSTRALIND"]
    assert work["reason"] is None and work["area"] == []  # its feed gives neither


def test_horizon_power() -> None:
    out = wa.HORIZON.outages("current", Feeds(), AROUND)
    # Yesterday's planned work and August's outage, still "Started", are leftovers.
    assert ids(out) == ["horizon:INCD-228865-a"]
    o = out[0]
    assert o["start"] == at(PERTH, 2026, 10, 13, 9) and o["suburbs"] == ["Esperance"] and o["customers"] == 40
    assert inside(-33.6415, 121.8, o["area"][0]) and not inside(-33.65, 121.8, o["area"][0])  # its 329 m radius


def test_every_network_can_be_chosen() -> None:
    assert set(NETWORKS) == set(POWER_NETWORKS)


# ---------------------------------------------------------------------- which network serves a house
@pytest.fixture
def settings(config: Config, db: Database) -> SettingsStore:
    s = SettingsStore(db, config)
    s.load()
    return s


def _house(settings: SettingsStore, lat: float, lon: float, place: str | None) -> tuple[OutageService, Feeds]:
    settings.save({"latitude": lat, "longitude": lon, "location_name": place})
    feeds = Feeds()
    svc = OutageService(settings, lambda: region_at(lat, lon, place), get=feeds, clock=lambda: NOW)
    svc.refresh()
    return svc, feeds


HOUSES = [
    ("Sydney, NSW", -33.8688, 151.2093, "ausgrid"),
    ("Penrith, NSW", -33.7507, 150.6877, "endeavour"),
    ("Dubbo, NSW", -32.2569, 148.6011, "essential"),
    ("Canberra, ACT", -35.2809, 149.13, "evoenergy"),
    ("Melbourne, VIC", -37.8136, 144.9631, "citipower"),
    ("Ballarat Central, VIC", -37.5622, 143.8503, "powercor"),
    ("Coburg, VIC", -37.7436, 144.9664, "citipower"),  # split with Jemena: both followed
    ("Adelaide, SA", -34.9285, 138.6007, "sapn"),
    ("Hobart, TAS", -42.8821, 147.3272, "tasnetworks"),
    ("Perth, WA", -31.9523, 115.8613, "westernpower"),
    ("Broome, WA", -17.9614, 122.2359, "horizon"),
    ("Esperance, WA", -33.8613, 121.8914, "horizon"),
    ("Brisbane, QLD", -27.4698, 153.0251, "energex"),
    ("Townsville, QLD", -19.259, 146.8169, "ergon"),
]


@pytest.mark.parametrize(("place", "lat", "lon", "network"), HOUSES)
def test_the_network_serving_the_house(
    settings: SettingsStore, place: str, lat: float, lon: float, network: str
) -> None:
    svc, _ = _house(settings, lat, lon, place)
    v = svc.view()
    assert v["network"]["id"] == network and v["network_auto"] and v["supported"]
    assert v["networks"][0]["id"] == network


def test_one_network_is_followed_when_its_sure(settings: SettingsStore) -> None:
    svc, feeds = _house(settings, -33.8688, 151.2093, "Sydney, NSW")
    assert [n["id"] for n in svc.view()["networks"]] == ["ausgrid"]
    assert not any("endeavour" in u or "pollen" in u for u in feeds.urls())


def test_every_network_that_might_is_followed_when_none_is_sure(settings: SettingsStore) -> None:
    # Penrith isn't in Ausgrid's area, and Endeavour's and Essential's are only rough boxes: both, Endeavour first.
    svc, _ = _house(settings, -33.7507, 150.6877, "Penrith, NSW")
    assert [n["id"] for n in svc.view()["networks"]] == ["endeavour", "essential"]
    # Coburg is split between CitiPower and Jemena (the suburb list says so).
    svc, _ = _house(settings, -37.7436, 144.9664, "Coburg, VIC")
    assert [n["id"] for n in svc.view()["networks"]] == ["citipower", "jemena"]
    # Canberra without a place name: the ACT's box takes in Queanbeyan (Essential's) too.
    svc, _ = _house(settings, -35.2809, 149.13, None)
    assert [n["id"] for n in svc.view()["networks"]] == ["evoenergy", "essential"]


def test_western_australia_without_a_place_name(settings: SettingsStore) -> None:
    svc, _ = _house(settings, -31.9523, 115.8613, None)  # outside the NEM: no region
    assert svc.view()["network"]["id"] == "westernpower"


def test_the_northern_territory_isnt_supported(settings: SettingsStore) -> None:
    svc, feeds = _house(settings, -12.4634, 130.8456, "Darwin, NT")
    v = svc.view()
    assert v["network"] is None and not v["supported"] and feeds.asked == []


def test_a_chosen_network_is_followed_anywhere(settings: SettingsStore) -> None:
    settings.save({"power_network": "sapn"})
    svc, _ = _house(settings, -33.8688, 151.2093, "Sydney, NSW")
    v = svc.view()
    assert v["network"]["id"] == "sapn" and not v["network_auto"] and [n["id"] for n in v["networks"]] == ["sapn"]


# ---------------------------------------------------------------------- matched to the house
def test_areas_near_the_house_are_asked_for_once(settings: SettingsStore) -> None:
    settings.save({"outage_radius_km": 30})
    svc, feeds = _house(settings, -33.8688, 151.2093, "Sydney, NSW")  # Yagoona's outage is 18 km west
    batches = [kw for u, kw in feeds.asked if u.endswith("/details-batch")]
    assert len(batches) == 1 and {"id": 736009999, "type": "U"} in batches[0]["json_body"]["items"]
    assert {"id": 133361, "type": "P"} not in batches[0]["json_body"]["items"]  # planned for next month: not yet
    svc.refresh()
    assert len([u for u in feeds.urls() if u.endswith("/details-batch")]) == 1  # kept, not asked again
    yagoona = by_id(svc.view()["now"])["ausgrid:736009999"]
    assert yagoona["affects"] is None and 17 < yagoona["distance_km"] < 20


def test_work_listed_only_by_street_counts_only_at_the_house(settings: SettingsStore) -> None:
    settings.save({"home_street": "Waverley Street", "home_suburb": "Aberfeldie", "power_network": "jemena"})
    svc, _ = _house(settings, -37.7596, 144.8967, "Aberfeldie, VIC")
    planned = svc.view()["planned"]
    assert ids(planned) == ["jemena:2026-10-15-0730-1700-ABERFELDIE"]
    assert planned[0]["affects"] == "street" and planned[0]["distance_km"] == 0 and planned[0]["lat"] == -37.7596
    settings.save({"home_street": "Buckley Street"})
    assert svc.view()["planned"] == []  # nowhere to put it on the map, and not the house's street
