"""
API keys for other apps on the home network (the Home Hub family dashboard, for one).

A key lets an app READ what the household chose when making it, through /api/v1, and nothing else: it can't change a
rate, a setting or the inverter. What a key may read is chosen per key, from SCOPES. The whole key (`wmp_...`) is shown
once, when it's made; only a SHA-256 hash is kept, with the key's first characters to tell keys apart, its name, and
when it was last used. Removing a key stops it at once.

Everything here blocks on SQLite, so call it through asyncio.to_thread from async code.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass

from app.core.database import Database

PREFIX = "wmp_"
MAX_KEYS = 20
MAX_NAME = 40
# Don't write down that a key was used more often than this (seconds): a widget asks every few seconds.
USED_EVERY = 60

# What a key may read, in the order they're shown: id -> (name, what it covers). Every one is read-only.
SCOPES: dict[str, tuple[str, str]] = {
    "live:read": ("Live power", "Solar, battery, home and grid power right now, and today's totals so far."),
    "history:read": (
        "History",
        "Every reading and each day's totals, back as far as they're kept, and the CSV download.",
    ),
    "costs:read": (
        "Costs and savings",
        "What each day cost and saved, the electricity rates, the bills and the payback.",
    ),
    "forecast:read": ("Forecast", "The next day's solar and battery forecast."),
    "insights:read": (
        "Insights",
        "Self-sufficiency, battery health, when grid power is used and how the panels perform.",
    ),
    "system:read": (
        "System details",
        "The system's size and inverter, the saved location and street, and how much the database holds.",
    ),
}
# What a new key is given unless changed: everything but the system details, which include where the house is.
DEFAULT_SCOPES = ("live:read", "history:read", "costs:read", "forecast:read", "insights:read")


@dataclass(frozen=True)
class ApiKey:
    id: str
    name: str
    prefix: str
    scopes: tuple[str, ...]
    created_at: int
    last_used: int | None

    def public(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "prefix": self.prefix,
            "scopes": list(self.scopes),
            "created_at": self.created_at,
            "last_used": self.last_used,
        }


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _row(r: tuple[str, str, str, str, int, int | None]) -> ApiKey:
    return ApiKey(r[0], r[1], r[2], tuple(s for s in r[3].split(",") if s), r[4], r[5])


_COLUMNS = "id, name, prefix, scopes, created_at, last_used"


class ApiKeyService:
    def __init__(self, db: Database):
        self.db = db
        self._lock = threading.Lock()
        self._noted: dict[str, float] = {}  # key id -> when its use was last written down

    def make(self, name: str, scopes: list[str] | None = None) -> tuple[ApiKey, str]:
        """Make a key. Returns it and the whole key, which is never available again. ValueError says what's wrong."""
        name = " ".join((name or "").split())
        if not name or len(name) > MAX_NAME:
            raise ValueError(f"Give the key a name (up to {MAX_NAME} letters), like Home Hub.")
        chosen = list(dict.fromkeys(DEFAULT_SCOPES if scopes is None else scopes))
        if not chosen:
            raise ValueError("Choose at least one thing the key may read.")
        if any(s not in SCOPES for s in chosen):
            raise ValueError("That permission isn't one we know.")
        key = PREFIX + secrets.token_urlsafe(32)
        made = ApiKey(secrets.token_hex(6), name, key[: len(PREFIX) + 4], tuple(chosen), int(time.time()), None)
        with self._lock, self.db.writing() as conn:
            if conn.execute("SELECT COUNT(*) FROM api_keys").fetchone()[0] >= MAX_KEYS:
                raise ValueError("That's a lot of keys. Remove some you don't use first.")
            conn.execute(
                "INSERT INTO api_keys (id, name, prefix, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (made.id, made.name, made.prefix, _hash(key), ",".join(made.scopes), made.created_at),
            )
        return made, key

    def all(self) -> list[ApiKey]:
        with self.db.reading() as conn:
            rows = conn.execute(f"SELECT {_COLUMNS} FROM api_keys ORDER BY created_at DESC, id").fetchall()
        return [_row(r) for r in rows]

    def remove(self, key_id: str) -> bool:
        with self._lock, self.db.writing() as conn:
            gone = conn.execute("DELETE FROM api_keys WHERE id = ?", (key_id,)).rowcount
        self._noted.pop(key_id, None)
        return gone > 0

    def check(self, key: str | None) -> ApiKey | None:
        """The key's details if it's a real one, else None. Notes that it was used (at most once a minute)."""
        if not key or not key.startswith(PREFIX) or len(key) > 120:
            return None
        with self.db.reading() as conn:
            row = conn.execute(f"SELECT {_COLUMNS} FROM api_keys WHERE hash = ?", (_hash(key),)).fetchone()
        if not row:
            return None
        found = _row(row)
        now = time.time()
        if now - self._noted.get(found.id, 0) > USED_EVERY:
            self._noted[found.id] = now
            with self._lock, self.db.writing() as conn:
                conn.execute("UPDATE api_keys SET last_used = ? WHERE id = ?", (int(now), found.id))
            return ApiKey(found.id, found.name, found.prefix, found.scopes, found.created_at, int(now))
        return found
