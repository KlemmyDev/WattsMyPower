from __future__ import annotations

import datetime as dt
import time

from app.core.schema import ROLLUP
from app.features.readings.repository import ReadingsRepository

# Recent enough to be inside raw-reading retention, and on a 5-minute boundary.
RECENT = (int(time.time()) - 2 * 86400) // ROLLUP * ROLLUP


def _fill(readings: ReadingsRepository, start: int, minutes: int, **values: float) -> None:
    conn = readings.db.connect()
    readings.insert_many(conn, [(start + i * 60, dict(values)) for i in range(minutes)])
    conn.close()


def test_insert_rolls_up_into_5_minute_buckets(readings: ReadingsRepository) -> None:
    start = RECENT
    _fill(readings, start, 10, pv_power=1000.0, daily_pv=2.0)
    with readings.db.reading() as conn:
        rows = conn.execute("SELECT ts, pv_power, daily_pv FROM samples_5m ORDER BY ts").fetchall()
    assert rows == [(start, 1000.0, 2.0), (start + ROLLUP, 1000.0, 2.0)]


def test_history_breaks_the_line_over_gaps(readings: ReadingsRepository) -> None:
    start = RECENT
    _fill(readings, start, 5, pv_power=500.0)
    _fill(readings, start + 3600, 5, pv_power=700.0)  # an hour later
    h = readings.history(start, start + 4000, points=1000, fields=["pv_power"])
    assert h["source"] == "samples" and h["bucket"] == 60
    values = h["series"]["pv_power"]
    assert None in values  # the gap is marked, so charts don't join across it
    assert values[0] == 500.0 and values[-1] == 700.0


def test_history_uses_rollups_for_long_ranges_and_ignores_unknown_fields(readings: ReadingsRepository) -> None:
    start = RECENT
    _fill(readings, start, 30, pv_power=100.0)
    h = readings.history(start, start + 30 * 86400, points=100, fields=["nope; DROP TABLE samples"])
    assert h["source"] == "samples_5m"
    assert list(h["series"]) == ["t", "pv_power", "load_power", "grid_power", "battery_power", "battery_soc"]


def test_daily_skips_the_first_ten_minutes_after_midnight(readings: ReadingsRepository) -> None:
    midnight = int(dt.datetime(2026, 3, 2).timestamp())
    _fill(readings, midnight, 5, daily_pv=30.0)  # yesterday's counter, not yet reset by the inverter
    _fill(readings, midnight + 600, 5, daily_pv=0.5)
    rows = readings.daily(midnight, midnight + 86400)
    assert rows == [{"date": "2026-03-02", "daily_pv": 0.5, "daily_import": None, "daily_export": None,
                     "daily_charge": None, "daily_discharge": None, "daily_direct": None, "daily_pv2": None}]  # fmt: skip


def _day_of_export(readings: ReadingsRepository, midnight: int, **values: float | None) -> None:
    """Exporting from 5 minutes before midnight to 2 hours after, a minute at a time."""
    conn = readings.db.connect()
    rows = []
    for i in range(125):
        snap = {k: v(i) if callable(v) else v for k, v in values.items()}
        rows.append((midnight - 300 + i * 60, snap))
    readings.insert_many(conn, rows)
    conn.close()


MIDNIGHT = int(dt.datetime(2026, 3, 4).timestamp())


def test_export_comes_from_the_meters_lifetime_counter_when_the_daily_one_stays_at_0(
    readings: ReadingsRepository,
) -> None:
    """The SH5.0RS: daily export (13045) reads 0 all day; lifetime export (13046) counts."""
    _day_of_export(readings, MIDNIGHT, grid_power=-500.0, daily_export=0.0, total_pv_export=9000.0,
                   total_export=lambda i: 100 + 0.01 * i)  # fmt: skip
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    # From the last rollup before midnight to the last one today: 1.2 kWh, not the ~1 kWh that
    # 500 W of averaged readings would make.
    assert day["daily_export"] == round(0.01 * 124 - 0.01 * 4, 2)


def test_before_the_meters_export_counter_was_recorded_grid_power_stands_in(readings: ReadingsRepository) -> None:
    """Older readings: total_export held the hybrid's own panels' export (no total_pv_export yet)."""
    _day_of_export(readings, MIDNIGHT, grid_power=-600.0, daily_export=0.4, total_export=lambda i: 50 + 0.002 * i)
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    assert day["daily_export"] == round(600 * 120 * 60 / 3.6e6, 2)  # 1.2 kWh


def test_a_counter_that_doesnt_move_or_jumps_is_not_believed(readings: ReadingsRepository) -> None:
    _day_of_export(readings, MIDNIGHT, grid_power=-600.0, total_pv_export=9000.0, total_export=100.0)
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    assert day["daily_export"] == 1.2  # stuck counter: grid power instead

    later = MIDNIGHT + 86400
    _day_of_export(readings, later, grid_power=-600.0, total_pv_export=9000.0,
                   total_export=lambda i: 100 + 0.01 * i + (5000 if i >= 60 else 0))  # fmt: skip
    (day,) = readings.daily(later, later + 86400)
    # Every rollup counts what the counter moved, except the one with the garbled jump.
    assert day["daily_export"] == round(0.01 * 124 - 0.01 * 4 - 0.05 + 0.05, 2)


def test_import_comes_from_the_meters_lifetime_counter(readings: ReadingsRepository) -> None:
    _day_of_export(readings, MIDNIGHT, grid_power=300.0, daily_import=0.0, total_import=lambda i: 2000 + 0.005 * i)
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    assert day["daily_import"] == 0.6 and day["daily_export"] == 0.0


def test_the_live_snapshot_gets_todays_metered_totals(readings: ReadingsRepository) -> None:
    _day_of_export(readings, MIDNIGHT, grid_power=-500.0, daily_export=0.0, total_pv_export=9000.0,
                   total_export=lambda i: 100 + 0.01 * i)  # fmt: skip
    snap = readings.with_metered_today({"ts": MIDNIGHT + 7200, "daily_export": 0.0, "daily_import": 0.0})
    assert snap["daily_export"] == 1.2 and snap["daily_import"] == 0.0


def test_export_starts_with_a_header(readings: ReadingsRepository) -> None:
    _fill(readings, RECENT, 2, pv_power=1.0)
    rows = list(readings.export_rows(RECENT, RECENT + 600, rollup=False))
    assert rows[0][:3] == ["ts", "time", "pv_power"]
    assert len(rows) == 3  # header and both raw rows
    assert len(list(readings.export_rows(RECENT, RECENT + 600, rollup=True))) == 2  # header and one rollup
