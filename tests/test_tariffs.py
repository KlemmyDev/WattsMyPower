from __future__ import annotations

import datetime as dt
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.readings.repository import ReadingsRepository
from app.features.tariffs.costs import daily_costs
from app.features.tariffs.model import rate_tables, validate
from app.features.tariffs.store import TariffStore

TOU: dict[str, Any] = {
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


def test_windows_can_wrap_past_midnight() -> None:
    tables = rate_tables(validate(TOU))
    assert tables.at(False, 23 * 60) == 1  # off-peak at 23:00
    assert tables.at(False, 3 * 60) == 1  # and at 03:00
    assert tables.at(False, 17 * 60) == 0  # peak
    assert tables.at(True, 12 * 60) == tables.other == 2  # shoulder fills the gaps


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"type": "monthly"}, "Rate type must be single rate or time of use."),
        ({"flat_rate": "lots"}, "Grid import rate must be a number."),
        ({"supply_charge": 50}, "Daily supply charge must be between 0 and 20."),
        ({"bands": TOU["bands"][:1]}, "Time of use needs between 2 and 6 rates."),
    ],
)
def test_validation_messages(change: dict[str, Any], message: str) -> None:
    with pytest.raises(ValueError, match=message.replace(".", r"\.")):
        validate({**TOU, **change})


def test_overlapping_windows_name_the_clash() -> None:
    bands = [
        {"name": "Peak", "rate": 0.45, "windows": [{"days": "weekdays", "start": "16:00", "end": "21:00"}]},
        {"name": "Evening", "rate": 0.4, "windows": [{"days": "all", "start": "20:00", "end": "22:00"}]},
        {"name": "Other", "rate": 0.3, "other": True, "windows": []},
    ]
    with pytest.raises(ValueError, match="Peak and Evening overlap on weekdays at 20:00"):
        validate({**TOU, "bands": bands})


def test_store_saves_and_reloads(db: Database, config: Config) -> None:
    store = TariffStore(db, config)
    store.load()
    assert store.get()["type"] == "flat" and store.get()["flat_rate"] == config.import_rate
    store.save(TOU)
    fresh = TariffStore(db, config)
    fresh.load()
    assert [b["name"] for b in fresh.get()["bands"]] == ["Peak", "Off-peak", "Shoulder"]


def test_first_load_carries_over_rates_from_the_old_settings_table(db: Database, config: Config) -> None:
    with db.writing() as conn:
        conn.execute("INSERT INTO settings VALUES ('import_rate', 0.41), ('feed_in_rate', 0.07)")
    store = TariffStore(db, config)
    store.load()
    t = store.get()
    assert (t["flat_rate"], t["feed_in_rate"], t["supply_charge"]) == (0.41, 0.07, config.supply_charge)


def test_costs_are_priced_by_rate_and_scaled_to_the_meter(readings: ReadingsRepository) -> None:
    t = validate(TOU)
    day = int(dt.datetime(2026, 3, 3).timestamp())  # a Tuesday
    conn = readings.db.connect()
    # 1 kW of grid import from 17:00 to 18:00 (peak), while the meter's lifetime counters say
    # 2 kWh came in and 1 kWh went out (the readings are averages, the counters the bill).
    meter = {"total_pv_export": 10.0}
    rows = [(day + 16 * 3600 + 59 * 60, {"total_import": 100.0, "total_export": 50.0, **meter})]
    rows += [
        (
            day + 17 * 3600 + i * 60,
            {"grid_power": 1000.0, "pv_power": 0.0, "battery_power": 0.0,
             "total_import": 100 + 2 * (i + 1) / 60, "total_export": 50 + (i + 1) / 60, **meter},
        )
        for i in range(60)
    ]  # fmt: skip
    rows.append((day + 18 * 3600, {"daily_pv": 3.0, "total_import": 102.0, "total_export": 51.0, **meter}))
    readings.insert_many(conn, rows)
    conn.close()

    out = daily_costs(readings, t, rate_tables(t), day, day + 86400)
    (d,) = out["days"]
    peak = d["bands"][0]
    assert d["import_kwh"] == 2.0  # scaled from the ~1 kWh of readings to the meter's 2 kWh
    assert peak["import_kwh"] == 2.0 and peak["cost"] == pytest.approx(0.9)
    assert d["feed_in_credit"] == pytest.approx(0.05)
    assert d["net_cost"] == pytest.approx(0.9 + 1.0 - 0.05)
