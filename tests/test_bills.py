from __future__ import annotations

import datetime as dt

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.bills.service import BillsService, period_start
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
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
