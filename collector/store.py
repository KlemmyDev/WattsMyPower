"""
The collector's SQLite store: one row per device per poll, raw words as JSON text, and the
devices it reads.

    readings  (ts, device) -> driver, input words, holding words (NULL when none were read)
    devices   role -> driver, host, port, unit, settings (JSON): the connected inverters, set up
              from the dashboard (Manage → Integrations)
    kv        small text values, e.g. whether the devices were seeded from the environment

Each poll's rows go in one transaction with a shared `ts`, so a reader sees all of a poll or none
of it, and paging (`since`) never splits one. Every call opens its own connection: cheap with WAL,
safe across threads, and readers use read-only ones so they can't take the write lock.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from collections.abc import Callable, Iterable, Iterator, Sequence
from contextlib import closing, contextmanager
from typing import NamedTuple

from collector.devices import DeviceConfig, Words

log = logging.getLogger(__name__)


def _baseline(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE readings (ts INTEGER NOT NULL, device TEXT NOT NULL, driver TEXT NOT NULL,"
        " input TEXT NOT NULL, holding TEXT, PRIMARY KEY (ts, device))"
    )


def _devices(conn: sqlite3.Connection) -> None:
    """The inverters to read, moved from environment variables into the database (see seed_devices)."""
    conn.execute(
        "CREATE TABLE devices (role TEXT PRIMARY KEY, driver TEXT NOT NULL, host TEXT NOT NULL,"
        " port INTEGER NOT NULL, unit INTEGER NOT NULL, settings TEXT NOT NULL DEFAULT '{}',"
        " added_at INTEGER NOT NULL)"
    )
    conn.execute("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")


# Applied in order; the database's PRAGMA user_version records how many have run.
# Never edit or reorder one that has shipped: add a new one.
MIGRATIONS: list[Callable[[sqlite3.Connection], None]] = [
    _baseline,
    _devices,
]

SEEDED = "devices_seeded"

# One device's words from one poll: (device, driver, input words, holding words - empty if none were read).
PollRow = tuple[str, str, Words, Words]


class Row(NamedTuple):
    """A stored row. `input` / `holding` stay as their stored JSON text: the feed sends them as-is."""

    ts: int
    device: str
    driver: str
    input: str
    holding: str | None


def encode(words: Words) -> str:
    """Words as a compact JSON object keyed by address (a string), in address order."""
    return json.dumps({str(a): words[a] for a in sorted(words)}, separators=(",", ":"))


class Store:
    def __init__(self, path: str, retention_days: int = 365):
        self.path = path
        self.retention_days = retention_days

    def connect(self, readonly: bool = False) -> sqlite3.Connection:
        if readonly:
            conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
        else:
            conn = sqlite3.connect(self.path, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    @contextmanager
    def reading(self) -> Iterator[sqlite3.Connection]:
        with closing(self.connect(readonly=True)) as conn:
            yield conn

    @contextmanager
    def writing(self) -> Iterator[sqlite3.Connection]:
        """A connection whose changes are committed (as one transaction) when the block ends without an error."""
        with closing(self.connect()) as conn:
            yield conn
            conn.commit()

    def migrate(self) -> int:
        """Create the database if needed and bring its schema up to date. Returns the schema version.

        Each step runs in a transaction of its own, with the version it brings the database to, so a step that
        fails part-way leaves the database as it was before it, to be tried again from the beginning."""
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with closing(self.connect()) as conn:
            conn.isolation_level = None  # transactions as below: sqlite3 doesn't open one for CREATE or ALTER
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > len(MIGRATIONS):
                log.warning(
                    "The collector's database (%s) was last used by a newer version of WattsMyPower (schema version "
                    "%d; this version knows up to %d). Carrying on, but some things may not work: go back to the "
                    "newer version, or restore a backup taken before it.",
                    self.path,
                    version,
                    len(MIGRATIONS),
                )
            for n, step in enumerate(MIGRATIONS[version:], start=version + 1):
                conn.execute("BEGIN IMMEDIATE")
                try:
                    step(conn)
                    conn.execute(f"PRAGMA user_version = {n}")
                except BaseException:
                    if conn.in_transaction:  # SQLite rolls some errors (a full disk) back itself
                        conn.execute("ROLLBACK")
                    log.exception(
                        "Collector database migration %d of %d (%s) failed and was undone: the database is as it "
                        "was before it",
                        n,
                        len(MIGRATIONS),
                        step.__name__.strip("_"),
                    )
                    raise
                conn.execute("COMMIT")
            return len(MIGRATIONS)

    # -- writing --------------------------------------------------------------
    def write_poll(self, ts: int, rows: Sequence[PollRow]) -> None:
        """One poll's rows, all with the same ts, in one transaction."""
        self.write_polls([(ts, rows)])

    def write_polls(self, polls: Iterable[tuple[int, Sequence[PollRow]]]) -> None:
        """Several polls in one transaction (the mock's backfill)."""
        with self.writing() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO readings (ts, device, driver, input, holding) VALUES (?, ?, ?, ?, ?)",
                (
                    (ts, device, driver, encode(inp), encode(holding) if holding else None)
                    for ts, rows in polls
                    for device, driver, inp, holding in rows
                ),
            )

    def prune(self, now: float) -> int:
        """Delete rows older than the retention period. Returns how many went."""
        if self.retention_days <= 0:
            return 0
        with self.writing() as conn:
            cur = conn.execute("DELETE FROM readings WHERE ts < ?", (int(now) - self.retention_days * 86400,))
            return cur.rowcount

    # -- devices --------------------------------------------------------------
    def devices(self) -> list[DeviceConfig]:
        """The connected inverters, hybrid first."""
        with self.reading() as conn:
            rows = conn.execute(
                "SELECT role, driver, host, port, unit, settings, added_at FROM devices"
                " ORDER BY role = 'hybrid' DESC, role"
            ).fetchall()
        return [DeviceConfig(r, d, h, p, u, json.loads(s or "{}"), a) for r, d, h, p, u, s, a in rows]

    def put_device(self, device: DeviceConfig) -> DeviceConfig:
        """Connect a device in its role, replacing whatever had that role. Returns it as stored."""
        added = device.added_at or int(time.time())
        with self.writing() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO devices (role, driver, host, port, unit, settings, added_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (device.role, device.driver, device.host, device.port, device.unit,
                 json.dumps(dict(device.settings), separators=(",", ":")), added),
            )  # fmt: skip
        return DeviceConfig(device.role, device.driver, device.host, device.port, device.unit, device.settings, added)

    def remove_device(self, role: str) -> bool:
        with self.writing() as conn:
            return conn.execute("DELETE FROM devices WHERE role = ?", (role,)).rowcount > 0

    def seed_devices(self, devices: Iterable[DeviceConfig]) -> bool:
        """Store the devices the environment configures (INVERTER_HOST, PV2_HOST), once ever.

        This moves an install from before devices were managed in the dashboard into the database.
        After it has run, the database is the only source: removing every device in the dashboard
        doesn't bring the environment's back on the next start. Returns whether it ran.
        """
        with self.writing() as conn:
            if conn.execute("SELECT 1 FROM kv WHERE key = ?", (SEEDED,)).fetchone():
                return False
            now = int(time.time())
            for d in devices:
                conn.execute(
                    "INSERT OR IGNORE INTO devices (role, driver, host, port, unit, settings, added_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        d.role,
                        d.driver,
                        d.host,
                        d.port,
                        d.unit,
                        json.dumps(dict(d.settings), separators=(",", ":")),
                        now,
                    ),
                )
            conn.execute("INSERT INTO kv (key, value) VALUES (?, ?)", (SEEDED, str(now)))
            return True

    # -- reading --------------------------------------------------------------
    def since(self, since: int, limit: int) -> tuple[list[Row], bool]:
        """Rows with ts > since, oldest first, at most `limit` but never splitting a poll.

        Returns (rows, more): `more` says rows exist after these. When the limit falls inside a
        poll, the feed stops before that poll; only if that would leave nothing (one poll larger
        than the limit) does it send that whole poll instead.
        """
        limit = max(1, limit)
        query = "SELECT ts, device, driver, input, holding FROM readings WHERE {} ORDER BY ts, device"
        with self.reading() as conn:
            rows = [Row(*r) for r in conn.execute(query.format("ts > ?") + " LIMIT ?", (since, limit + 1))]
            if len(rows) <= limit:
                return rows, False
            cut = rows[limit].ts  # the first poll that didn't (wholly) fit
            kept = [r for r in rows[:limit] if r.ts != cut]
            if kept:
                return kept, True
            kept = [Row(*r) for r in conn.execute(query.format("ts = ?"), (cut,))]
            more = conn.execute("SELECT 1 FROM readings WHERE ts > ? LIMIT 1", (cut,)).fetchone() is not None
            return kept, more

    def bounds(self) -> tuple[int | None, int | None]:
        """(oldest ts, latest ts) stored, or (None, None) when empty."""
        with self.reading() as conn:
            oldest, latest = conn.execute("SELECT MIN(ts), MAX(ts) FROM readings").fetchone()
            return oldest, latest

    def is_empty(self) -> bool:
        with self.reading() as conn:
            return conn.execute("SELECT 1 FROM readings LIMIT 1").fetchone() is None
