"""
A backup to download (Manage → Data): a zip of the dashboard's database and, when asked for and it can be had, the
collector's, with a README.txt on putting them back. The zip is encrypted with a passphrase the person chooses, so the
file on its own is no use to anyone who gets hold of it.

Each database is copied with SQLite's online backup, not by copying its file: readings keep being written while it's
made, and the file on its own misses whatever is still in the write-ahead log. Each copy is taken in one step, so it's
the database as it was at one moment, and is one file (no -wal to go with it). The collector copies its own
(GET /v1/backup, collector/backup.py), which is written into the zip as it arrives. The zip is made in a temporary
folder, sent, then deleted. One backup is made at a time: a large collector database takes a while, and room on disk.
"""

from __future__ import annotations

import asyncio
import getpass
import hashlib
import hmac
import http.client
import os
import secrets
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import zipfile
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractContextManager, ExitStack, closing
from dataclasses import dataclass
from datetime import datetime
from glob import glob
from typing import IO, Protocol

from Cryptodome.Cipher import AES
from Cryptodome.Hash import HMAC, SHA256

from app.core.version import VERSION
from app.features.live.client import CollectorError

DASHBOARD, COLLECTOR = "wattsmypower.db", "collector.db"
PREFIX = "wattsmypower-backup-"
CHUNK = 1 << 20  # bytes read and written at a time
STALE = 3600  # seconds after which a temporary folder is a leftover from a backup cut short
SQLITE = b"SQLite format 3\x00"  # how every SQLite database file starts
MAGIC = b"WMPBACKUP1\n"  # starts every encrypted backup: its format and version
SALT, NONCE, MAC = 16, 8, 32  # bytes: the key's salt, the counter's nonce, the HMAC-SHA256 at the end
SCRYPT = {"n": 1 << 15, "r": 8, "p": 1}  # the passphrase's key stretching: about 32 MB and a fraction of a second
MIN_PASSPHRASE = 8


class Copies(Protocol):
    """The collector's copy of its own database (CollectorClient, or a fake in tests)."""

    def backup(self) -> AbstractContextManager[IO[bytes]]: ...


class Busy(Exception):
    """Another backup is being made or sent."""


class BackupError(ValueError):
    """An encrypted backup that can't be opened: the wrong passphrase, or a damaged or unknown file."""


@dataclass
class Backup:
    """A backup made, ready to send. `skipped`: why the collector's database isn't in it, when it was asked for."""

    path: str
    name: str
    size: int
    skipped: str | None
    done: Callable[[], None]  # deletes it and lets the next one be made; call it once it's sent


def snapshot(src: str, dest: str) -> None:
    """Copy the database at `src` to a new file `dest`: consistent while it's written to, and one file on its own (its
    journal switched from the write-ahead log back to the default, so there's no -wal file to keep with it)."""
    with closing(sqlite3.connect(f"file:{src}?mode=ro", uri=True)) as source, closing(sqlite3.connect(dest)) as copy:
        source.execute("PRAGMA busy_timeout=5000")
        source.backup(copy)
        copy.execute("PRAGMA journal_mode=DELETE")


def folder() -> str:
    """A new temporary folder for a backup, after deleting any an earlier one left behind (one stopped by a restart)."""
    for old in glob(os.path.join(tempfile.gettempdir(), f"{PREFIX}*")):
        if os.path.getmtime(old) < time.time() - STALE:
            shutil.rmtree(old, ignore_errors=True)
    return tempfile.mkdtemp(prefix=PREFIX)


def once(*steps: Callable[[], object]) -> Callable[[], None]:
    """A function that runs `steps` in order the first time it's called, and does nothing after."""
    pending = list(steps)

    def run() -> None:
        while pending:
            pending.pop(0)()

    return run


async def send(path: str, done: Callable[[], None]) -> AsyncIterator[bytes]:
    """The file in chunks, read off the event loop. `done` runs once it's all sent, or the download stops."""
    try:
        with open(path, "rb") as f:
            while chunk := await asyncio.to_thread(f.read, CHUNK):
                yield chunk
    finally:
        done()


