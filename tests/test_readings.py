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


def test_export_starts_with_a_header(readings: ReadingsRepository) -> None:
    _fill(readings, RECENT, 2, pv_power=1.0)
    rows = list(readings.export_rows(RECENT, RECENT + 600, rollup=False))
    assert rows[0][:3] == ["ts", "time", "pv_power"]
    assert len(rows) == 3  # header and both raw rows
    assert len(list(readings.export_rows(RECENT, RECENT + 600, rollup=True))) == 2  # header and one rollup
