"""
Turning devices' readings into energy and runs, the same way for every integration.

Each poll, a device's reading moves its meter on from the last one (`step`):

- **Energy.** From its counter where it has one: what the counter moved since it last moved, spread evenly over
  that time (at most SPREAD back, and not before the run it belongs to started), so a counter that steps in
  0.1 kWh lands where the energy was used rather than all in the minute it ticked over (a run is taken to have
  begun any time after the reading before it was first seen running). A total counter that goes
  backwards has been reset, and its step is skipped; a cycle counter that goes backwards has started a new cycle,
  and its new value is that cycle's energy so far. Without a counter, its power: the average of this reading's and
  the last, for the time between them (not across a gap longer than GAP, when what happened isn't known). A step
  more than any appliance could draw (MAX_W) is a garbled reading, and skipped.
- **Runs,** for kinds that run in cycles (KINDS[…].cycles). Running is what the device says; for one that doesn't
  say (a smart plug on an older washer), drawing more than its kind's running_w. A run the device reports ends at
  the first reading that says it's stopped. One judged by power ends once it's been below that for QUIET (a wash
  pauses to soak), at the last reading it was above. A device that can't be read for a while (offline) ends its run
  at the last reading it was running. Energy a counter adds within TAIL of a run's end still belongs to it: some
  appliances only finish counting a cycle once it's over.

Energy lands in 5-minute buckets (as the readings' rollups do), added to what's there.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.schema import ROLLUP
from app.features.home.types import KINDS, Reading

SPREAD = 3 * 3600  # the longest a counter's step is spread back over
GAP = 15 * 60  # the longest gap between readings that power is averaged across
QUIET = 10 * 60  # how long a power-judged run must be idle before it's over
TAIL = 10 * 60  # energy counted this soon after a run ends is the run's
MAX_W = 15_000  # more than any appliance on a home circuit draws

Meter = dict[str, Any]
Run = dict[str, Any]


@dataclass
class Step:
    meter: Meter  # what to remember for the next reading
    energy: list[tuple[int, float]] = field(default_factory=list)  # (bucket start, kWh) to add
    runs: list[Run] = field(default_factory=list)  # runs started, updated or ended, to save


def bucket(ts: float) -> int:
    return int(ts) // ROLLUP * ROLLUP


def spread(start: float, end: float, kwh: float) -> list[tuple[int, float]]:
    """kWh used evenly over [start, end), by the 5-minute bucket it fell in. All in end's bucket if there's no span."""
    if end - start < 1:
        return [(bucket(end), kwh)]
    out = []
    b = bucket(start)
    while b < end:
        overlap = min(end, b + ROLLUP) - max(start, b)
        if overlap > 0:
            out.append((b, kwh * overlap / (end - start)))
        b += ROLLUP
    return out


def running(r: Reading, kind: str) -> tuple[bool | None, bool]:
    """Whether a device of `kind` is running a cycle (None: it doesn't run in cycles, or it can't be told), and whether
    that was judged by its power."""
    k = KINDS.get(kind) or KINDS["other"]
    if not k.cycles or not r.online:
        return None, False
    if r.running is not None:
        return r.running, False
    if r.power_w is not None:
        return r.power_w > k.running_w, True
    return None, False


def _plausible(kwh: float, seconds: float) -> bool:
    return 0 <= kwh <= MAX_W / 1000 * max(seconds, 60) / 3600


def step(meter: Meter, r: Reading, ts: int, kind: str) -> Step:
    """Move a device's meter on to this reading, taken at `ts`. `kind` is what the device is set as (which may not be
    what its integration said: a smart plug set as the washer it powers)."""
    m = dict(meter)
    out = Step(m)
    prev_ts: int | None = m.get("ts")
    run: Run | None = dict(m["run"]) if m.get("run") else None
    closing: Run | None = dict(m["closing"]) if m.get("closing") else None
    if closing and ts > closing["end"] + TAIL:
        closing = None

    # -- runs ------------------------------------------------------------------
    on, by_power = running(r, kind)
    ended: Run | None = None
    if on:
        if run is None:
            # It began after the last reading: energy counted now may have been used since then.
            since = prev_ts if prev_ts is not None and ts - prev_ts <= GAP else ts
            started: Run = {
                "id": None,
                "start": ts,
                "since": since,
                "end": None,
                "kwh": 0.0,
                "program": None,
                "peak_w": None,
            }
            run = started
        run["last_on"], run["by_power"] = ts, by_power
    elif run is not None:
        last_on = int(run.get("last_on") or run["start"])
        if on is None:  # it can't be told (offline, or it stopped saying): over once that's lasted a while
            stop, end = ts - last_on > GAP, last_on
        elif run.get("by_power"):
            stop, end = ts - last_on >= QUIET, last_on
        else:  # it said it's stopped; after a gap in the readings, when isn't known, so the last time it ran
            stop, end = True, ts if prev_ts is None or ts - prev_ts <= GAP else last_on
        if stop:
            ended, run = {**run, "end": end}, None
    if run is not None:
        if r.program:
            run["program"] = r.program
        if r.power_w is not None:
            run["peak_w"] = max(run["peak_w"] or 0.0, r.power_w)

    # -- energy ------------------------------------------------------------------
    kwh = 0.0
    window: tuple[float, float] | None = None
    owner = run or ended or closing  # the run this energy belongs to, if any
    if r.online and r.energy_kwh is not None:
        last, changed = m.get("energy"), m.get("changed")
        if last is not None and r.energy_kwh != last:
            moved = r.energy_kwh - last
            if moved < 0:
                moved = r.energy_kwh if r.counter == "cycle" else 0.0
            begin = max(
                float(changed or ts), ts - SPREAD, float(owner.get("since") or owner["start"]) if owner else 0.0
            )
            until = float(min(ts, owner["end"])) if owner and owner.get("end") else float(ts)
            if moved > 0 and _plausible(moved, until - begin):
                kwh, window = moved, (min(begin, until), until)
        if last is None or r.energy_kwh != last:
            m["energy"], m["changed"] = r.energy_kwh, ts
    elif r.online and r.power_w is not None and m.get("power") is not None and prev_ts is not None:
        seconds = ts - prev_ts
        if 0 < seconds <= GAP:
            used = (max(0.0, m["power"]) + max(0.0, r.power_w)) / 2 * seconds / 3.6e6
            if _plausible(used, seconds):
                kwh, window = used, (prev_ts, ts)
    if window and kwh > 0:
        out.energy = spread(*window, kwh)
        if owner is not None:
            owner["kwh"] = round(owner["kwh"] + kwh, 4)

    # -- what to remember ----------------------------------------------------------
    m["ts"] = ts
    m["power"] = r.power_w if r.online else None
    if ended is not None and not ended.get("by_power"):
        closing = ended  # a counter may still be catching up with it
    m["run"], m["closing"] = run, closing
    for x in (run, ended or (closing if owner is closing and kwh > 0 else None)):
        if x is not None:
            out.runs.append(x)
    return out
