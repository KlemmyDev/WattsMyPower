"""Checking GitHub for a newer version (app.features.updates), with GitHub's answers made up."""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import time
import urllib.error
from pathlib import Path
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.core.version import version_key
from app.features.settings.store import SettingsStore
from app.features.updates import service as updates
from app.features.updates.service import UpdateRefused, UpdateService

HERE = "a" * 40
NEWER = "b" * 40


def _github(head: str, version: str, compare: dict[str, Any] | Exception | None = None) -> dict[str, Any]:
    """Answers for a GitHub whose main branch is at `head`, with `version` in its pyproject.toml."""
    return {
        "commits": {"sha": head, "commit": {"committer": {"date": "2026-10-10T01:00:00Z"}}},
        "toml": f'[project]\nversion = "{version}"\n\n[tool.wattsmypower]\nrelease = "alpha"\n',
        "compare": compare,
    }


@pytest.fixture
def svc(config: Config, db: Database, tmp_path: Path) -> UpdateService:
    settings = SettingsStore(db, config)
    settings.load()
    return UpdateService(settings, tmp_path / "update")


def _answer(
    monkeypatch: pytest.MonkeyPatch, gh: dict[str, Any], commit: str | None, version: str = "2026.10.8"
) -> None:
    def get_json(url: str, *_: Any, **__: Any) -> Any:
        if "/compare/" in url:
            if isinstance(gh["compare"], Exception):
                raise gh["compare"]
            return gh["compare"]
        return gh["commits"]

    monkeypatch.setattr(updates, "get_json", get_json)
    monkeypatch.setattr(updates, "get_text", lambda *_, **__: gh["toml"])
    monkeypatch.setattr(updates, "COMMIT", commit)
    monkeypatch.setattr(updates, "VERSION", version)


def _not_found() -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://api.github.com", 404, "Not Found", {}, io.BytesIO())  # type: ignore[arg-type]


def test_versions_compare_by_their_numbers() -> None:
    assert version_key("2026.10.8.1") > version_key("2026.10.8")
    assert version_key("2026.10.10") > version_key("2026.10.9")
    assert version_key("2026.11.1") > version_key("2026.10.31")


