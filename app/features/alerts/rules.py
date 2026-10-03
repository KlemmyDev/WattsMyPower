"""
The alert rules: what each one watches for, and what it says.

A rule looks at the facts of the moment (the live status, the sun, and on demand the solar
performance and yesterday's totals) and answers with a Check: "bad" (the problem is there),
"ok" (it's not, so an alert out can be resolved), or "unknown" (can't tell, or in between: an
alert out stays out, and a problem just noticed has to be seen afresh). The service turns those
answers into notifications, with each rule's debounce and cooldown (see service.py).

Thresholds are switched and set in Settings → Alerts; each Setting below is one of them.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from app.features.inverters.types import Snapshot

HOUR = 3600
DAY = 86400

Values = dict[str, float]


@dataclass
class Facts:
    """What the rules look at, gathered once per evaluation. Times are unix seconds."""

    now: float
    snapshot: Snapshot | None
    hybrid_connected: bool  # a main inverter is set up to be read
    last_success: float | None  # when the collector last read it
    error: str | None
    poll_interval: int
    pv2: dict[str, Any] | None  # the second inverter, when one is set up (LiveService.pv2)
    reserve: float  # the battery's backup reserve, %
    sun: float  # the sun's height now, degrees
    daylight_since: float | None  # since when the sun has been up (sun.DAYLIGHT); None after dark
    # Looked up only when a rule asks: the Insights solar performance, and yesterday's totals.
    performance: Callable[[], dict[str, Any] | None] = lambda: None
    yesterday: Callable[[], dict[str, Any] | None] = lambda: None

    def fresh(self, ts: float | None) -> bool:
        """Whether something read at `ts` is current: within the last three polls."""
        return ts is not None and self.now - ts <= max(3 * self.poll_interval, 180)

    def reading(self) -> Snapshot | None:
        """The latest snapshot, if it's current."""
        snap = self.snapshot
        return snap if snap and self.fresh(snap.get("ts")) else None


@dataclass
class RuleState:
    """A rule's progress, kept in the database so a restart neither forgets nor repeats an alert."""

    rule: str
    pending_since: float | None = None  # the problem was first seen (debounce)
    active_since: float | None = None  # an alert is out
    last_fired: float | None = None  # when one last went out (cooldown)
    delivered: bool = False  # the alert out reached at least one channel
    retry_at: float | None = None  # when to try delivering it again, if it didn't
    event_id: int | None = None  # its row in the history
    data: dict[str, Any] = field(default_factory=dict)  # anything else a rule keeps


@dataclass
class Check:
    state: Literal["bad", "ok", "unknown", "report"]
    title: str = ""
    message: str = ""
    # When the problem started, if the rule knows better than "when it was first seen".
    since: float | None = None
    # Saved with the rule's state (e.g. the day a summary was sent).
    data: dict[str, Any] | None = None


UNKNOWN = Check("unknown")


@dataclass(frozen=True)
class Setting:
    key: str
    label: str
    unit: str
    min: float
    max: float
    default: float


@dataclass(frozen=True)
class Rule:
    id: str
    name: str
    description: str
    check: Callable[[Facts, Values, RuleState], Check]
    settings: tuple[Setting, ...] = ()
    enabled: bool = True
    # How long a problem must last before it's reported (seconds, from the rule's settings).
    debounce: Callable[[Values], float] = lambda v: 0
    # After an alert, the least time before the same rule sends another. None for a scheduled message.
    cooldown: float | None = HOUR
    urgent: bool = False

    def values(self, saved: dict[str, Any] | None = None) -> Values:
        """The rule's settings: saved values, else the defaults."""
        saved = saved or {}
        return {s.key: float(saved.get(s.key, s.default)) for s in self.settings}


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
    d = round(h / 24)
    return f"{d} days"


def day_name(date: str) -> str:
    """ "2026-10-02" as "Friday 2 October"."""
    lt = time.strptime(date, "%Y-%m-%d")
    return f"{time.strftime('%A', lt)} {lt.tm_mday} {time.strftime('%B', lt)}"


def _kw(w: float) -> str:
    return f"{abs(w) / 1000:.1f} kW"


def _kwh(v: float | None) -> str:
    return "no reading" if v is None else f"{v:.1f} kWh"


def _after(s: RuleState, now: float) -> str:
    return f" after {span(now - s.active_since)}" if s.active_since else ""


