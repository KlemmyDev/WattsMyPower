"""
Simple settings people can change from the dashboard: forecast location (and its place
name) and system cost. Tariffs are structured, so they live in tariffs.py.

Environment variables provide the defaults; anything saved from the Settings
page is stored in the `settings` table and wins over the environment.
"""

from __future__ import annotations

import threading
from contextlib import closing

from . import config, db

# key -> (min, max, default)
EDITABLE: dict[str, tuple[float, float, float]] = {
    "latitude": (-90, 90, config.LATITUDE),
    "longitude": (-180, 180, config.LONGITUDE),
    # What the solar and battery system cost (AUD), for the payback estimate. 0 = not entered.
    "system_cost": (0, 1_000_000, 0),
}

# Text settings: key -> max length. Stored in the kv table (the numeric settings table holds REALs).
TEXT: dict[str, int] = {"location_name": 120}

_lock = threading.Lock()
_values: dict[str, float] = {}
_text: dict[str, str] = {}


def load() -> None:
    with closing(db.connect()) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        conn.commit()
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        text = conn.execute(f"SELECT key, value FROM kv WHERE key IN ({','.join('?' * len(TEXT))})", list(TEXT)).fetchall()
    with _lock:
        _values.clear()
        _values.update({k: v for k, v in rows if k in EDITABLE})
        _text.clear()
        _text.update(text)


def get(key: str) -> float:
    with _lock:
        return _values.get(key, EDITABLE[key][2])


def get_text(key: str) -> str | None:
    with _lock:
        return _text.get(key)


def all_values() -> dict:
    return {**{k: get(k) for k in EDITABLE}, **{k: get_text(k) for k in TEXT}}


def save(changes: dict) -> dict[str, float]:
    """Validate and store. Raises ValueError naming the first bad field."""
    clean: dict[str, float] = {}
    text: dict[str, str | None] = {}
    for key, raw in changes.items():
        if key in TEXT:
            v = str(raw or "").strip()[:TEXT[key]]
            text[key] = v or None
            continue
        if key not in EDITABLE:
            raise ValueError(f"Unknown setting: {key}")
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"{key} must be a number") from None
        lo, hi, _ = EDITABLE[key]
        if not lo <= value <= hi:
            raise ValueError(f"{key} must be between {lo:g} and {hi:g}")
        clean[key] = round(value, 6)
    with closing(db.connect()) as conn:
        conn.executemany("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", clean.items())
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        for k, v in text.items():
            if v is None:
                conn.execute("DELETE FROM kv WHERE key = ?", (k,))
            else:
                conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (k, v))
        conn.commit()
    with _lock:
        _values.update(clean)
        for k, v in text.items():
            if v is None:
                _text.pop(k, None)
            else:
                _text[k] = v
    return all_values()
