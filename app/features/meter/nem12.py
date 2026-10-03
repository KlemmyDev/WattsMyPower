"""
Reading NEM12 files: the smart-meter interval data Australian distributors and retailers let
customers download (AEMO's Meter Data File Format Specification, NEM12 & NEM13).

The meter is what the household is billed on, so its readings are the ground truth for grid
import and export. A file is CSV records, each starting with its record type:

    100  header: "NEM12", when the file was made and by whom
    200  a channel: the NMI (the connection point), its suffix (E1, B1…), the unit (kWh, Wh…)
         and the interval length (5, 15 or 30 minutes); the 300-500 records after it belong to it
    300  one day of that channel: the date, one value per interval (1440 / interval length of
         them), then the day's quality, reason code, and when the values were made and loaded
    400  where quality varies across the day (quality "V"): which intervals have which quality
    500  B2B details (service orders): not needed here
    900  end of file

Two things are easy to get wrong, and both shift every reading:
- Times are NEM time: Australian Eastern Standard Time (UTC+10) all year, never daylight saving.
- Each value covers the interval ENDING at its slot: in 30-minute data, value 1 is 00:00 to 00:30
  of the day and value 48 is 23:30 to midnight.

Suffixes starting with E are energy the home took from the grid (import, or consumption), and
those starting with B the energy it sent out (export, or generation). AEMO's own wording names
them from the network's side (E as "export" from the network to the home), which is why the
letters look backwards. Other channels (Q and K reactive energy, and so on) aren't energy that's
billed per kWh, and are skipped.

Quality flags: A actual, E forward estimated, S substituted, F final substituted, N null (no
reading). Estimated and substituted readings are kept and counted as they're what the bill uses
until replaced; null intervals are left out, so a day with any is not treated as complete.
"""

from __future__ import annotations

import calendar
import csv
import datetime as dt
from dataclasses import dataclass, field

NEM_OFFSET = 10 * 3600  # NEM time is UTC+10 all year
INTERVALS = (5, 15, 30)  # minutes
# Energy units a channel can be in, as kWh per unit. The spec says units aren't case sensitive.
UNITS = {"wh": 0.001, "kwh": 1.0, "mwh": 1000.0}
DIRECTIONS = {"E": "import", "B": "export"}
QUALITY = {"A": "actual", "E": "estimated", "S": "substituted", "F": "substituted", "N": "missing", "V": "variable"}
INTERVAL_NAMES = {5: "five-minute", 15: "15-minute", 30: "half-hourly"}


class Nem12Error(ValueError):
    """The file can't be read as NEM12. The message is fit to show on the page."""


@dataclass(frozen=True)
class Reading:
    ts: int  # when the interval starts, unix seconds
    kwh: float
    quality: str  # quality flag and method, e.g. "A", "E52", "S53"


@dataclass
class Channel:
    """One NMI's import or export channel, e.g. NMI 3120000001's E1."""

    nmi: str
    suffix: str
    direction: str  # "import" or "export"
    unit: str  # as written in the file
    minutes: int
    # Keyed on interval start, so a later 300 record for the same day replaces an earlier one.
    readings: dict[int, Reading] = field(default_factory=dict)
    # Each NEM day the file has a 300 record for, readings or not.
    days: set[dt.date] = field(default_factory=set)
    missing: int = 0  # intervals with no reading (quality N or an empty value)

    @property
    def kwh(self) -> float:
        return sum(r.kwh for r in self.readings.values())

    @property
    def filled_days(self) -> set[dt.date]:
        """The days with at least one reading: importing replaces these (a day of nulls replaces nothing)."""
        return {nem_day(ts) for ts in self.readings}


@dataclass
class Nem12File:
    channels: list[Channel]
    # Channels left out, and anything else worth saying about the file, as readable sentences.
    notes: list[str]


def day_start(day: dt.date) -> int:
    """Unix seconds at the start of a NEM day (midnight AEST)."""
    return calendar.timegm((day.year, day.month, day.day, 0, 0, 0)) - NEM_OFFSET


def nem_day(ts: int) -> dt.date:
    """The NEM day an interval starting at `ts` belongs to."""
    return dt.datetime.fromtimestamp(ts + NEM_OFFSET, dt.UTC).date()


