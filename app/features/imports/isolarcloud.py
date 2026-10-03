"""
Turning an iSolarCloud export into 5-minute rollups.

iSolarCloud exports a plant's power curve at 5-minute steps from a few places (the plant's day
chart, the portal's Curve page and its parameter report), and each names its columns a little
differently: "PV(W)", "Purchased Energy(W)", "Feed-in(W)", "Battery Charge(W)", "Load(W)", or a
device's points such as "SH5.0RS_001(123456)/Total DC Power(kW)". So columns are matched by
what they're called rather than by position, and the match can be overridden by hand.

What comes out is one row per 5-minute bucket in the shape of samples_5m: the four powers in
the usual signs (app.features.inverters.types), battery level, and daily counters integrated
from the powers so daily totals, bills and insights count imported days too.
"""

from __future__ import annotations

import re
import statistics
import time
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from app.core.schema import ROLLUP
from app.features.imports.files import Cell, Table, UnreadableFile, read_tables
from app.features.inverters.limits import clean
from app.features.readings.repository import KWH_PER_W_ROLLUP

# What a column can be used for, and how it's labelled on the import page.
FIELDS: dict[str, str] = {
    "pv": "Solar",
    "load": "Home use",
    "import": "Grid import",
    "export": "Grid export",
    "charge": "Battery charging",
    "discharge": "Battery discharging",
    "soc": "Battery level",
}

# The first rule a column's name matches says what it is. Order matters: "discharge" before
# "charge", and the battery level before anything that mentions the battery.
_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("soc", re.compile(r"\bsoc\b|state of charge|battery level|battery percent")),
    ("discharge", re.compile(r"discharg")),
    ("charge", re.compile(r"charg")),
    ("export", re.compile(r"feed[\s-]*in|export|to grid")),
    ("import", re.compile(r"purchas|import|from grid")),
    ("load", re.compile(r"\bload\b|consum|home use|household")),
    ("pv", re.compile(r"\bpv\b|solar|dc power|production|plant power")),
]
_TIME_HEADER = re.compile(r"^(time|date|date ?time|timestamp|时间|日期)$")
_UNIT = re.compile(r"[(（\[]\s*([^)）\]]*?)\s*[)）\]]\s*$")
_POWER_UNITS = {"w": 1.0, "kw": 1000.0, "mw": 1e6}
_ENERGY_UNITS = {"wh", "kwh", "mwh"}

MAX_INTERVAL = 3600  # coarser than hourly is a daily or monthly report, not a curve


class NotACurve(ValueError):
    """The file doesn't hold readings this can import; the message says why."""


@dataclass
class Column:
    header: str
    device: str | None  # the part before "/" in a device point's name
    point: str  # the name, lower case, without device or unit
    unit: str | None  # lower case, e.g. "kw"
    field: str | None  # what it was matched to, if anything

    def to_json(self) -> dict[str, Any]:
        return {"header": self.header, "field": self.field, "unit": self.unit}


@dataclass
class Curve:
    """A parsed export: its columns, what each was used for, and its 5-minute buckets."""

    name: str
    columns: list[Column]
    mapping: dict[str, list[str]]  # field -> the headers summed for it
    interval: int  # seconds between readings
    buckets: dict[int, dict[str, float | None]]  # bucket ts -> sample columns
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------------------- columns


def describe(header: Cell) -> Column:
    h = re.sub(r"\s+", " ", str(header or "")).strip()
    unit = None
    if m := _UNIT.search(h):
        unit = m.group(1).strip().lower().replace(" ", "") or None
        h = h[: m.start()].strip()
    device, _, point = h.rpartition("/")
    point = point.strip().lower()
    match = None
    if not (unit in _ENERGY_UNITS and not point.startswith("soc")):
        match = next((f for f, rule in _RULES if rule.search(point)), None)
    if match == "soc" and unit in _POWER_UNITS:
        match = None
    return Column(str(header or "").strip(), device.strip() or None, point, unit, match)


def _auto_mapping(columns: Sequence[Column]) -> dict[str, list[str]]:
    """
    Each field's column: the first that matches it. The same point from several devices (both
    inverters' "Total DC Power" in a Curve export) is summed, as the plant's figure.
    """
    out: dict[str, list[str]] = {}
    for c in columns:
        if c.field is None:
            continue
        first = next((x for x in columns if x.header == out[c.field][0]), None) if c.field in out else None
        if first is None:
            out[c.field] = [c.header]
        elif c.device and first.device and c.device != first.device and c.point == first.point:
            out[c.field].append(c.header)
    return out


