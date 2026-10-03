from __future__ import annotations

import datetime as dt

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.bills.service import BillsService, period_start
from app.features.bills.tips import Baseload, baseload, tips
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.model import rate_tables, validate
from app.features.tariffs.store import TariffStore

FLAT = {"type": "flat", "flat_rate": 0.3, "feed_in_rate": 0.05, "supply_charge": 1.0, "bands": []}
NOW = int(dt.datetime(2026, 10, 15, 12).timestamp())


@pytest.mark.parametrize(
    ("day", "months", "start_day", "anchor", "start"),
    [
        (dt.date(2026, 10, 2), 3, 1, 1, dt.date(2026, 10, 1)),  # calendar quarters
        (dt.date(2026, 10, 2), 1, 15, 1, dt.date(2026, 9, 15)),  # monthly from the 15th
        (dt.date(2026, 10, 2), 2, 1, 1, dt.date(2026, 9, 1)),  # every two months from January
        (dt.date(2026, 10, 2), 2, 1, 2, dt.date(2026, 10, 1)),  # every two months from February
        (dt.date(2026, 1, 5), 3, 20, 3, dt.date(2025, 12, 20)),  # quarters from 20 March, across the new year
    ],
)
def test_period_start(day: dt.date, months: int, start_day: int, anchor: int, start: dt.date) -> None:
    assert period_start(day, months, start_day, anchor) == start


def _import(readings: ReadingsRepository, first: dt.date, last: dt.datetime, watts: float) -> None:
    """Steady grid import, read every 5 minutes, from the start of `first` to `last`."""
    t, end = int(dt.datetime.combine(first, dt.time()).timestamp()), int(last.timestamp())
    rows = []
    while t < end:
        rows.append((t, {"grid_power": watts, "pv_power": 0.0, "battery_power": 0.0}))
        t += 300
    conn = readings.db.connect()
    readings.insert_many(conn, rows)
    conn.close()


def _bills(db: Database, config: Config, readings: ReadingsRepository) -> BillsService:
    settings = SettingsStore(db, config)
    settings.load()
    settings.save({"bill_months": 1, "bill_day": 1})
    tariffs = TariffStore(db, config)
    tariffs.load()
    tariffs.save(FLAT)
    return BillsService(db, readings, settings, tariffs)


def test_the_current_bill_is_what_has_happened_plus_the_recent_average(
    db: Database, config: Config, readings: ReadingsRepository
) -> None:
    # 500 W from the grid all day: 12 kWh, $3.60 plus $1 supply = $4.60 a day.
    _import(readings, dt.date(2026, 9, 10), dt.datetime.fromtimestamp(NOW), 500)
    out = _bills(db, config, readings).build(NOW)

    assert out["period"] == {"start": "2026-10-01", "end": "2026-10-31", "days": 31, "day": 15}
    so_far = out["current"]["so_far"]
    assert so_far["days"] == 15 and so_far["import_kwh"] == pytest.approx(14 * 12 + 6, abs=0.05)
    expected = out["current"]["expected"]
    assert expected["net_cost"] == pytest.approx(31 * 4.6, abs=0.1) and expected["basis"] == "recent"
    assert [d["partial"] for d in out["days"]] == [False] * 14 + [True]

    (sep,) = out["past"]  # only September has readings, and only from the 10th
    assert (sep["start"], sep["days"], sep["recorded"]) == ("2026-09-01", 30, 21)
    assert sep["net_cost"] == pytest.approx(21 * 4.6, abs=0.1)

    nov = out["upcoming"][0]
    assert (nov["start"], nov["end"]) == ("2026-11-01", "2026-11-30")
    assert nov["net_cost"] == pytest.approx(30 * 4.6, abs=0.1)
    assert out["next_year"]["net_cost"] == pytest.approx(365 * 4.6, abs=0.5)
    assert out["bands"] == [{"name": "All times", "import_kwh": so_far["import_kwh"], "cost": so_far["import_cost"]}]


def test_upcoming_bills_follow_the_same_weeks_last_year(
    db: Database, config: Config, readings: ReadingsRepository
) -> None:
    _import(readings, dt.date(2026, 9, 10), dt.datetime.fromtimestamp(NOW), 500)
    # Last November used twice as much: 24 kWh a day, $8.20 with supply.
    _import(readings, dt.date(2025, 10, 28), dt.datetime(2025, 12, 6), 1000)
    nov, dec, _ = _bills(db, config, readings).build(NOW)["upcoming"]
    assert nov["basis"] == "last_year" and nov["net_cost"] == pytest.approx(30 * 8.2, abs=0.1)
    assert dec["basis"] == "mixed"  # early December has last year to go on, the rest doesn't


TOU = {
    "type": "tou",
    "flat_rate": 0.3,
    "feed_in_rate": 0.05,
    "supply_charge": 1.0,
    "bands": [
        {"name": "Peak", "rate": 0.45, "windows": [{"days": "all", "start": "16:00", "end": "21:00"}]},
        {"name": "Off-peak", "rate": 0.22, "windows": [{"days": "all", "start": "21:00", "end": "07:00"}]},
        {"name": "Shoulder", "rate": 0.3, "other": True, "windows": []},
    ],
}


