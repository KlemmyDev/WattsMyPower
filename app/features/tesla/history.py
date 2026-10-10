"""
A connected Tesla's in and out, as the home battery has its own: what it drew from the house while charging at home
(ev_energy, per 5-minute rollup, with how much came from the grid: the Home page's car line), and its sessions
(ev_sessions):

    away    from when it was last at home to when it's back: its level (and odometer) leaving and coming back, so
            "used 20% (about 15 kWh), 120 km" while it was out
    charge  each charge at home: its level at each end, and the energy from the house (and of it, from the grid)

At home is where control.CarState says: in Bluetooth range, or (through Tessie) near the house. A car that's gone
for less than AWAY_AFTER isn't counted as away (a Bluetooth reading that missed it), and a car only counts as back
once its level has been read since it left (over Bluetooth, the last reading before it went still stands until then).
"""

from __future__ import annotations

from typing import Any

from app.core.database import Database
from app.features.car.service import LEVELS_KEPT

ROLLUP = 300
AWAY_AFTER = 600  # seconds a car must be gone before it's away (one missed Bluetooth reading isn't a trip)
MAX_STEP = 120  # seconds of charging counted from one turn of the loop to the next, at most
MIN_CHARGE_KWH = 0.05  # a charge that drew less than this is dropped (a start that didn't take)

COLUMNS = ("id", "vin", "kind", "start", "end", "soc_start", "soc_end", "km_start", "km_end", "kwh", "grid_kwh")


