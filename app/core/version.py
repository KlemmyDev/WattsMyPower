"""
The app's version, as the dashboard and /healthz show it: from pyproject.toml, its `version` (the date it was
released: 2026.10.8, or 2026.10.8.1 for a second release that day) and `[tool.wattsmypower] release` (how far along it
is, "alpha", until it's marked stable and left out). The file is next to app/ in the repository and in the image.
"""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any


def _project() -> dict[str, Any]:
    try:
        with open(Path(__file__).resolve().parents[2] / "pyproject.toml", "rb") as f:
            return tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


_toml = _project()
VERSION: str = _toml.get("project", {}).get("version", "dev")
RELEASE: str | None = _toml.get("tool", {}).get("wattsmypower", {}).get("release")


def about() -> dict[str, str | None]:
    """The version and its release ("alpha"), for the dashboard."""
    return {"version": VERSION, "release": RELEASE}
