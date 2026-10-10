"""
Inverter readings: raw samples (one per poll) and their 5-minute rollups, and the
queries over them (history charts, daily totals, CSV export).
"""

from __future__ import annotations

import math
import sqlite3
import time
from collections.abc import Iterator
from typing import Any

from app.core.database import Database
from app.core.schema import MAX_W_THREE_PHASE, ROLLUP, ROLLUP_KEEPING_SQL, SAMPLE_COLUMNS

Snapshot = dict[str, Any]

COLS = list(SAMPLE_COLUMNS)
DAILY_COLS = [
    "daily_pv",
    "daily_import",
    "daily_export",
    "daily_charge",
    "daily_discharge",
    "daily_direct",
    "daily_pv2",
]
KWH_PER_W_ROLLUP = ROLLUP / 3.6e6  # one rollup of 1 W, in kWh
# Daily figures worked out from lifetime counters or power when the inverter has no daily counter for them (`daily`);
# a second inverter's (daily_pv2) is filled in along with them.
WORKED_OUT = ("daily_pv", "daily_charge", "daily_discharge")
# How long after midnight the inverter's daily counters are trusted to have reset (see `daily`).
SINCE_MIDNIGHT = 600
DEFAULT_FIELDS = ["pv_power", "load_power", "grid_power", "battery_power", "battery_soc"]

_INSERT = f"INSERT OR REPLACE INTO samples (ts, {', '.join(COLS)}) VALUES (?{', ?' * len(COLS)})"


