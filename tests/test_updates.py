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
        if "/tags" in url:
            return gh.get("tags", [])
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
    _answer(monkeypatch, _github(NEWER, "2026.10.8", {"ahead_by": 3, "behind_by": 0}), HERE)
    status = svc.check()
    assert status["available"] is True
    assert status["latest"] == {
        "version": "2026.10.8",
        "release": "alpha",
        "commit": NEWER,
        "tag": None,
        "date": "2026-10-10T01:00:00Z",
        "changes": 3,
        "behind": 0,
    }
    assert status["channel"] == "nightly" and status["move"] == "update"


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


def _tags(*names: str) -> list[dict[str, Any]]:
    return [{"name": name, "commit": {"sha": f"{i:x}" * 40}} for i, name in enumerate(names, start=1)]


def test_release_tags_in_order() -> None:
    tags = _tags("v2026.10.9-beta", "v2026.10.10-beta", "v2026.10.9", "latest", "v2026.10.10-beta.2", "v2026.10.8.1")
    assert updates.newest_tag(tags, "beta")["name"] == "v2026.10.10-beta.2"
    assert updates.newest_tag(tags, "stable")["name"] == "v2026.10.9"
    # The release of a version comes after its pre-releases.
    assert updates.newest_tag(_tags("v2026.10.9-rc.1", "v2026.10.9"), "beta")["name"] == "v2026.10.9"
    assert updates.newest_tag(_tags("v2026.10.9-beta", "nope"), "stable") is None


