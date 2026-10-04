"""
What's stored, and how much room it takes (Settings → Database): both SQLite databases, the dashboard's
and the collector's, measured table by table and described in plain words.

Measuring reads every page of both databases, so a report is kept for a few minutes; `fresh` measures again.
"""

from __future__ import annotations

import os
import shutil
import time
from typing import Any, Protocol

from app.core.cache import TTLCache
from app.core.config import Config
from app.core.database import Database
from app.features.live.client import CollectorError
from app.features.storage.catalog import COLLECTOR, DASHBOARD, GROUPS, SPECS, Table
from app.features.storage.measure import WEEK, measure

KEPT_FOR = 300  # seconds a report is reused


class Measures(Protocol):
    """The collector's measure of its own database (CollectorClient, or a fake in tests)."""

    def storage(self) -> dict[str, Any]: ...


def _days(n: int) -> str:
    return "Kept for good" if n <= 0 else f"{n} days"


class StorageService:
    def __init__(self, config: Config, db: Database, collector: Measures | None):
        self.config = config
        self.db = db
        self.collector = collector
        self._cache = TTLCache()

    def report(self, fresh: bool = False) -> dict[str, Any]:
        if fresh:
            self._cache.forget("report")
        result: dict[str, Any] = self._cache.get_or_load("report", KEPT_FOR, self._report)
        return result

    def _report(self) -> dict[str, Any]:
        now = int(time.time())
        with self.db.reading() as conn:
            mine = measure(conn, self.db.path, SPECS, now)
        databases = [
            {
                "id": "dashboard",
                "name": "Dashboard database",
                "about": "Everything the dashboard works out and keeps: readings, weather, prices, your settings.",
                "available": True,
                **_describe(mine, DASHBOARD, {"raw": self.config.raw_retention_days}, now),
            },
            self._collector(now),
        ]
        folder = os.path.dirname(os.path.abspath(self.db.path))
        disk = shutil.disk_usage(folder)
        return {
            "measured_at": now,
            "folder": folder,
            "disk": {"total": disk.total, "free": disk.free},
            "databases": databases,
        }

    def _collector(self, now: int) -> dict[str, Any]:
        head = {
            "id": "collector",
            "name": "Collector database",
            "about": "What the collector reads from your inverters, before the dashboard decodes it.",
        }
        if self.collector is None:
            return {**head, "available": False, "error": "The demo has no collector: its readings are generated."}
        try:
            found = self.collector.storage()
        except CollectorError as e:
            return {**head, "available": False, "error": e.detail}
        days = int(found.get("retention_days") or 0)
        return {**head, "available": True, **_describe(found, COLLECTOR, {"collector": days}, now)}


def _describe(m: dict[str, Any], catalog: dict[str, Table], retention: dict[str, int], now: int) -> dict[str, Any]:
    """A measured database, its tables described and grouped, with how fast each grows."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for t in m["tables"]:
        info = catalog.get(t["name"]) or Table("other", t["name"], "", "")
        groups.setdefault(info.group if info.group in GROUPS else "other", []).append(_table(t, info, retention, now))
    files = m["files"]
    tables = [t for ts in groups.values() for t in ts]
    return {
        "path": m["path"],
        "files": files,
        "total_bytes": sum(files.values()),
        "page_size": m["page_size"],
        "pages": m["pages"],
        "free_bytes": m["free_pages"] * m["page_size"],
        "schema_version": m["schema_version"],
        "sqlite_version": m["sqlite_version"],
        "journal_mode": m["journal_mode"],
        "measured": m["measured"],
        "rows": sum(t["rows"] or 0 for t in tables),
        "growth_per_day": sum(t["growing_per_day"] or 0 for t in tables),
        "groups": [
            {
                "id": g,
                "name": GROUPS[g][0],
                "about": GROUPS[g][1],
                "bytes": sum(t["bytes"] or 0 for t in ts) if m["measured"] else None,
                "rows": sum(t["rows"] or 0 for t in ts),
                "tables": sorted(ts, key=lambda t: -(t["bytes"] or 0)),
            }
            for g in GROUPS
            if (ts := groups.get(g))
        ],
    }


def _table(t: dict[str, Any], info: Table, retention: dict[str, int], now: int) -> dict[str, Any]:
    size = None if t["data_bytes"] is None else t["data_bytes"] + (t["index_bytes"] or 0)
    rows = t["rows"]
    per_row = size / rows if size and rows else None
    per_day_rows = t["recent_rows"] / (WEEK / 86400) if info.grows and t["recent_rows"] is not None else None
    per_day = per_day_rows * per_row if per_day_rows is not None and per_row is not None else None
    days = retention.get(info.retention, 0) if isinstance(info.retention, str) else info.retention or 0
    # Where it stops growing: rows past `days` old are deleted as new ones come, or only `cap` rows are kept.
    limit = days * per_day if days and per_day is not None else info.cap * per_row if info.cap and per_row else None
    full = bool(
        (days and t["oldest"] is not None and t["oldest"] <= now - (days - 1) * 86400)
        or (info.cap and rows and rows >= info.cap)
    )
    kept = info.kept.format(**{k: _days(v) for k, v in retention.items()})
    return {
        "name": t["name"],
        "label": info.label,
        "about": info.about,
        "kept": kept,
        "rows": rows,
        "bytes": size,
        "data_bytes": t["data_bytes"],
        "index_bytes": t["index_bytes"],
        "payload_bytes": t["payload_bytes"],
        "unused_bytes": t["unused_bytes"],
        "pages": t["pages"],
        "bytes_per_row": round(per_row, 1) if per_row is not None else None,
        "oldest": t["oldest"],
        "newest": t["newest"],
        "rows_per_day": round(per_day_rows, 1) if per_day_rows is not None else None,
        "bytes_per_day": round(per_day) if per_day is not None else None,
        # Still growing at that rate: it isn't yet at its limit.
        "growing_per_day": 0 if full else round(per_day) if per_day is not None else None,
        "limit_bytes": round(limit) if limit is not None else None,
        "parts": t["parts"],
        "columns": t["columns"],
        "indexes": t["indexes"],
    }
