"""Smart-meter (NEM12) data: reading files, storing them, and using them for bills and comparisons."""

from __future__ import annotations

import datetime as dt
import os
import time
from collections.abc import Callable, Iterator
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.bills.service import BillsService
from app.features.meter.nem12 import Nem12Error, parse
from app.features.meter.service import MeterService
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.costs import daily_costs
from app.features.tariffs.model import rate_tables, validate
from app.features.tariffs.store import TariffStore
from app.main import create_app

NMI = "3120000001"
JULY_1 = dt.date(2026, 7, 1)  # a Wednesday, in winter: no daylight saving anywhere
BRISBANE, SYDNEY = ZoneInfo("Australia/Brisbane"), ZoneInfo("Australia/Sydney")

Values = float | list[float | str]


def channel(
    suffix: str,
    days: dict[dt.date, Values],
    *,
    nmi: str = NMI,
    unit: str = "kWh",
    minutes: int = 30,
    quality: str = "A",
    events: tuple[tuple[int, int, str], ...] = (),
) -> list[str]:
    """A 200 record and a 300 record per day (a single value repeats all day), as a meter data provider writes them."""
    lines = [f"200,{nmi},E1B1,1,{suffix},N1,MTR123,{unit},{minutes},"]
    for day, values in days.items():
        vals = values if isinstance(values, list) else [values] * (1440 // minutes)
        cells = ",".join(v if isinstance(v, str) else f"{v:g}" for v in vals)
        lines.append(f"300,{day:%Y%m%d},{cells},{quality},,,20260702093015,20260702100120")
        lines += [f"400,{a},{b},{q},{'' if q[0] in 'AE' else 9}," for a, b, q in events]
    return lines


def nem12(*channels: list[str], end: bool = True) -> bytes:
    lines = ["100,NEM12,202607020930,MDP1,RETAILER1", *(line for ch in channels for line in ch)]
    return ("\r\n".join([*lines, *(["900"] if end else [])]) + "\r\n").encode()


@pytest.fixture(autouse=True)
def zone() -> Iterator[Callable[[str], None]]:
    """The dashboard's time zone: Brisbane unless a test picks another. Restored afterwards."""
    before = os.environ.get("TZ")

    def use(name: str) -> None:
        os.environ["TZ"] = name
        time.tzset()

    use("Australia/Brisbane")
    yield use
    if before is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = before
    time.tzset()


@pytest.fixture
def meter(db: Database, readings: ReadingsRepository) -> MeterService:
    return MeterService(db, readings)


def _grid(readings: ReadingsRepository, start: dt.datetime, end: dt.datetime, watts: float) -> None:
    """Steady grid power (positive = import) read every 5 minutes, as the inverter reports it."""
    t, stop = int(start.timestamp()), int(end.timestamp())
    rows = []
    while t < stop:
        rows.append((t, {"grid_power": watts, "pv_power": 0.0, "battery_power": 0.0}))
        t += 300
    conn = readings.db.connect()
    readings.insert_many(conn, rows)
    conn.close()


def _local(day: dt.date, hour: int = 0) -> dt.datetime:
    return dt.datetime.combine(day, dt.time(hour))


# ---------------------------------------------------------------------------------------------- reading files
def test_half_hourly_import_and_export() -> None:
    export = [0.0] * 20 + [1.5] * 8 + [0.0] * 20  # 10:00 to 14:00
    f = parse(nem12(channel("E1", {JULY_1: 0.25}), channel("B1", {JULY_1: export})))
    imp, exp = f.channels
    assert (imp.suffix, imp.direction, imp.minutes, len(imp.readings)) == ("E1", "import", 30, 48)
    assert imp.kwh == pytest.approx(12.0) and exp.kwh == pytest.approx(12.0)
    assert exp.direction == "export" and f.notes == []
    # The first value covers 00:00 to 00:30 NEM time; the 21st, 10:00 to 10:30.
    first = min(imp.readings)
    assert first == dt.datetime(2026, 7, 1, tzinfo=BRISBANE).timestamp()
    assert exp.readings[first + 20 * 1800].kwh == 1.5 and exp.readings[first + 19 * 1800].kwh == 0


@pytest.mark.parametrize(("minutes", "unit", "value", "kwh"), [(5, "Wh", 100, 28.8), (15, "KWH", 0.25, 24.0)])
def test_shorter_intervals_and_units(minutes: int, unit: str, value: float, kwh: float) -> None:
    (ch,) = parse(nem12(channel("E1", {JULY_1: value}, minutes=minutes, unit=unit))).channels
    assert len(ch.readings) == 1440 // minutes and ch.minutes == minutes
    assert ch.kwh == pytest.approx(kwh)
    ts = sorted(ch.readings)
    assert ts[1] - ts[0] == minutes * 60


def test_values_cover_the_interval_ending_at_their_slot_in_nem_time(zone: Callable[[str], None]) -> None:
    """NEM time is AEST all year. Brisbane matches it; Sydney is an hour ahead in summer."""
    summer = dt.date(2026, 1, 15)
    (ch,) = parse(nem12(channel("E1", {summer: [float(k) for k in range(1, 49)]}))).channels
    # Value 33 is the half hour ending 16:30 NEM time, so it starts at 16:00 in Brisbane…
    ts = next(t for t, r in ch.readings.items() if r.kwh == 33)
    assert dt.datetime.fromtimestamp(ts, BRISBANE) == dt.datetime(2026, 1, 15, 16, tzinfo=BRISBANE)
    # …and at 17:00 daylight-saving time in Sydney.
    assert dt.datetime.fromtimestamp(ts, SYDNEY).replace(tzinfo=None) == dt.datetime(2026, 1, 15, 17)
    # The last value is 23:30 to midnight NEM time: the next day in Sydney.
    last = max(ch.readings)
    assert dt.datetime.fromtimestamp(last, SYDNEY).replace(tzinfo=None) == dt.datetime(2026, 1, 16, 0, 30)


@pytest.mark.parametrize(
    ("name", "local_days"),
    [
        ("Australia/Brisbane", {"2026-01-15": (48.0, True)}),
        # In Sydney's summer the NEM day runs 01:00 to 01:00 local time, so it's split over two days
        # and neither is covered in full.
        ("Australia/Sydney", {"2026-01-15": (46.0, False), "2026-01-16": (2.0, False)}),
    ],
)
def test_days_follow_the_dashboards_time_zone(
    zone: Callable[[str], None], db: Database, readings: ReadingsRepository, name: str, local_days: dict[str, Any]
) -> None:
    zone(name)
    meter = MeterService(db, readings)
    day = dt.date(2026, 1, 15)
    meter.import_file(nem12(channel("E1", {day: 1.0}), channel("B1", {day: 0.0})), "a.csv", 1)
    days = meter.days(0, 2**40)
    assert {k: (d.import_kwh, d.complete) for k, d in days.items()} == local_days


def test_sydney_days_are_complete_with_the_neighbouring_nem_days(
    zone: Callable[[str], None], db: Database, readings: ReadingsRepository
) -> None:
    zone("Australia/Sydney")
    meter = MeterService(db, readings)
    nem_days = {dt.date(2026, 1, d): 1.0 for d in (14, 15, 16)}
    meter.import_file(nem12(channel("E1", nem_days), channel("B1", dict.fromkeys(nem_days, 0.0))), "a.csv", 1)
    day = meter.days(0, 2**40)["2026-01-15"]
    assert day.complete and day.import_kwh == 48.0


def test_quality_flags_are_kept_and_counted(meter: MeterService) -> None:
    july_2 = JULY_1 + dt.timedelta(1)
    events = ((1, 40, "A"), (41, 44, "S53"), (45, 48, "E52"))
    data = nem12(
        channel("E1", {JULY_1: 1.0}, quality="V", events=events),
        channel("E2", {july_2: 0.0}, quality="N"),  # no readings at all that day
    )
    (imp,) = parse(data).channels  # a channel with only null readings has nothing to keep
    qualities = [imp.readings[t].quality for t in sorted(imp.readings)]
    assert qualities == ["A"] * 40 + ["S53"] * 4 + ["E52"] * 4
    preview = meter.preview(data, "q.csv")
    assert preview["estimated"] == 8 and preview["missing"] == 0
    assert preview["channels"][0]["estimated"] == 8


def test_null_intervals_are_left_out_so_the_day_falls_back_to_the_inverter(meter: MeterService) -> None:
    values: list[float | str] = [1.0] * 46 + ["", ""]
    data = nem12(channel("E1", {JULY_1: values}, quality="V", events=((1, 46, "A"), (47, 48, "N"))))
    assert meter.preview(data, None)["missing"] == 2
    meter.import_file(data, "gap.csv", 1)
    (day,) = meter.days(0, 2**40).values()
    assert day.import_kwh == 46 and not day.complete


def test_channels_that_arent_energy_are_skipped_with_a_note() -> None:
    f = parse(nem12(channel("E1", {JULY_1: 0.5}), channel("Q1", {JULY_1: 0.1}, unit="kVArh")))
    assert [c.suffix for c in f.channels] == ["E1"]
    assert f.notes == ["Left out what isn't grid import or export in kWh: Q1 (kVArh)."]


def test_several_meters_are_added_together_with_a_note(meter: MeterService) -> None:
    data = nem12(channel("E1", {JULY_1: 0.5}), channel("E1", {JULY_1: 0.5}, nmi="3120000002"))
    preview = meter.preview(data, "two.csv")
    assert preview["nmis"] == [NMI, "3120000002"] and preview["import_kwh"] == 48
    assert "2 meters" in preview["notes"][0]


def _wrong_count() -> bytes:
    return nem12(channel("E1", {JULY_1: [0.5] * 47}))


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"PK\x03\x04rest of a zip", "This is a zip file"),
        (b"Date,Usage\n2026-07-01,12.5\n", "This doesn't look like a NEM12 file"),
        (b"100,NEM13,202607020930,MDP1,RETAILER1\n250,3120000001,...\n900\n", "This is a NEM13 file"),
        (b"100,NEM12,202607020930,MDP1,RETAILER1\n300,20260701,1,2,3\n900\n", "Line 2: interval data comes before"),
        (_wrong_count(), "Line 3: 1 Jul 2026 should have 48 half-hourly readings, but has 47"),
        (nem12(channel("E1", {JULY_1: [-1.0] + [0.5] * 47})), "Line 3: reading 1 on 1 Jul 2026 is negative"),
        (nem12(channel("E1", {JULY_1: ["abc"] + [0.5] * 47})), "isn't a number"),
        (nem12(channel("E1", {JULY_1: 0.5}, minutes=60)), "Line 2: an interval length of 60 minutes"),
        (nem12(channel("E1", {JULY_1: 0.5})).replace(b"20260701", b"20261301"), "isn't a date"),
        (nem12(channel("Q1", {JULY_1: 0.5}, unit="kVArh")), "no grid import or export readings"),
        (b"100,NEM12,202607020930,MDP1,RETAILER1\n900\n", "no interval data"),
        (b"100,NEM12,202607020930,MDP1,RETAILER1\n200,3120000001,E1,1,E1,N1,M,kWh,30,\n900\n", "no interval data"),
    ],
)
def test_odd_files_get_readable_errors(data: bytes, message: str) -> None:
    with pytest.raises(Nem12Error, match=message):
        parse(data)


