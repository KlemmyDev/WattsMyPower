"""
What there is to be told about, and when: each rule watches one thing and answers with a Check.

A Check is "bad" (it's happening), "ok" (it's not, so a notification out can be followed by an all-clear) or
"unknown" (can't tell: a notification out stays out). The service (service.py) turns those answers into
notifications with each rule's debounce (how long it must last first) and cooldown (the least time before the
same rule tells you again). Every rule can be switched off and has its own numbers, set in Settings → Notifications.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from app.features.inverters.types import Snapshot

Values = dict[str, float]
HOUR = 3600


@dataclass
class Facts:
    """What the rules look at, gathered once per evaluation. Times are unix seconds."""

    now: float
    snapshot: Snapshot | None
    hybrid_connected: bool  # a main inverter is set up to be read
    last_success: float | None  # when the collector last read it
    poll_interval: int
    off_grid: bool | None  # running the house without the grid; None when this inverter doesn't say
    off_grid_since: float | None

    def fresh(self, ts: float | None) -> bool:
        """Whether something read at `ts` is current: within the last three polls."""
        return ts is not None and self.now - ts <= max(3 * self.poll_interval, 180)

    def reading(self) -> Snapshot | None:
        """The latest snapshot, if it's current."""
        snap = self.snapshot
        return snap if snap and self.fresh(snap.get("ts")) else None


@dataclass
class RuleState:
    """A rule's progress, kept in the database so a restart neither forgets nor repeats a notification."""

    rule: str
    pending_since: float | None = None  # the problem was first seen (debounce)
    active_since: float | None = None  # a notification is out (or was held back: `quiet`)
    last_fired: float | None = None  # when one last went out (cooldown)
    quiet: bool = False  # it began during the cooldown, so no all-clear follows
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class Check:
    state: Literal["bad", "ok", "unknown"]
    title: str = ""
    message: str = ""
    # The all-clear's words, given by the "ok" answer that ends it.
    clear_title: str = ""
    clear_message: str = ""
    # When the problem started, if the rule knows better than "when it was first seen".
    since: float | None = None


UNKNOWN = Check("unknown")


@dataclass(frozen=True)
class Setting:
    key: str
    label: str
    unit: str
    min: float
    max: float
    default: float
    step: float = 1


@dataclass(frozen=True)
class Rule:
    id: str
    name: str
    description: str
    check: Callable[[Facts, Values], Check]
    settings: tuple[Setting, ...] = ()
    enabled: bool = True
    urgent: bool = False  # shown until dismissed, and let through quiet hours and the daily limit
    resolves: bool = True  # when it clears, a follow-up says so
    page: str = "/"  # where a tap goes

    def values(self, saved: dict[str, Any] | None = None) -> Values:
        """The rule's settings: saved values (kept within their limits), else the defaults."""
        saved = saved or {}
        out: Values = {}
        for s in self.settings:
            try:
                v = float(saved.get(s.key, s.default))
            except (TypeError, ValueError):
                v = s.default
            out[s.key] = min(s.max, max(s.min, v))
        return out


# -- wording ------------------------------------------------------------------------
def clock(ts: float, now: float) -> str:
    """ "14:05" today, else "Thu 2 Oct 14:05"."""
    lt, today = time.localtime(ts), time.localtime(now)
    hm = time.strftime("%H:%M", lt)
    if lt[:3] == today[:3]:
        return hm
    return f"{time.strftime('%a', lt)} {lt.tm_mday} {time.strftime('%b', lt)} {hm}"


def span(seconds: float) -> str:
    """A duration in words: "45 minutes", "2 hours 5 minutes", "3 days"."""
    m = max(1, round(seconds / 60))
    if m < 60:
        return f"{m} minute{'s' * (m != 1)}"
    h, m = divmod(m, 60)
    if h < 48:
        return f"{h} hour{'s' * (h != 1)}" + (f" {m} minute{'s' * (m != 1)}" if m else "")
    return f"{round(h / 24)} days"


