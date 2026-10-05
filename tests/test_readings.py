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


def test_the_live_snapshot_has_todays_counters_as_history_counts_them(readings: ReadingsRepository) -> None:
    """A counter that's lower now than earlier today (the second inverter's share missing from the latest reading)
    is today's highest, as History's day has it, so the Overview's figures are the same."""
    _fill(readings, MIDNIGHT + 3600, 10, daily_pv=12.0, daily_charge=3.0, daily_discharge=1.0)
    _fill(readings, MIDNIGHT + 7200, 1, daily_pv=8.0, daily_charge=3.0, daily_discharge=1.0)
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    snap = readings.with_metered_today({"ts": MIDNIGHT + 7200, "daily_pv": 8.0, "pv_power": 0.0})
    assert snap["daily_pv"] == day["daily_pv"] == 12.0
    assert (snap["daily_charge"], snap["daily_discharge"], snap["pv_power"]) == (3.0, 1.0, 0.0)


def _imported(readings: ReadingsRepository, ts: int, replaces: bool, **values: float) -> None:
    with readings.db.writing() as conn:
        import_id = conn.execute(
            "INSERT INTO imports (label, files, created_at, replaces) VALUES ('Daily report', 1, 0, ?)",
            (int(replaces),),
        ).lastrowid
        cols = ", ".join(values)
        conn.execute(
            f"INSERT INTO samples_5m (ts, import_id, {cols}) VALUES (?, ?{', ?' * len(values)})",
            (ts, import_id, *values.values()),
        )


def test_a_gap_filled_from_a_file_doesnt_outdo_the_inverters_own_counters(readings: ReadingsRepository) -> None:
    """The inverter counted 42.3 kWh of solar through the day, gap included. A file filling the gap adds its power
    readings up to 43.65 by then (they read high): the day is still the inverter's. A day with nothing recorded takes
    the file's, and an import that replaces what was recorded wins."""
    _fill(readings, MIDNIGHT + 8 * 3600, 10, daily_pv=20.0, daily_charge=5.0)
    _fill(readings, MIDNIGHT + 18 * 3600, 10, daily_pv=42.3, daily_charge=12.6)
    _imported(readings, MIDNIGHT + 17 * 3600, False, daily_pv=43.65, daily_charge=12.25, daily_discharge=8.5)
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    assert (day["daily_pv"], day["daily_charge"]) == (42.3, 12.6)
    assert day["daily_discharge"] == 8.5  # not recorded at all that day: the file's is all there is

    later = MIDNIGHT + 86400
    _imported(readings, later + 12 * 3600, False, daily_pv=30.0)
    _fill(readings, later + 2 * 86400, 1, daily_pv=1.0)  # another day, recorded
    _fill(readings, later + 86400 + 9 * 3600, 5, daily_pv=12.0)
    _imported(readings, later + 86400 + 10 * 3600, True, daily_pv=25.0)
    days = {d["date"]: d["daily_pv"] for d in readings.daily(later, later + 2 * 86400)}
    assert list(days.values()) == [30.0, 25.0]


def test_a_day_first_read_part_way_through_counts_the_grid_from_midnight(readings: ReadingsRepository) -> None:
    """Connected at 2 pm: the inverter's daily counters already hold the morning's import and export,
    as daily_pv holds its solar. Without them, the morning's export would come out as home use."""
    two_pm = MIDNIGHT + 14 * 3600
    conn = readings.db.connect()
    readings.insert_many(conn, [
        (two_pm + i * 60, {"grid_power": -600.0, "daily_pv": 40.0, "daily_import": 3.0, "daily_export": 25.0 + 0.01 * i,
                           "total_import": 2000.0, "total_pv_export": 9000.0, "total_export": 500 + 0.01 * i})
        for i in range(60)
    ])  # fmt: skip
    conn.close()
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    # The morning (25.04 kWh at the first rollup) and then the lifetime counter's steps: 0.55 kWh.
    assert day["daily_export"] == round(25.04 + 0.01 * 59 - 0.01 * 4, 2)
    assert day["daily_import"] == 3.0
    snap = readings.with_metered_today({"ts": two_pm + 3540, "daily_export": 0.0, "daily_import": 0.0})
    assert snap["daily_export"] == day["daily_export"]


def test_a_day_read_from_midnight_doesnt_add_the_daily_counter(readings: ReadingsRepository) -> None:
    """Read through midnight: the counters say it all, and a just-past-midnight daily counter (maybe not yet
    reset) is left alone."""
    _day_of_export(readings, MIDNIGHT, grid_power=-500.0, daily_export=30.0, total_pv_export=9000.0,
                   total_export=lambda i: 100 + 0.01 * i)  # fmt: skip
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    assert day["daily_export"] == round(0.01 * 124 - 0.01 * 4, 2)


def test_a_late_start_doesnt_take_an_impossible_daily_counter(readings: ReadingsRepository) -> None:
    """A garbled daily counter (more than the grid could carry since midnight) falls back to grid power."""
    one_am = MIDNIGHT + 3600
    conn = readings.db.connect()
    readings.insert_many(conn, [(one_am + i * 60, {"grid_power": -600.0, "daily_export": 6000.0, "total_pv_export": 9000.0,
                                                   "total_export": 500.0 + 0.01 * i}) for i in range(10)])  # fmt: skip
    conn.close()
    (day,) = readings.daily(MIDNIGHT, MIDNIGHT + 86400)
    assert day["daily_export"] == round(600 * 300 / 3.6e6 + 0.05, 2)


def test_export_starts_with_a_header(readings: ReadingsRepository) -> None:
    _fill(readings, RECENT, 2, pv_power=1.0)
    rows = list(readings.export_rows(RECENT, RECENT + 600, rollup=False))
    assert rows[0][:3] == ["ts", "time", "pv_power"]
    assert len(rows) == 3  # header and both raw rows
    assert len(list(readings.export_rows(RECENT, RECENT + 600, rollup=True))) == 2  # header and one rollup


def test_history_starts_at_the_first_rollup_after_raw_rows_are_pruned(readings: ReadingsRepository) -> None:
    conn = readings.db.connect()
    readings.insert_many(conn, [(MIDNIGHT, {"pv_power": 100.0}), (MIDNIGHT + 86400 * 200, {"pv_power": 200.0})])
    conn.execute("DELETE FROM samples WHERE ts = ?", (MIDNIGHT,))  # as RAW_RETENTION_DAYS would
    conn.commit()
    conn.close()
    stats = readings.stats()
    assert stats["first_ts"] == MIDNIGHT + 86400 * 200
    assert stats["history_from"] == MIDNIGHT
