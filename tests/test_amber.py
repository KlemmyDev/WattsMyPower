"""Amber Electric: the API client, price conversion, the price sync, and costs on Amber prices.
Every request to Amber is faked: nothing here touches the network."""

from __future__ import annotations

import datetime as dt
import http.client
import json
import urllib.error
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.amber.client import AmberClient, AmberError
from app.features.amber.prices import PriceLookup, convert
from app.features.amber.repository import PriceRepository
from app.features.amber.service import NEM, AmberService, AmberSetupError, mask
from app.features.bills.service import BillsService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.costs import daily_costs
from app.features.tariffs.model import rate_tables, validate
from app.features.tariffs.store import TariffStore
from app.main import create_app

KEY = "psk_0123456789abcdef0123456789abcdef"
NOW = int(dt.datetime(2026, 10, 3, 12, tzinfo=NEM).timestamp())
DAY = dt.timedelta(days=1)


def _iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts, dt.UTC).isoformat().replace("+00:00", "Z")


def interval(
    channel: str, start: int, minutes: int, cents: float, kind: str = "ActualInterval", **extra: Any
) -> dict[str, Any]:
    """One priced interval as Amber's /prices returns it (startTime is a second past the start)."""
    end = start + minutes * 60
    return {
        "type": kind,
        "duration": minutes,
        "spotPerKwh": 6.12,
        "perKwh": cents,
        "date": dt.datetime.fromtimestamp(start, NEM).date().isoformat(),
        "nemTime": dt.datetime.fromtimestamp(end, NEM).isoformat(),
        "startTime": _iso(start + 1),
        "endTime": _iso(end),
        "renewables": 45,
        "channelType": channel,
        "spikeStatus": "none",
        "descriptor": "neutral",
        **extra,
    }


# -- converting Amber's prices ---------------------------------------------------------------------
def test_prices_become_dollars_and_feed_in_becomes_what_you_earn() -> None:
    t = NOW
    general, paid, charged, controlled = convert(
        [
            interval("general", t, 30, 24.33),
            interval("feedIn", t, 30, -8.5),  # negative on Amber's feed-in: you're paid 8.5c a kWh
            interval("feedIn", t + 1800, 30, 3.2),  # positive: exporting costs 3.2c a kWh
            interval("controlledLoad", t, 30, 15.0),
        ]
    )
    assert (general.channel, general.rate) == ("general", 0.2433)
    assert (paid.channel, paid.rate) == ("feedIn", 0.085)
    assert charged.rate == -0.032
    assert controlled.rate == 0.15


@pytest.mark.parametrize("minutes", [5, 30])
def test_an_interval_starts_its_duration_before_it_ends(minutes: int) -> None:
    (p,) = convert([interval("general", NOW, minutes, 20.0)])
    assert (p.ts, p.duration) == (NOW, minutes * 60)  # not startTime, which is a second late


def test_only_final_prices_count_as_actual() -> None:
    kinds = convert(
        [
            interval("general", NOW, 5, 20.0),
            interval("general", NOW + 300, 5, 20.0, "CurrentInterval", estimate=True),
            interval("general", NOW + 600, 5, 20.0, "CurrentInterval", estimate=False),
            interval("general", NOW + 900, 5, 20.0, "ForecastInterval"),
        ]
    )
    assert [p.actual for p in kinds] == [True, False, True, False]


def test_malformed_intervals_are_skipped() -> None:
    good = interval("general", NOW, 30, 20.0)
    assert (
        len(convert([good, {**good, "channelType": "gas"}, {"type": "ActualInterval"}, {**good, "perKwh": "x"}])) == 1
    )


def test_lookup_finds_the_interval_covering_a_moment() -> None:
    look = PriceLookup([(0, 1800, 0.2), (1800, 300, 0.4), (3600, 300, 0.1)])
    assert [look.at(t) for t in (-1, 0, 1500, 1800, 2100, 3599, 3600)] == [None, 0.2, 0.2, 0.4, None, None, 0.1]


# -- the API client --------------------------------------------------------------------------------
def _headers(**h: str) -> http.client.HTTPMessage:
    msg = http.client.HTTPMessage()
    for k, v in h.items():
        msg[k.replace("_", "-")] = v
    return msg


class FakeFetch:
    """Stands in for app.core.http.fetch_json: records requests, answers with `reply`."""

    def __init__(self, reply: Any = None, headers: dict[str, str] | None = None, error: Exception | None = None):
        self.reply, self.headers, self.error = reply, headers or {}, error
        self.calls: list[tuple[str, dict[str, str]]] = []

    def __call__(self, url: str, headers: dict[str, str], timeout: float) -> tuple[Any, dict[str, str]]:
        self.calls.append((url, headers))
        if self.error:
            raise self.error
        return self.reply, self.headers


