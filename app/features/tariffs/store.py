"""The saved tariff: loaded once, kept in memory, and replaced when rates are saved."""

from __future__ import annotations

import copy
import json
import threading

from app.core.config import Config
from app.core.database import Database
from app.features.tariffs.model import RateTables, Tariff, rate_tables, validate


class TariffStore:
    def __init__(self, db: Database, config: Config):
        self.db = db
        self.config = config
        self._lock = threading.Lock()
        self._tariff: Tariff | None = None
        self._tables: RateTables | None = None

    def load(self) -> None:
        with self.db.writing() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = 'tariff'").fetchone()
            legacy: dict[str, float] = {}
            if row is None:  # first run, or upgrading from the flat-rate settings fields
                legacy = dict(
                    conn.execute(
                        "SELECT key, value FROM settings WHERE key IN ('import_rate', 'feed_in_rate', 'supply_charge')"
                    ).fetchall()
                )
        if row is not None:
            t = json.loads(row[0])
        else:
            c = self.config
            t = {
                "type": "flat",
                "flat_rate": legacy.get("import_rate", c.import_rate),
                "feed_in_rate": legacy.get("feed_in_rate", c.feed_in_rate),
                "supply_charge": legacy.get("supply_charge", c.supply_charge),
                "bands": [],
            }
        with self._lock:
            self._tariff, self._tables = t, rate_tables(t)

    def get(self) -> Tariff:
        """A copy of the tariff in force."""
        with self._lock:
            return copy.deepcopy(self._tariff) if self._tariff else {}

    def current(self) -> tuple[Tariff, RateTables]:
        """The tariff in force and its rate tables, read together."""
        with self._lock:
            assert self._tariff is not None and self._tables is not None, "TariffStore.load() not called"
            return self._tariff, self._tables

    def save(self, raw: object) -> Tariff:
        """Validate and store. Raises ValueError with a message fit to show on the page."""
        t = validate(raw)
        tables = rate_tables(t)
        with self.db.writing() as conn:
            conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES ('tariff', ?)", (json.dumps(t),))
        with self._lock:
            self._tariff, self._tables = t, tables
        return self.get()
