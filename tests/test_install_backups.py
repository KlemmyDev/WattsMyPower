"""install.sh's backups before an update: which are kept (its Python, run here against a folder of made-up backups)."""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _backup_script(data: Path) -> str:
    """install.sh's backup script (BACKUP_PY), pointed at `data` rather than the container's /data."""
    script = (ROOT / "install.sh").read_text()
    start = script.index("BACKUP_PY=\"$(cat <<'PY'\n") + len("BACKUP_PY=\"$(cat <<'PY'\n")
    return script[start : script.index("\nPY\n", start)].replace("/data", str(data))


def test_backups_keep_the_newest_and_the_last_of_each_version_and_channel(tmp_path: Path) -> None:
    data = tmp_path / "data"
    backups = data / "backups"
    backups.mkdir(parents=True)
    with sqlite3.connect(data / "wattsmypower.db") as db:
        db.execute("CREATE TABLE t (x)")
        db.execute("INSERT INTO t VALUES ('now')")
    db.close()
    made = [
        "20260901-010000",  # from before versions were in the name
        "20260902-010000",
        "20260903-010000-2026.9.3-stable",
        "20260904-010000-2026.9.3-stable",  # the last on stable before trying beta
        "20260906-010000-2026.9.6-beta",
        "20260907-010000-2026.9.7-beta",
        "20260908-010000-2026.9.8-beta",
        "20260909-010000-2026.9.9-beta",
        "20260910-010000-2026.9.9-beta",
        "20260911-010000-2026.9.9-beta",
        "20260912-010000-2026.9.9-beta",
        "20260913-010000-2026.9.9-beta",
    ]
    for when in made:
        (backups / f"wattsmypower-{when}.db").touch()
    (backups / "wattsmypower-20260903-010000-2026.9.3-stable.db-wal").touch()  # copied with its log
    (backups / "collector-20260101-000000.db").touch()  # the other database's: not this one's to tidy

    keep = "20260901-010000"  # the one --rollback would put back
    done = subprocess.run(
        [sys.executable, "-", "20261010-120000", "2026.10.9-beta", keep],
        input=_backup_script(data),
        capture_output=True,
        text=True,
    )
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "data/backups/wattsmypower-20261010-120000-2026.10.9-beta.db"
    with sqlite3.connect(backups / "wattsmypower-20261010-120000-2026.10.9-beta.db") as db:
        assert db.execute("SELECT x FROM t").fetchall() == [("now",)]
    db.close()

    assert sorted(p.name for p in backups.iterdir()) == [
        "collector-20260101-000000.db",
        "wattsmypower-20260901-010000.db",  # kept for --rollback
        "wattsmypower-20260902-010000.db",  # the newest from before versions were named
        "wattsmypower-20260904-010000-2026.9.3-stable.db",  # the newest on stable
        # the newest from each of the last 5 versions: 2026.10.9 and 2026.9.9 (below), 2026.9.8, 2026.9.7, 2026.9.6
        "wattsmypower-20260906-010000-2026.9.6-beta.db",
        "wattsmypower-20260907-010000-2026.9.7-beta.db",
        "wattsmypower-20260908-010000-2026.9.8-beta.db",
        # the newest 5
        "wattsmypower-20260910-010000-2026.9.9-beta.db",
        "wattsmypower-20260911-010000-2026.9.9-beta.db",
        "wattsmypower-20260912-010000-2026.9.9-beta.db",
        "wattsmypower-20260913-010000-2026.9.9-beta.db",
        "wattsmypower-20261010-120000-2026.10.9-beta.db",
    ]


@pytest.mark.skipif(not shutil.which("bash"), reason="needs bash")
def test_install_script_options() -> None:
    """--help lists going back, updating without a backup, and uninstalling; an unknown option is refused."""
    shown = subprocess.run(["bash", str(ROOT / "install.sh"), "--help"], capture_output=True, text=True, check=True)
    for option in ("--rollback", "--no-backup", "--uninstall"):
        assert option in shown.stdout
    refused = subprocess.run(["bash", str(ROOT / "install.sh"), "--nope"], capture_output=True, text=True)
    assert refused.returncode == 2 and "Unknown option" in refused.stderr
