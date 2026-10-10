"""SQLite connections and schema migrations. Every query in the app goes through a Database."""

from __future__ import annotations

import contextlib
import glob
import os
import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import closing, contextmanager

from app.core.schema import MIGRATIONS, add_missing_sample_columns


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
        """Create the database if needed and bring its schema up to date. Returns the schema version."""
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with self.writing() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            for n, step in enumerate(MIGRATIONS[version:], start=version + 1):
                step(conn)
                conn.execute(f"PRAGMA user_version = {n}")
            add_missing_sample_columns(conn)
            return len(MIGRATIONS)

    def size_bytes(self) -> int:
        return sum(os.path.getsize(p) for p in (self.path, self.path + "-wal") if os.path.exists(p))