# -- the rules ----------------------------------------------------------------------
def inverter_offline(f: Facts, v: Values, s: RuleState) -> Check:
    if not f.hybrid_connected:
        return Check("ok")  # nothing set up to be read (or it was removed): an alert out ends quietly
    if f.fresh(f.last_success):
        return Check(
            "ok",
            "Your inverter is back",
            f"Your inverter is answering again{_after(s, f.now)}, and readings have resumed.",
        )
    since = f.last_success
    when = f"since {clock(since, f.now)}" if since else f"for {span(v['minutes'] * 60)}"
    if f.error and f.error.startswith("Collector not reachable"):
        why = (
            "The dashboard can't reach the collector, the part of WattsMyPower that reads the inverter. "
            "Check the server it runs on is up."
        )
    else:
        why = "Check the inverter and its Wi-Fi dongle have power and are on your home network."
    return Check("bad", "Your inverter isn't answering", f"There have been no readings {when}. {why}", since=since)


def pv2_offline(f: Facts, v: Values, s: RuleState) -> Check:
    if f.pv2 is None:
        return Check("ok")  # no second inverter (or it was removed): an alert out ends quietly
    if not f.fresh(f.last_success):
        return UNKNOWN  # nothing's being read: the inverter alert covers that
    last = f.pv2.get("last_success")
    if f.fresh(last):
        return Check(
            "ok",
            "Your second inverter is back",
            f"Your second inverter is answering again{_after(s, f.now)}, and its solar is being counted.",
        )
    if f.daylight_since is None:
        return UNKNOWN  # it sleeps after dark: nothing to tell
    # It went quiet in daylight, or hasn't woken since the sun came up.
    since = max(last or 0, f.daylight_since)
    name = " ".join(x for x in (f.pv2.get("brand"), f.pv2.get("model")) if x) or "second inverter"
    return Check(
        "bad",
        "Your second inverter isn't answering",
        f"Your {name} hasn't answered since {clock(since, f.now)}, though the sun is up, so its solar isn't "
        "being counted. It may have tripped or lost its network connection: check its display and its isolator.",
        since=since,
    )


def battery_low(f: Facts, v: Values, s: RuleState) -> Check:
    snap = f.reading()
    soc = snap.get("battery_soc") if snap else None
    if soc is None:
        return UNKNOWN
    level = v["percent"]
    if soc <= level:
        return Check(
            "bad",
            f"Battery down to {soc:.0f}%",
            f"Your battery is down to {soc:.0f}%. Its backup reserve is {f.reserve:.0f}%: once it gets there, "
            "the house runs from the grid.",
        )
    if soc >= level + 5:  # a little above, so a battery hovering at the line doesn't keep resolving
        return Check("ok", "Battery charging again", f"Your battery is back up to {soc:.0f}%.")
    return UNKNOWN


SUNNY = 20.0  # degrees: the sun well up, when a battery with room should be soaking up any surplus
FULL = 95.0  # % from which a battery tapers off or stops charging on its own


def battery_not_charging(f: Facts, v: Values, s: RuleState) -> Check:
    snap = f.reading()
    if not snap or f.sun < SUNNY:
        return UNKNOWN
    grid, bat, soc = snap.get("grid_power"), snap.get("battery_power"), snap.get("battery_soc")
    if grid is None or bat is None or soc is None:
        return UNKNOWN
    if soc >= FULL or bat <= -100:  # full, or charging (negative is charging)
        how = f"is charging from solar again ({soc:.0f}% now)" if bat <= -100 else f"is nearly full ({soc:.0f}%)"
        return Check("ok", "Battery charging again", f"Your battery {how}.")
    if -grid >= v["export_w"]:
        return Check(
            "bad",
            "Battery isn't charging",
            f"You're sending {_kw(grid)} to the grid, but your battery ({soc:.0f}%) hasn't charged for "
            f"{span(v['minutes'] * 60)}. Something may be stopping it: check the inverter's app for a "
            "battery fault or a charging limit.",
        )
    return UNKNOWN  # not much spare solar: nothing to judge by


def solar_underperforming(f: Facts, v: Values, s: RuleState) -> Check:
    perf = f.performance()
    if not perf:
        return UNKNOWN
    today = time.strftime("%Y-%m-%d", time.localtime(f.now))
    week_ago = time.strftime("%Y-%m-%d", time.localtime(f.now - 7 * DAY))
    clear = [
        d
        for d in perf.get("days") or []
        if week_ago <= d["date"] < today and d.get("clear") and d.get("ratio") is not None
    ]
    need = int(v["days"])
    recent = clear[-need:]
    if len(recent) < need:
        return UNKNOWN  # not enough sunny days lately to judge
    limit = v["percent"] / 100
    last = recent[-1]
    if all(d["ratio"] < limit for d in recent):
        avg = sum(d["ratio"] for d in recent) / len(recent)
        days = "On your last clear day" if need == 1 else f"Over your last {need} clear days"
        return Check(
            "bad",
            "Solar is underperforming",
            f"{days}, your solar made about {avg:.0%} of what it usually does in that weather "
            f"({day_name(last['date'])}: {_kwh(last['actual_kwh'])} of an expected "
            f"{_kwh(last['expected_kwh'])}). Dirty or shaded panels, a tripped isolator or a fault in one of "
            "the inverters can do this. Insights shows each day.",
        )
    if last["ratio"] >= limit:
        return Check(
            "ok",
            "Solar back to normal",
            f"Your solar made {last['ratio']:.0%} of what it usually does in that weather on {day_name(last['date'])}.",
        )
    return UNKNOWN


