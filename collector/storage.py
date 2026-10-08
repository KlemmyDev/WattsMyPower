"""
Measuring the collector's database for the dashboard (GET /v1/storage, shown in Manage → Data): its
files on disk, and how much of them each table and index takes.

A copy of the dashboard's app/features/storage/measure.py (the collector's image doesn't include the
dashboard's code): keep the two, and the shape they return, the same. Sizes come from SQLite's `dbstat`
table, which walks every page; a SQLite built without it still gets row counts and the file sizes.
"""

from __future__ import annotations

import os
import sqlite3
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

WEEK = 7 * 86400


@dataclass(frozen=True)
class Spec:
    """How to measure a table beyond its size and rows: the column its rows are dated by (unix seconds),
    and a query breaking it down, giving (label, rows, weight) per part. A part's share of the table's
    size is its share of the weight: rows by default, or e.g. the bytes of text each part holds."""

    time: str | None = None
    parts: str | None = None


def files(path: str) -> dict[str, int]:
    """The database's files: the database itself, its write-ahead log and the log's shared-memory index."""
    sizes = {"database": path, "wal": f"{path}-wal", "shm": f"{path}-shm"}
    return {k: os.path.getsize(p) if os.path.exists(p) else 0 for k, p in sizes.items()}


def btrees(conn: sqlite3.Connection) -> dict[str, dict[str, int]] | None:
    """Each table's and index's pages, bytes on disk, bytes of data, and bytes left unused inside its
    pages, by name. None when this SQLite wasn't built with dbstat."""
    try:
        rows = conn.execute("SELECT name, pageno, pgsize, payload, unused FROM dbstat WHERE aggregate = 1").fetchall()
    except sqlite3.OperationalError:
        return None
    return {n: {"pages": p, "bytes": b, "payload": d, "unused": u} for n, p, b, d, u in rows}


def measure(conn: sqlite3.Connection, path: str, specs: Mapping[str, Spec], now: float | None = None) -> dict[str, Any]:
    """The database as a whole, and each table in it (its indexes counted with it)."""
    now = int(time.time() if now is None else now)
    pragma = lambda name: conn.execute(f"PRAGMA {name}").fetchone()[0]  # noqa: E731
    sizes = btrees(conn)
    schema = conn.execute(
        "SELECT type, name, tbl_name FROM sqlite_schema WHERE type IN ('table', 'index') ORDER BY name"
    ).fetchall()
    indexes: dict[str, list[str]] = {}
    for kind, name, table in schema:
        if kind == "index":
            indexes.setdefault(table, []).append(name)
    tables = [_table(conn, name, specs.get(name, Spec()), indexes.get(name, []), sizes, now)
              for kind, name, _ in schema if kind == "table"]  # fmt: skip
    if sizes is not None and "sqlite_schema" in sizes:  # the schema itself, which isn't listed in itself
        s = sizes["sqlite_schema"]
        tables.append(_empty("sqlite_schema", s))
    page_size = pragma("page_size")
    return {
        "path": path,
        "files": files(path),
        "page_size": page_size,
        "pages": pragma("page_count"),
        "free_pages": pragma("freelist_count"),
        "schema_version": pragma("user_version"),
        "sqlite_version": sqlite3.sqlite_version,
        "journal_mode": pragma("journal_mode"),
        "measured": sizes is not None,
        "tables": tables,
    }


def _empty(name: str, size: Mapping[str, int]) -> dict[str, Any]:
    return {
        "name": name, "rows": None, "data_bytes": size["bytes"], "index_bytes": 0, "payload_bytes": size["payload"],
        "unused_bytes": size["unused"], "pages": size["pages"], "oldest": None, "newest": None, "recent_rows": None,
        "parts": [], "columns": [], "indexes": [],
    }  # fmt: skip


def _table(
    conn: sqlite3.Connection,
    name: str,
    spec: Spec,
    index_names: list[str],
    sizes: Mapping[str, Mapping[str, int]] | None,
    now: int,
) -> dict[str, Any]:
    q = f'"{name}"'
    rows = conn.execute(f"SELECT COUNT(*) FROM {q}").fetchone()[0]
    oldest = newest = recent = None
    if spec.time:
        # Up to now: some tables hold hours still to come (the weather forecast), which aren't history.
        oldest, newest = conn.execute(f"SELECT MIN({spec.time}), MAX({spec.time}) FROM {q} WHERE {spec.time} <= ?",
                                      (now,)).fetchone()  # fmt: skip
        recent = conn.execute(f"SELECT COUNT(*) FROM {q} WHERE {spec.time} > ? AND {spec.time} <= ?",
                              (now - WEEK, now)).fetchone()[0]  # fmt: skip
    own = (sizes or {}).get(name)
    index_sizes = [(i, (sizes or {}).get(i)) for i in index_names]
    data = own["bytes"] if own else None
    index_bytes = sum(s["bytes"] for _, s in index_sizes if s) if sizes is not None else None
    parts: list[dict[str, Any]] = []
    if spec.parts and rows:
        try:
            found = conn.execute(spec.parts).fetchall()
        except sqlite3.OperationalError:  # a table from an older schema, without a column the query uses
            found = []
        weight = sum(w or 0 for _, _, w in found) or 1
        total = (data or 0) + (index_bytes or 0)
        parts = [{"label": str(label), "rows": n, "share": (w or 0) / weight,
                  "bytes": round(total * (w or 0) / weight) if sizes is not None else None}
                 for label, n, w in found]  # fmt: skip
    return {
        "name": name,
        "rows": rows,
        "data_bytes": data,
        "index_bytes": index_bytes,
        "payload_bytes": own["payload"] if own else None,
        "unused_bytes": own["unused"] if own else None,
        "pages": (own["pages"] if own else 0) + sum(s["pages"] for _, s in index_sizes if s)
        if sizes is not None
        else None,
        "oldest": oldest,
        "newest": newest,
        "recent_rows": recent,
        "parts": parts,
        "columns": [{"name": c[1], "type": c[2] or ""} for c in conn.execute(f"PRAGMA table_info({q})")],
        "indexes": [{"name": i, "bytes": s["bytes"] if s else None} for i, s in index_sizes],
    }


# The readings table: dated by poll, broken down by device, each part weighed by the JSON it holds.
SPECS: dict[str, Spec] = {
    "readings": Spec(
        "ts",
        "SELECT CASE device WHEN 'hybrid' THEN 'Hybrid inverter' WHEN 'pv2' THEN 'Second inverter' ELSE device END"
        " || ' (' || driver || ')', COUNT(*), SUM(LENGTH(input) + IFNULL(LENGTH(holding), 0))"
        " FROM readings GROUP BY device, driver ORDER BY COUNT(*) DESC",
    ),
    "devices": Spec("added_at"),
}
