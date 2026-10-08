"""Checking GitHub for a newer version (app.features.updates), with GitHub's answers made up."""

from __future__ import annotations

import io
import urllib.error
from typing import Any

import pytest

from app.core.config import Config
from app.core.database import Database
from app.core.version import version_key
from app.features.settings.store import SettingsStore
from app.features.updates import service as updates
from app.features.updates.service import UpdateService

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
def svc(config: Config, db: Database) -> UpdateService:
    settings = SettingsStore(db, config)
    settings.load()
    return UpdateService(settings)


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