def daily_summary(f: Facts, v: Values, s: RuleState) -> Check:
    lt = time.localtime(f.now)
    if lt.tm_hour < v["hour"]:
        return UNKNOWN
    yday = time.strftime("%Y-%m-%d", time.localtime(time.mktime((*lt[:2], lt.tm_mday - 1, 12, 0, 0, 0, 0, -1))))
    if s.data.get("date") == yday:
        return UNKNOWN  # sent already
    y = f.yesterday()
    if not y:
        return Check("report", data={"date": yday})  # nothing recorded yesterday: nothing to say
    lines = [
        f"Solar: {_kwh(y['pv'])}",
        f"Home use: {_kwh(y['home'])}",
        f"Bought from the grid: {_kwh(y['imp'])}",
        f"Sold to the grid: {_kwh(y['exp'])}",
        f"Cost: ${y['cost']:.2f}, including the ${y['supply']:.2f} supply charge, after ${y['credit']:.2f} "
        "of feed-in credit"
        if y["cost"] >= 0
        else f"Credit: ${-y['cost']:.2f}, after the ${y['supply']:.2f} supply charge",
    ]
    title = f"Yesterday: {_kwh(y['pv'])} of solar" if y["pv"] is not None else "Yesterday's summary"
    return Check("report", title, f"{day_name(yday)}\n" + "\n".join(lines), data={"date": yday})


RULES: tuple[Rule, ...] = (
    Rule(
        "inverter_offline",
        "Inverter not answering",
        "No readings from your main inverter for a while. Usually its Wi-Fi dongle has dropped off the network, "
        "or the inverter or the server has lost power. You'll hear again when it's back.",
        inverter_offline,
        (Setting("minutes", "After", "minutes", 5, 240, 15),),
        debounce=lambda v: v["minutes"] * 60,
        urgent=True,
    ),
    Rule(
        "pv2_offline",
        "Second inverter not answering",
        "Your second solar inverter has stopped answering while the sun is up. It sleeps after dark, so it's only "
        "checked in daylight (worked out from your location, not the clock).",
        pv2_offline,
        (Setting("minutes", "After", "minutes", 15, 240, 30),),
        debounce=lambda v: v["minutes"] * 60,
        cooldown=3 * HOUR,
    ),
    Rule(
        "battery_low",
        "Battery low",
        "The battery has run down close to its backup reserve, after which the house runs from the grid.",
        battery_low,
        (Setting("percent", "At or below", "%", 1, 80, 10),),
        debounce=lambda v: 5 * 60,
        cooldown=12 * HOUR,
    ),
    Rule(
        "battery_not_charging",
        "Battery not charging in the sun",
        "Solar is spilling to the grid while the battery has room but isn't charging. That usually means a "
        "battery fault or a setting that stops it charging.",
        battery_not_charging,
        (
            Setting("minutes", "For", "minutes", 10, 180, 30),
            Setting("export_w", "While exporting at least", "W", 200, 5000, 500),
        ),
        debounce=lambda v: v["minutes"] * 60,
        cooldown=12 * HOUR,
    ),
    Rule(
        "solar_underperforming",
        "Solar underperforming",
        "On clear days, solar made well under what this system usually makes in that weather, judged the same way "
        "as Solar performance on the Insights page. Checked once a day.",
        solar_underperforming,
        (
            Setting("percent", "Below", "% of expected", 30, 95, 75),
            Setting("days", "On", "clear days in a row", 1, 5, 2),
        ),
        cooldown=3 * DAY,
    ),
    Rule(
        "daily_summary",
        "Daily summary",
        "Each morning: yesterday's solar, home use, what you bought and sold, and what it cost.",
        daily_summary,
        (Setting("hour", "Sent at", "am", 5, 11, 7),),
        enabled=False,
        cooldown=None,
    ),
)
BY_ID = {r.id: r for r in RULES}
