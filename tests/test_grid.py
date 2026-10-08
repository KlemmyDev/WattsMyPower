"""The grid (app.features.grid): AEMO's market data and notices, made up here, and the outlook and alerts from them."""

from __future__ import annotations

from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.alerts.rules import BY_ID, Facts, RuleState
from app.features.grid.aemo import AemoClient, AemoError, nem_time, notice
from app.features.grid.service import GridService, region_at
from app.features.settings.store import SettingsStore

NOW = nem_time("2026-10-08T17:02:00")


def _notice(nid: int, at: str, kind: str, title: str, body: str = "") -> dict[str, Any]:
    return {"NOTICEID": float(nid), "EFFECTIVEDATE": at, "TYPEID": kind, "EXTERNALREFERENCE": title, "REASON": body}


SUMMARY = {
    "ELEC_NEM_SUMMARY": [
        {
            "SETTLEMENTDATE": "2026-10-08T17:00:00",
            "REGIONID": "QLD1",
            "PRICE": 412.5,
            "PRICE_STATUS": "FIRM",
            "APCFLAG": 0.0,
            "MARKETSUSPENDEDFLAG": 0.0,
            "TOTALDEMAND": 7811.2,
        },
        {"SETTLEMENTDATE": "2026-10-08T17:00:00", "REGIONID": "SA1", "PRICE": -40.0, "TOTALDEMAND": 1200.0},
    ],
    "ELEC_NEM_SUMMARY_MARKET_NOTICE": [
        _notice(3, "2026-10-08T16:40:00", "RESERVE NOTICE", "Forecast Lack Of Reserve Level 2 (LOR2) condition in the QLD region on 08/10/2026"),
        _notice(2, "2026-10-08T12:00:00", "MINIMUM SYSTEM LOAD", "Forecast Minimum System Load MSL1 condition in the SA Region on 08/10/2026"),
        _notice(1, "2026-10-08T09:00:00", "MARKET SYSTEMS", "Initial - CHG0113553 - MSATS 59.0 FTA-2 Industry Test"),
    ],
}  # fmt: skip

PRICES = {
    "5MIN": [
        {"SETTLEMENTDATE": "2026-10-08T16:55:00", "REGIONID": "QLD1", "RRP": 90.0, "TOTALDEMAND": 7700.0, "PERIODTYPE": "ACTUAL"},
        {"SETTLEMENTDATE": "2026-10-08T16:55:00", "REGIONID": "NSW1", "RRP": 95.0, "TOTALDEMAND": 8000.0, "PERIODTYPE": "ACTUAL"},
        {"SETTLEMENTDATE": "2026-10-08T17:30:00", "REGIONID": "QLD1", "RRP": 640.0, "TOTALDEMAND": 8100.0, "PERIODTYPE": "FORECAST"},
        {"SETTLEMENTDATE": "2026-10-08T18:00:00", "REGIONID": "QLD1", "RRP": 120.0, "TOTALDEMAND": 8000.0, "PERIODTYPE": "FORECAST"},
    ]
}  # fmt: skip


class Weather:
    def __init__(self, hours: list[dict[str, Any]] | None = None):
        self._hours = hours or []

    def hours(self, start: int, end: int) -> list[dict[str, Any]]:
        return [h for h in self._hours if start <= h["ts"] < end]


@pytest.fixture
def settings(config: Config, db: Database) -> SettingsStore:
    s = SettingsStore(db, config)
    s.load()
    s.save({"latitude": -27.47, "longitude": 153.02})  # Brisbane
    return s


def _grid(settings: SettingsStore, snap: dict[str, Any] | None = None, weather: Weather | None = None) -> GridService:
    calls: list[str] = []

    def post(url: str, body: bytes) -> Any:
        calls.append(url)
        return PRICES

    client = AemoClient(get=lambda url: SUMMARY, post=post)
    svc = GridService(
        settings,
        weather,  # type: ignore[arg-type]
        lambda: snap,
        client,
        clock=lambda: NOW,
    )
    svc.calls = calls  # type: ignore[attr-defined]
    return svc


