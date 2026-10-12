"""
The Overview's dashboards: each a name and the widgets on it, laid out once for a computer's wide grid (12 columns)
and, if it's been arranged separately, once for a phone's (4 columns). What a widget is and shows is the web app's
business (its type and settings); this keeps the layout whole and in bounds.

Stored as one JSON document in the kv table. Until one is saved there's none, and the web app shows its own default.
"""

from __future__ import annotations

import json
import re
import threading
from typing import Any

from app.core.database import Database

KEY = "dashboards"
COLS = {"computer": 12, "phone": 4}
MAX_DASHBOARDS = 12
MAX_WIDGETS = 80
MAX_ROWS = 400  # how far down a widget can start
MAX_HEIGHT = 24  # rows
NAME_MAX = 40
SETTINGS_MAX = 4000  # characters of JSON, per widget
DOC_MAX = 400_000

ID = re.compile(r"[A-Za-z0-9_-]{1,40}")
TYPE = re.compile(r"[a-z][a-z0-9-]{0,39}")


class DashboardError(ValueError):
    """What's wrong with dashboards sent to be saved, in words for the page."""


def _int(value: Any, low: int, high: int, what: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise DashboardError(f"{what} must be a whole number from {low} to {high}.")
    return value


def _widgets(items: Any, cols: int, where: str) -> list[dict[str, Any]]:
    if not isinstance(items, list) or len(items) > MAX_WIDGETS:
        raise DashboardError(f"{where} needs a list of up to {MAX_WIDGETS} widgets.")
    out, ids = [], set()
    for item in items:
        if not isinstance(item, dict):
            raise DashboardError(f"Each widget on {where} needs its details.")
        wid, kind = item.get("id"), item.get("type")
        if not isinstance(wid, str) or not ID.fullmatch(wid) or wid in ids:
            raise DashboardError(f"Each widget on {where} needs an id of its own.")
        if not isinstance(kind, str) or not TYPE.fullmatch(kind):
            raise DashboardError(f"A widget on {where} has no type it could be.")
        ids.add(wid)
        w = _int(item.get("w"), 1, cols, "A widget's width")
        x = _int(item.get("x"), 0, cols - w, "A widget's place across")
        y = _int(item.get("y"), 0, MAX_ROWS, "A widget's place down")
        h = _int(item.get("h"), 1, MAX_HEIGHT, "A widget's height")
        settings = item.get("settings", {})
        if not isinstance(settings, dict) or len(json.dumps(settings)) > SETTINGS_MAX:
            raise DashboardError("A widget's settings are too many to keep.")
        out.append({"id": wid, "type": kind, "x": x, "y": y, "w": w, "h": h, "settings": settings})
    return out


def validate(doc: Any) -> dict[str, Any]:
    """The dashboards as they'll be kept, checked: names, ids, and every widget inside its grid."""
    if not isinstance(doc, dict) or not isinstance(doc.get("dashboards"), list):
        raise DashboardError("Send the dashboards as a list.")
    boards = doc["dashboards"]
    if not 1 <= len(boards) <= MAX_DASHBOARDS:
        raise DashboardError(f"Keep from 1 to {MAX_DASHBOARDS} dashboards.")
    out, ids = [], set()
    for board in boards:
        if not isinstance(board, dict):
            raise DashboardError("Each dashboard needs its details.")
        bid, name = board.get("id"), board.get("name")
        if not isinstance(bid, str) or not ID.fullmatch(bid) or bid in ids:
            raise DashboardError("Each dashboard needs an id of its own.")
        ids.add(bid)
        name = " ".join(name.split()) if isinstance(name, str) else ""
        if not 0 < len(name) <= NAME_MAX:
            raise DashboardError(f"Give each dashboard a name of up to {NAME_MAX} characters.")
        layouts = board.get("layouts")
        if not isinstance(layouts, dict) or "computer" not in layouts:
            raise DashboardError(f"{name} needs its layout.")
        kept: dict[str, Any] = {"computer": _widgets(layouts["computer"], COLS["computer"], name)}
        # A phone without a layout of its own follows the computer's, in order.
        phone = layouts.get("phone")
        kept["phone"] = None if phone is None else _widgets(phone, COLS["phone"], f"{name} (phone)")
        out.append({"id": bid, "name": name, "layouts": kept})
    kept_doc = {"v": 1, "dashboards": out}
    if len(json.dumps(kept_doc)) > DOC_MAX:
        raise DashboardError("That's more than can be kept. Take some widgets away.")
    return kept_doc


class DashboardService:
    def __init__(self, db: Database):
        self.db = db
        self._lock = threading.Lock()

    def get(self) -> dict[str, Any]:
        """The dashboards as saved, or none ({"dashboards": null}) until they first are."""
        with self.db.reading() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", (KEY,)).fetchone()
        if row:
            try:
                return validate(json.loads(row[0]))
            except (ValueError, TypeError):  # kept by a version that laid them out differently: start afresh
                pass
        return {"v": 1, "dashboards": None}

    def save(self, doc: Any) -> dict[str, Any]:
        kept = validate(doc)
        with self._lock, self.db.writing() as conn:
            conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (KEY, json.dumps(kept)))
        return kept

    def reset(self) -> dict[str, Any]:
        """Back to the web app's default."""
        with self._lock, self.db.writing() as conn:
            conn.execute("DELETE FROM kv WHERE key = ?", (KEY,))
        return {"v": 1, "dashboards": None}