def rollup(ts: float) -> int:
    return int(ts // ROLLUP * ROLLUP)


class History:
    def __init__(self, db: Database):
        self.db = db

    # -- energy ---------------------------------------------------------------------------------
    def add_energy(self, vin: str, ts: float, wh: float, grid_wh: float) -> None:
        with self.db.writing() as conn:
            conn.execute(
                "INSERT INTO ev_energy (vin, ts, wh, grid_wh) VALUES (?, ?, ?, ?) ON CONFLICT (vin, ts) DO UPDATE"
                " SET wh = wh + excluded.wh, grid_wh = grid_wh + excluded.grid_wh",
                (vin, rollup(ts), wh, grid_wh),
            )

    def power(self, vin: str, start: int, end: int) -> list[dict[str, Any]]:
        """What the car drew from the house in each 5-minute rollup of [start, end) it charged in, as average W, and
        of that what came from the grid: [{t, w, grid_w}]."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT ts, wh, grid_wh FROM ev_energy WHERE vin = ? AND ts >= ? AND ts < ? ORDER BY ts",
                (vin, start, end),
            ).fetchall()
        k = 3600 / ROLLUP
        return [
            {"t": int(ts), "w": round(wh * k), "grid_w": round(min(wh, grid_wh or 0) * k)}
            for ts, wh, grid_wh in rows
            if wh > 0
        ]

    def charged_w(self, start: int, end: int) -> dict[int, float]:
        """What the cars drew from the house in each 5-minute rollup of [start, end) they charged in, as average W."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT ts, SUM(wh) FROM ev_energy WHERE ts >= ? AND ts < ? GROUP BY ts", (start, end)
            ).fetchall()
        return {int(ts): wh * 3600 / ROLLUP for ts, wh in rows if wh > 0}

    # -- wakes ----------------------------------------------------------------------------------
    def add_wake(self, vin: str, ts: float, reason: str) -> None:
        """The dashboard woke the car (or sent it something while it slept, which wakes it), and why. Kept as long as
        its levels are: they're there to see it isn't woken too often lately, not for good."""
        with self.db.writing() as conn:
            conn.execute("INSERT OR REPLACE INTO ev_wakes (vin, ts, reason) VALUES (?, ?, ?)", (vin, int(ts), reason))
            conn.execute("DELETE FROM ev_wakes WHERE vin = ? AND ts < ?", (vin, int(ts) - LEVELS_KEPT))

    def wakes(self, vin: str, start: int, end: int) -> list[dict[str, Any]]:
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT ts, reason FROM ev_wakes WHERE vin = ? AND ts >= ? AND ts < ? ORDER BY ts", (vin, start, end)
            ).fetchall()
        return [{"t": int(ts), "reason": reason} for ts, reason in rows]

    # -- events ---------------------------------------------------------------------------------
    def add_event(self, vin: str, ts: float, text: str, kind: str | None) -> None:
        """What the dashboard did with the car, or saw done (the activity), kept for its day's chart."""
        with self.db.writing() as conn:
            conn.execute("INSERT INTO ev_events (vin, ts, text, kind) VALUES (?, ?, ?, ?)", (vin, int(ts), text, kind))

    def events(self, vin: str, start: int, end: int) -> list[dict[str, Any]]:
        """The car's activity through [start, end), oldest first."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT ts, text, kind FROM ev_events WHERE vin = ? AND ts >= ? AND ts < ? ORDER BY ts, id",
                (vin, start, end),
            ).fetchall()
        return [{"ts": int(ts), "vin": vin, "text": text, "kind": kind} for ts, text, kind in rows]

    # -- levels ---------------------------------------------------------------------------------
    # A Tesla's level by its VIN, while it isn't tied to one of the dashboard's cars (whose levels CarService keeps):
    # the same calls as CarService's, so either keeps a car's levels (TeslaService._levels).
    def record_level(self, vin: str, ts: int, soc: float, source: str) -> None:
        with self.db.writing() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO ev_levels (vin, ts, soc, source) VALUES (?, ?, ?, ?)", (vin, ts, soc, source)
            )
            conn.execute("DELETE FROM ev_levels WHERE vin = ? AND ts < ?", (vin, ts - LEVELS_KEPT))

    def level(self, vin: str, now: int) -> dict[str, Any] | None:
        """The level last recorded at or before `now`, as {given, given_at}; None if never recorded."""
        with self.db.reading() as conn:
            row = conn.execute(
                "SELECT ts, soc FROM ev_levels WHERE vin = ? AND ts <= ? ORDER BY ts DESC LIMIT 1", (vin, now)
            ).fetchone()
        return {"given": float(row[1]), "given_at": int(row[0])} if row else None

    def last_read(self, vin: str, now: int) -> tuple[int, float] | None:
        """When the level was last read from the car itself (not held while it slept), and what."""
        with self.db.reading() as conn:
            row = conn.execute(
                "SELECT ts, soc FROM ev_levels WHERE vin = ? AND ts <= ? AND source NOT LIKE '%:asleep'"
                " ORDER BY ts DESC LIMIT 1",
                (vin, now),
            ).fetchone()
        return (int(row[0]), float(row[1])) if row else None

    def levels(self, vin: str, start: int, end: int) -> list[tuple[int, float, str]]:
        """The levels recorded in [start, end), oldest first, each with where it came from, with the one either
        side (so a line can reach both edges)."""
        cols = "SELECT ts, soc, source FROM ev_levels WHERE vin = ?"
        with self.db.reading() as conn:
            before = conn.execute(f"{cols} AND ts < ? ORDER BY ts DESC LIMIT 1", (vin, start)).fetchall()
            within = conn.execute(f"{cols} AND ts >= ? AND ts < ? ORDER BY ts", (vin, start, end)).fetchall()
            after = conn.execute(f"{cols} AND ts >= ? ORDER BY ts LIMIT 1", (vin, end)).fetchall()
        return [(int(ts), float(soc), str(src)) for ts, soc, src in [*before, *within, *after]]

    # -- sessions -------------------------------------------------------------------------------
    def _row(self, row: tuple[Any, ...]) -> dict[str, Any]:
        return dict(zip(COLUMNS, row, strict=True))

    def open(self, vin: str, kind: str) -> dict[str, Any] | None:
        """The car's session of `kind` under way (no end yet), if there is one."""
        with self.db.reading() as conn:
            row = conn.execute(
                f"SELECT {', '.join(COLUMNS)} FROM ev_sessions WHERE vin = ? AND kind = ? AND end IS NULL"
                " ORDER BY start DESC LIMIT 1",
                (vin, kind),
            ).fetchone()
        return self._row(row) if row else None

    def start(self, vin: str, kind: str, start: int, soc: float | None, km: float | None) -> int:
        with self.db.writing() as conn:
            cur = conn.execute(
                "INSERT INTO ev_sessions (vin, kind, start, soc_start, km_start, kwh, grid_kwh) VALUES"
                " (?, ?, ?, ?, ?, ?, ?)",
                (vin, kind, start, soc, km, 0.0 if kind == "charge" else None, 0.0 if kind == "charge" else None),
            )
            return int(cur.lastrowid or 0)

    def add_charge(self, session: int, kwh: float, grid_kwh: float) -> None:
        with self.db.writing() as conn:
            conn.execute(
                "UPDATE ev_sessions SET kwh = kwh + ?, grid_kwh = grid_kwh + ? WHERE id = ?", (kwh, grid_kwh, session)
            )

    def finish(self, session: int, end: int, soc: float | None, km: float | None) -> dict[str, Any] | None:
        """End a session; a charge that drew next to nothing is dropped (None)."""
        with self.db.writing() as conn:
            conn.execute(
                "UPDATE ev_sessions SET end = ?, soc_end = ?, km_end = ? WHERE id = ?", (end, soc, km, session)
            )
            row = conn.execute(f"SELECT {', '.join(COLUMNS)} FROM ev_sessions WHERE id = ?", (session,)).fetchone()
            s = self._row(row) if row else None
            if s and s["kind"] == "charge" and (s["kwh"] or 0) < MIN_CHARGE_KWH:
                conn.execute("DELETE FROM ev_sessions WHERE id = ?", (session,))
                return None
        return s

    def cancel(self, session: int) -> None:
        with self.db.writing() as conn:
            conn.execute("DELETE FROM ev_sessions WHERE id = ?", (session,))

    def sessions(self, vin: str, start: int, end: int) -> list[dict[str, Any]]:
        """The car's sessions that touch [start, end), newest first."""
        with self.db.reading() as conn:
            rows = conn.execute(
                f"SELECT {', '.join(COLUMNS)} FROM ev_sessions WHERE vin = ? AND start < ? AND (end IS NULL OR"
                " end >= ?) ORDER BY start DESC",
                (vin, end, start),
            ).fetchall()
        return [self._row(r) for r in rows]

    def forget(self, vin: str | None = None) -> None:
        """Drop a car's history (or every car's)."""
        with self.db.writing() as conn:
            for table in ("ev_energy", "ev_sessions", "ev_wakes", "ev_events"):
                if vin is None:
                    conn.execute(f"DELETE FROM {table}")
                else:
                    conn.execute(f"DELETE FROM {table} WHERE vin = ?", (vin,))