def _header_row(table: Table) -> int | None:
    """The row naming the columns: the first with a time column and something to import, or two things."""
    for i, row in enumerate(table[:40]):
        cols = [describe(c) for c in row if isinstance(c, str)]
        found = {c.field for c in cols if c.field}
        timed = any(_TIME_HEADER.match(c.point) for c in cols)
        if len(found) >= 2 or (timed and found):
            return i
    return None


# ---------------------------------------------------------------------------------------- times

_YMD = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]m)?)?", re.I)  # fmt: skip
_DMY = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]m)?)?", re.I)  # fmt: skip
_HM = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?$", re.I)
_DATE_HINTS = [
    (re.compile(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})"), (0, 1, 2)),
    (re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)"), (0, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})"), (2, 1, 0)),
]
_EXCEL_EPOCH = datetime(1899, 12, 30)


def _hour(h: str, ampm: str | None) -> int:
    n = int(h)
    if ampm:
        n = n % 12 + (12 if ampm.lower() == "pm" else 0)
    return n


def _at(y: int, mo: int, d: int, h: int = 0, mi: int = 0, s: int = 0) -> datetime | None:
    try:
        return datetime(y, mo, d) + timedelta(hours=h, minutes=mi, seconds=s)  # 24:00 is the next midnight
    except ValueError:
        return None


def _date_hint(texts: Sequence[str]) -> datetime | None:
    """A date mentioned in the file's title rows or its name, for exports whose rows only give the time."""
    for text in texts:
        for rule, (yi, mi, di) in _DATE_HINTS:
            if m := rule.search(text):
                g = m.groups()
                if when := _at(int(g[yi]), int(g[mi]), int(g[di])):
                    return when
    return None


def _day_first(cells: Sequence[Cell]) -> bool:
    """Whether dd/mm/yyyy (as iSolarCloud writes it in Australia) rather than mm/dd/yyyy."""
    for c in cells:
        if isinstance(c, str) and (m := _DMY.match(c)):
            if int(m.group(1)) > 12:
                return True
            if int(m.group(2)) > 12:
                return False
    return True


def _when(cell: Cell, day_first: bool, day: datetime | None) -> tuple[datetime | None, bool]:
    """(local time, whether the cell gave only a time of day)."""
    if isinstance(cell, float):
        if 1 <= cell < 2958466:  # an Excel date
            return _EXCEL_EPOCH + timedelta(days=cell), False
        if 0 <= cell < 1 and day:  # an Excel time of day
            return day + timedelta(seconds=round(cell * 86400)), True
        return None, False
    if not cell:
        return None, False
    s = cell.strip()
    if m := _YMD.match(s):
        y, mo, d, h, mi, sec, ap = m.groups()
        return _at(int(y), int(mo), int(d), _hour(h or "0", ap), int(mi or 0), int(sec or 0)), False
    if m := _DMY.match(s):
        a, b, y, h, mi, sec, ap = m.groups()
        d, mo = (a, b) if day_first else (b, a)
        return _at(int(y), int(mo), int(d), _hour(h or "0", ap), int(mi or 0), int(sec or 0)), False
    if (m := _HM.match(s)) and day:
        h, mi, sec, ap = m.groups()
        return day + timedelta(hours=_hour(h, ap), minutes=int(mi), seconds=int(sec or 0)), True
    return None, False


def _unix(when: datetime) -> int:
    """Local wall-clock time to unix seconds, in the dashboard's time zone (as the plant's clock reads)."""
    return int(time.mktime((*when.timetuple()[:8], -1)))


# ---------------------------------------------------------------------------------------- values


def _number(cell: Cell) -> float | None:
    if isinstance(cell, float):
        return cell
    if not cell:
        return None
    s = cell.strip().replace(",", "").replace(" ", "")
    try:
        return float(s)
    except ValueError:
        return None  # "--" and the like: not read


def _scale(c: Column, values: Sequence[float | None]) -> float:
    """What to multiply a column by for W (or % for battery level)."""
    present = [abs(v) for v in values if v is not None]
    top = max(present, default=0.0)
    if c.field == "soc":
        return 100.0 if 0 < top <= 1.0 else 1.0
    if c.unit in _POWER_UNITS:
        return _POWER_UNITS[c.unit]
    # No unit given: a home system's power curve reaching no higher than 50 is in kW.
    return 1000.0 if 0 < top <= 50 else 1.0