def test_client_sends_the_key_as_a_bearer_token_and_notes_the_rate_limit() -> None:
    fetch = FakeFetch([interval("general", NOW, 5, 20.0)], {"RateLimit-Remaining": "42"})
    client = AmberClient(KEY, fetch)
    assert len(client.prices("01F5A5CRKMZ5BCX9P1S4V990AM", dt.date(2026, 10, 1), dt.date(2026, 10, 2))) == 1
    (url, headers) = fetch.calls[0]
    assert url == (
        "https://api.amber.com.au/v1/sites/01F5A5CRKMZ5BCX9P1S4V990AM/prices?startDate=2026-10-01&endDate=2026-10-02"
    )
    assert headers == {"Authorization": f"Bearer {KEY}"}
    assert client.remaining == 42
    client.current("01F5A5CRKMZ5BCX9P1S4V990AM", next=12)
    assert fetch.calls[1][0].endswith("/sites/01F5A5CRKMZ5BCX9P1S4V990AM/prices/current?next=12")


def _http_error(status: int, **headers: str) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://api.amber.com.au/v1/sites", status, "", _headers(**headers), None)


def test_client_errors_are_readable() -> None:
    with pytest.raises(AmberError, match="didn't accept the API key") as bad:
        AmberClient(KEY, FakeFetch(error=_http_error(401))).sites()
    assert bad.value.bad_key
    with pytest.raises(AmberError) as limited:
        AmberClient(KEY, FakeFetch(error=_http_error(429, RateLimit_Reset="120", RateLimit_Remaining="0"))).sites()
    assert (limited.value.status, limited.value.retry_after) == (429, 120)
    with pytest.raises(AmberError, match="could not be reached"):
        AmberClient(KEY, FakeFetch(error=urllib.error.URLError("no route"))).sites()


def test_client_only_puts_site_ids_it_trusts_in_urls() -> None:
    fetch = FakeFetch([])
    with pytest.raises(AmberError, match="Invalid Amber site"):
        AmberClient(KEY, fetch).prices("../users", dt.date(2026, 10, 1), dt.date(2026, 10, 1))
    assert fetch.calls == []


# -- connecting and syncing ------------------------------------------------------------------------
SITE = {
    "id": "01F5A5CRKMZ5BCX9P1S4V990AM",
    "nmi": "3052282872",
    "network": "Energex",
    "status": "active",
    "intervalLength": 5,
    "activeFrom": "2025-01-01",
    "channels": [{"identifier": "E1", "type": "general", "tariff": "A100"}],
}


class FakeAmber:
    """A pretend Amber account: one general and one feed-in price at noon each NEM day from `earliest`."""

    def __init__(self, sites: list[dict[str, Any]] | None = None, earliest: dt.date = dt.date(2020, 1, 1)):
        self._sites = [SITE] if sites is None else sites
        self.earliest = earliest
        self.requests: list[tuple[str, str]] = []
        self.remaining: int | None = 45
        self.refuse_longer_than: int | None = None  # days
        self.error: AmberError | None = None

    def sites(self) -> list[dict[str, Any]]:
        if self.error:
            raise self.error
        return self._sites

    def prices(self, site_id: str, start: dt.date, end: dt.date, resolution: int | None = None) -> list[dict[str, Any]]:
        self.requests.append((start.isoformat(), end.isoformat()))
        if self.error:
            raise self.error
        if self.refuse_longer_than and (end - start).days + 1 > self.refuse_longer_than:
            raise AmberError("Amber couldn't answer that request.", 400)
        out = []
        day = max(start, self.earliest)
        while day <= end:
            noon = int(dt.datetime.combine(day, dt.time(12), NEM).timestamp())
            out += [interval("general", noon, 30, 25.0), interval("feedIn", noon, 30, -5.0)]
            day += DAY
        return out


@pytest.fixture
def tariffs(db: Database, config: Config) -> TariffStore:
    store = TariffStore(db, config)
    store.load()
    return store


def _service(db: Database, tariffs: TariffStore, amber: FakeAmber) -> AmberService:
    svc = AmberService(db, tariffs, client_factory=lambda key: amber, clock=lambda: NOW)  # type: ignore[arg-type,return-value]
    svc.load()
    return svc


def _first_reading(readings: ReadingsRepository, ts: int) -> None:
    conn = readings.db.connect()
    readings.insert_many(conn, [(ts, {"grid_power": 100.0})])
    conn.close()


