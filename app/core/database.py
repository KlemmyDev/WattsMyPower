"""SQLite connections and schema migrations. Every query in the app goes through a Database."""

from __future__ import annotations

import contextlib
import glob
import logging
import os
import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import closing, contextmanager

from app.core.schema import MIGRATIONS, add_missing_sample_columns

log = logging.getLogger(__name__)


def keep_private(paths: Iterable[str]) -> None:
    """Make files readable by their owner only, where they're more open (from before the app's umask). Best effort:
    a file it can't change is left as it is."""
    for path in paths:
        with contextlib.suppress(OSError):
            if os.stat(path).st_mode & 0o077:
                os.chmod(path, 0o600)


class Database:
    def __init__(self, path: str):
        self.path = path

    def connect(self, readonly: bool = False) -> sqlite3.Connection:
        """A new connection. Readers each open their own: cheap with WAL, and safe across threads."""
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
        """A connection whose changes are committed when the block ends without an error."""
        with closing(self.connect()) as conn:
            yield conn
            conn.commit()

    def keep_private(self) -> None:
        """The database's files, and the backups install.sh makes next to it, readable by this user only."""
        backups = glob.glob(os.path.join(os.path.dirname(self.path) or ".", "backups", "*.db"))
        keep_private([self.path, self.path + "-wal", self.path + "-shm", *backups])

    def migrate(self) -> int:
        """Create the database if needed and bring its schema up to date. Returns the schema version.

        Each step runs in a transaction of its own, with the version it brings the database to, so a step that
        fails part-way (a full disk, the container stopped) leaves the database as it was before it: the next
        start tries it again from the beginning, rather than tripping over what it half did."""
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with closing(self.connect()) as conn:
            conn.isolation_level = None  # transactions as below: sqlite3 doesn't open one for CREATE or ALTER
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > len(MIGRATIONS):
                log.warning(
                    "The database (%s) was last used by a newer version of WattsMyPower (schema version %d; this "
                    "version knows up to %d). Carrying on, but some things may not work: go back to the newer "
                    "version, or restore a backup taken before it.",
                    self.path,
                    version,
                    len(MIGRATIONS),
                )
            for n, step in enumerate(MIGRATIONS[version:], start=version + 1):
                with transaction(conn, f"Database migration {n} of {len(MIGRATIONS)} ({step.__name__.strip('_')})"):
                    step(conn)
                    conn.execute(f"PRAGMA user_version = {n}")
            with transaction(conn, "Adding new reading columns to the database"):
                add_missing_sample_columns(conn)
            if version < len(MIGRATIONS):
                log.info("Database schema updated from version %d to %d", version, len(MIGRATIONS))
            return len(MIGRATIONS)

    def size_bytes(self) -> int:
        return sum(os.path.getsize(p) for p in (self.path, self.path + "-wal") if os.path.exists(p))


@contextmanager
def transaction(conn: sqlite3.Connection, what: str) -> Iterator[None]:
    """One explicit transaction, on a connection with isolation_level None: committed when the block ends, rolled
    back (and logged, naming `what`) if it raises."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        if conn.in_transaction:  # SQLite rolls some errors (a full disk) back itself
            conn.execute("ROLLBACK")
        log.exception("%s failed and was undone: the database is as it was before it", what)
        raise
    conn.execute("COMMIT")