def test_stable_behind_this_one_is_older(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    # Moving from nightly to stable: its release is behind this build, so installing it goes back.
    gh = _github(NEWER, "2026.10.7", {"ahead_by": 0, "behind_by": 5}) | {"tags": _tags("v2026.10.7", "v2026.10.8-beta")}
    _answer(monkeypatch, gh, HERE)
    status = svc.set_channel("stable")
    assert (svc.folder / "channel").read_text() == "stable\n"
    assert status["channel"] == "stable" and status["latest"]["tag"] == "v2026.10.7"
    assert status["move"] == "older" and status["available"] is False
    assert status["latest"]["behind"] == 5


def test_a_channel_with_nothing_released(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    _answer(monkeypatch, _github(NEWER, "2026.10.9") | {"tags": _tags("v2026.10.8-beta")}, HERE)
    status = svc.set_channel("stable")
    assert status["unreleased"] is True and status["latest"] is None and status["move"] is None


def test_the_channel_is_saved_for_install_sh_to_read(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    """In Docker the dashboard's files are its alone (umask 077), but install.sh reads the channel as whoever runs it."""
    _answer(monkeypatch, _github(NEWER, "2026.10.9") | {"tags": _tags("v2026.10.8-beta")}, HERE)
    old = os.umask(0o077)
    try:
        svc.set_channel("beta")
    finally:
        os.umask(old)
    assert (svc.folder / "channel").stat().st_mode & 0o777 == 0o644


def test_a_check_for_another_channel_isnt_shown(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    _answer(monkeypatch, _github(NEWER, "2026.10.9", {"ahead_by": 2, "behind_by": 0}), HERE)
    assert svc.check()["available"] is True
    svc.folder.mkdir(parents=True, exist_ok=True)
    (svc.folder / "channel").write_text("beta\n")  # changed by install.sh --channel beta
    status = svc.status()
    assert status["channel"] == "beta" and status["latest"] is None and status["checked_at"] is None


def test_an_unknown_channel_is_refused(svc: UpdateService) -> None:
    with pytest.raises(ValueError):
        svc.set_channel("weekly")
    svc.folder.mkdir(parents=True, exist_ok=True)
    (svc.folder / "channel").write_text("weekly\n")
    assert svc.channel() == "nightly"


def test_without_commits_an_older_version_is_older(svc: UpdateService, monkeypatch: pytest.MonkeyPatch) -> None:
    _answer(monkeypatch, _github(NEWER, "2026.10.7"), None, version="2026.10.9")
    assert svc.check()["move"] == "older"


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


@pytest.mark.skipif(not shutil.which("git") or not shutil.which("bash"), reason="needs git and bash")
def test_install_script_follows_the_channel_both_ways(tmp_path: Path) -> None:
    """install.sh's update, up to building (cut off before Docker), in a clone of a repository with releases tagged."""
    git = ["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main"]
    origin = tmp_path / "origin"
    origin.mkdir()
    script = (ROOT / "install.sh").read_text()
    cut = script.index("# ---------------------------------------------------------------- Docker")
    (origin / "install.sh").write_text(script[:cut] + 'echo "AT $(git rev-parse HEAD)"\nexit 0\n')
    (origin / "docker-compose.yml").write_text("services: {}\n")
    (origin / "app").mkdir()
    subprocess.run([*git, "init", "-q"], cwd=origin, check=True)

    def commit(name: str, tag: str | None = None) -> str:
        (origin / "app" / "x.txt").write_text(name)
        subprocess.run([*git, "add", "."], cwd=origin, check=True)
        subprocess.run([*git, "commit", "-qm", name], cwd=origin, check=True)
        if tag:  # annotated, as scripts/release.sh makes them
            subprocess.run([*git, "tag", "-a", tag, "-m", tag], cwd=origin, check=True)
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=origin, capture_output=True, text=True).stdout.strip()

    stable = commit("one", "v2026.10.1")
    beta = commit("two", "v2026.10.2-beta")
    commit("three", "not-a-release")
    nightly = commit("four")
    app = tmp_path / "app"
    subprocess.run([*git, "clone", "-q", str(origin), str(app)], check=True)

    def install(*args: str) -> str:
        done = subprocess.run(["bash", "install.sh", "--yes", *args], cwd=app, capture_output=True, text=True)
        assert done.returncode == 0, done.stderr
        at = subprocess.run(["git", "rev-parse", "HEAD"], cwd=app, capture_output=True, text=True).stdout.strip()
        assert f"AT {at}" in done.stdout
        return done.stdout + done.stderr

    out = install("--channel", "stable")  # nightly to stable: back to the release
    assert "Going back to v2026.10.1" in out and "four" in out
    head = lambda: subprocess.run(["git", "rev-parse", "HEAD"], cwd=app, capture_output=True, text=True).stdout.strip()  # noqa: E731
    assert head() == stable
    assert (app / "data" / "update" / "channel").read_text() == "stable\n"
    assert "Already up to date (v2026.10.1" in install()  # remembered
    install("--channel=beta")
    assert head() == beta  # the pre-release, newer than the release
    (app / "data" / "update" / "channel").write_text("nightly\n")  # as the dashboard leaves it
    assert "Updating to" in install()
    assert head() == nightly
    branch = subprocess.run(["git", "branch", "--show-current"], cwd=app, capture_output=True, text=True).stdout
    assert branch.strip() == "main"
    # A stable release of the same version as a beta comes after it, and beta follows it.
    subprocess.run([*git, "tag", "v2026.10.2", beta], cwd=origin, check=True)
    assert "Updating to" not in install("--channel", "beta") and head() == beta
    # A release taken back on GitHub goes here too.
    subprocess.run([*git, "tag", "-d", "v2026.10.2", "v2026.10.2-beta"], cwd=origin, check=True, capture_output=True)
    install()
    assert head() == stable


@pytest.mark.skipif(not shutil.which("git") or not shutil.which("bash"), reason="needs git and bash")
def test_release_script_tags_each_channel(tmp_path: Path) -> None:
    """scripts/release.sh in a clone, pushing to a repository of its own (without a GitHub release)."""
    git = ["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main"]
    origin = tmp_path / "origin.git"
    subprocess.run([*git, "init", "-q", "--bare", str(origin)], check=True)
    work = tmp_path / "work"
    subprocess.run([*git, "clone", "-q", str(origin), str(work)], check=True, capture_output=True)
    (work / "scripts").mkdir()
    shutil.copy(ROOT / "scripts" / "release.sh", work / "scripts" / "release.sh")
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@t"}  # fmt: skip

    def commit(version: str, push: bool = True) -> None:
        (work / "pyproject.toml").write_text(f'[project]\nname = "x"\nversion = "{version}"\n')
        (work / "change.txt").write_text(str(time.time()))
        subprocess.run([*git, "add", "."], cwd=work, check=True)
        subprocess.run([*git, "commit", "-qm", version], cwd=work, check=True)
        if push:
            subprocess.run(["git", "push", "-q", "origin", "main"], cwd=work, check=True, capture_output=True)

    def release(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", "scripts/release.sh", *args, "--yes", "--tag-only"], cwd=work, env=env, capture_output=True,
            text=True,
        )  # fmt: skip

    def tags() -> list[str]:
        out = subprocess.run(["git", "tag", "-l"], cwd=origin, capture_output=True, text=True).stdout
        return sorted(out.split())

    commit("2026.10.10")
    assert release("beta").returncode == 0
    assert "already this commit" in release("beta").stderr
    commit("2026.10.10")  # another change, the same version
    assert release("beta").returncode == 0
    assert tags() == ["v2026.10.10-beta", "v2026.10.10-beta.2"]
    assert release("stable", "v2026.10.10-beta").returncode == 0  # the first beta, promoted
    assert "bump the version" in release("stable").stderr  # v2026.10.10 is taken, by another commit
    commit("2026.10.11")
    assert release("stable").returncode == 0
    assert tags() == ["v2026.10.10", "v2026.10.10-beta", "v2026.10.10-beta.2", "v2026.10.11"]
    commit("2026.10.12", push=False)  # not merged
    assert "isn't on main" in release("stable", "HEAD").stderr
    assert "no 'nightly' channel" in release("nightly").stderr