class Backups:
    def __init__(self, db_path: str, collector: Copies | None):
        self.db_path = db_path
        self.collector = collector
        self._lock = threading.Lock()

    def make(self, everything: bool, passphrase: str) -> Backup:
        """A backup of the dashboard's database, and with `everything` the collector's too if it can be had, encrypted
        with `passphrase`. Raises Busy while another is being made or sent, sqlite3.Error or OSError (e.g. the disk is
        full) if it can't be."""
        if not self._lock.acquire(blocking=False):
            raise Busy
        done = once(self._lock.release)
        try:
            where = folder()
            done = once(lambda: shutil.rmtree(where, ignore_errors=True), self._lock.release)
            now = datetime.now()
            mine = os.path.join(where, DASHBOARD)
            snapshot(self.db_path, mine)
            plain = os.path.join(where, "backup.zip")
            skipped = self._zip(plain, mine, everything, now)
            os.remove(mine)
            path = os.path.join(where, "backup.zip.enc")
            encrypt(plain, path, passphrase)
            os.remove(plain)
            name = f"wattsmypower-backup-{VERSION}-{now:%Y-%m-%d}.zip.enc"
            return Backup(path, name, os.path.getsize(path), skipped, done)
        except BaseException:
            done()
            raise

    def _zip(self, path: str, mine: str, everything: bool, now: datetime) -> str | None:
        """Write the zip; why the collector's database isn't in it, when it was asked for and isn't."""
        if not everything:
            _write(path, mine, None, "You chose to back up the dashboard's database only.", now)
            return None
        if self.collector is None:
            skipped = "The demo has no collector. Its readings are made up."
            _write(path, mine, None, skipped, now)
            return skipped
        with ExitStack() as stack:
            try:
                source = stack.enter_context(self.collector.backup())
            except CollectorError as e:
                _write(path, mine, None, e.detail, now)
                return e.detail
            try:
                _write(path, mine, source, None, now)
                return None
            except CollectorError as e:  # it stopped part way: the zip is made again, without it
                _write(path, mine, None, e.detail, now)
                return e.detail


def _keys(passphrase: str, salt: bytes) -> tuple[bytes, bytes]:
    """The cipher's key and the HMAC's key, both from the passphrase and its salt."""
    keys = hashlib.scrypt(passphrase.encode(), salt=salt, dklen=64, maxmem=64 << 20, **SCRYPT)
    return keys[:32], keys[32:]


def encrypt(src: str, dest: str, passphrase: str) -> None:
    """Encrypt `src` to `dest`, in chunks: AES-256 in counter mode, then an HMAC-SHA256 over everything before it. The
    layout is MAGIC, salt, nonce, the ciphertext, then the HMAC."""
    if len(passphrase) < MIN_PASSPHRASE:
        raise BackupError(f"The passphrase needs at least {MIN_PASSPHRASE} characters.")
    salt, nonce = secrets.token_bytes(SALT), secrets.token_bytes(NONCE)
    key, mac_key = _keys(passphrase, salt)
    header = MAGIC + salt + nonce
    mac = HMAC.new(mac_key, digestmod=SHA256)
    mac.update(header)
    cipher = AES.new(key, AES.MODE_CTR, nonce=nonce)
    with open(src, "rb") as source, open(dest, "wb") as out:
        out.write(header)
        while chunk := source.read(CHUNK):
            part = cipher.encrypt(chunk)
            mac.update(part)
            out.write(part)
        out.write(mac.digest())