def test_connecting_masks_the_key_and_picks_the_only_site(db: Database, tariffs: TariffStore) -> None:
    status = _service(db, tariffs, FakeAmber()).connect(f"  {KEY}\n")
    assert status["key"] == "psk_…cdef" == mask(KEY)
    assert KEY not in json.dumps(status)
    assert status["site_id"] == SITE["id"] and status["interval_length"] == 5
    assert status["sites"][0]["network"] == "Energex"
    # Kept for next time, in full, server-side only.
    again = _service(db, tariffs, FakeAmber())
    assert again.ready and again.status()["key"] == "psk_…cdef"


def test_a_key_amber_refuses_is_not_kept(db: Database, tariffs: TariffStore) -> None:
    amber = FakeAmber()
    amber.error = AmberError("Amber didn't accept the API key.", 401)
    svc = _service(db, tariffs, amber)
    with pytest.raises(AmberSetupError, match="didn't accept") as e:
        svc.connect(KEY)
    assert e.value.status == 422 and not svc.status()["connected"]
    with pytest.raises(AmberSetupError, match="doesn't look like"):
        svc.connect("not a key")


def test_with_several_sites_one_is_chosen(db: Database, tariffs: TariffStore) -> None:
    other = {**SITE, "id": "01F5A5CRKMZ5BCX9P1S4V990AN", "nmi": "3052282873"}
    svc = _service(db, tariffs, FakeAmber([SITE, other]))
    assert svc.connect(KEY)["site_id"] is None and not svc.ready
    svc.sync(NOW)  # nothing to sync until a site is chosen
    with pytest.raises(AmberSetupError):
        svc.choose_site("01F5A5CRKMZ5BCX9P1S4V990AZ")
    assert svc.choose_site(other["id"])["site_id"] == other["id"] and svc.ready


def test_sync_fetches_today_then_backfills_a_week_at_a_time(
    db: Database, tariffs: TariffStore, readings: ReadingsRepository
) -> None:
    _first_reading(readings, NOW - 20 * 86400)  # readings from 13 September (NEM)
    amber = FakeAmber()
    svc = _service(db, tariffs, amber)
    svc.connect(KEY)
    svc.sync(NOW)
    assert amber.requests == [
        ("2026-10-02", "2026-10-04"),  # yesterday's final prices, today's, and the forecast
        ("2026-09-25", "2026-10-01"),
        ("2026-09-18", "2026-09-24"),
        ("2026-09-13", "2026-09-17"),  # back to the first day with readings, and no further
    ]
    status = svc.status()
    assert not status["backfilling"] and status["error"] is None and status["last_sync"] == NOW
    assert status["prices_from"] == int(dt.datetime(2026, 9, 13, 12, tzinfo=NEM).timestamp())
    amber.requests.clear()
    svc.sync(NOW + 300)
    assert amber.requests == [("2026-10-02", "2026-10-04")]  # from then on, one request each run


def test_backfill_stops_where_amber_has_nothing_older(
    db: Database, tariffs: TariffStore, readings: ReadingsRepository
) -> None:
    _first_reading(readings, NOW - 400 * 86400)
    amber = FakeAmber(earliest=dt.date(2026, 9, 20))
    svc = _service(db, tariffs, amber)
    svc.connect(KEY)
    svc.sync(NOW)
    assert amber.requests[-1] == ("2026-09-11", "2026-09-17")  # empty: the backfill is done
    assert not svc.status()["backfilling"]


def test_backfill_tries_shorter_pages_when_amber_refuses_a_range(
    db: Database, tariffs: TariffStore, readings: ReadingsRepository
) -> None:
    _first_reading(readings, NOW - 400 * 86400)
    amber = FakeAmber()
    amber.refuse_longer_than = 3
    svc = _service(db, tariffs, amber)
    svc.connect(KEY)
    svc.sync(NOW)  # today's 3 days are fine; a week isn't, so the page halves
    assert amber.requests[1:] == [
        ("2026-09-25", "2026-10-01"),  # refused
        ("2026-09-29", "2026-10-01"),
        ("2026-09-26", "2026-09-28"),
        ("2026-09-23", "2026-09-25"),
    ]
    svc.sync(NOW + 300)  # carrying on with the shorter pages
    assert amber.requests[5:7] == [("2026-10-02", "2026-10-04"), ("2026-09-20", "2026-09-22")]


def test_sync_leaves_room_in_amber_rate_limit(db: Database, tariffs: TariffStore, readings: ReadingsRepository) -> None:
    _first_reading(readings, NOW - 400 * 86400)
    amber = FakeAmber()
    amber.remaining = 8  # few requests left this window: only today's
    svc = _service(db, tariffs, amber)
    svc.connect(KEY)
    svc.sync(NOW)
    assert amber.requests == [("2026-10-02", "2026-10-04")] and svc.status()["backfilling"]


