"""
The household account and its sessions.

Everything here blocks on SQLite (and password checks take ~50 ms on purpose), so call it
through asyncio.to_thread from async code.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.database import Database
from app.features.auth.passwords import hash_password, verify_password

log = logging.getLogger(__name__)

COOKIE = "wmp_session"
SESSION_DAYS = 30
MIN_PASSWORD = 8
# The one-time code that creating the account needs, kept next to the database (data/setup-code).
SETUP_CODE_FILE = "setup-code"
# Easy to read out and type: no 0/O or 1/I.
_CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class WrongSetupCode(Exception):
    """The set-up code given to create the account isn't the one in the logs."""


@dataclass(frozen=True)
class User:
    id: int
    username: str


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _plain_code(code: str) -> str:
    """A set-up code as typed, without the dash, spaces or lower case it might come with."""
    return "".join(c for c in (code or "").upper() if c.isalnum())


def _validate(username: str, password: str) -> str:
    username = (username or "").strip()
    if not 1 <= len(username) <= 64:
        raise ValueError("Enter a username.")
    if len(password or "") < MIN_PASSWORD:
        raise ValueError(f"Use a password of at least {MIN_PASSWORD} characters.")
    if len(password) > 256:
        raise ValueError("That password is too long.")
    return username


class LoginThrottle:
    """Brute-force protection: a few failed sign-ins per key (e.g. an address and a username), then a pause.

    In memory on purpose: it only has to slow down guessing, and a restart forgetting it is fine.
    """

    WINDOW = 15 * 60
    SWEEP = 60  # seconds between clearing out keys whose failures have all expired

    def __init__(self) -> None:
        self._failures: dict[str, list[float]] = {}
        self._swept = time.time()

    def wait(self, key: str, limit: int) -> int:
        """Seconds this key must wait before trying again (0 = go ahead), after `limit` failures in the window."""
        now = time.time()
        recent = [t for t in self._failures.get(key, []) if now - t < self.WINDOW]
        if recent:
            self._failures[key] = recent
        else:
            self._failures.pop(key, None)
        return int(self.WINDOW - (now - recent[0])) + 1 if len(recent) >= limit else 0

    def record_failure(self, key: str) -> None:
        now = time.time()
        if now - self._swept > self.SWEEP:
            self._swept = now
            self._failures = {k: ts for k, ts in self._failures.items() if now - ts[-1] < self.WINDOW}
        self._failures.setdefault(key, []).append(now)

    def clear(self, key: str) -> None:
        self._failures.pop(key, None)

    def __len__(self) -> int:
        return len(self._failures)


