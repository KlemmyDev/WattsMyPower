"""
The app's version, as the dashboard and /healthz show it: from pyproject.toml, its `version` (the date it was
released: 2026.10.8, or 2026.10.8.1 for a second release that day) and `[tool.wattsmypower] release` (how far along it
is, "alpha", until it's marked stable and left out). The file is next to app/ in the repository and in the image.

And the commit it was built from, which is what tells an update apart (app.features.updates): GIT_COMMIT, stamped
into the image by install.sh, or, run from a checkout, the checkout's own.
"""

from __future__ import annotations

import os
import re
import subprocess
import tomllib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"[0-9a-f]{40}")


def _project() -> dict[str, Any]:
    try:
        with open(ROOT / "pyproject.toml", "rb") as f:
            return tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


_toml = _project()
VERSION: str = _toml.get("project", {}).get("version", "dev")
RELEASE: str | None = _toml.get("tool", {}).get("wattsmypower", {}).get("release")


def _commit() -> str | None:
    """The commit this was built from: GIT_COMMIT, else the checkout's HEAD when run from one; None if neither says."""
    stamped = os.environ.get("GIT_COMMIT", "").strip().lower()
    if SHA.fullmatch(stamped):
        return stamped
    if not (ROOT / ".git").exists():
        return None
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return None
    sha = head.stdout.strip()
    return sha if SHA.fullmatch(sha) else None


COMMIT: str | None = _commit()


def version_key(version: str) -> tuple[int, ...]:
    """A version's numbers, to compare two: (2026, 10, 8, 1) for 2026.10.8.1, which comes after 2026.10.8."""
    return tuple(int(n) for n in re.findall(r"\d+", version))


def about() -> dict[str, str | None]:
    """The version, its release ("alpha"), and the commit it was built from, for the dashboard."""
    return {"version": VERSION, "release": RELEASE, "commit": COMMIT}