def test_a_file_cut_short_is_read_with_a_note() -> None:
    f = parse(b"\xef\xbb\xbf" + nem12(channel("E1", {JULY_1: 0.5}), end=False))  # with a byte-order mark too
    assert f.channels[0].kwh == 24 and "no end record" in f.notes[0]


# ---------------------------------------------------------------------------------------------- storing
def test_reimporting_replaces_overlapping_days_and_imports_can_be_removed(meter: MeterService) -> None:
    d1, d2, d3 = JULY_1, JULY_1 + dt.timedelta(1), JULY_1 + dt.timedelta(2)
    first = meter.import_file(nem12(channel("E1", {d1: 1.0, d2: 1.0})), "june.csv", 100)
    # A corrected file for the 2nd, and the 3rd: the 2nd is replaced, not added to.
    second_data = nem12(channel("E1", {d2: 2.0, d3: 2.0}))
    assert meter.preview(second_data, "july.csv")["replaces_days"] == 1
    second = meter.import_file(second_data, "C:\\Downloads\\july.csv", 200)
    assert second["filename"] == "july.csv"
    totals = {k: d.import_kwh for k, d in meter.days(0, 2**40).items()}
    assert totals == {"2026-07-01": 48.0, "2026-07-02": 96.0, "2026-07-03": 96.0}
    listed = meter.imports()
    assert [(i["id"], i["intervals"], i["import_kwh"]) for i in listed] == [
        (second["id"], 96, 192.0),
        (first["id"], 48, 48.0),
    ]

    # Re-importing the 1st leaves nothing of the first import, so it drops off the list.
    meter.import_file(nem12(channel("E1", {d1: 0.5})), "again.csv", 300)
    assert first["id"] not in {i["id"] for i in meter.imports()}

    # A later file whose day is all nulls doesn't wipe the readings already there.
    nulls = nem12(channel("E1", {d2: 0.0}, quality="N"), channel("E1", {d3: 3.0}, nmi="3120000002"))
    meter.import_file(nulls, "nulls.csv", 400)
    assert meter.days(0, 2**40)["2026-07-02"].import_kwh == 96.0

    assert meter.remove(second["id"]) and not meter.remove(second["id"])
    assert set(meter.days(0, 2**40)) == {"2026-07-01", "2026-07-03"}  # the other meter's day stays


