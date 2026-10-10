"""
The site's time zone: the one the server keeps its days in (the process's local time, set with TZ), by its IANA
name, e.g. "Australia/Brisbane". The dashboard draws its days, hours and clock times in it, rather than in whatever
zone the browser is in (another state, a trip away, or a browser that says UTC for privacy).
"""

from __future__ import annotations

import os
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

LOCALTIME = Path("/etc/localtime")
TIMEZONE_FILE = Path("/etc/timezone")


def _from_link(path: Path) -> str | None:
    """The zone a zoneinfo symlink points at: /usr/share/zoneinfo/Australia/Brisbane is "Australia/Brisbane"."""
    try:
        target = str(path.resolve()) if path.is_symlink() else ""
    except OSError:
        return None
    _, found, name = target.rpartition("zoneinfo/")
    if not found:
        return None
    for prefix in ("posix/", "right/"):
        name = name.removeprefix(prefix)
    return name or None


def _from_file(path: Path) -> str | None:
    try:
        return path.read_text().strip() or None
    except OSError:
        return None


def _offset(name: str, now: float) -> int | None:
    """The zone's offset from UTC at `now`, in seconds; None if it isn't a zone this machine knows."""
    try:
        off = datetime.fromtimestamp(now, ZoneInfo(name)).utcoffset()
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None
    return None if off is None else int(off.total_seconds())


def site_zone(now: float | None = None) -> str | None:
    """
    The IANA name of the zone the server's local time is in. Taken from TZ, else /etc/localtime or /etc/timezone,
    and only if it's a zone whose offset now matches the server's own (a TZ the machine has no zone data for leaves
    it on UTC). Else a whole-hour offset as "Etc/GMT-10" (no daylight saving), or None if even that won't do.
    """
    now = time.time() if now is None else now
    local = time.localtime(now).tm_gmtoff
    candidates = [os.environ.get("TZ", "").strip().removeprefix(":"), _from_link(LOCALTIME), _from_file(TIMEZONE_FILE)]
    for name in candidates:
        if name and not name.startswith("/") and _offset(name, now) == local:
            return name
    if local % 3600 == 0:
        hours = -local // 3600  # Etc/GMT names have the sign flipped: Etc/GMT-10 is ten hours ahead of UTC
        return "UTC" if hours == 0 else f"Etc/GMT{hours:+d}"
    return None