def decode(data: bytes) -> str:
    """The file's text. Raises Nem12Error for things that clearly aren't a NEM12 CSV."""
    if data.startswith(b"PK\x03\x04"):
        raise Nem12Error("This is a zip file. Unzip it first, then choose the CSV file inside.")
    if b"\x00" in data[:4096]:
        raise Nem12Error("This doesn't look like a NEM12 file: it isn't a text (CSV) file.")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def parse(data: bytes) -> Nem12File:
    """Read a NEM12 file. Raises Nem12Error, naming the line, if it can't be read."""
    text = decode(data)
    channels: dict[tuple[str, str], Channel] = {}
    notes: list[str] = []
    skipped: set[tuple[str, str]] = set()
    current: Channel | None = None  # the channel the 300 records belong to; None while skipping one
    in_block = False  # after a 200 record, so 300s have a channel (or are being skipped)
    last_day: tuple[Channel, dt.date, list[str]] | None = None  # the latest 300, for its 400s
    seen_header = seen_end = False
    records = 0

    for n, row in enumerate(csv.reader(text.splitlines()), start=1):
        f = [c.strip() for c in row]
        while f and f[-1] == "":
            f.pop()
        if not f:
            continue
        kind = f[0]
        if kind == "100":
            if len(f) > 1 and f[1].upper() == "NEM13":
                raise Nem12Error(
                    "This is a NEM13 file, with meter reads rather than interval data. "
                    "Ask your retailer or distributor for the NEM12 (interval data) file instead."
                )
            if len(f) > 1 and f[1].upper() != "NEM12":
                raise Nem12Error(f"Line {n}: this file says it's {f[1]}, not NEM12 interval data.")
            seen_header = True
        elif kind == "200":
            in_block = True
            last_day = None
            current = _channel(f, n, channels, skipped)
        elif kind == "300":
            if not in_block:
                raise Nem12Error(f"Line {n}: interval data comes before any NMI details (200 record).")
            records += 1
            last_day = _day(f, n, current) if current else None
        elif kind == "400":
            if last_day:
                _events(f, n, *last_day)
        elif kind == "250":
            raise Nem12Error(
                "This file has meter reads (NEM13) rather than interval data. "
                "Ask your retailer or distributor for the NEM12 (interval data) file instead."
            )
        elif kind == "900":
            seen_end = True
            in_block = False
            current = last_day = None
        elif kind == "500":
            continue
        elif not seen_header and not channels and not skipped:
            raise Nem12Error(
                "This doesn't look like a NEM12 file. It should start with a line beginning "
                '"100,NEM12". Check you downloaded the interval data (NEM12) file rather than a summary.'
            )
        else:
            raise Nem12Error(f"Line {n}: unknown record type {kind!r}. A NEM12 file only has 100 to 900 records.")

    if not records:
        raise Nem12Error("This file has no interval data in it.")
    others = ", ".join(sorted({s for _, s in skipped}))
    kept = [c for c in channels.values() if c.readings]
    if not kept:
        if not channels:
            raise Nem12Error(f"This file has no grid import or export readings in it, only {others}.")
        raise Nem12Error("Every reading in this file is missing (quality N), so there's nothing to import.")
    if skipped:
        notes.append(f"Left out what isn't grid import or export in kWh: {others}.")
    if not seen_end:
        notes.append("The file has no end record (900), so it may have been cut short. Check the last day looks right.")
    nmis = sorted({c.nmi for c in kept})
    if len(nmis) > 1:
        notes.append(f"This file covers {len(nmis)} meters ({', '.join(nmis)}). Their readings are added together.")
    return Nem12File(channels=sorted(kept, key=lambda c: (c.nmi, c.direction != "import", c.suffix)), notes=notes)