class AuthService:
    """Accounts, sessions and the sign-in throttle. `enabled=False` (AUTH=false) leaves the dashboard open."""

    def __init__(self, db: Database, enabled: bool):
        self.db = db
        self.enabled = enabled
        self.code_path = Path(db.path).parent / SETUP_CODE_FILE
        self._code: str | None = None  # the set-up code, in case it couldn't be saved to code_path
        self.throttle = LoginThrottle()
        # Only one account may ever be created; this stops two first-run setups racing.
        self._lock = threading.Lock()
        # Run a password check against a throwaway hash for unknown usernames, so a failed sign-in
        # takes the same time whether or not the username exists. Made up front, not on first use,
        # so even the first failed sign-in isn't slower for an unknown username.
        self._dummy_hash = hash_password(secrets.token_hex(8))

    # --- accounts

    def has_account(self) -> bool:
        with self.db.reading() as conn:
            return conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None

    def create_account(self, username: str, password: str, code: str) -> int:
        """Create the household account with the set-up code from the logs. Only allowed while there is none."""
        if self.has_account():
            raise PermissionError("An account already exists. Sign in instead.")
        username = _validate(username, password)
        expected = self._read_code()
        if expected is None:  # the file went missing: make a new one, which the logs show
            expected = self.prepare_setup_code() or ""
        if not expected or not hmac.compare_digest(_plain_code(code).encode(), _plain_code(expected).encode()):
            raise WrongSetupCode("That set-up code isn't right. Check the code in the dashboard's logs.")
        hashed = hash_password(password)
        with self._lock, self.db.writing() as conn:
            if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                raise PermissionError("An account already exists. Sign in instead.")
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                (username, hashed, int(time.time())),
            )
            assert cur.lastrowid is not None  # always set after an INSERT
        self._forget_code()
        return cur.lastrowid

    # --- the set-up code: whoever opens a new dashboard first mustn't be able to claim it without one

    def prepare_setup_code(self) -> str | None:
        """While there's no account, the code creating one needs (kept in data/setup-code, so it lasts through
        restarts), written to the logs where the person installing will look. None once there's an account."""
        if not self.enabled or self.has_account():
            self._forget_code()
            return None
        code = self._read_code()
        if code is None:
            code = "".join(secrets.choice(_CODE_LETTERS) for _ in range(8))
            code = self._code = f"{code[:4]}-{code[4:]}"
            try:
                self.code_path.parent.mkdir(parents=True, exist_ok=True)
                fd = os.open(self.code_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w") as f:
                    f.write(code + "\n")
            except OSError as e:
                log.warning("Couldn't save the set-up code to %s: %s", self.code_path, e)
        log.warning(
            "\n\n    Set-up code: %s\n\n    Open the dashboard and enter this code to create its account.\n"
            "    It's also in data/%s, and it's only needed once.\n",
            code,
            SETUP_CODE_FILE,
        )
        return code

    def _read_code(self) -> str | None:
        """The code in data/setup-code (which reset-account may have replaced), else the one made here, if any."""
        try:
            code = self.code_path.read_text().strip()
        except OSError:
            return self._code
        return code if len(_plain_code(code)) >= 8 else self._code

    def _forget_code(self) -> None:
        self._code = None
        with contextlib.suppress(OSError):
            self.code_path.unlink(missing_ok=True)

    def check_login(self, username: str, password: str) -> int | None:
        """The user id for a username and password, or None if they don't match."""
        with self.db.reading() as conn:
            row = conn.execute(
                "SELECT id, password_hash FROM users WHERE username = ?", ((username or "").strip(),)
            ).fetchone()
        if not row:
            verify_password(password or "", self._dummy_hash)
            return None
        return row[0] if verify_password(password or "", row[1]) else None

    def change_password(self, user_id: int, current: str, new: str) -> None:
        with self.db.reading() as conn:
            row = conn.execute("SELECT username, password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row or not verify_password(current or "", row[1]):
            raise PermissionError("Your current password isn't right.")
        _validate(row[0], new)
        with self.db.writing() as conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new), user_id))

    def reset(self) -> None:
        """Remove the account and every session (the dashboard then asks for a new account)."""
        with self.db.writing() as conn:
            conn.execute("DELETE FROM sessions")
            conn.execute("DELETE FROM users")

    # --- sessions

    def new_session(self, user_id: int) -> str:
        """A new session token for the cookie. Only its hash is stored."""
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.db.writing() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (_token_hash(token), user_id, now, now + SESSION_DAYS * 86400),
            )
        return token

    def session_user(self, token: str | None) -> User | None:
        """The signed-in user for a session token, or None. Extends sessions as they're used."""
        if not token:
            return None
        now = int(time.time())
        with self.db.writing() as conn:
            row = conn.execute(
                "SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id"
                " WHERE s.token_hash = ?",
                (_token_hash(token),),
            ).fetchone()
            if not row or row[2] < now:
                return None
            # Sliding expiry, written at most once a day.
            if row[2] - now < (SESSION_DAYS - 1) * 86400:
                conn.execute(
                    "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
                    (now + SESSION_DAYS * 86400, _token_hash(token)),
                )
        return User(id=row[0], username=row[1])

    def end_session(self, token: str | None, everywhere_for: int | None = None) -> None:
        """Sign out one browser (by token), or every browser of a user (`everywhere_for`)."""
        with self.db.writing() as conn:
            if everywhere_for is not None:
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (everywhere_for,))
            elif token:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
