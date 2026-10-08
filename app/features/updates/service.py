"""
Whether a newer version is on GitHub (Settings → System → Updates, and the version at the foot of the navigation).

Every few hours, and when asked, the latest commit on the repository's main branch is compared with the commit this was
built from (app.core.version.COMMIT): one that's different is an update, and GitHub's compare counts the commits since.
Its version is read from that commit's pyproject.toml. Without a commit to compare (an image built without install.sh),
or one GitHub doesn't know (a local build), the versions are compared instead.

Settings → System turns it off (update_check), and then nothing is asked of GitHub but a check asked for by hand. A
check makes three requests at most, well inside GitHub's 60 an hour without an account.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
import tomllib
import urllib.error
from typing import Any

from app.core.http import get_json, get_text
from app.core.version import COMMIT, VERSION, about, version_key
from app.features.settings.store import SettingsStore

log = logging.getLogger(__name__)

REPO = "KlemmyDev/WattsMyPower"
BRANCH = "main"
API = "https://api.github.com"
FIRST_CHECK = 60  # seconds after starting
EVERY = 6 * 3600


def _why(e: Exception) -> str:
    """A failed check, in words for Settings."""
    if isinstance(e, urllib.error.HTTPError):
        if e.code in (403, 429):
            return "GitHub's limit on checks was reached. It'll try again later."
        return f"GitHub answered {e.code}."
    if isinstance(e, (urllib.error.URLError, OSError)):
        return "Couldn't reach GitHub. Check this machine's internet connection."
    return "GitHub's answer couldn't be read."


class UpdateService:
    def __init__(self, settings: SettingsStore):
        self.settings = settings
        self._lock = threading.Lock()
        self._latest: dict[str, Any] | None = None
        self._checked_at: float | None = None
        self._error: str | None = None
        self._task: asyncio.Task[None] | None = None

    def enabled(self) -> bool:
        return bool(self.settings.get("update_check"))

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _run(self) -> None:
        await asyncio.sleep(FIRST_CHECK)
        while True:
            if self.enabled():
                try:
                    await asyncio.to_thread(self.check)
                except Exception:  # a check must never end the loop
                    log.exception("Checking for updates failed")
            await asyncio.sleep(EVERY)

    def check(self) -> dict[str, Any]:
        """Ask GitHub for the latest commit on main, its version, and how many commits it's ahead of this one."""
        try:
            head = get_json(f"{API}/repos/{REPO}/commits/{BRANCH}")
            sha = str(head["sha"])
            project = tomllib.loads(get_text(f"https://raw.githubusercontent.com/{REPO}/{sha}/pyproject.toml"))
            changes: int | None = None
            if sha == COMMIT:
                changes = 0
            elif COMMIT:
                try:
                    changes = int(get_json(f"{API}/repos/{REPO}/compare/{COMMIT}...{sha}")["ahead_by"])
                except urllib.error.HTTPError as e:
                    if e.code != 404:  # 404: GitHub doesn't have this commit (a local build); compare versions
                        raise
            latest = {
                "version": str(project.get("project", {}).get("version", "")),
                "release": project.get("tool", {}).get("wattsmypower", {}).get("release"),
                "commit": sha,
                "date": head["commit"]["committer"]["date"],
                "changes": changes,
            }
            with self._lock:
                self._latest, self._checked_at, self._error = latest, time.time(), None
        except (urllib.error.URLError, OSError, KeyError, TypeError, ValueError, tomllib.TOMLDecodeError) as e:
            log.info("Couldn't check for updates: %s", e)
            with self._lock:
                self._checked_at, self._error = time.time(), _why(e)
        return self.status()

    def status(self) -> dict[str, Any]:
        """This version, the latest on GitHub (as last checked), and whether it's an update."""
        with self._lock:
            latest, checked_at, error = self._latest, self._checked_at, self._error
        return {
            "enabled": self.enabled(),
            "current": about(),
            "latest": latest,
            "available": _newer(latest),
            "checked_at": checked_at,
            "error": error,
            "repo": REPO,
            "branch": BRANCH,
        }


def _newer(latest: dict[str, Any] | None) -> bool:
    """Whether the latest on GitHub is an update: commits since this one, or, without them to go on, a later version."""
    if latest is None:
        return False
    if latest["changes"] is not None:
        return bool(latest["changes"] > 0)
    if COMMIT and latest["commit"] == COMMIT:
        return False
    return version_key(latest["version"]) > version_key(VERSION)
