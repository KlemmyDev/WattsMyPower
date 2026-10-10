"""Manage → Data: both databases measured table by table, described, and how fast they grow; and a backup to download."""

from __future__ import annotations

import errno
import http.client
import io
import re
import socket
import sqlite3
import tempfile
import threading
import time
import urllib.parse
import zipfile
from collections.abc import Iterator
from contextlib import closing, contextmanager
from dataclasses import replace
from pathlib import Path
from typing import IO, Any

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.live.client import CollectorClient, CollectorError
from app.features.storage.service import StorageService
from app.main import create_app
from collector.config import Config as CollectorConfig
from collector.main import create_app as create_collector
from collector.store import Store

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


# -- backups ------------------------------------------------------------------------------------------


class CopyingCollector:
    """A collector that sends a copy of its database: `data`, or an error before it starts, or one part way."""

    def __init__(self, data: bytes = b"", refuse: CollectorError | None = None, cut_after: int | None = None):
        self.data, self.refuse, self.cut_after = data, refuse, cut_after

    def storage(self) -> dict[str, Any]:
        raise CollectorError(502, "Not measured here.")

    @contextmanager
    def backup(self) -> Iterator[IO[bytes]]:
        if self.refuse:
            raise self.refuse
        source = io.BytesIO(self.data)
        if self.cut_after is not None:
            cut, read = self.cut_after, source.read

            def cut_off(n: int | None = -1) -> bytes:
                if source.tell() >= cut:
                    raise http.client.IncompleteRead(b"")
                return read(n)

            source.read = cut_off  # type: ignore[method-assign]
        yield source


def collector_db(path: Path, polls: int) -> bytes:
    """A collector database with `polls` rows of readings, as its file."""
    store = Store(str(path))
    store.migrate()
    store.write_polls([(ts, [("hybrid", "sungrow.sh_rs", {5008: ts}, {})]) for ts in range(polls)])
    with store.writing() as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return path.read_bytes()


def unzip(body: bytes, into: Path) -> dict[str, Path]:
    into.mkdir()
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        assert zf.testzip() is None
        zf.extractall(into)
        return {n: into / n for n in zf.namelist()}


def rows(path: Path, table: str) -> int:
    with closing(sqlite3.connect(path)) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        n: int = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        return n


@pytest.fixture
def temp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Where backups are made, to see they're cleaned up."""
    where = tmp_path / "tmp"
    where.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(where))
    return where


def test_a_backup_is_a_zip_of_the_dashboard_database(
    client: TestClient, db: Database, temp: Path, tmp_path: Path
) -> None:
    now = int(time.time())
    add_samples(db, now - DAY, now)  # still in the write-ahead log: the copy has them all the same
    r = client.get("/api/storage/backup")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert r.headers["cache-control"] == "no-store" and "x-backup-skipped" not in r.headers
    assert re.fullmatch(
        r'attachment; filename="wattsmypower-backup-[\d.]+-\d{4}-\d{2}-\d{2}\.zip"', r.headers["content-disposition"]
    )
    files = unzip(r.content, tmp_path / "out")
    assert set(files) == {"wattsmypower.db", "README.txt"}
    assert rows(files["wattsmypower.db"], "samples") == 1440 and rows(files["wattsmypower.db"], "samples_5m") == 288
    with closing(sqlite3.connect(files["wattsmypower.db"])) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"  # one file, no -wal to go with it
    readme = files["README.txt"].read_text()
    assert "KEEP IT PRIVATE" in readme and "docker compose stop" in readme and "-wal or -shm" in readme
    assert "You chose the dashboard's only" in readme
    assert list(temp.iterdir()) == []  # deleted once it's sent


def test_everything_includes_the_collectors_database(client: TestClient, temp: Path, tmp_path: Path) -> None:
    collector = CopyingCollector(collector_db(tmp_path / "c.db", 50))
    client.app.state.services.storage.backups.collector = collector  # type: ignore[attr-defined]
    r = client.get("/api/storage/backup?everything=true")
    assert r.status_code == 200 and "x-backup-skipped" not in r.headers
    files = unzip(r.content, tmp_path / "out")
    assert set(files) == {"wattsmypower.db", "collector.db", "README.txt"}
    assert rows(files["collector.db"], "readings") == 50
    assert "collector.db" in files["README.txt"].read_text()
    assert list(temp.iterdir()) == []


