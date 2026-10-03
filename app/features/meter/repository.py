"""Imported smart-meter readings: storing a NEM12 file's intervals, listing and removing imports."""

from __future__ import annotations

from typing import Any

from app.core.database import Database
from app.features.meter.nem12 import Nem12File, day_start

# (ts, minutes, direction, kwh, quality, nmi, suffix)
Interval = tuple[int, int, str, float, str, str, str]


class MeterRepository:
    def __init__(self, db: Database):
        self.db = db

    def store(self, filename: str, parsed: Nem12File, now: int) -> int:
        """Save a file's readings as a new import, replacing what earlier imports had for the same
        channel and days (a newer file is the meter's corrected data). Returns the import's id."""
        with self.db.writing() as conn:
            cur = conn.execute("INSERT INTO meter_imports (filename, imported_at) VALUES (?, ?)", (filename, now))
            import_id = cur.lastrowid
            assert import_id is not None
            for ch in parsed.channels:
                conn.executemany(
                    "DELETE FROM meter_intervals WHERE nmi = ? AND suffix = ? AND ts >= ? AND ts < ?",
                    [(ch.nmi, ch.suffix, day_start(d), day_start(d) + 86400) for d in ch.filled_days],
                )
                conn.executemany(
                    "INSERT OR REPLACE INTO meter_intervals (nmi, suffix, ts, minutes, direction, kwh, quality, import_id)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        (ch.nmi, ch.suffix, r.ts, ch.minutes, ch.direction, r.kwh, r.quality, import_id)
                        for r in ch.readings.values()
                    ],
                )
            # Earlier imports whose readings have all been replaced have nothing left to show.
            conn.execute("DELETE FROM meter_imports WHERE id NOT IN (SELECT DISTINCT import_id FROM meter_intervals)")
        return import_id

    def stored_days(self, nmi: str, suffix: str, first: int, last: int) -> set[int]:
        """Which NEM days (as day numbers since 1970) a channel already has readings for, between two times."""
        sql = (
            "SELECT DISTINCT (ts + 36000) / 86400 FROM meter_intervals"
            " WHERE nmi = ? AND suffix = ? AND ts >= ? AND ts < ?"
        )
        with self.db.reading() as conn:
            return {d for (d,) in conn.execute(sql, (nmi, suffix, first, last))}

    def imports(self) -> list[dict[str, Any]]:
        """Each import still holding readings, newest first, with what it covers."""
        sql = (
            "SELECT i.id, i.filename, i.imported_at, GROUP_CONCAT(DISTINCT m.nmi), COUNT(*), MIN(m.ts),"
            " MAX(m.ts + m.minutes * 60), SUM(CASE WHEN m.direction = 'import' THEN m.kwh ELSE 0 END),"
            " SUM(CASE WHEN m.direction = 'export' THEN m.kwh ELSE 0 END), SUM(m.quality NOT LIKE 'A%')"
            " FROM meter_imports i JOIN meter_intervals m ON m.import_id = i.id"
            " GROUP BY i.id ORDER BY i.imported_at DESC, i.id DESC"
        )
        with self.db.reading() as conn:
            rows = conn.execute(sql).fetchall()
        return [
            {
                "id": r[0],
                "filename": r[1],
                "imported_at": r[2],
                "nmis": sorted((r[3] or "").split(",")),
                "intervals": r[4],
                "start": r[5],
                "end": r[6],
                "import_kwh": round(r[7], 2),
                "export_kwh": round(r[8], 2),
                "estimated": r[9],
            }
            for r in rows
        ]

    def remove(self, import_id: int) -> bool:
        """Delete an import and its readings. False if there was no such import."""
        with self.db.writing() as conn:
            conn.execute("DELETE FROM meter_intervals WHERE import_id = ?", (import_id,))
            return conn.execute("DELETE FROM meter_imports WHERE id = ?", (import_id,)).rowcount > 0

    def intervals(self, start: int, end: int) -> list[Interval]:
        """Every reading whose interval starts in [start, end), oldest first."""
        sql = (
            "SELECT ts, minutes, direction, kwh, quality, nmi, suffix FROM meter_intervals"
            " WHERE ts >= ? AND ts < ? ORDER BY ts"
        )
        with self.db.reading() as conn:
            return conn.execute(sql, (start, end)).fetchall()

    def extent(self) -> tuple[int, int] | None:
        """When the earliest reading starts and the latest ends, or None with no meter data."""
        with self.db.reading() as conn:
            first, last = conn.execute("SELECT MIN(ts), MAX(ts + minutes * 60) FROM meter_intervals").fetchone()
        return (first, last) if first is not None else None

    def has_export(self) -> bool:
        """Whether any meter imported so far has an export channel (a home without solar may not)."""
        with self.db.reading() as conn:
            return (
                conn.execute("SELECT 1 FROM meter_intervals WHERE direction = 'export' LIMIT 1").fetchone() is not None
            )