# -- AEMO ---------------------------------------------------------------------------------
def test_nem_time_is_aest_all_year() -> None:
    # 10 am NEM time is midnight UTC, in summer as in winter (the NEM doesn't follow daylight saving).
    assert nem_time("2026-01-15T10:00:00") % 86400 == 0
    assert nem_time("2026-07-15T10:00:00") % 86400 == 0


def test_notices_that_matter_to_a_household() -> None:
    lor = notice(SUMMARY["ELEC_NEM_SUMMARY_MARKET_NOTICE"][0])
    assert lor and lor["kind"] == "lor2" and lor["level"] == "warning" and lor["regions"] == ["QLD1"]
    msl = notice(SUMMARY["ELEC_NEM_SUMMARY_MARKET_NOTICE"][1])
    assert msl and msl["kind"] == "msl1" and msl["level"] == "info" and msl["regions"] == ["SA1"]
    assert notice(SUMMARY["ELEC_NEM_SUMMARY_MARKET_NOTICE"][2]) is None  # IT housekeeping
    actual = notice(_notice(4, "2026-10-08T18:00:00", "RESERVE NOTICE", "Actual LOR2 condition in the NSW Region"))
    assert actual and actual["level"] == "critical" and actual["regions"] == ["NSW1"]
    shed = notice(_notice(5, "2026-10-08T18:00:00", "LOAD RESTRICTION", "Direction to shed load in the VIC region"))
    assert shed and shed["kind"] == "load_shedding" and shed["level"] == "critical"
    off = notice(
        _notice(6, "2026-10-08T19:00:00", "RESERVE NOTICE", "Cancellation of Forecast LOR2 condition in the QLD region")
    )
    assert off and off["cancels"] and off["level"] == "info"


def test_a_failed_fetch_says_why() -> None:
    def fail(url: str) -> Any:
        raise OSError("no route")

    with pytest.raises(AemoError, match="Couldn't reach AEMO"):
        AemoClient(get=fail).summary()


@pytest.mark.parametrize(
    ("lat", "lon", "place", "region"),
    [
        (-27.47, 153.02, None, "QLD1"),  # Brisbane
        (-33.87, 151.21, None, "NSW1"),  # Sydney
        (-35.28, 149.13, None, "NSW1"),  # Canberra
        (-37.81, 144.96, None, "VIC1"),  # Melbourne
        (-34.93, 138.60, None, "SA1"),  # Adelaide
        (-42.88, 147.33, None, "TAS1"),  # Hobart
        (-31.95, 115.86, None, None),  # Perth: not in the NEM
        (-12.46, 130.84, None, None),  # Darwin
        (-28.18, 153.54, "Tweed Heads, NSW", "NSW1"),  # the place name's state wins
        (51.5, -0.1, None, None),
    ],
)
def test_region_from_where_the_house_is(lat: float, lon: float, place: str | None, region: str | None) -> None:
    assert region_at(lat, lon, place) == region


# -- the service ---------------------------------------------------------------------------
def test_view_follows_the_region(settings: SettingsStore) -> None:
    grid = _grid(settings)
    grid.refresh()
    v = grid.view()
    assert (v["region"], v["region_auto"], v["region_name"]) == ("QLD1", True, "Queensland")
    assert v["market"]["price"] == 412.5 and v["market"]["demand"] == 7811.2
    assert [p["price"] for p in v["prices"]] == [90.0, 640.0, 120.0]  # QLD's only
    assert [n["kind"] for n in v["notices"]] == ["lor2"] and v["notices"][0]["active"]
    kinds = [r["kind"] for r in v["outlook"]["reasons"]]
    assert v["outlook"]["level"] == "warning" and kinds[0] == "lor2" and "spike" in kinds


def test_prices_ahead_are_fetched_every_half_hour(settings: SettingsStore) -> None:
    grid = _grid(settings)
    grid.refresh()
    grid.refresh()
    assert len(grid.calls) == 1  # type: ignore[attr-defined]
    settings.save({"nem_region": "NSW1"})
    grid.refresh()
    assert len(grid.calls) == 2  # type: ignore[attr-defined]
    assert [p["price"] for p in grid.view()["prices"]] == [95.0]


