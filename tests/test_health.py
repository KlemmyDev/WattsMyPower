"""The Health page: the checkup, the solar trend and its likely causes, and the battery's run."""

from __future__ import annotations

import datetime as dt
import time

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.bills.service import BillsService
from app.features.forecast.learning import Sample
from app.features.insights import battery, performance
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.store import TariffStore

NOW = int(dt.datetime(2026, 10, 15, 12).timestamp())
DAY = 86400


def at(day: int, hour: float) -> int:
    """`day` days before NOW's date, at `hour` local time."""
    d = dt.date.fromtimestamp(NOW) - dt.timedelta(days=day)
    return int(dt.datetime.combine(d, dt.time()).timestamp() + hour * 3600)


# ------------------------------------------------------------------ the solar trend
def sample(ts: int, poa: float, actual: float, full: bool = False) -> Sample:
    return Sample(ts=ts, day="", ghi=poa, poa=poa, cell="", cloud=None, temp=None, actual=actual, full=full)


def test_the_monthly_ratio_leaves_out_full_battery_and_capped_hours() -> None:
    days = range(12)  # all in October
    hours = [sample(at(d, h), 0.8, 4.0) for d in days for h in (11, 12)]  # 4 kWh from 0.8 kWh/m² on 6.25 kW
    hours += [sample(at(d, 13), 0.8, 1.0, full=True) for d in days]  # held back: not the panels
    hours += [sample(at(d, 14), 0.9, 5.0) for d in days]  # at the inverter's limit
    hours += [sample(at(d, 7), 0.1, 0.1) for d in days]  # too dim to judge
    (month,) = performance.monthly(hours, 6.25, cap_kwh=5.0)
    assert month == {"month": "2026-10", "ratio": 0.8, "hours": 24}


def test_the_trend_is_a_share_of_the_average_per_year() -> None:
    months = [{"month": f"2026-{m:02d}", "ratio": 0.8 - 0.004 * m} for m in range(1, 13)]
    per_year = performance.trend(months)
    assert per_year is not None and per_year == pytest.approx(-0.048 / 0.774, abs=0.002)
    assert performance.trend(months[:5]) is None  # too few months to say


def test_output_held_at_a_limit_counts_as_capped() -> None:
    since = at(30, 0)
    # 12 sunny middays the model puts at 6 kW, with output flat at 5: 1 kWh lost each.
    hours: list[tuple[int, float, float | None]] = [(at(d, 12), 6.0, 5.0) for d in range(12)]
    hours += [(at(d, 9), 3.0, 3.0) for d in range(12)]
    out = performance.capped(hours, 5.0, since)
    assert out == {"limit_kw": 5.0, "days": 12, "kwh": 12.0}
    # A peak reached only now and then is the sunniest hour, not a cap.
    assert performance.capped(hours[:5] + hours[12:], 5.0, since) is None


def test_output_jumping_after_rain_points_to_dust() -> None:
    days = [{"date": f"2026-09-{d:02d}", "ratio": 0.86, "clear": True} for d in range(1, 11)]
    days += [{"date": f"2026-09-{d:02d}", "ratio": 0.97, "clear": True} for d in range(12, 16)]
    out = performance.dust(days, {"2026-09-11": 14.0, "2026-09-03": 1.0}, "2026-09-01")
    assert out == {"date": "2026-09-11", "rain_mm": 14.0, "before": 0.86, "after": 0.97}
    # No jump, no dust.
    flat = [{**d, "ratio": 0.9} for d in days]
    assert performance.dust(flat, {"2026-09-11": 14.0}, "2026-09-01") is None


def test_afternoons_falling_behind_mornings_points_to_shade() -> None:
    since = at(14, 0)
    before = [(at(d, h), 2.0, 2.0) for d in range(15, 40) for h in (9, 10, 14, 15)]
    after = [(at(d, h), 2.0, 2.0 if h < 12 else 1.5) for d in range(1, 14) for h in (9, 10, 14, 15)]
    assert performance.shade(before + after, since) == {"part": "afternoon", "drop": 0.25}
    # A day that's down all over isn't shade.
    dull = [(t, e, a * 0.8) for t, e, a in before[: len(after)]]
    assert performance.shade(before + [(t + 30 * DAY, e, a) for t, e, a in dull], since) is None


# ------------------------------------------------------------------ the battery
def test_a_month_of_the_battery() -> None:
    daily = [{"daily_charge": 10.0, "daily_discharge": 9.0}] * 30
    row = battery.month_row("2026-09", daily, 97.5, 10.0)
    assert row == {
        "month": "2026-09",
        "soh": 97.5,
        "charge_kwh": 300.0,
        "discharge_kwh": 270.0,
        "efficiency": 90.0,
        "cycles": 27.0,
    }


def test_the_warranty_used_by_time_and_by_energy() -> None:
    installed = int(dt.datetime(2021, 10, 15).timestamp())
    w = battery.warranty(installed, 10, 30, 12_000.0, NOW)
    assert w is not None
    assert w["time_pct"] == pytest.approx(50, abs=0.2) and w["energy_pct"] == 40.0 and w["used_mwh"] == 12.0
    assert battery.warranty(installed, None, None, 12_000.0, NOW) is None