def test_a_rate_limited_sync_waits_for_the_window_to_reset(db: Database, tariffs: TariffStore) -> None:
    amber = FakeAmber()
    svc = _service(db, tariffs, amber)
    svc.connect(KEY)
    amber.error = AmberError("Amber is limiting requests for now.", 429, retry_after=120)
    svc.sync(NOW)
    assert "limiting" in svc.status()["error"]
    amber.error = None
    svc.sync(NOW + 60)
    assert len(amber.requests) == 1  # still waiting
    svc.sync(NOW + 121)
    assert len(amber.requests) == 2 and svc.status()["error"] is None


def test_days_missed_while_the_dashboard_was_off_are_caught_up(db: Database, tariffs: TariffStore) -> None:
    amber = FakeAmber()
    svc = _service(db, tariffs, amber)
    svc.connect(KEY)
    svc.sync(NOW)
    amber.requests.clear()
    svc.sync(NOW + 10 * 86400)  # back on 13 October
    assert amber.requests == [("2026-10-12", "2026-10-14"), ("2026-10-03", "2026-10-09"), ("2026-10-10", "2026-10-11")]


def test_disconnecting_forgets_the_key_and_prices(db: Database, tariffs: TariffStore) -> None:
    svc = _service(db, tariffs, FakeAmber())
    svc.connect(KEY)
    svc.sync(NOW)
    tariffs.save({"type": "amber", "flat_rate": 0.3, "feed_in_rate": 0.05, "supply_charge": 1.1, "bands": []})
    status = svc.disconnect()
    assert not status["connected"] and status["key"] is None
    assert svc.repo.coverage()["first"] is None
    t = tariffs.get()  # back to a single rate at the Amber tariff's fallback rates
    assert (t["type"], t["flat_rate"], t["supply_charge"]) == ("flat", 0.3, 1.1)
    with db.reading() as conn:
        assert conn.execute("SELECT COUNT(*) FROM kv WHERE value LIKE ?", (f"%{KEY}%",)).fetchone()[0] == 0


# -- costs on Amber prices -------------------------------------------------------------------------
AMBER = {"type": "amber", "flat_rate": 0.3, "feed_in_rate": 0.05, "supply_charge": 1.0, "bands": []}
TEN = int(dt.datetime(2026, 3, 3, 10).timestamp())  # 10:00 local on a Tuesday


