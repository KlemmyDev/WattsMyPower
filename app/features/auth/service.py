"""
The household account and its sessions.

Everything here blocks on SQLite (and password checks take ~50 ms on purpose), so call it
through asyncio.to_thread from async code.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass

from app.core.database import Database
from app.features.auth.passwords import hash_password, verify_password

COOKIE = "wmp_session"
SESSION_DAYS = 30
MIN_PASSWORD = 8


@dataclass(frozen=True)
class User:
    id: int
    username: str


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


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
    """Brute-force protection: a few failed sign-ins per address, then a pause.

    In memory on purpose: it only has to slow down guessing, and a restart forgetting it is fine.
    """

    WINDOW, LIMIT = 15 * 60, 5

    def __init__(self) -> None:
        self._failures: dict[str, list[float]] = {}

    def wait(self, ip: str) -> int:
        """Seconds this address must wait before trying again (0 = go ahead)."""
        now = time.time()
        recent = [t for t in self._failures.get(ip, []) if now - t < self.WINDOW]
        self._failures[ip] = recent
        return int(self.WINDOW - (now - recent[0])) + 1 if len(recent) >= self.LIMIT else 0

    def record_failure(self, ip: str) -> None:
        self._failures.setdefault(ip, []).append(time.time())

    def clear(self, ip: str) -> None:
        self._failures.pop(ip, None)


class AuthService:
    """Accounts, sessions and the sign-in throttle. `enabled=False` (AUTH=false) leaves the dashboard open."""

    def __init__(self, db: Database, enabled: bool):
        self.db = db
        self.enabled = enabled
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

    def create_account(self, username: str, password: str) -> int:
        """Create the household account. Only allowed while there is none."""
        username = _validate(username, password)
        hashed = hash_password(password)
        with self._lock, self.db.writing() as conn:
            if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                raise PermissionError("An account already exists. Sign in instead.")
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                (username, hashed, int(time.time())),
            )
            assert cur.lastrowid is not None  # always set after an INSERT
            return cur.lastrowid

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