class FlatPrices:
    def buy(self, ts: int) -> float:
        return 0.30

    def sell(self, ts: int) -> float:
        return 0.05


def test_a_bigger_battery_keeps_what_was_sent_away_for_the_evening() -> None:
    rows: list[tuple[int, float | None, float | None]] = []
    for d in range(20):
        start = at(d + 1, 0)
        for k in range(288):
            ts, hour = start + k * 300, k / 12
            if 10 <= hour < 14:  # full by 10 and sending 3 kW away: 12 kWh a day
                rows.append((ts, -3000.0, 100.0))
            elif 18 <= hour < 22:  # down to reserve by 6 and buying 1.5 kW: 6 kWh a day
                rows.append((ts, 1500.0, 10.0))
            else:
                rows.append((ts, 0.0, 60.0))
    out = battery.sizing(sorted(rows), 10.0, 5.0, 10.0, FlatPrices())  # type: ignore[arg-type]
    assert out is not None
    assert out["days"] == 20 and out["full_by_noon"] == 20 and out["reserve_days"] == 20
    assert out["sent_while_full_kwh"] == pytest.approx(240) and out["bought_while_low_kwh"] == pytest.approx(120)
    five, ten = out["options"]
    # 5 kWh kept each day gives back 4.75 (after losses each way); 10 kWh covers the evening's 6.
    assert five["kwh"] == pytest.approx(20 * 5 * 0.95, abs=0.5)
    assert ten["kwh"] == pytest.approx(120, abs=0.5)
    # Each kWh given back saves 30c, less the 5c it would have earned as feed-in.
    assert five["saved"] == pytest.approx(five["kwh"] * 0.30 - 20 * 5 / 0.95 * 0.05, abs=0.1)
    assert battery.sizing(rows[: 288 * 5], 10.0, 5.0, 10.0, None) is None  # too few days


# ------------------------------------------------------------------ the database's side
def test_payback_from_what_the_system_saves(db: Database, config: Config, readings: ReadingsRepository) -> None:
    # 60 days of 1 kW of solar used at home all day: 24 kWh a day the grid didn't supply, at 30c.
    start = at(60, 0)
    conn = readings.db.connect()
    readings.insert_many(
        conn,
        [
            (t, {"grid_power": 0.0, "pv_power": 1000.0, "battery_power": 0.0, "daily_pv": (t - start) % DAY / 3600})
            for t in range(start, NOW, 300)
        ],
    )
    conn.close()
    settings = SettingsStore(db, config)
    settings.load()
    tariffs = TariffStore(db, config)
    tariffs.load()
    tariffs.save({"type": "flat", "flat_rate": 0.3, "feed_in_rate": 0.05, "supply_charge": 1.0, "bands": []})
    bills = BillsService(db, readings, settings, tariffs)
    assert bills.payback(NOW, None)["cost"] is None  # no cost set: savings, but no payback

    installed = at(160, 0)  # 100 days before the first reading
    settings.save({"system_cost": 5000, "system_installed": installed})
    out = bills.payback(NOW, 10_000.0)
    daily = 23 + 55 / 60  # the inverter's day counter, as last read at 23:55
    assert out["per_year"] == pytest.approx(daily * 0.3 * 365, abs=1)
    assert out["saved_before"] == pytest.approx(100 * daily * 0.3, abs=1)
    assert out["paid_off"] is False and out["paid_pct"] == pytest.approx(out["saved_total"] / 50, abs=0.1)
    left = (5000 - out["saved_total"]) / (daily * 0.3)
    assert out["payback_at"] == pytest.approx(NOW + left * DAY, abs=DAY)
    assert out["co2_t"] == 6.8


def test_ownership_settings_are_checked(db: Database, config: Config) -> None:
    settings = SettingsStore(db, config)
    settings.load()
    with pytest.raises(ValueError, match="Battery warranty must be between 0 and 30 years"):
        settings.save({"battery_warranty_years": 40})
    assert settings.save({"system_cost": 12_500})["system_cost"] == 12_500


def test_grid_hours_are_per_day_and_priced(db: Database, config: Config, readings: ReadingsRepository) -> None:
    start = at(20, 0)
    conn = readings.db.connect()
    readings.insert_many(
        conn, [(t, {"grid_power": 2000.0 if time.localtime(t).tm_hour == 18 else 0.0}) for t in range(start, NOW, 300)]
    )
    conn.close()
    settings = SettingsStore(db, config)
    settings.load()
    tariffs = TariffStore(db, config)
    tariffs.load()
    tariffs.save(
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
    out = BillsService(db, readings, settings, tariffs).grid_hours(NOW)
    month = next(m for m in out["months"] if m["hours"])
    assert month["hours"][18] == {"kwh": 2.0, "cost": 1.0} and month["hours"][3] == {"kwh": 0.0, "cost": 0.0}
    assert out["dearest"] == {"name": "Peak", "hours": [16, 17, 18, 19, 20]}
