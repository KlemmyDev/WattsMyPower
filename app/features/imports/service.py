"""
Importing history from iSolarCloud exports: a preview of what a file holds, writing it into the
5-minute rollups, and listing or removing what was imported.

Imported rows normally only fill time the dashboard didn't record itself: buckets with real readings
are left alone, and a rollup rebuilt from real samples later replaces an imported one. Each imported
row carries its import's id, so an import can be removed without touching recorded history.
Importing a day again replaces what an earlier import wrote for it.

An import can instead replace what the dashboard recorded (`replace`), for days whose readings are
incomplete or wrong. The file's readings win for every 5-minute bucket it has, before today (today
is still being recorded). The recorded rollups it replaces are kept in import_replaced and put back
when the import is removed, and rollups rebuilt from raw samples leave its buckets alone
(ROLLUP_KEEPING_SQL).
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from app.core.database import Database
from app.core.schema import ROLLUP
from app.features.imports.isolarcloud import FIELDS, Curve, parse
from app.features.readings.repository import KWH_PER_W_ROLLUP

# What an imported bucket holds (isolarcloud._buckets), in samples_5m's columns.
COLUMNS = [
    "pv_power", "load_power", "grid_power", "battery_power", "battery_soc",
    "daily_pv", "daily_import", "daily_export", "daily_charge", "daily_discharge",
]  # fmt: skip
_WRITE = (
    f"INSERT OR REPLACE INTO samples_5m (ts, {', '.join(COLUMNS)}, import_id) VALUES (?{', ?' * (len(COLUMNS) + 1)})"
)


def _date(ts: int) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def _today_start(now: float) -> int:
    lt = time.localtime(now)
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))


def _chunks(values: list[int], n: int = 500) -> list[list[int]]:
    return [values[i : i + n] for i in range(0, len(values), n)]


class ImportService:
    def __init__(self, db: Database, clock: Callable[[], float] = time.time):
        self.db = db
        self.clock = clock

    def _recorded(self, start: int, end: int) -> tuple[set[int], set[int]]:
        """(buckets with real readings, buckets imported before) between start and end inclusive."""
        with self.db.reading() as conn:
            rows = conn.execute("SELECT ts, import_id FROM samples_5m WHERE ts >= ? AND ts <= ?", (start, end))
            live: set[int] = set()
            imported: set[int] = set()
            for ts, import_id in rows:
                (live if import_id is None else imported).add(ts)
            raw = conn.execute(
                f"SELECT DISTINCT ts / {ROLLUP} * {ROLLUP} FROM samples WHERE ts >= ? AND ts < ?", (start, end + ROLLUP)
            )
            live.update(b for (b,) in raw)
        return live, imported - live

    def preview(self, name: str, data: bytes, overrides: Mapping[str, Sequence[str]] | None = None) -> dict[str, Any]:
        """What a file holds and what importing it would do, day by day. Writes nothing."""
        curve = parse(name, data, overrides)
        return self._summary(curve)

    def _summary(self, curve: Curve) -> dict[str, Any]:
        buckets = curve.buckets
        first, last = min(buckets), max(buckets)
        live, imported = self._recorded(first, last)
        today = _today_start(self.clock())
        days: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"buckets": 0, "new": 0, "replaces": 0, "recorded": 0, "load_kwh": 0.0, "locked": False}
        )
        for b, row in buckets.items():
            d = days[_date(b)]
            d["buckets"] += 1
            d["locked"] = d["locked"] or b >= today  # still being recorded: never replaced
            if b in live:
                d["recorded"] += 1
            elif b in imported:
                d["replaces"] += 1
            else:
                d["new"] += 1
            if row.get("load_power") is not None:
                d["load_kwh"] += max(row["load_power"] or 0, 0) * KWH_PER_W_ROLLUP
            for c in ("daily_pv", "daily_import", "daily_export"):
                if row.get(c) is not None:
                    d[c] = row[c]  # counters only rise through the day, so the last is the total
        out_days = [
            {
                "date": date,
                "buckets": d["buckets"],
                "new": d["new"],
                "replaces": d["replaces"],
                "recorded": d["recorded"],
                "locked": d["locked"],
                "pv_kwh": round(d.get("daily_pv", 0), 1) if "daily_pv" in d else None,
                "load_kwh": round(d["load_kwh"], 1) if d["load_kwh"] else None,
                "import_kwh": round(d.get("daily_import", 0), 1) if "daily_import" in d else None,
                "export_kwh": round(d.get("daily_export", 0), 1) if "daily_export" in d else None,
            }
            for date, d in sorted(days.items())
        ]
        return {
            "name": curve.name,
            "columns": [c.to_json() for c in curve.columns],
            "mapping": curve.mapping,
            "fields": FIELDS,
            "interval": curve.interval,
            "first_ts": first,
            "last_ts": last + ROLLUP,
            "days": out_days,
            "buckets": len(buckets),
            "new": sum(d["new"] for d in out_days),
            "replaces": sum(d["replaces"] for d in out_days),
            "recorded": sum(d["recorded"] for d in out_days),
            "warnings": curve.warnings,
        }

    def run(
        self,
        name: str,
        data: bytes,
        overrides: Mapping[str, Sequence[str]] | None = None,
        into: int | None = None,
        label: str | None = None,
        replace: bool = False,
    ) -> dict[str, Any]:
        """
        Import a file, as a new import or (`into`) as one more file of an earlier one. With `replace`, its
        readings also replace what the dashboard recorded, before today. Returns its summary and the import's id.
        """
        curve = parse(name, data, overrides)
        summary = self._summary(curve)
        live, _ = self._recorded(min(curve.buckets), max(curve.buckets))
        today = _today_start(self.clock())
        replacing = sorted(b for b in curve.buckets if b in live and b < today) if replace else []
        keep = live - set(replacing)
        rows = [(b, *(row.get(c) for c in COLUMNS)) for b, row in sorted(curve.buckets.items()) if b not in keep]
        if not rows and into is None:
            return {**summary, "import_id": None, "written": 0, "replaced": 0}  # nothing to add
        with self.db.writing() as conn:
            if into is not None and conn.execute("SELECT 1 FROM imports WHERE id = ?", (into,)).fetchone():
                import_id = into
                conn.execute("UPDATE imports SET files = files + 1 WHERE id = ?", (into,))
            else:
                cur = conn.execute(
                    "INSERT INTO imports (label, files, created_at) VALUES (?, 1, ?)",
                    ((label or name).strip()[:200] or name, int(self.clock())),
                )
                import_id = int(cur.lastrowid or 0)
            if replacing:
                self._back_up(conn, replacing, import_id)
                conn.execute("UPDATE imports SET replaces = 1 WHERE id = ?", (import_id,))
            # Recorded rollups an earlier import replaced, and this one now replaces again: this import puts them back.
            conn.executemany(
                "UPDATE import_replaced SET import_id = ? WHERE ts = ? AND import_id != ?",
                [(import_id, r[0], import_id) for r in rows],
            )
            conn.executemany(_WRITE, [(*r, import_id) for r in rows])
            # Imports whose every row was replaced by this one are gone.
            conn.execute(
                "DELETE FROM imports WHERE id != ? AND NOT EXISTS (SELECT 1 FROM samples_5m WHERE import_id = imports.id)",
                (import_id,),
            )
        return {**summary, "import_id": import_id, "written": len(rows), "replaced": len(replacing)}

    def _back_up(self, conn: Any, buckets: list[int], import_id: int) -> None:
        """Keep the recorded rollups about to be replaced, to put back if the import is removed."""
        for chunk in _chunks(buckets):
            cur = conn.execute(
                f"SELECT * FROM samples_5m WHERE import_id IS NULL AND ts IN ({','.join('?' * len(chunk))})", chunk
            )
            names = [d[0] for d in cur.description]
            conn.executemany(
                "INSERT OR REPLACE INTO import_replaced (ts, import_id, data) VALUES (?, ?, ?)",
                [
                    (row[0], import_id, json.dumps({k: v for k, v in zip(names, row, strict=True) if v is not None}))
                    for row in cur.fetchall()
                ],
            )

    def list(self) -> list[dict[str, Any]]:
        sql = (
            "SELECT i.id, i.label, i.files, i.created_at, COUNT(s.ts), MIN(s.ts), MAX(s.ts),"
            " COUNT(DISTINCT date(s.ts, 'unixepoch', 'localtime')), i.replaces,"
            " (SELECT COUNT(DISTINCT date(r.ts, 'unixepoch', 'localtime')) FROM import_replaced r WHERE r.import_id = i.id)"
            " FROM imports i LEFT JOIN samples_5m s ON s.import_id = i.id GROUP BY i.id ORDER BY i.created_at DESC, i.id DESC"
        )
        with self.db.reading() as conn:
            rows = conn.execute(sql).fetchall()
        return [
            {
                "id": i,
                "label": label,
                "files": files,
                "created_at": created,
                "buckets": n,
                "first_ts": lo,
                "last_ts": hi + ROLLUP if hi is not None else None,
                "days": days,
                # Days whose recorded readings it replaced, and puts back if removed.
                "replaced_days": replaced if replaces else 0,
            }
            for i, label, files, created, n, lo, hi, days, replaces, replaced in rows
        ]

    def remove(self, import_id: int) -> int:
        """Delete an import's rows, putting back any recorded rollups it replaced. Returns how many went."""
        with self.db.writing() as conn:
            n = conn.execute("DELETE FROM samples_5m WHERE import_id = ?", (import_id,)).rowcount
            have = {r[1] for r in conn.execute("PRAGMA table_info(samples_5m)")}
            backups = conn.execute("SELECT data FROM import_replaced WHERE import_id = ?", (import_id,)).fetchall()
            for (data,) in backups:
                row = {k: v for k, v in json.loads(data).items() if k in have and k != "import_id"}
                conn.execute(
                    f"INSERT OR REPLACE INTO samples_5m ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                    list(row.values()),
                )
            conn.execute("DELETE FROM import_replaced WHERE import_id = ?", (import_id,))
            conn.execute("DELETE FROM imports WHERE id = ?", (import_id,))
        return n