def _net(
    pos: list[float | None] | None, neg: list[float | None] | None, n: int, names: tuple[str, str], warnings: list[str]
) -> list[float | None]:
    """
    A signed series from a pair of one-way columns (import and export, discharge and charge).
    A lone column with negative values is taken as already signed; a lone one-way column
    can't say what the other way did, so the series is left unknown.
    """
    if pos is not None and neg is not None:
        return [
            None if a is None and b is None else max(a or 0, 0) - max(b or 0, 0) for a, b in zip(pos, neg, strict=True)
        ]
    lone = pos if pos is not None else neg
    if lone is None:
        return [None] * n
    if any(v is not None and v < 0 for v in lone):
        return list(lone) if pos is not None else [None if v is None else -v for v in lone]
    have, missing = names if pos is not None else names[::-1]
    warnings.append(
        f"There's a {have} column but no {missing} column, so that was worked out from the others where it could be."
    )
    return [None] * n


# ---------------------------------------------------------------------------------------- parsing


def parse(name: str, data: bytes, overrides: Mapping[str, Sequence[str]] | None = None) -> Curve:
    """Read an iSolarCloud export into 5-minute buckets. `overrides` sets a field's columns by header ([] = none)."""
    try:
        tables = read_tables(name, data)
    except UnreadableFile:
        raise
    except Exception as e:  # a damaged file shouldn't surface as a server error
        raise UnreadableFile(f"{name} couldn't be read as a spreadsheet ({type(e).__name__}).") from e
    for table in tables:
        if (at := _header_row(table)) is not None:
            return _curve(name, table, at, overrides or {})
    raise NotACurve(
        f"{name} doesn't have columns for solar, home use, the grid or the battery. Export the plant's "
        "5-minute power curve (PV, load, feed-in, purchased and battery power) from iSolarCloud."
    )


def _curve(name: str, table: Table, at: int, overrides: Mapping[str, Sequence[str]]) -> Curve:
    header = table[at]
    columns = [describe(c) for c in header]
    by_header = {c.header: i for i, c in enumerate(columns) if c.header}
    mapping = _auto_mapping(columns)
    for f, headers in overrides.items():
        if f in FIELDS:
            mapping[f] = [h for h in headers if h in by_header]
    mapping = {f: hs for f, hs in mapping.items() if hs}
    if not mapping:
        raise NotACurve(f"{name}: none of its columns are set to be imported.")

    t_col = next((i for i, c in enumerate(columns) if _TIME_HEADER.match(c.point)), 0)
    rows = [r for r in table[at + 1 :] if len(r) > t_col]
    hints = [str(c) for r in table[:at] for c in r if isinstance(c, str)] + [name]
    day_first = _day_first([r[t_col] for r in rows])
    day = _date_hint(hints)

    # Times first: a file giving only the time of day steps past midnight when the time goes backwards.
    times: list[int] = []
    kept: list[list[Cell]] = []
    time_only = False
    prev: datetime | None = None
    for r in rows:
        when, only_time = _when(r[t_col], day_first, day)
        if when is None:
            continue
        if only_time:
            time_only = True
            if prev is not None and when < prev:
                when += timedelta(days=1)
                day = (day or when) + timedelta(days=1)
        prev = when
        times.append(_unix(when))
        kept.append(r)
    if not times:
        if any(isinstance(c, str) and _HM.match(c.strip()) for c in (r[t_col] for r in rows)):
            raise NotACurve(
                f"{name} gives times but not which day they're on. Keep the date in the file name "
                "(for example 2025-04-21.csv) and upload it again."
            )
        raise NotACurve(f"{name} has no rows with a date and time to import.")

    steps = [b - a for a, b in zip(sorted(times), sorted(times)[1:], strict=False) if b > a]
    interval = int(statistics.median(steps)) if steps else ROLLUP
    if interval > MAX_INTERVAL:
        raise NotACurve(
            f"{name} has one row every {_span(interval)}, so it's a report of totals rather than the power "
            "curve. History needs readings every 5 minutes: export the plant's power curve for a day or a range of days."
        )

    def column(f: str) -> list[float | None] | None:
        """A field's values in W (or %), summed across its columns; None if it has none."""
        heads = mapping.get(f)
        if not heads:
            return None
        total: list[float | None] = [None] * len(kept)
        for h in heads:
            i = by_header[h]
            raw = [_number(r[i]) if i < len(r) else None for r in kept]
            k = _scale(columns[i], raw)
            for j, v in enumerate(raw):
                if v is not None:
                    total[j] = (total[j] or 0.0) + v * k
        return total

    warnings: list[str] = []
    if time_only:
        warnings.append(
            f"The rows only give the time of day, so the date was taken from {'the file' if day else 'its name'}."
        )
    n = len(kept)
    pv, load, soc = column("pv"), column("load"), column("soc")
    grid = _net(column("import"), column("export"), n, ("grid import", "grid export"), warnings)
    battery = _net(column("discharge"), column("charge"), n, ("battery discharging", "battery charging"), warnings)

    readings: list[tuple[int, dict[str, float | None]]] = []
    for j, ts in enumerate(times):
        p = pv[j] if pv else None
        lo, g, b = (load[j] if load else None), grid[j], battery[j]
        if pv and p is None and (lo is not None or g is not None):
            p = 0.0  # the inverter asleep: after dark the export shows "--"
        # Whichever one of the four is missing follows from the rest: home use = solar + grid + battery.
        # (So an export without battery columns still gets the battery's share.)
        if p is not None and lo is not None and g is not None and b is None:
            b = lo - p - g
        elif p is not None and lo is not None and b is not None and g is None:
            g = lo - p - b
        elif p is not None and g is not None and b is not None and lo is None:
            lo = p + g + b
        elif lo is not None and g is not None and b is not None and p is None:
            p = lo - g - b
        values = {
            "pv_power": p,
            "load_power": lo,
            "grid_power": g,
            "battery_power": b,
            "battery_soc": soc[j] if soc else None,
        }
        if any(v is not None for v in values.values()):
            readings.append((ts, values))
    if not readings:
        raise NotACurve(f"{name} has no readings in the columns chosen.")

    return Curve(
        name=name,
        columns=[c for c in columns if c.header],
        mapping=mapping,
        interval=interval,
        buckets=_buckets(readings, interval),
        warnings=warnings,
    )


