"""
Running a switchable device on spare solar: a rule the dashboard follows for it (the Home page → a device's page).

A rule switches the device on when the home has been sending at least `start_w` to the grid (over the last few
minutes), and off again once it's been drawing at least `stop_w` from it: so the device runs on what would otherwise
be exported, and stops when the sun goes in. Optionally only between `from` and `until` (outside them, it switches
off a device it switched on), and never while power costs more than `max_price` ($/kWh, the tariff's rate or
Amber's price). After a switch it waits MIN_MINUTES before the next, so a passing cloud doesn't flick it on and off.

Switching the device by hand pauses its rule for the rest of the day: the household's choice wins. A fridge or freezer
can't have one: off, it stops keeping food cold.

`decide` is pure; the service (app.features.home.service) gives it what's happening and does the switching.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

MIN_MINUTES = 10  # the least time between two switches by a rule
PROTECTED = {"fridge", "freezer"}
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

DEFAULTS: dict[str, Any] = {
    "enabled": True,
    "start_w": 1500,
    "stop_w": 300,
    "from": None,
    "until": None,
    "max_price": None,
}


class RuleError(ValueError):
    """A rule that can't be kept, in words."""


def validate(body: dict[str, Any], kind: str) -> dict[str, Any]:
    """A rule from the dashboard's form, checked. Raises RuleError, in words."""
    if kind in PROTECTED:
        raise RuleError("A fridge or freezer can't run on spare solar: switched off, it stops keeping food cold.")
    rule = {**DEFAULTS, **{k: body[k] for k in DEFAULTS if k in body}}
    if not isinstance(rule["enabled"], bool):
        raise RuleError("Say whether the rule is on.")
    for key, words, top in (("start_w", "sending to the grid", 30_000), ("stop_w", "drawing from the grid", 30_000)):
        value = rule[key]
        if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= top:
            raise RuleError(f"Give how much the home is {words} as watts, 0 to {top:,}.")
        rule[key] = round(float(value))
    if rule["start_w"] < 100:
        raise RuleError("Switch it on only once at least 100 W is going to the grid, or it'd run on grid power.")
    for key in ("from", "until"):
        if rule[key] in ("", None):
            rule[key] = None
        elif not isinstance(rule[key], str) or not _TIME.match(rule[key]):
            raise RuleError("Give times as HH:MM, like 09:30.")
    if (rule["from"] is None) != (rule["until"] is None):
        raise RuleError("Give both times, or neither.")
    if rule["from"] is not None and rule["from"] == rule["until"]:
        raise RuleError("The times can't be the same: leave both empty to let it run any time.")
    price = rule["max_price"]
    if price in ("", None):
        rule["max_price"] = None
    elif isinstance(price, bool) or not isinstance(price, int | float) or not -1 <= price <= 20:
        raise RuleError("Give the highest price as dollars per kWh, like 0.30.")
    return rule


@dataclass(frozen=True)
class Conditions:
    """What's happening, for rules to decide on: W going to the grid on average over the last few minutes (negative:
    drawn from it; None: not known), and the price of power now ($/kWh)."""

    export_w: float | None
    price: float | None


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def in_window(rule: dict[str, Any], now: float) -> bool:
    if rule.get("from") is None:
        return True
    lt = time.localtime(now)
    m, start, end = lt.tm_hour * 60 + lt.tm_min, _minutes(rule["from"]), _minutes(rule["until"])
    return start <= m < end if start < end else m >= start or m < end  # a window past midnight wraps


def end_of_day(now: float) -> int:
    lt = time.localtime(now)
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + 1, 0, 0, 0, 0, 0, -1)))


def decide(rule: dict[str, Any], state: dict[str, Any], on: bool, c: Conditions, now: float) -> tuple[bool, str] | None:
    """Whether to switch the device (on: whether it's on now) and why, in a few words; None to leave it. `state` is what
    the rule last did: `at` (when it last switched it), `on_by_rule` (it's on because the rule switched it on), and
    `paused_until` (it was switched by hand)."""
    if not rule.get("enabled") or state.get("paused_until", 0) > now:
        return None
    if now - state.get("at", 0) < MIN_MINUTES * 60:
        return None
    if not in_window(rule, now):
        return (False, "outside its hours") if on and state.get("on_by_rule") else None
    if on and rule.get("max_price") is not None and c.price is not None and c.price > rule["max_price"]:
        return False, "power costs more than its limit"
    if c.export_w is None:
        return None
    if not on and c.export_w >= rule["start_w"]:
        if rule.get("max_price") is not None and c.price is not None and c.price > rule["max_price"]:
            return None
        return True, "spare solar"
    if on and state.get("on_by_rule", True) and -c.export_w >= rule["stop_w"]:
        return False, "no spare solar"
    return None
