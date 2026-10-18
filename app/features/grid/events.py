"""When the house ran without the grid: each time the inverter went off-grid (a blackout, usually) and came back.

The Sungrow hybrid says so in its running state (see app.features.inverters.sungrow.sh_rs.OFF_GRID; GoodWe's maps to
the same). Each poll's state is followed here, so a stretch off-grid is one row (when it started and, once the grid's
back, when it ended), kept for good: the Grid page lists them, and the live status says whether it's happening now.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from app.features.grid.service import VOLTAGE_HIGH, VOLTAGE_LOW
from app.features.inverters.sungrow.sh_rs import OFF_GRID
from app.features.inverters.types import Snapshot

KIND = "off_grid"
SHOWN = 30  # events listed on the Grid page


def off_grid(snap: Snapshot) -> bool | None:
    """Whether a reading says the inverter is running the house without the grid; None where it doesn't say."""
    state = snap.get("running_state")
    return None if state is None else int(state) in OFF_GRID


FREQ_LOW, FREQ_HIGH = 49.85, 50.15  # Hz: the normal band (the standard allows 49.85 to 50.15)


def supply_healthy(snap: Snapshot | None) -> bool | None:
    """Whether the grid supply the inverter sees is in its normal range: voltage within the limits and frequency in
    the normal band, going by whichever of the two it reports. None with no reading, or neither."""
    if snap is None:
        return None
    v, f = snap.get("grid_voltage"), snap.get("grid_freq")
    checks = []
    if v is not None and v > 50:  # below that it isn't measuring the grid
        checks.append(VOLTAGE_LOW <= v <= VOLTAGE_HIGH)
    if f is not None and f > 0:
        checks.append(FREQ_LOW <= f <= FREQ_HIGH)
    return all(checks) if checks else None


class OffGridTracker:
    """Follows each poll's state and keeps the events. Used from the ingest thread with its write connection."""

    def __init__(self, live: Any):
        self.live = live
        self._open: tuple[int, int] | None = None  # (row id, started) of the stretch under way

    def load(self, conn: sqlite3.Connection) -> None:
        """Pick up a stretch left open when the dashboard last stopped (it ends at the next reading that's on-grid)."""
        row = conn.execute(
            "SELECT id, start FROM grid_events WHERE kind = ? AND end IS NULL ORDER BY start DESC LIMIT 1", (KIND,)
        ).fetchone()
        self._open = (row[0], row[1]) if row else None
        self.live.off_grid_since = self._open[1] if self._open else None

    def observe(self, conn: sqlite3.Connection, snaps: list[tuple[int, Snapshot]]) -> None:
        """Take in a batch of readings, oldest first."""
        changed = False
        for ts, snap in snaps:
            off = off_grid(snap)
            if off is None:
                continue
            self.live.off_grid_known = True
            if off and self._open is None:
                cur = conn.execute("INSERT INTO grid_events (kind, start) VALUES (?, ?)", (KIND, ts))
                self._open = (int(cur.lastrowid or 0), ts)
                changed = True
            elif not off and self._open is not None:
                conn.execute("UPDATE grid_events SET end = ? WHERE id = ?", (ts, self._open[0]))
                self._open = None
                changed = True
        if changed:
            conn.commit()
        self.live.off_grid_since = self._open[1] if self._open else None


def recent(conn: sqlite3.Connection, limit: int = SHOWN) -> list[dict[str, Any]]:
    """The latest events, newest first: when each started and ended (None while it's still going)."""
    rows = conn.execute(
        "SELECT id, start, end FROM grid_events WHERE kind = ? ORDER BY start DESC LIMIT ?", (KIND, limit)
    ).fetchall()
    return [{"id": r[0], "start": r[1], "end": r[2]} for r in rows]