def _span(seconds: int) -> str:
    if seconds >= 86400:
        days = round(seconds / 86400)
        return "day" if days == 1 else f"{days} days"
    hours = round(seconds / 3600)
    return "hour" if hours == 1 else f"{hours} hours"


def _buckets(readings: list[tuple[int, dict[str, float | None]]], interval: int) -> dict[int, dict[str, float | None]]:
    """
    Readings averaged into 5-minute buckets. A coarser export (every 10 or 15 minutes) holds each
    reading across the buckets until the next, so a day still adds up. Then the day's counters.
    """
    sums: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    readings.sort(key=lambda r: r[0])
    for k, (ts, values) in enumerate(readings):
        b = ts // ROLLUP * ROLLUP
        reach = ROLLUP
        if interval > ROLLUP:
            gap = readings[k + 1][0] - ts if k + 1 < len(readings) else interval
            reach = gap if gap <= interval * 1.5 else ROLLUP  # don't paper over a real outage
        for step in range(0, max(reach, ROLLUP), ROLLUP):
            for c, v in values.items():
                if v is not None:
                    sums[b + step][c].append(v)

    out: dict[int, dict[str, float | None]] = {}
    totals: dict[str, float] = {}
    day = None
    for b in sorted(sums):
        cols = sums[b]
        row: dict[str, float | None] = {c: round(sum(vs) / len(vs), 2) for c, vs in cols.items()}
        clean(row)
        today = time.strftime("%Y-%m-%d", time.localtime(b))
        if today != day:
            day, totals = (
                today,
                dict.fromkeys(("daily_pv", "daily_import", "daily_export", "daily_charge", "daily_discharge"), 0.0),
            )
        pv, grid, batt = row.get("pv_power"), row.get("grid_power"), row.get("battery_power")
        if pv is not None:
            totals["daily_pv"] += max(pv, 0) * KWH_PER_W_ROLLUP
        if grid is not None:
            totals["daily_import"] += max(grid, 0) * KWH_PER_W_ROLLUP
            totals["daily_export"] += max(-grid, 0) * KWH_PER_W_ROLLUP
        if batt is not None:
            totals["daily_discharge"] += max(batt, 0) * KWH_PER_W_ROLLUP
            totals["daily_charge"] += max(-batt, 0) * KWH_PER_W_ROLLUP
        row.update(
            daily_pv=round(totals["daily_pv"], 3) if pv is not None else None,
            daily_import=round(totals["daily_import"], 3) if grid is not None else None,
            daily_export=round(totals["daily_export"], 3) if grid is not None else None,
            daily_charge=round(totals["daily_charge"], 3) if batt is not None else None,
            daily_discharge=round(totals["daily_discharge"], 3) if batt is not None else None,
        )
        out[b] = row
    return out