def _day(peak: float, off: float, shoulder: float, export: float, t: dict = TOU) -> dict:
    """A priced day: grid use in each rate, and solar exported at the feed-in rate."""
    use = [peak, off, shoulder]
    bands = [{"import_kwh": u, "cost": u * b["rate"]} for u, b in zip(use, t["bands"], strict=True)]
    return {
        "import_kwh": sum(use),
        "export_kwh": export,
        "import_cost": sum(b["cost"] for b in bands),
        "feed_in_credit": export * t["feed_in_rate"],
        "bands": bands,
    }


def test_tips_move_peak_use_onto_spare_solar() -> None:
    t = validate(TOU)
    # 4 kWh a day at peak, with 10 kWh of solar exported: a quarter of the peak moved onto solar
    # saves (45c - 5c) a kWh, over a 90-day bill.
    out = tips(t, rate_tables(t), [_day(4, 2, 1, 10)] * 7, 90, None)
    assert [x["kind"] for x in out] == ["peak"]  # not solar as well: it's the same move
    (peak,) = out
    assert (peak["band"], peak["to"], peak["moved_kwh_day"]) == (0, "solar", 1.0)
    assert peak["saving"] == pytest.approx(1.0 * 0.40 * 90)
    # Without solar going spare, the cheapest rate instead: 45c - 22c.
    (peak,) = tips(t, rate_tables(t), [_day(4, 2, 1, 0)] * 7, 90, None)
    assert peak["to"] == "Off-peak" and peak["saving"] == pytest.approx(1.0 * 0.23 * 90)


def test_tips_on_a_flat_rate() -> None:
    t = validate(FLAT)
    # 8 kWh a day from the grid at 30c, and 6 kWh of solar exported at 5c.
    day = {"import_kwh": 8.0, "export_kwh": 6.0, "import_cost": 2.4, "feed_in_credit": 0.3, "bands": []}
    base, solar = tips(t, rate_tables(t), [day] * 7, 30, Baseload(400, 1.0))
    # 400 W always on, all from the grid, is 9.6 kWh a day; 100 W less saves 2.4 kWh a day at 30c.
    assert (base["kind"], base["kwh_day"], base["cut_watts"]) == ("baseload", 9.6, 100)
    assert base["saving"] == pytest.approx(2.4 * 0.3 * 30)
    # When the battery covers three-quarters of the night, most of it is solar that would have earned 5c.
    (base,) = [x for x in tips(t, rate_tables(t), [day] * 7, 30, Baseload(400, 0.25)) if x["kind"] == "baseload"]
    assert base["price"] == pytest.approx(0.25 * 0.3 + 0.75 * 0.05)
    # A quarter of the solar exported, used instead of grid power: 30c - 5c, over 30 days.
    assert (solar["kind"], solar["moved_kwh_day"]) == ("solar", 1.5)
    assert solar["saving"] == pytest.approx(1.5 * 0.25 * 30)


def test_tips_point_out_a_large_supply_charge() -> None:
    t = validate({**FLAT, "supply_charge": 1.5})
    # Little grid use ($1 a day) against a $1.50 supply charge: 60% of the bill.
    day = {"import_kwh": 3.33, "export_kwh": 0.0, "import_cost": 1.0, "feed_in_credit": 0.0, "bands": []}
    (supply,) = tips(t, rate_tables(t), [day] * 7, 30, None)
    assert supply["kind"] == "supply" and supply["saving"] is None
    assert supply["share"] == pytest.approx(0.6) and supply["cost"] == pytest.approx(45)


def test_baseload_is_the_typical_overnight_low() -> None:
    rows = []
    for night in range(5):
        start = int(dt.datetime(2026, 10, 1 + night, 1).timestamp())
        for k in range(48):  # 1am to 5am
            # 300 W always on, with a fridge cycling to 450 W half the time.
            rows.append((start + k * 300, 0.0, 450.0 if k % 2 else 300.0, 0.0))
    assert baseload(rows) == (300, 1.0)  # all from the grid
    # The battery supplying it instead: the same always-on use, none of it from the grid.
    assert baseload([(ts, pv, 0.0, grid) for ts, pv, grid, _ in rows]) == (300, 0.0)
    assert baseload(rows[:96]) is None  # two nights isn't enough to go on


def test_the_bill_has_each_days_detail_whats_still_to_come_and_tips(
    db: Database, config: Config, readings: ReadingsRepository
) -> None:
    _import(readings, dt.date(2026, 9, 10), dt.datetime.fromtimestamp(NOW), 500)
    out = _bills(db, config, readings).build(NOW)
    first = out["days"][0]
    assert first["import_cost"] == pytest.approx(3.6, abs=0.01) and first["supply"] == 1.0
    assert first["bands"] == [{"import_kwh": pytest.approx(12, abs=0.01), "cost": pytest.approx(3.6, abs=0.01)}]
    # 16 to 31 October still to come, each expected to cost what the recent days did.
    assert [a["date"] for a in out["ahead"]][:1] == ["2026-10-16"] and len(out["ahead"]) == 16
    assert out["ahead"][0]["net_cost"] == pytest.approx(4.6, abs=0.05)
    # 500 W around the clock: worth cutting.
    assert [x["kind"] for x in out["tips"]] == ["baseload"]
    assert out["tips"][0]["watts"] == 500 and out["tips"][0]["grid_share"] == 1.0
