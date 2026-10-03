"""
Smart-meter data: importing NEM12 files, each local day's import and export as the meter counted
them, and how that compares with the dashboard's own figures.

The meter at the grid connection is what the retailer bills from, so where it covers a whole day
its figures are used for bills and costs instead of the inverter's (app.features.tariffs.costs).
The inverter's meter can disagree with it: a second inverter wired outside the inverter's meter,
a CT clamp on the wrong wire, or gaps in the readings. Comparing the two day by day shows which.

Only each NMI's general channels (E1 and B1, usually) count as grid import and export. Others,
such as E2 controlled load, are stored and listed with `included: false`, but left out of the
daily figures, and so out of bills, costs and the comparison (see nem12.general_channels).
"""

from __future__ import annotations

import datetime as dt
import os
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.database import Database
from app.features.meter.nem12 import Nem12File, day_start, general_channels, parse
from app.features.meter.repository import MeterRepository
from app.features.readings.repository import ReadingsRepository

NOTABLE_KWH = 0.5  # a day's difference worth pointing out: at least this much…
NOTABLE_SHARE = 0.1  # …and at least this share of what the meter counted
EPOCH = dt.date(1970, 1, 1).toordinal()


@dataclass
class MeterDay:
    """One local day of meter readings."""

    date: str
    import_kwh: float = 0.0
    export_kwh: float = 0.0
    # Every channel's readings cover the whole day (so it can stand in for the inverter's figures).
    complete: bool = False
    estimated: int = 0  # readings that are estimated or substituted rather than actual
    # The import readings as (interval start, minutes, kWh), for pricing by time of use.
    imports: list[tuple[int, int, float]] = field(default_factory=list)


def _midnight(date: dt.date) -> int:
    """Unix seconds at local midnight starting `date` (the dashboard's time zone, which may observe daylight saving)."""
    return int(time.mktime((date.year, date.month, date.day, 0, 0, 0, 0, 0, -1)))


def _summary(parsed: Nem12File, general: set[tuple[str, str]]) -> dict[str, Any]:
    """What a file holds, per channel and in total. The totals only count the `general` channels."""
    channels: list[dict[str, Any]] = [
        {
            "nmi": ch.nmi,
            "suffix": ch.suffix,
            "direction": ch.direction,
            # Counted as grid import or export (E1, B1…), rather than stored only (E2 controlled load…).
            "included": (ch.nmi, ch.suffix) in general,
            "unit": ch.unit,
            "minutes": ch.minutes,
            "days": len(ch.days),
            "readings": len(ch.readings),
            "kwh": round(ch.kwh, 2),
            "estimated": sum(1 for r in ch.readings.values() if not r.quality.startswith("A")),
            "missing": ch.missing,
        }
        for ch in parsed.channels
    ]
    days: set[dt.date] = set().union(*(ch.days for ch in parsed.channels))
    return {
        "nmis": sorted({ch.nmi for ch in parsed.channels}),
        "channels": channels,
        "first": min(days).isoformat(),
        "last": max(days).isoformat(),
        "days": len(days),
        "import_kwh": round(sum(c["kwh"] for c in channels if c["included"] and c["direction"] == "import"), 2),
        "export_kwh": round(sum(c["kwh"] for c in channels if c["included"] and c["direction"] == "export"), 2),
        "estimated": sum(c["estimated"] for c in channels),
        "missing": sum(c["missing"] for c in channels),
        "notes": parsed.notes,
    }


def clean_filename(name: str | None) -> str:
    """The uploaded file's name without any folders, for the list of imports."""
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    return base[:120] or "Meter data"