def describe(s: dict[str, Any], battery_kwh: float | None) -> dict[str, Any]:
    """A session for the EV page: its levels and their difference, that as energy (from the car's battery size), and
    for time away the distance and what it used per 100 km."""
    soc0, soc1 = s.get("soc_start"), s.get("soc_end")
    delta = round(soc1 - soc0, 1) if soc0 is not None and soc1 is not None else None
    km = (
        round(s["km_end"] - s["km_start"], 1) if s.get("km_end") is not None and s.get("km_start") is not None else None
    )
    battery = round(-delta / 100 * battery_kwh, 1) if delta is not None and battery_kwh else None
    out = {
        "id": s["id"],
        "kind": s["kind"],
        "start": s["start"],
        "end": s["end"],
        "soc_start": soc0,
        "soc_end": soc1,
        "soc_change": delta,
        "km": km if km is None or km >= 0 else None,
    }
    if s["kind"] == "away":
        # Used (positive), or gained (a charge while out); per 100 km once it's driven far enough to say.
        out["used_kwh"] = battery
        out["kwh_per_100km"] = round(battery / km * 100, 1) if battery and km and km >= 5 and battery > 0 else None
    else:
        kwh, grid = s.get("kwh") or 0.0, s.get("grid_kwh") or 0.0
        out["kwh"] = round(kwh, 2)
        out["grid_kwh"] = round(grid, 2)
        out["solar_share"] = round(max(0.0, 1 - grid / kwh), 3) if kwh > 0 else None
    return out