def test_the_migration_adds_the_meter_tables(db: Database) -> None:
    with db.reading() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"meter_imports", "meter_intervals"} <= tables


# ---------------------------------------------------------------------------------------------- using it
TOU = validate(
    {
        "type": "tou",
        "flat_rate": 0.3,
        "feed_in_rate": 0.05,
        "supply_charge": 1.0,
        "bands": [
            {"name": "Peak", "rate": 0.5, "windows": [{"days": "all", "start": "16:00", "end": "21:00"}]},
            {"name": "Off-peak", "rate": 0.2, "other": True, "windows": []},
        ],
    }
)


def test_costs_use_the_meter_where_it_covers_a_day(meter: MeterService, readings: ReadingsRepository) -> None:
    d1, d2 = JULY_1, JULY_1 + dt.timedelta(1)
    _grid(readings, _local(d1), _local(d1 + dt.timedelta(3)), 500)  # 12 kWh a day, as the inverter saw it
    # The meter: 1 kWh each half hour of the 16:00-21:00 peak (10 kWh), 0.1 otherwise (3.8 kWh), and some export.
    used = [1.0 if 32 <= k < 42 else 0.1 for k in range(48)]
    meter.import_file(nem12(channel("E1", {d1: used, d2: used}), channel("B1", {d1: 0.05, d2: 0.05})), "m.csv", 1)

    start = int(_local(d1).timestamp())
    out = daily_costs(readings, TOU, rate_tables(TOU), start, start + 3 * 86400, meter)
    one, _, three = out["days"]
    assert one["source"] == "meter" and three["source"] == "inverter"
    assert one["import_kwh"] == pytest.approx(13.8) and one["export_kwh"] == pytest.approx(2.4)
    peak, off = one["bands"]
    assert peak["import_kwh"] == pytest.approx(10.0) and off["import_kwh"] == pytest.approx(3.8)
    assert one["net_cost"] == pytest.approx(10 * 0.5 + 3.8 * 0.2 + 1.0 - 2.4 * 0.05)
    assert three["import_kwh"] == pytest.approx(12.0, abs=0.05)  # no meter data: the inverter's figures


