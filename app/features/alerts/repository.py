"""Alert channels, rule settings, each rule's state, and the history of what was sent."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

from app.core.database import Database
from app.features.alerts.rules import RuleState

KEEP = 500  # history rows kept: a year or more of a few alerts a day


@dataclass
class Channel:
    kind: str
    enabled: bool
    config: dict[str, str]
    updated_at: int


@dataclass
class RuleSettings:
    enabled: bool
    settings: dict[str, Any]


_STATE = ("pending_since", "active_since", "last_fired", "delivered", "retry_at", "event_id", "data")


class AlertsRepository:
    def __init__(self, db: Database):
        self.db = db

    # -- channels -------------------------------------------------------------
    def channels(self) -> dict[str, Channel]:
        with self.db.reading() as conn:
            rows = conn.execute("SELECT kind, enabled, config, updated_at FROM alert_channels").fetchall()
        return {k: Channel(k, bool(on), json.loads(cfg), at) for k, on, cfg, at in rows}

    def save_channel(self, kind: str, enabled: bool, config: dict[str, str]) -> None:
        with self.db.writing() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO alert_channels (kind, enabled, config, updated_at) VALUES (?, ?, ?, ?)",
                (kind, int(enabled), json.dumps(config), int(time.time())),
            )

    def delete_channel(self, kind: str) -> bool:
        with self.db.writing() as conn:
            return conn.execute("DELETE FROM alert_channels WHERE kind = ?", (kind,)).rowcount > 0

    # -- rules ----------------------------------------------------------------
    def rules(self) -> dict[str, RuleSettings]:
        with self.db.reading() as conn:
            rows = conn.execute("SELECT rule, enabled, settings FROM alert_rules").fetchall()
        return {r: RuleSettings(bool(on), json.loads(s)) for r, on, s in rows}

    def save_rule(self, rule: str, enabled: bool, settings: dict[str, Any]) -> None:
        with self.db.writing() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO alert_rules (rule, enabled, settings) VALUES (?, ?, ?)",
                (rule, int(enabled), json.dumps(settings)),
            )

    # -- state ----------------------------------------------------------------
    def states(self) -> dict[str, RuleState]:
        with self.db.reading() as conn:
            rows = conn.execute(f"SELECT rule, {', '.join(_STATE)} FROM alert_state").fetchall()
        return {r[0]: RuleState(r[0], r[1], r[2], r[3], bool(r[4]), r[5], r[6], json.loads(r[7] or "{}")) for r in rows}

    def save_state(self, s: RuleState) -> None:
        with self.db.writing() as conn:
            conn.execute(
                f"INSERT OR REPLACE INTO alert_state (rule, {', '.join(_STATE)}) VALUES (?{', ?' * len(_STATE)})",
                (
                    s.rule,
                    s.pending_since,
                    s.active_since,
                    s.last_fired,
                    int(s.delivered),
                    s.retry_at,
                    s.event_id,
                    json.dumps(s.data),
                ),
            )

    def clear_state(self, rule: str | None = None) -> None:
        """Forget a rule's progress (or every rule's), e.g. when it's switched off."""
        with self.db.writing() as conn:
            if rule is None:
                conn.execute("DELETE FROM alert_state")
            else:
                conn.execute("DELETE FROM alert_state WHERE rule = ?", (rule,))

    # -- history --------------------------------------------------------------
    def add_event(
        self, ts: float, rule: str, kind: str, title: str, message: str, status: str, error: str | None
    ) -> int:
        with self.db.writing() as conn:
            cur = conn.execute(
                "INSERT INTO alert_history (ts, rule, kind, title, message, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (int(ts), rule, kind, title, message, status, error),
            )
            event_id = int(cur.lastrowid or 0)
            conn.execute("DELETE FROM alert_history WHERE id <= ?", (event_id - KEEP,))
            return event_id

    def update_event(self, event_id: int, **changes: Any) -> None:
        cols = [c for c in changes if c in ("status", "error", "resolved_at")]
        if not cols:
            return
        with self.db.writing() as conn:
            conn.execute(
                f"UPDATE alert_history SET {', '.join(f'{c} = ?' for c in cols)} WHERE id = ?",
                (*(changes[c] for c in cols), event_id),
            )

    def event(self, event_id: int) -> dict[str, Any] | None:
        with self.db.reading() as conn:
            row = conn.execute("SELECT id, title, message FROM alert_history WHERE id = ?", (event_id,)).fetchone()
        return {"id": row[0], "title": row[1], "message": row[2]} if row else None

    def history(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT id, ts, rule, kind, title, message, status, error, resolved_at FROM alert_history "
                "ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        keys = ("id", "ts", "rule", "kind", "title", "message", "status", "error", "resolved_at")
        return [dict(zip(keys, r, strict=True)) for r in rows]
