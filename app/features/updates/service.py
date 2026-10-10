"""
Whether a newer version is on GitHub (Manage → System → Updates, and the version at the foot of the navigation).

It follows a release channel (Manage → System → Updates), each a commit on GitHub:
- nightly: the latest commit on main, so every change as it's merged;
- beta: the newest release tag, a pre-release (v2026.10.9-beta, -beta.2…) or a stable one, whichever is newer;
- stable: the newest stable release tag (v2026.10.9, with nothing after the version).
scripts/release.sh tags them; no other tags count. Every few hours, and when asked, the channel's commit is compared with the commit this was
built from (app.core.version.COMMIT), and GitHub's compare counts the commits between: commits it has that this hasn't
make it an update; only commits this has that it hasn't (moving to an older channel, nightly to stable) make it older,
which can be installed too, going back. Its version is read from that commit's pyproject.toml. Without a commit to
compare (an image built without install.sh), or one GitHub doesn't know (a local build), the versions are compared.

The channel is kept in the folder shared with the host (below, `channel`), where install.sh reads it too: an update,
from here or by hand, goes to the channel's commit, whichever way that is. install.sh saves it on every install: beta
for a new one, and nightly for one from before beta was the default (which followed main without it saved).

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
CHANNELS = ("nightly", "beta", "stable")
# Without a channel saved (install.sh saves one, so only an image built some other way): what a new install follows.
DEFAULT_CHANNEL = "beta"
# A release tag: v and the version, and for a pre-release -beta, then .2, .3… for the same version's next ones
# (v2026.10.9-beta, v2026.10.9-beta.2), as scripts/release.sh makes them. Any other tag isn't a release.
# install.sh and scripts/release.sh pick the same tags, in the same order (git's version sort).
TAG = re.compile(r"v(\d+(?:\.\d+)*)(-beta(?:\.(\d+))?)?")


def tag_key(name: str) -> tuple[tuple[int, ...], bool, int] | None:
    """A release tag's place among the others (None for a tag that isn't one): by version, then a stable release after
    the same version's betas, then the betas by their number (-beta is the first, then -beta.2)."""
    m = TAG.fullmatch(name)
    if not m:
        return None
    return version_key(m[1]), m[2] is None, int(m[3] or 1)


def _on_windows() -> bool:
    """Whether it's running on Windows, in WSL (as install.ps1 sets it up): a container shares WSL's kernel, whose
    release says so (5.15.153.1-microsoft-standard-WSL2)."""
    try:
        return "microsoft" in Path("/proc/sys/kernel/osrelease").read_text().lower()
    except OSError:
        return False


WINDOWS = _on_windows()


