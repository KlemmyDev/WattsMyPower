"""
Whether a newer version is on GitHub (Manage → System → Updates, and the version at the foot of the navigation).

Every few hours, and when asked, the latest commit on the repository's main branch is compared with the commit this was
built from (app.core.version.COMMIT): one that's different is an update, and GitHub's compare counts the commits since.
Its version is read from that commit's pyproject.toml. Without a commit to compare (an image built without install.sh),
or one GitHub doesn't know (a local build), the versions are compared instead.

Manage → System turns it off (update_check), and then nothing is asked of GitHub but a check asked for by hand. A
check makes three requests at most, well inside GitHub's 60 an hour without an account.

Updating is done on the host, by updater.sh (run every minute by cron, set up by install.sh), through the data folder
they share (data/update here, /data/update in the container): it notes that it's there and whether it can update
(updater.json); "Update now" leaves a request; and it reports how the update is going (status.json, update.log). The
dashboard can't update itself (it doesn't have the code, and mustn't control Docker): it can only ask.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import threading
import time
import tomllib
import urllib.error
from pathlib import Path
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
UPDATER_GONE = 180  # seconds without word from updater.sh (it runs every minute) before it's taken as not there
RECENT = 15 * 60  # a finished update is reported for this long
LOG_LINES = 12
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


class UpdateRefused(Exception):
    """Why an update can't be started now, for Settings."""


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
    def __init__(self, settings: SettingsStore, folder: Path):
        self.settings = settings
        self.folder = folder  # shared with updater.sh on the host
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
            "install": self.installer(),
        }

    # -- updating, by updater.sh on the host ---------------------------------------------------------

    def _read(self, name: str) -> dict[str, Any] | None:
        try:
            data = json.loads((self.folder / name).read_text())
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def installer(self) -> dict[str, Any]:
        """Whether updater.sh is there and can update (`ready`, else `why` not), and how an update is going: `state`
        is idle, requested (waiting for it to start, within a minute), running, done, failed or expired (asked for
        while it wasn't running), with the end of its log."""
        now = time.time()
        seen = self._read("updater.json")
        here = bool(seen and isinstance(seen.get("seen_at"), (int, float)) and now - seen["seen_at"] < UPDATER_GONE)
        why = None
        if not seen:
            why = "Updating from here isn't set up yet: run bash install.sh once more on the machine it's installed on."
        elif not here:
            why = "The updater on this machine hasn't checked in for a few minutes (it runs every minute, from cron)."
        elif not seen.get("can_update"):
            said = seen.get("why") or "it didn't say why"
            why = f"The updater can't update: {said}."
        status = self._read("status.json") or {}
        state = status.get("state") if status.get("state") in ("running", "done", "failed", "expired") else "idle"
        ended = status.get("finished_at")
        if state in ("done", "failed", "expired") and not (isinstance(ended, (int, float)) and now - ended < RECENT):
            state = "idle"
        if (self.folder / "request").exists() and state != "running":
            state = "requested"
        return {
            "ready": here and bool(seen and seen.get("can_update")),
            "why": why,
            "state": state,
            "started_at": status.get("started_at"),
            "finished_at": ended,
            "from": status.get("from"),
            "to": status.get("to"),
            "error": status.get("error"),
            "log": self._log() if state in ("running", "failed") else [],
        }

    def _log(self) -> list[str]:
        try:
            text = (self.folder / "update.log").read_text(errors="replace")
        except OSError:
            return []
        lines = [ANSI.sub("", line).rstrip() for line in text.splitlines()]
        return [line for line in lines if line.strip()][-LOG_LINES:]

    def install(self) -> dict[str, Any]:
        """Ask updater.sh to update (Manage → System → Update now). It starts within a minute."""
        current = self.installer()
        if not current["ready"]:
            raise UpdateRefused(current["why"] or "The updater isn't ready.")
        if current["state"] in ("requested", "running"):
            raise UpdateRefused("An update is already under way.")
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            (self.folder / "request").write_text(f"{int(time.time())}\n")
        except OSError as e:
            raise UpdateRefused(f"Couldn't ask the updater: {e.strerror or e}.") from e
        return self.status()


def _newer(latest: dict[str, Any] | None) -> bool:
    """Whether the latest on GitHub is an update: commits since this one, or, without them to go on, a later version."""
    if latest is None:
        return False
    if latest["changes"] is not None:
        return bool(latest["changes"] > 0)
    if COMMIT and latest["commit"] == COMMIT:
        return False
    return version_key(latest["version"]) > version_key(VERSION)