def kw(w: float) -> str:
    return f"{abs(w) / 1000:.1f} kW"


def wait(default: float) -> Setting:
    """How long it must last before it's reported."""
    return Setting("minutes", "Only if it lasts", "minutes", 0, 240, default)


def cooldown(default: float) -> Setting:
    """The least time between two notifications from one rule."""
    return Setting("cooldown_hours", "At most once every", "hours", 0, 72, default, 0.5)


# -- the rules ----------------------------------------------------------------------
def off_grid(f: Facts, v: Values) -> Check:
    """The grid's down: the inverter is running the house on solar and the battery."""
    if f.off_grid is None:
        return UNKNOWN
    if not f.off_grid:
        return Check("ok", clear_title="The grid's back", clear_message="You're back on the grid.")
    since = f.off_grid_since or f.now
    return Check(
        "bad",
        "The grid's down",
        f"Your inverter has been running the house without the grid since {clock(since, f.now)}.",
        since=since,
    )


def low_battery(f: Facts, v: Values) -> Check:
    """The battery has fallen to the level set."""
    snap = f.reading()
    soc = snap.get("battery_soc") if snap else None
    if soc is None:
        return UNKNOWN
    level = v["percent"]
    if soc <= level:
        return Check(
            "bad",
            f"Battery at {soc:.0f}%",
            f"The battery is down to {soc:.0f}%, at or below your {level:.0f}% mark.",
        )
    if soc >= level + 5:  # a little clear of it before it counts as over
        return Check("ok", clear_title="Battery recovering", clear_message=f"The battery is back up to {soc:.0f}%.")
    return UNKNOWN


def grid_import(f: Facts, v: Values) -> Check:
    """The house has been buying more than the power set from the grid."""
    snap = f.reading()
    w = snap.get("grid_power") if snap else None
    if w is None:
        return UNKNOWN
    limit = v["kw"] * 1000
    if w >= limit:
        return Check(
            "bad",
            f"Buying {kw(w)} from the grid",
            f"The house is importing {kw(w)}, above your {v['kw']:g} kW mark.",
        )
    if w < limit * 0.8:
        return Check(
            "ok", clear_title="Grid import is back down", clear_message=f"The house is importing {kw(max(w, 0))}."
        )
    return UNKNOWN


def inverter_offline(f: Facts, v: Values) -> Check:
    """The collector can't read the inverter, or has stopped hearing from it."""
    if not f.hybrid_connected:
        return UNKNOWN
    if f.fresh(f.last_success):
        return Check("ok", clear_title="The inverter's answering again", clear_message="Readings are coming in again.")
    since = f.last_success
    seen = f"Its last reading was at {clock(since, f.now)}." if since else "It hasn't been read yet."
    return Check(
        "bad",
        "The inverter isn't answering",
        f"WattsMyPower can't read your inverter. {seen}",
        since=since,
    )


RULES: tuple[Rule, ...] = (
    Rule(
        "off_grid",
        "Grid down",
        "Tells you when the house goes off the grid (a blackout, usually), and when the grid is back.",
        off_grid,
        (wait(1), cooldown(0)),
        urgent=True,
        page="/grid",
    ),
    Rule(
        "low_battery",
        "Low battery",
        "Tells you when the battery falls to a level you choose.",
        low_battery,
        (Setting("percent", "Tell me at or below", "%", 5, 95, 20), wait(5), cooldown(6)),
        page="/battery",
    ),
    Rule(
        "grid_import",
        "Heavy grid import",
        "Tells you when the house has been buying a lot of power from the grid for a while.",
        grid_import,
        (Setting("kw", "Tell me above", "kW", 0.5, 20, 3, 0.5), wait(15), cooldown(3)),
        enabled=False,
        page="/grid",
    ),
    Rule(
        "inverter_offline",
        "Inverter not answering",
        "Tells you when WattsMyPower can't read your inverter.",
        inverter_offline,
        (wait(10), cooldown(6)),
        page="/",
    ),
)
BY_ID = {r.id: r for r in RULES}
