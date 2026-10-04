"""
The first-run guide (/welcome): whether it's finished or put off, and which steps were done or skipped.

Stored as JSON in the kv table. An install that was already set up before the guide existed (an
inverter connected, readings recorded, or rates, location or billing period saved) is marked finished
the first time it's asked, so upgrading never shows it. Only what a person enters counts, never what
the app writes by itself at startup, or a new install would skip the guide. That's decided once and stored: connecting the inverter
part-way through the guide doesn't end it.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.core.schema import SAMPLE_TABLES
from app.features.integrations.service import IntegrationsService

KEY = "onboarding"
STEPS = ("inverter", "system", "plan", "location", "billing")
MARKS = ("done", "skipped")
# Settings rows only a person saving from the dashboard writes: the forecast location, the billing
# period, and older versions' flat rates and system cost. Not any row: values copied in automatically
# at startup (such as system details seeded from the environment) are there on a new install too.
# Nor kv's location_name, which startup looks up for the default location.
ENTERED = (
    "latitude", "longitude", "bill_months", "bill_day", "bill_anchor",
    "import_rate", "feed_in_rate", "supply_charge", "system_cost",
)  # fmt: skip


class OnboardingService:
    def __init__(self, config: Config, db: Database, integrations: IntegrationsService):
        self.config = config
        self.db = db
        self.integrations = integrations
        self._lock = threading.Lock()

    def _load(self) -> dict[str, Any] | None:
        with self.db.reading() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", (KEY,)).fetchone()
        return json.loads(row[0]) if row else None

    def _store(self, state: dict[str, Any]) -> None:
        with self.db.writing() as conn:
            conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (KEY, json.dumps(state)))

    def already_set_up(self) -> bool | None:
        """Whether this install was in use before the guide was first asked about. None: can't tell yet
        (no sign of use here, and the collector couldn't be asked whether an inverter is connected)."""
        if self.config.mock:  # the demo makes up its readings: there's nothing to set up
            return True
        with self.db.reading() as conn:
            if any(conn.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone() for t in SAMPLE_TABLES):
                return True
            marks = ",".join("?" * len(ENTERED))
            if conn.execute(f"SELECT 1 FROM settings WHERE key IN ({marks}) LIMIT 1", ENTERED).fetchone():
                return True
            if conn.execute("SELECT 1 FROM kv WHERE key = 'tariff'").fetchone():
                return True
        return self.integrations.has_hybrid()

    def _current(self) -> tuple[dict[str, Any], bool]:
        """The stored state, deciding it first if it's never been asked. Returns it and whether it's stored."""
        state = self._load()
        if state is not None:
            return state, True
        set_up = self.already_set_up()
        state = {"complete": bool(set_up), "dismissed": False, "steps": {}}
        if set_up:
            state["existing"] = True
        if set_up is None:  # ask again next time, rather than settle it while the collector is down
            return state, False
        self._store(state)
        return state, True

    @staticmethod
    def _view(state: dict[str, Any]) -> dict[str, Any]:
        complete, dismissed = bool(state.get("complete")), bool(state.get("dismissed"))
        return {
            "complete": complete,
            "dismissed": dismissed,
            # Send signed-in visits to the guide.
            "show": not complete and not dismissed,
            "steps": {k: v for k, v in (state.get("steps") or {}).items() if k in STEPS},
        }

    def state(self) -> dict[str, Any]:
        with self._lock:
            return self._view(self._current()[0])

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        """Mark steps ({"steps": {"plan": "done"}}), finish ({"complete": true}) or put it off
        ({"dismissed": true}). Raises ValueError naming the first bad value."""
        steps = changes.get("steps") or {}
        if not isinstance(steps, dict):
            raise ValueError("steps must be an object.")
        for step, mark in steps.items():
            if step not in STEPS:
                raise ValueError(f"No step {step!r}.")
            if mark not in MARKS and mark is not None:
                raise ValueError(f"Mark a step {' or '.join(MARKS)}.")
        for flag in ("complete", "dismissed"):
            if flag in changes and not isinstance(changes[flag], bool):
                raise ValueError(f"{flag} must be true or false.")
        with self._lock:
            state, _ = self._current()
            marked = {**(state.get("steps") or {}), **steps}
            state = {
                **state,
                "steps": {k: v for k, v in marked.items() if v is not None},
                **{f: changes[f] for f in ("complete", "dismissed") if f in changes},
                "updated_at": int(time.time()),
            }
            self._store(state)
            return self._view(state)