def newest_tag(tags: list[dict[str, Any]], channel: str) -> dict[str, Any] | None:
    """The tag (as GitHub lists them) a channel follows: the newest release, or for stable the newest stable one."""
    keyed = [(key, t) for t in tags if (key := tag_key(str(t.get("name", "")))) is not None]
    if channel == "stable":
        keyed = [(key, t) for key, t in keyed if key[1]]
    return max(keyed, key=lambda kt: kt[0])[1] if keyed else None


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
        self._checked: str | None = None  # the channel the check was for: changing it starts again
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

    def channel(self) -> str:
        """The release channel it follows (nightly, beta or stable), as the host's install.sh reads it too."""
        try:
            saved = (self.folder / "channel").read_text().strip()
        except OSError:
            return DEFAULT_CHANNEL
        return saved if saved in CHANNELS else DEFAULT_CHANNEL

    def set_channel(self, channel: str) -> dict[str, Any]:
        """Follow another channel (Manage → System → Updates), and check it now."""
        if channel not in CHANNELS:
            raise ValueError(f"There's no {channel!r} channel: it's one of {', '.join(CHANNELS)}.")
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            tmp = self.folder / ".channel.tmp"
            tmp.write_text(f"{channel}\n")
            tmp.replace(self.folder / "channel")  # whole, for install.sh
        except OSError as e:
            raise UpdateRefused(f"Couldn't save the channel: {e.strerror or e}.") from e
        return self.check()

    def check(self) -> dict[str, Any]:
        """Ask GitHub for the commit the channel is at, its version, and how many commits it's ahead or behind."""
        channel = self.channel()
        try:
            if channel == "nightly":
                head = get_json(f"{API}/repos/{REPO}/commits/{BRANCH}")
                sha, tag, date = str(head["sha"]), None, head["commit"]["committer"]["date"]
            else:
                # GitHub lists tags by name, not version: a hundred is plenty to find the newest among.
                found = newest_tag(get_json(f"{API}/repos/{REPO}/tags?per_page=100"), channel)
                if found is None:  # nothing released on it yet: nothing to move to
                    with self._lock:
                        self._latest, self._checked_at, self._error, self._checked = None, time.time(), None, channel
                    return self.status()
                sha, tag, date = str(found["commit"]["sha"]), str(found["name"]), None
            project = tomllib.loads(get_text(f"https://raw.githubusercontent.com/{REPO}/{sha}/pyproject.toml"))
            changes: int | None = None
            behind: int | None = None
            if sha == COMMIT:
                changes = behind = 0
            elif COMMIT:
                try:
                    compared = get_json(f"{API}/repos/{REPO}/compare/{COMMIT}...{sha}")
                    changes, behind = int(compared["ahead_by"]), int(compared["behind_by"])
                except urllib.error.HTTPError as e:
                    if e.code != 404:  # 404: GitHub doesn't have this commit (a local build); compare versions
                        raise
            latest = {
                "version": str(project.get("project", {}).get("version", "")),
                "release": project.get("tool", {}).get("wattsmypower", {}).get("release"),
                "commit": sha,
                "tag": tag,
                "date": date,
                "changes": changes,
                "behind": behind,
            }
            with self._lock:
                self._latest, self._checked_at, self._error, self._checked = latest, time.time(), None, channel
        except (urllib.error.URLError, OSError, KeyError, TypeError, ValueError, tomllib.TOMLDecodeError) as e:
            log.info("Couldn't check for updates: %s", e)
            with self._lock:
                if self._checked != channel:
                    self._latest = None
                self._checked_at, self._error, self._checked = time.time(), _why(e), channel
        return self.status()

    def status(self) -> dict[str, Any]:
        """This version, the channel's on GitHub (as last checked), and whether it's an update or older."""
        channel = self.channel()
        with self._lock:
            latest, checked_at, error = self._latest, self._checked_at, self._error
            if self._checked != channel:  # checked for another channel: not checked yet
                latest = checked_at = error = None
        move = _move(latest)
        return {
            "enabled": self.enabled(),
            "channel": channel,
            "current": about(),
            "latest": latest,
            # Something to install: an update (newer), or older, from moving to a channel behind this one.
            "move": move,
            "available": move == "update",
            # The channel has nothing released on it yet (checked, and no tag).
            "unreleased": checked_at is not None and latest is None and error is None,
            "checked_at": checked_at,
            "error": error,
            "repo": REPO,
            "branch": BRANCH,
            # Installed (and updated by hand) with install.ps1, rather than install.sh, for Settings to say so.
            "windows": WINDOWS,
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
            again = "install.ps1 once more on the PC" if WINDOWS else "bash install.sh once more on the machine"
            why = f"Updating from here isn't set up yet: run {again} it's installed on."
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


def _move(latest: dict[str, Any] | None) -> str | None:
    """What installing the channel's commit would be: an update (commits this hasn't), older (only commits behind this
    one), or nothing (this one). Without commits to go on, the versions decide."""
    if latest is None:
        return None
    if latest["changes"] is not None:
        if latest["changes"] > 0:
            return "update"
        return "older" if latest["behind"] else None
    if COMMIT and latest["commit"] == COMMIT:
        return None
    theirs, ours = version_key(latest["version"]), version_key(VERSION)
    return "update" if theirs > ours else "older" if theirs < ours else None