class ReadingsRepository:
    def __init__(self, db: Database, poll_interval: int, raw_retention_days: int):
        self.db = db
        self.poll_interval = poll_interval
        self.raw_retention_days = raw_retention_days

    # ------------------------------------------------------------------ writing (the ingest loop's connection)
    def heal_rollups(self, conn: sqlite3.Connection) -> None:
        """After a crash or restart, rebuild rollups from the last recorded (not imported) bucket onward."""
        last = conn.execute("SELECT MAX(ts) FROM samples_5m WHERE import_id IS NULL").fetchone()[0] or 0
        conn.execute(ROLLUP_KEEPING_SQL, (last, 2**62))
        conn.commit()

    def insert(self, conn: sqlite3.Connection, ts: int, snap: Snapshot) -> None:
        conn.execute(_INSERT, (ts, *(snap.get(c) for c in COLS)))
        bucket = ts // ROLLUP * ROLLUP
        conn.execute(ROLLUP_KEEPING_SQL, (bucket, bucket + ROLLUP))
        conn.commit()

    def insert_many(self, conn: sqlite3.Connection, rows: list[tuple[int, Snapshot]]) -> None:
        if not rows:
            return
        conn.executemany(_INSERT, [(ts, *(s.get(c) for c in COLS)) for ts, s in rows])
        conn.execute(ROLLUP_KEEPING_SQL, (rows[0][0] // ROLLUP * ROLLUP, 2**62))
        conn.commit()

    def raw_cutoff(self) -> int:
        """Oldest timestamp raw rows are kept for (bucket-aligned); 0 = everything is kept."""
        if self.raw_retention_days <= 0:
            return 0
        return (int(time.time()) - self.raw_retention_days * 86400) // ROLLUP * ROLLUP

    def prune(self, conn: sqlite3.Connection) -> int:
        """Delete raw rows past retention (their rollups stay). Returns how many went."""
        cutoff = self.raw_cutoff()
        if not cutoff:
            return 0
        n = conn.execute("DELETE FROM samples WHERE ts < ?", (cutoff,)).rowcount
        conn.commit()
        return n

    def is_empty(self, conn: sqlite3.Connection) -> bool:
        return conn.execute("SELECT 1 FROM samples LIMIT 1").fetchone() is None

    # ------------------------------------------------------------------ queries
    def latest(self) -> Snapshot | None:
        with self.db.reading() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM samples ORDER BY ts DESC LIMIT 1").fetchone()
            return dict(row) if row else None

    def history(self, start: int, end: int, points: int, fields: list[str]) -> dict[str, Any]:
        """
        Columnar, time-bucketed series between start and end (unix seconds).
        Picks raw rows for short ranges and 5-minute rollups for long ones, and
        inserts a null row wherever data is missing so charts show gaps honestly.
        """
        fields = [f for f in fields if f in SAMPLE_COLUMNS] or DEFAULT_FIELDS
        span = max(1, end - start)
        bucket = max(self.poll_interval, math.ceil(span / max(10, points)))
        table = "samples"
        # Long ranges, or anything reaching back past raw retention, read the rollups.
        if bucket >= ROLLUP or start < self.raw_cutoff():
            bucket = max(bucket, ROLLUP)
            table = "samples_5m"
            nice = (300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400)
            bucket = next((n for n in nice if n >= bucket), math.ceil(bucket / 86400) * 86400)

        select = ", ".join(f"{SAMPLE_COLUMNS[f]}({f})" for f in fields)
        sql = f"SELECT (ts / {bucket}) * {bucket} AS b, {select} FROM {table} WHERE ts >= ? AND ts < ? GROUP BY b ORDER BY b"
        with self.db.reading() as conn:
            rows = conn.execute(sql, (start, end)).fetchall()

        out: dict[str, list[Any]] = {"t": [], **{f: [] for f in fields}}
        # Missing more than a few polls (or a few buckets) -> break the line.
        gap = max(bucket * 3, self.poll_interval * 6, 120)
        prev = None
        for row in rows:
            if prev is not None and row[0] - prev > gap:
                out["t"].append(prev + bucket)
                for f in fields:
                    out[f].append(None)
            out["t"].append(row[0])
            for i, f in enumerate(fields, 1):
                v = row[i]
                out[f].append(round(v, 2) if v is not None else None)
            prev = row[0]
        return {"bucket": bucket, "source": table, "series": out}

    def daily(self, start: int, end: int) -> list[dict[str, Any]]:
        """
        Per-local-day energy totals (kWh) from the inverter's daily counters, except grid import
        and export, which come from the meter (see `metered`).

        A day's counters are what the dashboard recorded. Rollups imported to fill time it didn't record
        (app.features.imports) carry daily totals added up from the file's power readings, which read
        high (a 5-minute sample held for 5 minutes), while the inverter's own counters kept counting
        through the gap: so where a day has recorded counters, imported ones don't count. A day with
        none takes the imported totals, and an import that replaces what was recorded wins.
        """
        # Skip the first 10 minutes after midnight: if the inverter's clock lags
        # ours, yesterday's un-reset counter would otherwise count as today's max.
        select = ", ".join(f"MAX(s.{c})" for c in DAILY_COLS)
        # 2: an import replacing what was recorded, 1: recorded, 0: an import filling a gap.
        source = "CASE WHEN s.import_id IS NULL THEN 1 WHEN i.replaces = 1 THEN 2 ELSE 0 END"
        sql = (
            f"SELECT date(s.ts, 'unixepoch', 'localtime') AS d, {source} AS src, {select}"
            " FROM samples_5m s LEFT JOIN imports i ON i.id = s.import_id"
            " WHERE s.ts >= ? AND s.ts < ? AND strftime('%H%M', s.ts, 'unixepoch', 'localtime') >= '0010'"
            " GROUP BY d, src ORDER BY d, src DESC"
        )
        with self.db.reading() as conn:
            rows = conn.execute(sql, (start, end)).fetchall()
        grid = self.metered(start, end)
        days: dict[str, dict[str, float | None]] = {}
        for date, _src, *values in rows:  # the most trusted source first
            day = days.setdefault(date, dict.fromkeys(DAILY_COLS))
            for c, v in zip(DAILY_COLS, values, strict=True):
                if day[c] is None and v is not None:
                    day[c] = round(v, 2)
        if any(day[c] is None for day in days.values() for c in WORKED_OUT):
            for date, worked in self.worked_out(start, end).items():
                if (missing := days.get(date)) is not None:
                    for c, v in worked.items():
                        if missing[c] is None and v is not None:
                            missing[c] = v
        out = []
        for date, day in days.items():
            imp, exp = grid.get(date, (None, None))
            # Days with nothing to go on keep the inverter's own counters.
            day["daily_import"] = imp if imp is not None else day["daily_import"]
            day["daily_export"] = exp if exp is not None else day["daily_export"]
            out.append({"date": date, **day})
        return out

    def worked_out(self, start: int, end: int) -> dict[str, dict[str, float | None]]:
        """
        A day's solar, charge and discharge (kWh) for inverters that don't count them per day: a Fronius GEN24 has no
        daily counters at all, and Fronius' Solar API no battery counters. Solar (each system's, too) is how far its
        lifetime counter moved over the day, from the last reading before it; without one, its power added up over
        the day's rollups, as is the battery's charge and discharge. Only fills in what the counters left out.
        """
        cols = "ts, pv_power, battery_power, total_pv, total_pv2, pv2_power, import_id"
        with self.db.reading() as conn:
            prev = conn.execute(f"SELECT {cols} FROM samples_5m WHERE ts < ? ORDER BY ts DESC LIMIT 1", (start,))
            rows = [*prev.fetchall(), *conn.execute(f"SELECT {cols} FROM samples_5m WHERE ts >= ? AND ts < ? ORDER BY ts", (start, end))]  # fmt: skip
        # Per day: [last total_pv before it, last total_pv in it, the same for pv2, pv kWh, pv2 kWh, charge, discharge,
        # whether there's a battery]
        days: dict[str, list[float | None]] = {}
        last: list[float | None] = [None, None]  # the latest lifetime counters seen (pv, pv2)
        for ts, pv, bp, total, total2, pv2, _ in rows:
            if ts >= start:
                date = time.strftime("%Y-%m-%d", time.localtime(ts))
                d = days.setdefault(date, [last[0], None, last[1], None, 0.0, 0.0, 0.0, 0.0, 0.0])
                d[1] = total if total is not None else d[1]
                d[3] = total2 if total2 is not None else d[3]
                for i, w in ((4, pv), (5, pv2)):
                    d[i] = (d[i] or 0.0) + max(w or 0.0, 0.0) * KWH_PER_W_ROLLUP
                d[6] = (d[6] or 0.0) + max(-(bp or 0.0), 0.0) * KWH_PER_W_ROLLUP
                d[7] = (d[7] or 0.0) + max(bp or 0.0, 0.0) * KWH_PER_W_ROLLUP
                d[8] = 1.0 if bp is not None else d[8]
            last = [total if total is not None else last[0], total2 if total2 is not None else last[1]]

        def moved(before: float | None, after: float | None, by_power: float | None) -> float | None:
            step = after - before if before is not None and after is not None else None
            if step is not None and 0 <= step <= MAX_W_THREE_PHASE / 1000 * 24:
                return round(step, 2)
            return round(by_power, 2) if by_power is not None else None

        return {
            date: {
                "daily_pv": moved(b, a, pv),
                "daily_pv2": moved(b2, a2, pv2) if a2 is not None or (pv2 or 0) > 0 else None,
                "daily_charge": round(ch or 0.0, 2) if battery else None,
                "daily_discharge": round(dis or 0.0, 2) if battery else None,
            }
            for date, (b, a, b2, a2, pv, pv2, ch, dis, battery) in days.items()
        }

    def metered(self, start: int, end: int) -> dict[str, tuple[float | None, float | None]]:
        """
        Grid import and export (kWh) per local day, as the meter counted them.

        Not from the inverter's daily import/export counters: some units (an SH5.0RS here) leave
        those at 0 all day. Instead, how far the meter's lifetime counters moved in each 5-minute
        rollup, which also counts through gaps in the readings. Where a rollup has no usable
        counter reading (before they were recorded, a reset, a garbled jump), its average grid
        power stands in. Export counters only count from when total_pv_export was recorded too:
        before that, total_export held the hybrid's own panels' export, not the meter's.
        A day whose counter didn't move while grid power says it should have uses grid power.

        A day whose readings start part-way through (the day the inverter was connected, or after an
        outage overnight) has nothing to count the hours before from, while its solar and battery
        figures are the inverter's own daily counters, kept since midnight. Leaving those hours' grid
        out made everything exported before the first reading look like home use. So the first rollup
        of such a day takes the inverter's daily import/export counters as they stand, which counted
        from midnight (on a unit that leaves them at 0, nothing is added).
        """
        cols = "ts, total_import, total_export, total_pv_export, grid_power, daily_import, daily_export"
        with self.db.reading() as conn:
            prev = conn.execute(f"SELECT {cols} FROM samples_5m WHERE ts < ? ORDER BY ts DESC LIMIT 1", (start,))
            rows = [
                *prev.fetchall(),
                *conn.execute(f"SELECT {cols} FROM samples_5m WHERE ts >= ? AND ts < ? ORDER BY ts", (start, end)),
            ]

        # Per day and direction: [kWh from counters, grid kWh where counters were used, grid kWh
        # otherwise, rollups with anything to go on].
        days: dict[str, list[list[float]]] = {}
        for p, (ts, imp, exp, pv_exp, grid, day_imp, day_exp) in zip([None, *rows], rows, strict=False):
            if ts < start:
                continue
            lt = time.localtime(ts)
            date = time.strftime("%Y-%m-%d", lt)
            first = p is None or time.strftime("%Y-%m-%d", time.localtime(p[0])) != date
            d = days.setdefault(date, [[0.0] * 4, [0.0] * 4])
            g = grid or 0.0
            by_power = (max(g, 0.0) * KWH_PER_W_ROLLUP, max(-g, 0.0) * KWH_PER_W_ROLLUP)
            # the most any home connection could carry since (counters are checked whatever the phases)
            cap = MAX_W_THREE_PHASE / 1000 * (ts - p[0]) / 3600 if p else 0.0
            counters = (
                (p[1], imp) if p else (None, None),
                (p[2], exp) if p and p[3] is not None and pv_exp is not None else (None, None),
            )
            # The inverter's own count since midnight, for a day whose readings start late. Not in
            # the first SINCE_MIDNIGHT seconds, when a lagging inverter clock may not have reset it yet.
            since = lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec
            today = (
                (day_imp, day_exp if pv_exp is not None else None)
                if first and since >= SINCE_MIDNIGHT
                else (None, None)
            )
            most = MAX_W_THREE_PHASE / 1000 * since / 3600
            for i, (before, after) in enumerate(counters):
                step = after - before if before is not None and after is not None else None
                if step is not None and 0 <= step <= cap:
                    d[i][0] += step
                    d[i][1] += by_power[i]
                    d[i][3] += 1
                elif (counted := today[i]) is not None and 0 <= counted <= most:
                    d[i][2] += max(counted, by_power[i])  # a counter left at 0 still has this rollup's power
                    d[i][3] += 1
                elif grid is not None:
                    d[i][2] += by_power[i]
                    d[i][3] += 1

        def total(c: list[float]) -> float | None:
            from_counter, power_there, power_elsewhere, known = c
            if not known:
                return None
            if power_there > 1 and from_counter < power_there / 2:  # the counter isn't counting
                from_counter = power_there
            return round(from_counter + power_elsewhere, 2)

        return {date: (total(i), total(e)) for date, (i, e) in days.items()}

    def with_metered_today(self, snap: Snapshot) -> Snapshot:
        """A live snapshot with today's daily counters as `daily` counts them (grid import/export as `metered` counts
        them), so the live figures for today are the ones History and the Home page show for it."""
        ts = snap.get("ts")
        if ts is None:
            return snap
        lt = time.localtime(ts)
        midnight = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))
        date = time.strftime("%Y-%m-%d", lt)
        today = next((d for d in self.daily(midnight, ts + 1) if d["date"] == date), None)
        if today is None:  # just after midnight, before `daily` trusts the counters: the meter's grid figures only
            imp, exp = self.metered(midnight, ts + 1).get(date, (None, None))
            today = {"daily_import": imp, "daily_export": exp}
        return {**snap, **{c: v for c, v in today.items() if c != "date" and v is not None}}

    def rollups(self, start: int, end: int, columns: list[str], not_null: str | None = None) -> list[tuple[Any, ...]]:
        """(ts, *columns) for each 5-minute rollup in the range, oldest first."""
        cols = [c for c in columns if c in SAMPLE_COLUMNS]
        where = f" AND {not_null} IS NOT NULL" if not_null in SAMPLE_COLUMNS else ""
        sql = f"SELECT ts, {', '.join(cols)} FROM samples_5m WHERE ts >= ? AND ts < ?{where} ORDER BY ts"
        with self.db.reading() as conn:
            return conn.execute(sql, (start, end)).fetchall()

    def export_rows(self, start: int, end: int, rollup: bool) -> Iterator[list[Any] | tuple[Any, ...]]:
        """CSV rows (header first) of raw samples, or 5-minute rollups."""
        # Raw rows before the retention cutoff are gone, so fall back to rollups there.
        table = "samples_5m" if rollup or start < self.raw_cutoff() else "samples"
        conn = self.db.connect(readonly=True)
        try:
            yield ["ts", "time", *COLS]
            yield from conn.execute(
                f"SELECT ts, datetime(ts, 'unixepoch', 'localtime'), {', '.join(COLS)} FROM {table} "
                f"WHERE ts >= ? AND ts < ? ORDER BY ts",
                (start, end),
            )
        finally:
            conn.close()

    def stats(self) -> dict[str, Any]:
        with self.db.reading() as conn:
            raw = conn.execute("SELECT COUNT(*), MIN(ts), MAX(ts) FROM samples").fetchone()
            r5 = conn.execute("SELECT COUNT(*), MIN(ts) FROM samples_5m").fetchone()
        return {
            "raw_rows": raw[0],
            "first_ts": raw[1],
            "last_ts": raw[2],
            "rollup_rows": r5[0],
            # Raw rows are pruned after RAW_RETENTION_DAYS; rollups are kept, so history starts here.
            "history_from": r5[1],
            "db_bytes": self.db.size_bytes(),
        }