def decrypt(src: str, dest: str, passphrase: str) -> None:
    """Decrypt a backup made by `encrypt` to `dest`. The HMAC is checked before anything is written, so a wrong
    passphrase or a damaged file raises BackupError and leaves no output."""
    size = os.path.getsize(src)
    header_len = len(MAGIC) + SALT + NONCE
    if size < header_len + MAC:
        raise BackupError("That isn't a WattsMyPower backup.")
    with open(src, "rb") as f:
        header = f.read(header_len)
    if not header.startswith(MAGIC):
        raise BackupError("That isn't a WattsMyPower backup.")
    salt, nonce = header[len(MAGIC) : len(MAGIC) + SALT], header[len(MAGIC) + SALT :]
    key, mac_key = _keys(passphrase, salt)
    mac = HMAC.new(mac_key, digestmod=SHA256)
    with open(src, "rb") as f:
        f.seek(0)
        remaining = size - MAC
        while remaining > 0:
            chunk = f.read(min(CHUNK, remaining))
            mac.update(chunk)
            remaining -= len(chunk)
        tag = f.read(MAC)
    if not hmac.compare_digest(mac.digest(), tag):
        raise BackupError("The passphrase is wrong, or the backup is damaged.")
    cipher = AES.new(key, AES.MODE_CTR, nonce=nonce)
    with open(src, "rb") as source, open(dest, "wb") as out:
        source.seek(header_len)
        remaining = size - MAC - header_len
        while remaining > 0:
            chunk = source.read(min(CHUNK, remaining))
            out.write(cipher.decrypt(chunk))
            remaining -= len(chunk)


def _write(path: str, mine: str, collector: IO[bytes] | None, skipped: str | None, now: datetime) -> None:
    # The quickest compression: databases of readings shrink a lot even so, and a large one is done much sooner.
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
        zf.write(mine, DASHBOARD)
        if collector is not None:
            with zf.open(COLLECTOR, "w", force_zip64=True) as entry:
                _copy(collector, entry)
        zf.writestr("README.txt", readme(now, collector is not None, skipped))


def _copy(source: IO[bytes], dest: IO[bytes]) -> None:
    """The collector's database, as it arrives. Raises CollectorError if it stops part way, or isn't a database."""
    first = True
    while True:
        try:
            chunk = source.read(CHUNK)
        except (OSError, http.client.HTTPException) as e:  # cut off: fewer bytes than it said it'd send
            raise CollectorError(502, f"The collector's copy was cut off part way ({type(e).__name__}).") from e
        if not chunk:
            break
        if first and not chunk.startswith(SQLITE):
            raise CollectorError(502, "The collector sent something that isn't a database.")
        first = False
        dest.write(chunk)
    if first:
        raise CollectorError(502, "The collector sent an empty copy of its database.")


def readme(now: datetime, collector: bool, skipped: str | None) -> str:
    """README.txt: what's in the backup, that it's private, and how to put it back."""
    files = f"  {DASHBOARD}  the dashboard's readings, bills, settings and connected services\n"
    if collector:
        files += f"  {COLLECTOR}     what the collector reads from your inverters, and which inverters it reads\n"
    elif skipped:
        files += f"\nThe collector's database isn't in it. {skipped}\n"
    copy = "both files" if collector else DASHBOARD
    ones = "the ones" if collector else "the one"
    return f"""WattsMyPower backup
Made {now.day} {now:%B %Y at %H:%M} by WattsMyPower {VERSION}.

In this backup:
{files}
KEEP IT PRIVATE. It holds the passwords, keys and tokens saved in the dashboard (for example Tapo and EcoFlow
passwords, Amber, Tessie and Home Assistant tokens, and the Tesla key). The passphrase you chose opens it: without
it the backup can't be opened, so keep a copy of the passphrase somewhere safe.

To restore it, in the folder WattsMyPower is installed in (where docker-compose.yml is):
  1. Stop WattsMyPower:  docker compose stop
  2. Copy {copy} into the data/ folder, replacing {ones} there.
  3. Delete any files in data/ ending in -wal or -shm (for example wattsmypower.db-wal). They belong to the
     database files you've just replaced.
  4. Start it again:  docker compose start

Restore it to this version of WattsMyPower or a newer one. An older version may not be able to read it.
"""


def main(argv: list[str]) -> int:
    """`python -m app.features.storage.backup decrypt BACKUP OUT`: open an encrypted backup. Asks for the passphrase."""
    if len(argv) != 3 or argv[0] != "decrypt":
        print("usage: python -m app.features.storage.backup decrypt BACKUP.zip.enc OUT.zip", file=sys.stderr)
        return 2
    try:
        decrypt(argv[1], argv[2], getpass.getpass("Passphrase: "))
    except (BackupError, OSError) as e:
        print(e, file=sys.stderr)
        return 1
    print(f"Decrypted to {argv[2]}. Unzip it, then follow the README inside.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