def _grid(readings: ReadingsRepository, start: int, minutes: int, watts: float) -> None:
    """Steady grid power, read every 5 minutes: + importing, − exporting."""
    rows = [
        (start + k * 300, {"grid_power": watts, "pv_power": max(0.0, -watts), "battery_power": 0.0})
        for k in range(minutes // 5)
    ]
    conn = readings.db.connect()
    readings.insert_many(conn, rows)
    conn.close()


def _prices(db: Database, intervals: list[dict[str, Any]]) -> PriceRepository:
    repo = PriceRepository(db)
    with db.writing() as conn:
        repo.save(conn, convert(intervals), NOW)
    return repo


def _day(readings: ReadingsRepository, t: dict[str, Any], prices: PriceRepository | None) -> dict[str, Any]:
    tariff = validate(t)
    (day,) = daily_costs(readings, tariff, rate_tables(tariff), TEN - 10 * 3600, TEN + 14 * 3600, prices)["days"]
    return day


def test_each_reading_is_priced_at_its_interval_5_or_30_minutes(db: Database, readings: ReadingsRepository) -> None:
    _grid(readings, TEN, 60, 1000)  # 1 kW from the grid, 10:00 to 11:00: 1 kWh
    prices = _prices(
        db,
        [interval("general", TEN, 30, 20.0)]  # 10:00-10:30 as one 30-minute price
        + [interval("general", TEN + 1800 + k * 300, 5, 40.0) for k in range(6)],  # then 5-minute prices
    )
    day = _day(readings, AMBER, prices)
    priced, fallback = day["bands"]
    assert day["import_kwh"] == pytest.approx(1.0)
    assert priced["cost"] == pytest.approx(0.5 * 0.2 + 0.5 * 0.4)
    assert priced["rate"] == pytest.approx(0.3)  # the average price paid
    assert fallback["import_kwh"] == 0 and day["unpriced_kwh"] == 0
    assert day["net_cost"] == pytest.approx(0.3 + 1.0)


def test_exports_earn_the_feed_in_price_even_when_it_is_negative(db: Database, readings: ReadingsRepository) -> None:
    _grid(readings, TEN, 60, -1000)  # 1 kW to the grid for an hour
    prices = _prices(
        db,
        [interval("feedIn", TEN, 30, -10.0), interval("feedIn", TEN + 1800, 30, 4.0)],  # paid 10c, then charged 4c
    )
    day = _day(readings, AMBER, prices)
    assert day["export_kwh"] == pytest.approx(1.0)
    assert day["feed_in_credit"] == pytest.approx(0.5 * 0.10 - 0.5 * 0.04)
    assert day["feed_in_rate"] == pytest.approx(0.03)
    assert day["net_cost"] == pytest.approx(1.0 - 0.03)


def test_times_without_a_price_use_the_fallback_rates_and_say_so(db: Database, readings: ReadingsRepository) -> None:
    _grid(readings, TEN, 60, 1000)
    _grid(readings, TEN + 3600, 60, -1000)
    prices = _prices(db, [interval("general", TEN, 30, 20.0)])  # only 10:00-10:30 is priced
    day = _day(readings, AMBER, prices)
    priced, fallback = day["bands"]
    assert priced["import_kwh"] == pytest.approx(0.5) and priced["cost"] == pytest.approx(0.1)
    assert fallback["import_kwh"] == pytest.approx(0.5) and fallback["cost"] == pytest.approx(0.15)
    assert day["feed_in_credit"] == pytest.approx(0.05)  # all exports at the 5c fallback, not at 0
    assert day["unpriced_kwh"] == pytest.approx(1.5)


def test_flat_and_time_of_use_costs_ignore_amber_prices(db: Database, readings: ReadingsRepository) -> None:
    _grid(readings, TEN, 60, 1000)
    _grid(readings, TEN + 7 * 3600, 60, -1000)
    prices = _prices(db, [interval("general", TEN, 30, 99.0), interval("feedIn", TEN + 7 * 3600, 30, 99.0)])
    tou = {
        **AMBER,
        "type": "tou",
        "bands": [
            {"name": "Peak", "rate": 0.45, "windows": [{"days": "all", "start": "16:00", "end": "21:00"}]},
            {"name": "Other", "rate": 0.25, "other": True, "windows": []},
        ],
    }
    for t in ({**AMBER, "type": "flat"}, tou):
        assert _day(readings, t, prices) == _day(readings, t, None)
    flat = _day(readings, {**AMBER, "type": "flat"}, prices)
    assert flat["import_cost"] == pytest.approx(0.3) and flat["feed_in_credit"] == pytest.approx(0.05)
    assert "unpriced_kwh" not in flat and "home_cost" not in flat["bands"][0]


def test_bills_on_amber_price_home_use_at_the_prices_of_the_time(
    db: Database, config: Config, readings: ReadingsRepository, tariffs: TariffStore
) -> None:
    now = TEN + 4 * 3600
    _grid(readings, TEN, 60, 1000)
    prices = _prices(db, [interval("general", TEN + k * 1800, 30, 50.0) for k in range(2)])
    tariffs.save(AMBER)
    settings = SettingsStore(db, config)
    settings.load()
    out = BillsService(db, readings, settings, tariffs, prices).build(now)
    so_far = out["current"]["so_far"]
    assert so_far["import_cost"] == pytest.approx(0.5)
    assert so_far["without_solar"] == pytest.approx(0.5 + 1.0)  # 1 kWh of home use at 50c, plus supply
    assert [b["name"] for b in out["bands"]] == ["Amber prices", "No Amber price"]


# -- through the API -------------------------------------------------------------------------------
@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def test_amber_through_the_api(client: TestClient) -> None:
    assert client.get("/api/amber").json()["connected"] is False
    r = client.put("/api/tariff", json=AMBER)
    assert r.status_code == 422 and "Connect your Amber account" in r.json()["detail"]

    amber = FakeAmber()
    client.app.state.services.amber.client_factory = lambda key: amber  # type: ignore[attr-defined]
    assert client.put("/api/amber", json={"api_key": "short"}).status_code == 422
    body = client.put("/api/amber", json={"api_key": KEY}).json()
    assert body["key"] == "psk_…cdef" and KEY not in client.get("/api/amber").text

    assert client.put("/api/tariff", json=AMBER).json()["type"] == "amber"
    assert client.get("/api/costs").json()["type"] == "amber"
    prices = client.get("/api/amber/prices").json()
    assert set(prices) == {"interval_length", "now", "general", "feed_in"}

    assert client.delete("/api/amber").json()["connected"] is False
    assert client.get("/api/tariff").json()["type"] == "flat"
