from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path

import pytest

from collector import store as store_module
from collector.store import MIGRATIONS, Row, Store


def keys(rows: list[Row]) -> list[tuple[int, str]]:
    return [(r.ts, r.device) for r in rows]


@pytest.fixture
def cfg_path(tmp_path: Path) -> str:
    return str(tmp_path / "prune.db")


@pytest.fixture
def three_polls(store: Store) -> Store:
    store.write_poll(100, [("hybrid", "sungrow.sh_rs", {5008: 1}, {}), ("pv2", "sungrow.sg_d", {5000: 2}, {})])
    store.write_poll(160, [("hybrid", "sungrow.sh_rs", {5008: 3}, {}), ("pv2", "sungrow.sg_d", {5000: 4}, {})])
    store.write_poll(220, [("hybrid", "sungrow.sh_rs", {5008: 5}, {})])
    return store


def test_rows_round_trip_as_json(store: Store) -> None:
    store.write_poll(
        100,
        [("hybrid", "sungrow.sh_rs", {13045: 432, 5008: 312}, {13059: 50}), ("pv2", "sungrow.sg_d", {5000: 294}, {})],
    )
    rows, more = store.since(0, 10)
    assert not more and keys(rows) == [(100, "hybrid"), (100, "pv2")]
    assert rows[0].input == '{"5008":312,"13045":432}'  # compact, in address order
    assert json.loads(rows[0].holding or "") == {"13059": 50}
    assert rows[1].holding is None  # no holding registers read


def test_a_poll_is_written_in_one_transaction(store: Store) -> None:
    with pytest.raises(TypeError):  # the second row can't be encoded: the first mustn't be stored either
        store.write_poll(100, [("hybrid", "sungrow.sh_rs", {1: 1}, {}), ("pv2", "sungrow.sg_d", {1: 1, "x": 2}, {})])  # type: ignore[dict-item]
    assert store.since(0, 10) == ([], False)


def test_since_returns_newer_rows_oldest_first(three_polls: Store) -> None:
    rows, more = three_polls.since(100, 10)
    assert keys(rows) == [(160, "hybrid"), (160, "pv2"), (220, "hybrid")] and not more
    assert three_polls.since(220, 10) == ([], False)


@pytest.mark.parametrize(
    ("since", "limit", "expected", "more"),
    [
        (0, 2, [100, 100], True),
        (0, 3, [100, 100], True),  # 160 would be split: stop before it
        (0, 4, [100, 100, 160, 160], True),
        (0, 5, [100, 100, 160, 160, 220], False),
        (0, 1, [100, 100], True),  # one poll bigger than the limit: sent whole
        (100, 1, [160, 160], True),
        (160, 1, [220], False),
    ],
)
def test_limit_never_splits_a_poll(three_polls: Store, since: int, limit: int, expected: list[int], more: bool) -> None:
    rows, got_more = three_polls.since(since, limit)
    assert [r.ts for r in rows] == expected and got_more is more


def test_a_whole_last_poll_bigger_than_the_limit_has_nothing_after_it(store: Store) -> None:
    store.write_poll(100, [("hybrid", "sungrow.sh_rs", {1: 1}, {}), ("pv2", "sungrow.sg_d", {1: 1}, {})])
    rows, more = store.since(0, 1)
    assert len(rows) == 2 and not more


def test_prune_drops_rows_past_retention(cfg_path: str) -> None:
    store = Store(cfg_path, retention_days=1)
    store.migrate()
    now = 1_790_850_000
    store.write_poll(now - 2 * 86400, [("hybrid", "sungrow.sh_rs", {1: 1}, {})])
    store.write_poll(now - 3600, [("hybrid", "sungrow.sh_rs", {1: 2}, {})])
    assert store.prune(now) == 1
    assert [r.ts for r in store.since(0, 10)[0]] == [now - 3600]


def test_retention_zero_keeps_everything(cfg_path: str) -> None:
    store = Store(cfg_path, retention_days=0)
    store.migrate()
    store.write_poll(1, [("hybrid", "sungrow.sh_rs", {1: 1}, {})])
    assert store.prune(1_790_850_000) == 0 and store.bounds() == (1, 1)


def test_bounds(three_polls: Store) -> None:
    assert three_polls.bounds() == (100, 220)


def test_bounds_of_an_empty_store(store: Store) -> None:
    assert store.bounds() == (None, None) and store.is_empty()


def test_migrate_is_idempotent_and_versioned(store: Store) -> None:
    assert store.migrate() == len(MIGRATIONS)
    with sqlite3.connect(store.path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)


def test_a_step_that_fails_part_way_is_undone_and_runs_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The steps' CREATE TABLEs have no IF NOT EXISTS: one left behind by a failed step would fail every start after."""
    s = Store(str(tmp_path / "half.db"))
    s.migrate()
    disk_full = True

    def _notes(conn: sqlite3.Connection) -> None:
        conn.execute("CREATE TABLE notes (ts INTEGER PRIMARY KEY)")
        if disk_full:
            raise sqlite3.OperationalError("database or disk is full")

    monkeypatch.setattr(store_module, "MIGRATIONS", [*MIGRATIONS, _notes])
    with pytest.raises(sqlite3.OperationalError, match="disk is full"):
        s.migrate()
    assert "(notes) failed and was undone" in caplog.text
    with sqlite3.connect(s.path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE name = 'notes'").fetchone() == (0,)
        assert conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
    disk_full = False
    assert s.migrate() == len(MIGRATIONS) + 1


def test_a_database_from_a_newer_version_is_used_with_a_warning(store: Store, caplog: pytest.LogCaptureFixture) -> None:
    with sqlite3.connect(store.path) as conn:
        conn.execute(f"PRAGMA user_version = {len(MIGRATIONS) + 1}")
    with caplog.at_level(logging.WARNING):
        store.migrate()
    assert "newer version of WattsMyPower" in caplog.text
    assert store.devices() == []  # and it carries on