def test_the_same_commit_is_up_to_date(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    _answer(monkeypatch, _github(HERE, "2026.10.8"), HERE)
    status = svc.check()
    assert status["available"] is False
    assert status["latest"]["changes"] == 0 and status["error"] is None


def test_commits_since_this_one_are_an_update(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    # A change merged without a new version is still an update: it's the commits that count.
    _answer(monkeypatch, _github(NEWER, "2026.10.8", {"ahead_by": 3}), HERE)
    status = svc.check()
    assert status["available"] is True
    assert status["latest"] == {
        "version": "2026.10.8",
        "release": "alpha",
        "commit": NEWER,
        "date": "2026-10-10T01:00:00Z",
        "changes": 3,
    }


def test_a_local_build_compares_versions(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    # GitHub doesn't know this commit (built from local changes): the version decides.
    _answer(monkeypatch, _github(NEWER, "2026.10.8.1", _not_found()), HERE)
    assert svc.check()["available"] is True
    _answer(monkeypatch, _github(NEWER, "2026.10.8", _not_found()), HERE)
    assert svc.check()["available"] is False


def test_without_a_commit_the_version_decides(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    _answer(monkeypatch, _github(NEWER, "2026.10.9"), None)
    status = svc.check()
    assert status["available"] is True and status["latest"]["changes"] is None


def test_github_out_of_reach_is_reported(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    _answer(monkeypatch, _github(NEWER, "2026.10.9"), HERE)
    monkeypatch.setattr(updates, "get_json", lambda *_, **__: (_ for _ in ()).throw(urllib.error.URLError("down")))
    status = svc.check()
    assert status["available"] is False and status["latest"] is None
    assert status["error"] == "Couldn't reach GitHub. Check this machine's internet connection."
    assert status["checked_at"] is not None


def test_checking_can_be_turned_off(svc: UpdateService) -> None:
    assert svc.enabled() is True
    svc.settings.save({"update_check": 0})
    assert svc.enabled() is False and svc.status()["enabled"] is False


# -- updating, through updater.sh --------------------------------------------------------------------


def _updater(svc: UpdateService, **note: Any) -> None:
    svc.folder.mkdir(parents=True, exist_ok=True)
    (svc.folder / "updater.json").write_text(
        json.dumps({"seen_at": time.time(), "can_update": True, "why": None} | note)
    )


def test_without_the_updater_it_says_how_to_set_it_up(svc: UpdateService) -> None:
    install = svc.installer()
    assert install["ready"] is False and install["state"] == "idle"
    assert "run bash install.sh once more" in install["why"]
    with pytest.raises(UpdateRefused):
        svc.install()


def test_an_updater_gone_quiet_isnt_ready(svc: UpdateService) -> None:
    _updater(svc, seen_at=time.time() - 600)
    assert svc.installer()["ready"] is False
    assert "hasn't checked in" in svc.installer()["why"]


def test_an_updater_that_cant_update_says_why(svc: UpdateService) -> None:
    _updater(svc, can_update=False, why="this folder has local changes, which an update would overwrite")
    assert svc.installer()["ready"] is False
    assert svc.installer()["why"] == (
        "The updater can't update: this folder has local changes, which an update would overwrite."
    )


def test_update_now_leaves_a_request_once(svc: UpdateService) -> None:
    _updater(svc)
    assert svc.installer()["ready"] is True
    assert svc.install()["install"]["state"] == "requested"
    assert (svc.folder / "request").exists()
    with pytest.raises(UpdateRefused, match="already under way"):
        svc.install()


def test_how_an_update_goes(svc: UpdateService) -> None:
    _updater(svc)
    (svc.folder / "update.log").write_text("\x1b[1mGetting the latest version\x1b[0m\n\n  Already up to date.\n")
    (svc.folder / "status.json").write_text(json.dumps({"state": "running", "started_at": time.time(), "from": "a"}))
    running = svc.installer()
    assert running["state"] == "running" and running["log"] == ["Getting the latest version", "  Already up to date."]
    (svc.folder / "status.json").write_text(json.dumps({"state": "done", "finished_at": time.time(), "to": "b"}))
    assert svc.installer()["state"] == "done" and svc.installer()["to"] == "b"
    # Long after, it's just idle again.
    (svc.folder / "status.json").write_text(json.dumps({"state": "done", "finished_at": time.time() - 3600}))
    assert svc.installer()["state"] == "idle"


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(not shutil.which("git") or not shutil.which("bash"), reason="needs git and bash")
def test_updater_script_runs_install_when_asked(tmp_path: Path) -> None:
    """updater.sh in a checkout of its own, with Docker and install.sh stood in for."""
    app = tmp_path / "app"
    app.mkdir()
    shutil.copy(ROOT / "updater.sh", app / "updater.sh")
    (app / "install.sh").write_text('echo "Building and starting"; echo "$@" > ran.txt\n')
    git = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]
    subprocess.run(["git", "init", "-q"], cwd=app, check=True)
    subprocess.run([*git, "add", "."], cwd=app, check=True)
    subprocess.run([*git, "commit", "-qm", "x"], cwd=app, check=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text("#!/bin/sh\nexit 0\n")
    (bin_dir / "docker").chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    run = lambda: subprocess.run(["bash", str(app / "updater.sh")], cwd=tmp_path, env=env, check=True)  # noqa: E731
    folder = app / "data" / "update"

    run()  # nothing asked: it only says it's there
    assert json.loads((folder / "updater.json").read_text())["can_update"] is True
    assert not (folder / "status.json").exists()

    (folder / "request").write_text("now\n")
    run()
    status = json.loads((folder / "status.json").read_text())
    assert status["state"] == "done" and status["from"] == status["to"]
    assert (app / "ran.txt").read_text().strip() == "--yes"
    assert "Building and starting" in (folder / "update.log").read_text()
    assert not (folder / "request").exists() and not (folder / ".running").exists()
