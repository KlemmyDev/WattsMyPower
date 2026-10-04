"""Settings → Database: both databases measured table by table, described, and how fast they grow."""

from __future__ import annotations

import time
from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.live.client import CollectorError
from app.features.storage.service import StorageService
from app.main import create_app

DAY = 86400


class FakeCollector:
    def __init__(self, answer: dict[str, Any] | CollectorError):
        self.answer = answer
        self.calls = 0

    def storage(self) -> dict[str, Any]:
        self.calls += 1
        if isinstance(self.answer, CollectorError):
            raise self.answer
        return self.answer


def collector_measure(oldest: int, rows: int) -> dict[str, Any]:
    return {
        "path": "/data/collector.db",
        "files": {"database": 8192 * 100, "wal": 4096, "shm": 32768},
        "page_size": 4096, "pages": 200, "free_pages": 3, "schema_version": 2, "sqlite_version": "3.46.1",
        "journal_mode": "wal", "measured": True, "retention_days": 365,
        "tables": [{
            "name": "readings", "rows": rows, "data_bytes": 700_000, "index_bytes": 100_000, "payload_bytes": 650_000,
            "unused_bytes": 20_000, "pages": 196, "oldest": oldest, "newest": int(time.time()),
            "recent_rows": 7 * 2880, "parts": [], "columns": [], "indexes": [],
        }],
    }  # fmt: skip


def table(report: dict[str, Any], db: str, name: str) -> dict[str, Any]:
    found = next(d for d in report["databases"] if d["id"] == db)
    return next(t for g in found["groups"] for t in g["tables"] if t["name"] == name)


def add_samples(db: Database, start: int, end: int, step: int = 60) -> None:
    with db.writing() as conn:
        conn.executemany("INSERT INTO samples (ts, pv_power) VALUES (?, 1000)", [(t,) for t in range(start, end, step)])
        conn.executemany(
            "INSERT INTO samples_5m (ts, pv_power, import_id) VALUES (?, 1000, ?)",
            [(t, 1 if t < start + DAY else None) for t in range(start, end, 300)],
        )


def test_the_dashboard_database_is_measured_table_by_table(config: Config, db: Database) -> None:
    now = int(time.time())
    add_samples(db, now - 3 * DAY, now)
    report = StorageService(config, db, None).report()
    dash = report["databases"][0]
    assert dash["measured"] and dash["schema_version"] > 0 and dash["files"]["database"] > 0
    assert dash["total_bytes"] == sum(dash["files"].values())
    assert [g["id"] for g in dash["groups"]][:2] == ["readings", "weather"]
    raw = table(report, "dashboard", "samples")
    assert raw["label"] == "Every poll" and raw["kept"] == "90 days"
    assert raw["rows"] == 3 * 1440 and raw["oldest"] == now - 3 * DAY
    assert raw["bytes"] >= raw["data_bytes"] > 0 and raw["bytes_per_row"] > 0
    # 3 days of rows in the last week: 3 * 1440 / 7 a day, still growing (90 days aren't kept yet).
    assert raw["rows_per_day"] == round(3 * 1440 / 7, 1)
    assert raw["growing_per_day"] == raw["bytes_per_day"] > 0
    assert raw["limit_bytes"] == pytest.approx(raw["bytes_per_day"] * 90, rel=0.01)
    rollups = table(report, "dashboard", "samples_5m")
    assert {p["label"]: p["rows"] for p in rollups["parts"]} == {"Recorded": 576, "Imported from files": 288}
    assert {i["name"] for i in rollups["indexes"]} == {"samples_5m_import"}
    # No growth measured for a table filled by imports, and SQLite's own schema has no rows.
    assert table(report, "dashboard", "meter_intervals")["rows_per_day"] is None
    assert table(report, "dashboard", "sqlite_schema")["rows"] is None
    assert report["disk"]["total"] >= report["disk"]["free"] > 0


def test_saved_details_show_their_names_only(config: Config, db: Database) -> None:
    with db.writing() as conn:
        conn.execute("INSERT INTO kv (key, value) VALUES ('amber', '{\"api_key\": \"psk_secret\"}')")
    kv = table(StorageService(config, db, None).report(), "dashboard", "kv")
    assert [p["label"] for p in kv["parts"]] == ["amber"]
    assert "psk_secret" not in repr(kv)


def test_a_table_at_its_retention_has_stopped_growing(config: Config, db: Database) -> None:
    now = int(time.time())
    add_samples(db, now - 3 * DAY, now, step=600)
    raw = table(StorageService(replace(config, raw_retention_days=2), db, None).report(), "dashboard", "samples")
    assert raw["kept"] == "2 days" and raw["bytes_per_day"] > 0 and raw["growing_per_day"] == 0
    forever = table(StorageService(replace(config, raw_retention_days=0), db, None).report(), "dashboard", "samples")
    assert forever["kept"] == "Kept for good" and forever["limit_bytes"] is None and forever["growing_per_day"] > 0


def test_the_collector_database_is_described(config: Config, db: Database) -> None:
    now = int(time.time())
    service = StorageService(config, db, FakeCollector(collector_measure(now - 30 * DAY, 30 * 2880)))
    report = service.report()
    col = report["databases"][1]
    assert col["available"] and col["total_bytes"] == 8192 * 100 + 4096 + 32768 and col["free_bytes"] == 3 * 4096
    readings = table(report, "collector", "readings")
    assert readings["label"] == "Register reads" and readings["kept"] == "365 days"
    assert readings["bytes"] == 800_000 and readings["rows_per_day"] == 2880 and readings["growing_per_day"] > 0
    assert col["groups"][0]["name"] == "Raw inverter registers"


def test_a_collector_that_cant_say_is_explained(config: Config, db: Database) -> None:
    down = StorageService(
        config, db, FakeCollector(CollectorError(502, "The collector couldn't be reached (URLError)."))
    )
    assert down.report()["databases"][1] == {
        "id": "collector",
        "name": "Collector database",
        "about": "What the collector reads from your inverters, before the dashboard decodes it.",
        "available": False,
        "error": "The collector couldn't be reached (URLError).",
    }
    demo = StorageService(config, db, None).report()["databases"][1]
    assert not demo["available"] and "demo" in demo["error"]


def test_a_report_is_reused_for_a_few_minutes(config: Config, db: Database) -> None:
    collector = FakeCollector(collector_measure(int(time.time()) - DAY, 2880))
    service = StorageService(config, db, collector)
    service.report()
    service.report()
    assert collector.calls == 1
    service.report(fresh=True)
    assert collector.calls == 2


def test_an_unknown_table_still_shows(config: Config, db: Database) -> None:
    with db.writing() as conn:
        conn.execute("CREATE TABLE scratch (x)")
    report = StorageService(config, db, None).report()
    other = next(g for g in report["databases"][0]["groups"] if g["id"] == "other")
    assert [t["name"] for t in other["tables"]] == ["scratch"] and other["tables"][0]["label"] == "scratch"


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def test_the_storage_api(client: TestClient) -> None:
    body = client.get("/api/storage").json()
    assert [d["id"] for d in body["databases"]] == ["dashboard", "collector"]
    assert client.get("/api/storage?fresh=true").json()["measured_at"] >= body["measured_at"]


def test_the_storage_api_needs_signing_in(config: Config) -> None:
    with TestClient(create_app(replace(config, auth=True), poll=False, serve_dashboard=False)) as c:
        assert c.get("/api/storage").status_code == 401