def test_bills_count_the_days_from_the_meter(
    db: Database, config: Config, meter: MeterService, readings: ReadingsRepository
) -> None:
    now = int(dt.datetime(2026, 7, 6, 12).timestamp())
    _grid(readings, _local(JULY_1), dt.datetime.fromtimestamp(now), 500)
    days = {JULY_1 + dt.timedelta(k): 0.5 for k in range(3)}  # 24 kWh a day on the 1st to 3rd
    meter.import_file(nem12(channel("E1", days), channel("B1", dict.fromkeys(days, 0.0))), "m.csv", 1)
    settings = SettingsStore(db, config)
    settings.load()
    settings.save({"bill_months": 1, "bill_day": 1})
    tariffs = TariffStore(db, config)
    tariffs.load()
    tariffs.save({"type": "flat", "flat_rate": 0.3, "feed_in_rate": 0.05, "supply_charge": 1.0, "bands": []})

    out = BillsService(db, readings, settings, tariffs, meter).build(now)
    so_far = out["current"]["so_far"]
    assert so_far["meter_days"] == 3 and so_far["days"] == 6
    assert [d["source"] for d in out["days"]] == ["meter"] * 3 + ["inverter"] * 3
    assert so_far["import_kwh"] == pytest.approx(3 * 24 + 2 * 12 + 6, abs=0.1)