@pytest.mark.parametrize(
    ("collector", "why"),
    [
        (CopyingCollector(refuse=CollectorError(502, "The collector couldn't be reached (URLError).")), "reached"),
        (CopyingCollector(b"SQLite format 3\x00" + bytes(3 << 20), cut_after=1 << 20), "cut off part way"),
        (CopyingCollector(b"<html>Not a database</html>"), "isn't a database"),
    ],
)
def test_without_the_collectors_database_the_backup_says_why(
    client: TestClient, temp: Path, tmp_path: Path, collector: CopyingCollector, why: str
) -> None:
    client.app.state.services.storage.backups.collector = collector  # type: ignore[attr-defined]
    r = client.get("/api/storage/backup?everything=true")
    assert r.status_code == 200 and why in urllib.parse.unquote(r.headers["x-backup-skipped"])
    files = unzip(r.content, tmp_path / "out")
    assert set(files) == {"wattsmypower.db", "README.txt"}
    assert why in files["README.txt"].read_text() and rows(files["wattsmypower.db"], "samples") == 0
    assert list(temp.iterdir()) == []


def test_the_demo_has_no_collector_to_back_up(client: TestClient, temp: Path) -> None:
    r = client.get("/api/storage/backup?everything=true")
    assert r.status_code == 200 and "demo" in urllib.parse.unquote(r.headers["x-backup-skipped"])


def test_one_backup_at_a_time(client: TestClient, temp: Path) -> None:
    backups = client.app.state.services.storage.backups  # type: ignore[attr-defined]
    made = backups.make(False)
    r = client.get("/api/storage/backup")
    assert r.status_code == 409 and "already being made" in r.json()["detail"]
    made.done()
    assert list(temp.iterdir()) == [] and client.get("/api/storage/backup").status_code == 200


def test_a_backup_that_cant_be_written_cleans_up(
    client: TestClient, temp: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def full(*_: Any) -> None:
        raise OSError(errno.ENOSPC, "No space left on device")

    with monkeypatch.context() as m:
        m.setattr("app.features.storage.backup._write", full)
        r = client.get("/api/storage/backup")
        assert r.status_code == 507 and "No space left" in r.json()["detail"]
    assert list(temp.iterdir()) == []
    assert client.get("/api/storage/backup").status_code == 200  # and the next one can be made


def test_a_backup_needs_signing_in(config: Config) -> None:
    with TestClient(create_app(replace(config, auth=True), poll=False, serve_dashboard=False)) as c:
        r = c.get("/api/storage/backup?everything=true")
        assert r.status_code == 401 and "content-disposition" not in r.headers


def test_a_backup_from_the_real_collector(config: Config, db: Database, tmp_path: Path, temp: Path) -> None:
    """End to end: the collector's GET /v1/backup over HTTP, read by the dashboard's CollectorClient."""
    collector_cfg = CollectorConfig(db_path=str(tmp_path / "collector.db"), token="secret")
    store = Store(collector_cfg.db_path)
    store.migrate()
    store.write_polls([(ts, [("hybrid", "sungrow.sh_rs", {5008: ts}, {})]) for ts in range(0, 600_000, 60)])
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    url = f"http://127.0.0.1:{sock.getsockname()[1]}"
    server = uvicorn.Server(uvicorn.Config(create_collector(collector_cfg, poll=False), ws="none", log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        while not server.started:
            time.sleep(0.01)
        made = StorageService(config, db, CollectorClient(url, "secret")).backups.make(True)
        assert made.skipped is None
        files = unzip(Path(made.path).read_bytes(), tmp_path / "out")
        made.done()
        assert rows(files["collector.db"], "readings") == 10_000 and rows(files["wattsmypower.db"], "samples") == 0

        wrong = StorageService(config, db, CollectorClient(url, "wrong")).backups.make(True)
        assert wrong.skipped is not None and "COLLECTOR_TOKEN" in wrong.skipped
        wrong.done()
    finally:
        server.should_exit = True
        thread.join(5)
    gone = StorageService(config, db, CollectorClient(url, "secret")).backups.make(True)
    assert gone.skipped is not None and "couldn't be reached" in gone.skipped
    gone.done()
    assert list(temp.iterdir()) == []
