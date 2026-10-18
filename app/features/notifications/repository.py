"""Notification channels, each rule's settings and progress, the options that apply to all, and what was sent."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.database import Database
from app.features.notifications.rules import RuleState

KEEP = 300  # history rows kept
OPTIONS = "notify_options"  # kv


@dataclass
class Channel:
    kind: str
    enabled: bool
    config: dict[str, str]
    updated_at: int


@dataclass
class RuleSettings:
    enabled: bool
    values: dict[str, Any] = field(default_factory=dict)
    # Which channels this rule uses ("push", "ntfy", "webhook"); None: all of them.
    channels: list[str] | None = None


DEFAULT_OPTIONS: dict[str, Any] = {
    "quiet": {"enabled": False, "start": "22:00", "end": "07:00"},
    "daily_cap": 20,
}


class NotificationsRepository:
    def __init__(self, db: Database):
        self.db = db

    # -- channels -------------------------------------------------------------
    def channels(self) -> dict[str, Channel]:
        with self.db.reading() as conn:
            rows = conn.execute("SELECT kind, enabled, config, updated_at FROM notify_channels").fetchall()
        return {k: Channel(k, bool(on), json.loads(cfg), at) for k, on, cfg, at in rows}

    def save_channel(self, kind: str, enabled: bool, config: dict[str, str]) -> None:
        with self.db.writing() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO notify_channels (kind, enabled, config, updated_at) VALUES (?, ?, ?, ?)",
                (kind, int(enabled), json.dumps(config), int(time.time())),
            )

    def delete_channel(self, kind: str) -> bool:
        with self.db.writing() as conn:
            return conn.execute("DELETE FROM notify_channels WHERE kind = ?", (kind,)).rowcount > 0

    # -- rules ----------------------------------------------------------------
    def rules(self) -> dict[str, RuleSettings]:
        with self.db.reading() as conn:
            rows = conn.execute("SELECT rule, enabled, settings FROM notify_rules").fetchall()
        out = {}
        for rule, on, text in rows:
            saved = json.loads(text)
            out[rule] = RuleSettings(bool(on), saved.get("values") or {}, saved.get("channels"))
        return out

    def save_rule(self, rule: str, settings: RuleSettings) -> None:
        text = json.dumps({"values": settings.values, "channels": settings.channels})
        with self.db.writing() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO notify_rules (rule, enabled, settings) VALUES (?, ?, ?)",
                (rule, int(settings.enabled), text),
            )

    # -- progress -------------------------------------------------------------
    def states(self) -> dict[str, RuleState]:
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT rule, pending_since, active_since, last_fired, quiet, data FROM notify_state"
            ).fetchall()
        return {r[0]: RuleState(r[0], r[1], r[2], r[3], bool(r[4]), json.loads(r[5] or "{}")) for r in rows}

    def save_state(self, s: RuleState) -> None:
        with self.db.writing() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO notify_state (rule, pending_since, active_since, last_fired, quiet, data)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (s.rule, s.pending_since, s.active_since, s.last_fired, int(s.quiet), json.dumps(s.data)),
            )

    # -- options ---------------------------------------------------------------
    def options(self) -> dict[str, Any]:
        with self.db.reading() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", (OPTIONS,)).fetchone()
        saved = json.loads(row[0]) if row else {}
        return {**DEFAULT_OPTIONS, **saved, "quiet": {**DEFAULT_OPTIONS["quiet"], **(saved.get("quiet") or {})}}

    def save_options(self, options: dict[str, Any]) -> None:
        with self.db.writing() as conn:
            conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (OPTIONS, json.dumps(options)))

    # -- history ---------------------------------------------------------------
    def add_history(self, ts: int, rule: str | None, event: str, title: str, body: str, results: dict[str, str]) -> int:
        """Record a notification and how each channel took it ("ok", or why not); old rows are dropped."""
        with self.db.writing() as conn:
            cur = conn.execute(
                "INSERT INTO notify_history (ts, rule, event, title, body, results) VALUES (?, ?, ?, ?, ?, ?)",
                (ts, rule, event, title, body, json.dumps(results)),
            )
            conn.execute(
                "DELETE FROM notify_history WHERE id NOT IN (SELECT id FROM notify_history ORDER BY id DESC LIMIT ?)",
                (KEEP,),
            )
            return int(cur.lastrowid or 0)

    def history(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT id, ts, rule, event, title, body, results FROM notify_history ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {"id": i, "ts": ts, "rule": rule, "event": ev, "title": t, "body": b, "results": json.loads(res or "{}")}
            for i, ts, rule, ev, t, b, res in rows
        ]

    def sent_since(self, ts: int) -> int:
        """How many notifications (not tests, not ones held back) got through to at least one channel since `ts`."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT results FROM notify_history WHERE ts >= ? AND event IN ('alert', 'resolved')", (ts,)
            ).fetchall()
        return sum(1 for (res,) in rows if "ok" in json.loads(res or "{}").values())