def _channel(
    f: list[str], n: int, channels: dict[tuple[str, str], Channel], skipped: set[tuple[str, str]]
) -> Channel | None:
    """The channel a 200 record starts, or None (added to `skipped`) if it isn't grid import or export."""
    # 200, NMI, NMIConfiguration, RegisterID, NMISuffix, MDMDataStreamIdentifier, MeterSerialNumber,
    # UOM, IntervalLength, NextScheduledReadDate
    if len(f) < 9:
        raise Nem12Error(f"Line {n}: the NMI details (200 record) are missing fields.")
    nmi, suffix, unit, length = f[1], f[4].upper(), f[7], f[8]
    if not nmi or not suffix:
        raise Nem12Error(f"Line {n}: the NMI details (200 record) have no NMI or suffix.")
    try:
        minutes = int(length)
    except ValueError:
        raise Nem12Error(f"Line {n}: the interval length {length!r} isn't a number of minutes.") from None
    if minutes not in INTERVALS:
        raise Nem12Error(f"Line {n}: an interval length of {minutes} minutes isn't one NEM12 uses (5, 15 or 30).")
    direction = DIRECTIONS.get(suffix[0])
    factor = UNITS.get(unit.lower())
    if direction is None or factor is None:
        skipped.add((nmi, f"{suffix} ({unit})" if unit else suffix))
        return None
    ch = channels.get((nmi, suffix))
    if ch is None:
        ch = channels[(nmi, suffix)] = Channel(nmi, suffix, direction, unit, minutes)
    elif ch.minutes != minutes:
        raise Nem12Error(
            f"Line {n}: {nmi} {suffix} changes from {ch.minutes}- to {minutes}-minute intervals part way through. "
            "Import each part as its own file."
        )
    ch.unit = unit
    return ch


def _day(f: list[str], n: int, ch: Channel) -> tuple[Channel, dt.date, list[str]]:
    """Read a 300 record into its channel. Returns what its 400 records need: the channel, day and qualities."""
    count = 1440 // ch.minutes
    try:
        day = dt.datetime.strptime(f[1], "%Y%m%d").date() if len(f) > 1 and len(f[1]) == 8 else None
    except ValueError:
        day = None
    if day is None:
        raise Nem12Error(f"Line {n}: {f[1] if len(f) > 1 else 'the date'!r} isn't a date (YYYYMMDD).")
    label = f"{day.day} {day:%b %Y}"
    quality = f[2 + count].upper() if len(f) > 2 + count else ""
    if not quality[:1].isalpha():
        found = next((k for k, v in enumerate(f[2:]) if v[:1].isalpha()), len(f) - 2)
        raise Nem12Error(
            f"Line {n}: {label} should have {count} {INTERVAL_NAMES[ch.minutes]} readings, but has {found}."
        )
    unit = UNITS[ch.unit.lower()]
    start = day_start(day)
    if day in ch.days:  # a later record for the same day replaces the earlier one
        for k in range(count):
            ch.readings.pop(start + k * ch.minutes * 60, None)
    ch.days.add(day)
    qualities = [quality] * count
    for k, raw in enumerate(f[2 : 2 + count]):
        ts = start + k * ch.minutes * 60
        if raw == "":
            ch.missing += 1
            continue
        v = _number(raw)
        if v is None:
            raise Nem12Error(f"Line {n}: reading {k + 1} on {label} ({raw!r}) isn't a number.")
        if v < 0:
            raise Nem12Error(f"Line {n}: reading {k + 1} on {label} is negative ({raw}), which NEM12 doesn't allow.")
        ch.readings[ts] = Reading(ts, v * unit, quality)
    if quality == "N":
        _drop(ch, start, range(count))
    return ch, day, qualities


def _events(f: list[str], n: int, ch: Channel, day: dt.date, qualities: list[str]) -> None:
    """Apply a 400 record: one quality for a run of intervals (1-based, inclusive) in the day before it."""
    # 400, StartInterval, EndInterval, QualityMethod, ReasonCode, ReasonDescription
    try:
        first, last, quality = int(f[1]), int(f[2]), f[3].upper()
    except (IndexError, ValueError):
        raise Nem12Error(f"Line {n}: the quality details (400 record) are incomplete.") from None
    if not 1 <= first <= last <= len(qualities) or not quality:
        raise Nem12Error(
            f"Line {n}: the quality details (400 record) cover intervals {first} to {last}, "
            f"but the day only has {len(qualities)}."
        )
    start = day_start(day)
    span = range(first - 1, last)
    if quality == "N":
        _drop(ch, start, span)
        return
    for k in span:
        ts = start + k * ch.minutes * 60
        if ts in ch.readings:
            ch.readings[ts] = Reading(ts, ch.readings[ts].kwh, quality)


def _drop(ch: Channel, start: int, intervals: range) -> None:
    """Leave out intervals marked null (N): whatever value they hold isn't a reading."""
    for k in intervals:
        if ch.readings.pop(start + k * ch.minutes * 60, None) is not None:
            ch.missing += 1


def _number(v: str) -> float | None:
    try:
        x = float(v)
    except ValueError:
        return None
    return x if x == x and abs(x) != float("inf") else None
