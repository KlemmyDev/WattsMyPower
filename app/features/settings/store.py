"""
Settings people can change from the dashboard: the forecast location (and its place
name) and the billing period. Tariffs are structured, so they have their own store.

Environment variables provide the defaults; anything saved from the Settings page is
stored in the database and wins over the environment.
"""

from __future__ import annotations

import threading
from typing import Any

from app.core.config import Config
from app.core.database import Database

# Text settings: key -> max length. Stored in the kv table (the settings table holds REALs).
TEXT: dict[str, int] = {"location_name": 120}
# Settings that only take whole numbers.
WHOLE = {"bill_months", "bill_day", "bill_anchor"}


class SettingsStore:
    def __init__(self, db: Database, config: Config):
        self.db = db
        # key -> (min, max, default)
        self.editable: dict[str, tuple[float, float, float]] = {
            "latitude": (-90, 90, config.latitude),
            "longitude": (-180, 180, config.longitude),
            # The billing period: every 1, 2 or 3 months, starting on this day of the month, in step
            # with a month a bill starts in (1-12). The default is calendar quarters.
            "bill_months": (1, 3, 3),
            "bill_day": (1, 28, 1),
            "bill_anchor": (1, 12, 1),
        }
        self._lock = threading.Lock()
        self._values: dict[str, float] = {}
        self._text: dict[str, str] = {}

    def load(self) -> None:
        with self.db.reading() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
            marks = ",".join("?" * len(TEXT))
            text = conn.execute(f"SELECT key, value FROM kv WHERE key IN ({marks})", list(TEXT)).fetchall()
        with self._lock:
            self._values = {k: v for k, v in rows if k in self.editable}
            self._text = dict(text)

    def get(self, key: str) -> float:
        with self._lock:
            return self._values.get(key, self.editable[key][2])

    def get_text(self, key: str) -> str | None:
        with self._lock:
            return self._text.get(key)

    def all_values(self) -> dict[str, Any]:
        values = {k: self.get(k) for k in self.editable}
        whole = {k: int(v) for k, v in values.items() if k in WHOLE}
        return {**values, **whole, **{k: self.get_text(k) for k in TEXT}}

    def save(self, changes: dict[str, Any]) -> dict[str, Any]:
        """Validate and store. Raises ValueError naming the first bad field."""
        clean: dict[str, float] = {}
        text: dict[str, str | None] = {}
        for key, raw in changes.items():
            if key in TEXT:
                text[key] = str(raw or "").strip()[: TEXT[key]] or None
                continue
            if key not in self.editable:
                raise ValueError(f"Unknown setting: {key}")
            try:
                value = float(raw)
            except (TypeError, ValueError):
                raise ValueError(f"{key} must be a number") from None
            lo, hi, _ = self.editable[key]
            if not lo <= value <= hi:
                raise ValueError(f"{key} must be between {lo:g} and {hi:g}")
            if key in WHOLE and not value.is_integer():
                raise ValueError(f"{key} must be a whole number")
            clean[key] = round(value, 6)
        with self.db.writing() as conn:
            conn.executemany("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", clean.items())
            for k, t in text.items():
                if t is None:
                    conn.execute("DELETE FROM kv WHERE key = ?", (k,))
                else:
                    conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (k, t))
        with self._lock:
            self._values.update(clean)
            for k, t in text.items():
                if t is None:
                    self._text.pop(k, None)
                else:
                    self._text[k] = t
        return self.all_values()