def test_reconciling_the_meter_with_the_dashboard(meter: MeterService, readings: ReadingsRepository) -> None:
    d1, d2 = JULY_1, JULY_1 + dt.timedelta(1)
    _grid(readings, _local(d1), _local(d2 + dt.timedelta(1)), 500)  # 12 kWh a day
    # The meter agrees on the 1st (within a whisker) and counts 3 kWh more on the 2nd.
    data = nem12(channel("E1", {d1: 0.251, d2: 0.3125}), channel("B1", {d1: 0.0, d2: 0.0}))
    meter.import_file(data, "m.csv", 1)
    out = meter.reconcile(None, None)
    one, two = out["days"]
    assert (one["meter_import"], one["dashboard_import"], one["notable"]) == (12.05, 12.0, False)
    assert (two["meter_import"], two["import_diff"], two["notable"]) == (15.0, -3.0, True)
    s = out["summary"]
    assert (s["compared_days"], s["notable_days"], s["meter_import"], s["dashboard_import"]) == (2, 1, 27.05, 24.0)


def test_meter_data_through_the_api(config: Config) -> None:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as client:
        data = nem12(channel("E1", {JULY_1: 0.5}), channel("B1", {JULY_1: 0.1}))
        headers = {"Content-Type": "application/octet-stream"}
        preview = client.post("/api/meter/preview?filename=usage.csv", content=data, headers=headers).json()
        assert (preview["filename"], preview["days"], preview["import_kwh"], preview["export_kwh"]) == (
            "usage.csv", 1, 24.0, 4.8)  # fmt: skip
        assert client.get("/api/meter/imports").json() == []  # a preview stores nothing

        bad = client.post("/api/meter/imports?filename=x.csv", content=b"not,a,meter,file", headers=headers)
        assert bad.status_code == 422 and "doesn't look like a NEM12 file" in bad.json()["detail"]
        assert client.post("/api/meter/imports", content=b"", headers=headers).json() == {
            "detail": "That file is empty."
        }

        made = client.post("/api/meter/imports?filename=usage.csv", content=data, headers=headers).json()
        (listed,) = client.get("/api/meter/imports").json()
        assert listed["id"] == made["id"] and listed["nmis"] == [NMI] and listed["export_kwh"] == 4.8
        assert client.get("/api/meter/reconcile").json()["days"][0]["meter_import"] == 24.0
        assert client.delete(f"/api/meter/imports/{made['id']}").json() == {"removed": True}
        assert client.delete(f"/api/meter/imports/{made['id']}").status_code == 404
        assert client.get("/api/meter/reconcile").json() == {"summary": None, "days": []}
