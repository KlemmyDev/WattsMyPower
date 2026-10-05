"""The home tables: connected accounts, their devices, each device's energy and its runs (see app.core.schema._home)."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from app.core.database import Database
from app.features.home.energy import Meter, Run


def _json(text: str | None) -> dict[str, Any]:
    try:
        value = json.loads(text) if text else {}
    except ValueError:
        value = {}
    return value if isinstance(value, dict) else {}


@dataclass(frozen=True)
class Account:
    id: int
    integration: str
    saved: dict[str, Any]
    state: dict[str, Any]
    created_at: int


@dataclass(frozen=True)
class Device:
    id: int
    account: int
    key: str
    name: str
    kind: str
    model: str | None
    hidden: bool
    position: int
    meter: Meter
    group: str | None = None  # shown with the others in it as one on the Home page ("Study")


_DEVICE = "SELECT id, account, key, name, kind, model, hidden, position, meter, group_name FROM home_devices"


def _device(row: tuple[Any, ...]) -> Device:
    id, account, key, name, kind, model, hidden, position, meter, group = row
    return Device(id, account, key, name, kind, model, bool(hidden), position, _json(meter), group)


class HomeRepository:
    def __init__(self, db: Database):
        self.db = db

    # -- accounts -------------------------------------------------------------
    def accounts(self) -> list[Account]:
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT id, integration, saved, state, created_at FROM home_accounts ORDER BY id"
            ).fetchall()
        return [Account(i, n, _json(s), _json(st), c) for i, n, s, st, c in rows]

    def account(self, conn: sqlite3.Connection, account_id: int) -> Account | None:
        row = conn.execute(
            "SELECT id, integration, saved, state, created_at FROM home_accounts WHERE id = ?", (account_id,)
        ).fetchone()
        return Account(row[0], row[1], _json(row[2]), _json(row[3]), row[4]) if row else None

    def add_account(self, conn: sqlite3.Connection, integration: str, saved: dict[str, Any], now: int) -> int:
        cur = conn.execute(
            "INSERT INTO home_accounts (integration, saved, state, created_at) VALUES (?, ?, '{}', ?)",
            (integration, json.dumps(saved), now),
        )
        assert cur.lastrowid is not None
        return cur.lastrowid

    def save_account(
        self,
        conn: sqlite3.Connection,
        account_id: int,
        saved: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
    ) -> None:
        if saved is not None:
            conn.execute("UPDATE home_accounts SET saved = ? WHERE id = ?", (json.dumps(saved), account_id))
        if state is not None:
            conn.execute("UPDATE home_accounts SET state = ? WHERE id = ?", (json.dumps(state), account_id))

    def delete_account(self, conn: sqlite3.Connection, account_id: int) -> bool:
        """Remove an account with its devices, their energy and their runs."""
        devices = "SELECT id FROM home_devices WHERE account = ?"
        conn.execute(f"DELETE FROM home_energy WHERE device IN ({devices})", (account_id,))
        conn.execute(f"DELETE FROM home_runs WHERE device IN ({devices})", (account_id,))
        conn.execute("DELETE FROM home_devices WHERE account = ?", (account_id,))
        return conn.execute("DELETE FROM home_accounts WHERE id = ?", (account_id,)).rowcount > 0

    # -- devices --------------------------------------------------------------
    def devices(self, conn: sqlite3.Connection | None = None, account: int | None = None) -> list[Device]:
        where, args = (" WHERE account = ?", (account,)) if account is not None else ("", ())
        sql = f"{_DEVICE}{where} ORDER BY position, id"
        if conn is not None:
            return [_device(r) for r in conn.execute(sql, args)]
        with self.db.reading() as c:
            return [_device(r) for r in c.execute(sql, args)]

    def device(self, conn: sqlite3.Connection, device_id: int) -> Device | None:
        row = conn.execute(f"{_DEVICE} WHERE id = ?", (device_id,)).fetchone()
        return _device(row) if row else None

    def add_device(
        self, conn: sqlite3.Connection, account: int, key: str, name: str, kind: str, model: str | None, now: int
    ) -> Device:
        position = conn.execute("SELECT COALESCE(MAX(position) + 1, 0) FROM home_devices").fetchone()[0]
        cur = conn.execute(
            "INSERT INTO home_devices (account, key, name, kind, model, hidden, position, meter, created_at)"
            " VALUES (?, ?, ?, ?, ?, 0, ?, '{}', ?)",
            (account, key, name, kind, model, position, now),
        )
        assert cur.lastrowid is not None
        return Device(cur.lastrowid, account, key, name, kind, model, False, position, {})

    def update_device(self, conn: sqlite3.Connection, device_id: int, **changes: Any) -> None:
        columns = {"name": "name", "kind": "kind", "hidden": "hidden", "model": "model", "group": "group_name"}
        allowed = {columns[k]: v for k, v in changes.items() if k in columns}
        if allowed:
            sets = ", ".join(f"{k} = ?" for k in allowed)
            conn.execute(f"UPDATE home_devices SET {sets} WHERE id = ?", (*allowed.values(), device_id))

    def save_meter(self, conn: sqlite3.Connection, device_id: int, meter: Meter) -> None:
        conn.execute("UPDATE home_devices SET meter = ? WHERE id = ?", (json.dumps(meter), device_id))

    # -- energy and runs --------------------------------------------------------
    def add_energy(self, conn: sqlite3.Connection, device_id: int, rows: Iterable[tuple[int, float]]) -> None:
        conn.executemany(
            "INSERT INTO home_energy (ts, device, kwh) VALUES (?, ?, ?)"
            " ON CONFLICT (ts, device) DO UPDATE SET kwh = kwh + excluded.kwh",
            [(ts, device_id, kwh) for ts, kwh in rows],
        )

    def save_run(self, conn: sqlite3.Connection, device_id: int, run: Run) -> None:
        """Record a run, or bring a recorded one up to date. A new run's id is set on `run` itself, so the meter
        holding it (app.features.home.energy) knows it next time."""
        values = (run["start"], run.get("end"), run["kwh"], run.get("program"), run.get("peak_w"))
        if run.get("id") is None:
            cur = conn.execute(
                "INSERT INTO home_runs (device, start, end, kwh, program, peak_w) VALUES (?, ?, ?, ?, ?, ?)",
                (device_id, *values),
            )
            run["id"] = cur.lastrowid
        else:
            conn.execute(
                "UPDATE home_runs SET start = ?, end = ?, kwh = ?, program = ?, peak_w = ? WHERE id = ?",
                (*values, run["id"]),
            )

    def energy(self, start: int, end: int, device: int | None = None) -> list[tuple[int, int, float]]:
        """(bucket start, device, kWh) for every bucket in [start, end) (of one device's, if given), oldest first."""
        where, args = (" AND device = ?", (start, end, device)) if device is not None else ("", (start, end))
        with self.db.reading() as conn:
            return conn.execute(
                f"SELECT ts, device, kwh FROM home_energy WHERE ts >= ? AND ts < ?{where} ORDER BY ts", args
            ).fetchall()

    def run(self, run_id: int) -> dict[str, Any] | None:
        with self.db.reading() as conn:
            row = conn.execute(
                "SELECT id, device, start, end, kwh, program, peak_w FROM home_runs WHERE id = ?", (run_id,)
            ).fetchone()
        keys = ("id", "device", "start", "end", "kwh", "program", "peak_w")
        return dict(zip(keys, row, strict=True)) if row else None

    def runs(self, start: int, end: int, device: int | None = None) -> list[dict[str, Any]]:
        """Runs that started in [start, end), oldest first."""
        where, args = ("AND device = ?", (start, end, device)) if device is not None else ("", (start, end))
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT id, device, start, end, kwh, program, peak_w FROM home_runs"
                f" WHERE start >= ? AND start < ? {where} ORDER BY start",
                args,
            ).fetchall()
        keys = ("id", "device", "start", "end", "kwh", "program", "peak_w")
        return [dict(zip(keys, r, strict=True)) for r in rows]

    def last_runs(self) -> dict[int, dict[str, Any]]:
        """Each device's latest finished run."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT r.id, r.device, r.start, r.end, r.kwh, r.program, r.peak_w FROM home_runs r"
                " JOIN (SELECT device, MAX(start) AS s FROM home_runs WHERE end IS NOT NULL GROUP BY device) l"
                " ON l.device = r.device AND l.s = r.start"
            ).fetchall()
        keys = ("id", "device", "start", "end", "kwh", "program", "peak_w")
        return {r[1]: dict(zip(keys, r, strict=True)) for r in rows}