def test_a_cancelled_warning_is_over(settings: SettingsStore) -> None:
    grid = _grid(settings)
    grid.refresh()
    SUMMARY_LATER = {
        **SUMMARY,
        "ELEC_NEM_SUMMARY_MARKET_NOTICE": [
            _notice(7, "2026-10-08T16:58:00", "RESERVE NOTICE", "Cancellation of Forecast LOR2 condition in the QLD region")
        ],
    }  # fmt: skip
    grid.client = AemoClient(get=lambda url: SUMMARY_LATER, post=lambda url, body: PRICES)
    grid.refresh()
    notices = grid.view()["notices"]
    assert [n["id"] for n in notices] == [7, 3] and not any(n["active"] for n in notices)


def test_turned_off_or_outside_the_nem(settings: SettingsStore) -> None:
    grid = _grid(settings)
    grid.refresh()
    settings.save({"nem_region": "none"})
    v = grid.view()
    assert not v["enabled"] and v["region"] is None
    assert v["market"] is None and v["prices"] == [] and v["notices"] == [] and v["outlook"]["level"] == "normal"


def test_the_inverter_and_the_weather_count_too(settings: SettingsStore) -> None:
    settings.save({"nem_region": "none"})
    storm = {"ts": int(NOW) + 3 * 3600, "code": 95, "precip_prob": 80}
    snap = {"ts": NOW, "running_state": 0x1000, "grid_voltage": 0.0, "grid_freq": 0.0}
    out = _grid(settings, snap, Weather([storm])).outlook()
    assert out["level"] == "outage" and [r["kind"] for r in out["reasons"]] == ["off_grid", "storm"]
    high = _grid(settings, {"ts": NOW, "running_state": 0, "grid_voltage": 256.4, "grid_freq": 50.01}).outlook()
    assert high["level"] == "watch" and high["reasons"][0]["kind"] == "voltage_high"
    calm = _grid(settings, {"ts": NOW, "running_state": 0, "grid_voltage": 241.0, "grid_freq": 50.01}).outlook()
    assert calm == {"level": "normal", "reasons": []}


# -- alerts --------------------------------------------------------------------------------
def _facts(snap: dict[str, Any], grid: dict[str, Any] | None = None) -> Facts:
    return Facts(
        now=NOW,
        snapshot={"ts": NOW, **snap},
        hybrid_connected=True,
        last_success=NOW,
        error=None,
        poll_interval=60,
        pv2=None,
        reserve=5.0,
        sun=10.0,
        daylight_since=NOW - 8 * 3600,
        grid=lambda: grid,
    )


def test_grid_down_alert() -> None:
    rule = BY_ID["grid_down"]
    v = rule.values()
    down = rule.check(_facts({"running_state": 0x1000, "battery_soc": 72.0}), v, RuleState("grid_down"))
    assert down.state == "bad" and "72%" in down.message
    assert rule.check(_facts({"running_state": 0}), v, RuleState("grid_down")).state == "ok"


def test_blackout_risk_alert(settings: SettingsStore) -> None:
    rule = BY_ID["grid_warning"]
    grid = _grid(settings)
    grid.refresh()
    bad = rule.check(_facts({"battery_soc": 45.0}, grid.outlook()), {}, RuleState("grid_warning"))
    assert bad.state == "bad" and bad.title == "Low reserve warning" and "charging it from the grid" in bad.message
    calm = {"level": "watch", "reasons": [{"kind": "spike", "level": "watch", "title": "x", "detail": "y"}]}
    assert rule.check(_facts({}, calm), {}, RuleState("grid_warning")).state == "ok"  # a price spike alone isn't one


def test_high_voltage_alert() -> None:
    rule = BY_ID["grid_voltage"]
    v = rule.values()
    assert rule.check(_facts({"grid_voltage": 258.0}), v, RuleState("grid_voltage")).state == "bad"
    assert rule.check(_facts({"grid_voltage": 249.0}), v, RuleState("grid_voltage")).state == "ok"
    assert rule.check(_facts({"grid_voltage": 0.0}), v, RuleState("grid_voltage")).state == "unknown"


def test_api(settings: SettingsStore, config: Config) -> None:
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app(config, poll=False, serve_dashboard=False)
    with TestClient(app) as client:
        body = client.get("/api/grid").json()
        assert body["enabled"] and "outlook" in body and body["limits"]["voltage_high"] == 253