class MeterService:
    def __init__(self, db: Database, readings: ReadingsRepository):
        self.repo = MeterRepository(db)
        self.readings = readings

    # ------------------------------------------------------------------ imports
    def preview(self, data: bytes, filename: str | None) -> dict[str, Any]:
        """What importing a file would add, without storing it. Raises Nem12Error if it can't be read."""
        parsed = parse(data)
        replaces: set[int] = set()
        for ch in parsed.channels:
            filled = ch.filled_days
            days = {d.toordinal() - EPOCH for d in filled}
            stored = self.repo.stored_days(ch.nmi, ch.suffix, day_start(min(filled)), day_start(max(filled)) + 86400)
            replaces |= days & stored
        general = general_channels(self.repo.channels() | {(c.nmi, c.direction, c.suffix) for c in parsed.channels})
        return {"filename": clean_filename(filename), **_summary(parsed, general), "replaces_days": len(replaces)}

    def import_file(self, data: bytes, filename: str | None, now: int) -> dict[str, Any]:
        """Store a file's readings, replacing any already imported for the same days. Raises Nem12Error."""
        parsed = parse(data)
        name = clean_filename(filename)
        import_id = self.repo.store(name, parsed, now)
        return {"id": import_id, "filename": name, **_summary(parsed, general_channels(self.repo.channels()))}

    def imports(self) -> list[dict[str, Any]]:
        """Each import still holding readings, newest first: what it covers, and each of its channels."""
        general = general_channels(self.repo.channels())
        out: dict[int, dict[str, Any]] = {}
        for i, filename, at, nmi, suffix, direction, n, first, last, kwh, estimated in self.repo.import_channels():
            item = out.setdefault(
                i,
                {
                    "id": i,
                    "filename": filename,
                    "imported_at": at,
                    "nmis": [],
                    "intervals": 0,
                    "start": first,
                    "end": last,
                    "import_kwh": 0.0,
                    "export_kwh": 0.0,
                    "estimated": 0,
                    "channels": [],
                },
            )
            included = (nmi, suffix) in general
            if nmi not in item["nmis"]:
                item["nmis"].append(nmi)
            item["intervals"] += n
            item["start"], item["end"] = min(item["start"], first), max(item["end"], last)
            item["estimated"] += estimated
            if included:
                item[f"{direction}_kwh"] += kwh
            item["channels"].append(
                {"nmi": nmi, "suffix": suffix, "direction": direction, "kwh": round(kwh, 2), "included": included}
            )
        for item in out.values():
            item["import_kwh"], item["export_kwh"] = round(item["import_kwh"], 2), round(item["export_kwh"], 2)
        return list(out.values())

    def remove(self, import_id: int) -> bool:
        return self.repo.remove(import_id)

    # ------------------------------------------------------------------ per day
    def days(self, start: int, end: int) -> dict[str, MeterDay]:
        """Each local day with grid import or export readings in [start, end), keyed on YYYY-MM-DD.
        Only the general channels count (not controlled load and the like)."""
        rows = self.repo.intervals(start, end)
        if not rows:
            return {}
        stored = self.repo.channels()
        general = general_channels(stored)
        has_export = any(direction == "export" for _, direction, _ in stored)
        out: dict[str, MeterDay] = {}
        # Seconds of readings per day, direction and channel: a day is complete when each channel covers it.
        cover: dict[str, dict[tuple[str, str, str], int]] = {}
        lengths: dict[str, int] = {}
        day: MeterDay | None = None
        lo = hi = 0
        for ts, minutes, direction, kwh, quality, nmi, suffix in rows:
            if (nmi, suffix) not in general:
                continue
            if not lo <= ts < hi:  # rows are in time order: only look up the local day when it changes
                date = dt.date.fromtimestamp(ts)
                lo, hi = _midnight(date), _midnight(date + dt.timedelta(1))
                key = date.isoformat()
                day = out.setdefault(key, MeterDay(key))
                lengths[key] = hi - lo
            assert day is not None
            if direction == "import":
                day.import_kwh += kwh
                day.imports.append((ts, minutes, kwh))
            else:
                day.export_kwh += kwh
            if not quality.startswith("A"):
                day.estimated += 1
            chans = cover.setdefault(day.date, {})
            chans[(direction, nmi, suffix)] = chans.get((direction, nmi, suffix), 0) + minutes * 60
        for key, d in out.items():
            full = {k: s >= lengths[key] for k, s in cover[key].items()}
            imp = [ok for (direction, _, _), ok in full.items() if direction == "import"]
            exp = [ok for (direction, _, _), ok in full.items() if direction == "export"]
            d.complete = bool(imp) and all(imp) and (all(exp) if exp else not has_export)
            d.import_kwh, d.export_kwh = round(d.import_kwh, 3), round(d.export_kwh, 3)
        return out

    def reconcile(self, start: int | None, end: int | None) -> dict[str, Any]:
        """
        Each day's import and export as the meter and the dashboard counted them, and the difference
        (dashboard minus meter). Totals cover only days the meter covers in full and the dashboard
        has figures for. Defaults to everything the meter data covers.
        """
        extent = self.repo.extent()
        if extent is None:
            return {"summary": None, "days": []}
        start = start if start is not None else _midnight(dt.date.fromtimestamp(extent[0]))
        end = end if end is not None else extent[1]
        meter = self.days(start, end)
        dash = {d["date"]: d for d in self.readings.daily(start, end)}

        def diff(ours: float | None, theirs: float) -> float | None:
            return round(ours - theirs, 2) if ours is not None else None

        def notable(delta: float | None, base: float) -> bool:
            return delta is not None and abs(delta) >= max(NOTABLE_KWH, NOTABLE_SHARE * base)

        days: list[dict[str, Any]] = []
        compared: list[dict[str, Any]] = []
        for key in sorted(meter):
            m, r = meter[key], dash.get(key) or {}
            di, de = r.get("daily_import"), r.get("daily_export")
            row: dict[str, Any] = {
                "date": key,
                "complete": m.complete,
                "estimated": m.estimated,
                "meter_import": round(m.import_kwh, 2),
                "meter_export": round(m.export_kwh, 2),
                "dashboard_import": di,
                "dashboard_export": de,
                "import_diff": diff(di, m.import_kwh),
                "export_diff": diff(de, m.export_kwh),
            }
            row["notable"] = m.complete and (
                notable(row["import_diff"], m.import_kwh) or notable(row["export_diff"], m.export_kwh)
            )
            days.append(row)
            if m.complete and di is not None and de is not None:
                compared.append(row)

        def total(k: str) -> float:
            return round(sum(r[k] for r in compared), 2)

        summary = {
            "first": days[0]["date"] if days else None,
            "last": days[-1]["date"] if days else None,
            "meter_days": len(days),
            "complete_days": sum(1 for r in days if r["complete"]),
            "compared_days": len(compared),
            "notable_days": sum(1 for r in days if r["notable"]),
            **{k: total(k) for k in ("meter_import", "dashboard_import", "meter_export", "dashboard_export")},
        }
        return {"summary": summary, "days": days}
