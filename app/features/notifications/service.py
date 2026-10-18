"""
Telling you what's happening: each poll the rules (rules.py) look at the live facts, and what they find goes out
through the channels you've set up: the browsers that turned notifications on (webpush.py), an ntfy topic and a
webhook (channels.py).

What keeps it from being noisy, all of it yours to set:
- a rule only speaks once its problem has lasted its number of minutes (debounce);
- and then no more than once in its cooldown, though it still follows up with an all-clear when it ends;
- quiet hours hold everything back except the urgent (the grid going down);
- a limit on how many go out in a day, urgent ones excepted.

Everything said, and how each channel took it, is kept (the history), so a notification that didn't arrive says why.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from app.core.database import Database
from app.core.http import post
from app.features.notifications import channels as channel_mod
from app.features.notifications.channels import KINDS, DeliveryError, Message, Send
from app.features.notifications.repository import Channel, NotificationsRepository, RuleSettings
from app.features.notifications.rules import BY_ID, RULES, Check, Facts, Rule, RuleState, span
from app.features.notifications.webpush import PushService

if TYPE_CHECKING:
    from app.features.live.service import LiveService

log = logging.getLogger(__name__)

CHANNELS = ("push", "ntfy", "webhook")  # push: the browsers
MAX_CAP = 200


def minutes_of(hhmm: str) -> int | None:
    """ "22:30" as minutes into the day, or None if it isn't a time."""
    try:
        hour, minute = (int(x) for x in hhmm.split(":"))
    except (ValueError, AttributeError):
        return None
    return hour * 60 + minute if 0 <= hour < 24 and 0 <= minute < 60 else None


def in_quiet(quiet: dict[str, Any], ts: float) -> bool:
    """Whether `ts` (local time) falls inside the quiet hours, which may run past midnight (22:00 to 07:00)."""
    if not quiet.get("enabled"):
        return False
    a, b = minutes_of(str(quiet.get("start"))), minutes_of(str(quiet.get("end")))
    if a is None or b is None or a == b:
        return False
    lt = time.localtime(ts)
    now = lt.tm_hour * 60 + lt.tm_min
    return a <= now < b if a < b else now >= a or now < b


class Notifier:
    def __init__(
        self, db: Database, live: LiveService, send: Send = post, clock: Callable[[], float] = time.time
    ) -> None:
        self.db = db
        self.live = live
        self.send = send
        self.clock = clock
        self.repo = NotificationsRepository(db)
        self.push = PushService(db, send)
        self._lock = threading.Lock()

    # -- watching -----------------------------------------------------------------
    def facts(self, now: float) -> Facts:
        live = self.live
        grid = live.grid_connection()
        return Facts(
            now=now,
            snapshot=live.latest,
            hybrid_connected=live.inverter is True,
            last_success=live.last_success,
            poll_interval=live.config.poll_interval,
            off_grid=grid["off_grid"],
            off_grid_since=live.off_grid_since,
        )

    def evaluate(self, now: float | None = None) -> None:
        """One look at every rule. Called after each poll (and while the inverter can't be reached)."""
        now = self.clock() if now is None else now
        with self._lock:
            facts = self.facts(now)
            settings = self.repo.rules()
            states = self.repo.states()
            for rule in RULES:
                cfg = settings.get(rule.id)
                state = states.get(rule.id) or RuleState(rule.id)
                if not (cfg.enabled if cfg else rule.enabled):
                    if state.pending_since is not None or state.active_since is not None:
                        self.repo.save_state(RuleState(rule.id, last_fired=state.last_fired))  # switched off: forget
                    continue
                values = rule.values(cfg.values if cfg else None)
                before = (state.pending_since, state.active_since, state.last_fired, state.quiet)
                try:
                    self._step(rule, values, cfg.channels if cfg else None, rule.check(facts, values), state, now)
                except Exception:
                    log.exception("Notification rule %s failed", rule.id)
                if before != (state.pending_since, state.active_since, state.last_fired, state.quiet):
                    self.repo.save_state(state)

    def _step(
        self,
        rule: Rule,
        values: dict[str, float],
        channels: list[str] | None,
        check: Check,
        state: RuleState,
        now: float,
    ) -> None:
        """Move a rule on by one answer: start waiting, tell you, hold back, or say it's over."""
        wait = values.get("minutes", 0) * 60
        cooldown = values.get("cooldown_hours", 0) * 3600
        if check.state == "bad":
            if state.active_since is not None:
                return
            state.pending_since = state.pending_since or now
            if now - state.pending_since < wait:
                return
            state.active_since = check.since or state.pending_since
            state.pending_since = None
            if state.last_fired is not None and now - state.last_fired < cooldown:
                state.quiet = True  # too soon after the last: say nothing, now or when it ends
                self.repo.add_history(
                    int(now), rule.id, "held", check.title, check.message, {"held": "Told you recently (cooldown)"}
                )
                return
            state.quiet = False
            state.last_fired = now
            self.send_message(
                Message("alert", rule.id, check.title, check.message, int(now), rule.urgent), rule, channels
            )
        elif check.state == "ok":
            state.pending_since = None
            if state.active_since is None:
                return
            lasted = span(max(60, now - state.active_since))
            quiet, state.active_since, state.quiet = state.quiet, None, False
            if rule.resolves and not quiet and check.clear_title:
                body = f"{check.clear_message} It lasted {lasted}."
                self.send_message(
                    Message("resolved", rule.id, check.clear_title, body, int(now), False), rule, channels
                )
        elif state.active_since is None:
            state.pending_since = None

    # -- sending ------------------------------------------------------------------
    def send_message(self, msg: Message, rule: Rule | None, channels: list[str] | None = None) -> dict[str, str]:
        """Send through the chosen channels (all by default), unless quiet hours or the day's limit hold it back,
        and record how each took it."""
        now = msg.ts
        options = self.repo.options()
        if not msg.urgent and msg.event != "test":
            held = None
            if in_quiet(options["quiet"], now):
                held = "Quiet hours"
            else:
                lt = time.localtime(now)
                midnight = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))
                if self.repo.sent_since(midnight) >= int(options["daily_cap"]):
                    held = "Daily limit reached"
            if held:
                self.repo.add_history(now, msg.rule, "held", msg.title, msg.body, {"held": held})
                return {"held": held}
        url = rule.page if rule else "/"
        wanted = [c for c in CHANNELS if channels is None or c in channels]
        results: dict[str, str] = {}
        if "push" in wanted and self.push.any():
            try:
                self.push.send_all(msg, url)
                results["push"] = "ok"
            except DeliveryError as e:
                results["push"] = str(e)
        configured = self.repo.channels()
        for kind in ("ntfy", "webhook"):
            ch = configured.get(kind)
            if kind in wanted and ch and ch.enabled:
                try:
                    channel_mod.deliver(kind, ch.config, msg, self.send)
                    results[kind] = "ok"
                except DeliveryError as e:
                    results[kind] = str(e)
        if not results:
            results["none"] = "No channel is set up to receive it."
        self.repo.add_history(now, msg.rule, msg.event, msg.title, msg.body, results)
        return results

    def test(self, target: str) -> dict[str, str]:
        """A test notification to one place: "push" (every browser, or one by its id), "ntfy" or "webhook".
        Raises DeliveryError, saying what went wrong."""
        now = int(self.clock())
        msg = Message("test", None, "Test from WattsMyPower", "If you can read this, notifications reach you.", now)
        if target == "ntfy" or target == "webhook":
            ch = self.repo.channels().get(target)
            if not ch:
                raise DeliveryError("Save its settings first.")
            channel_mod.deliver(target, ch.config, msg, self.send)
        else:
            self.push.send_all(msg, "/", None if target == "push" else target)
        self.repo.add_history(now, None, "test", msg.title, msg.body, {target if target in KINDS else "push": "ok"})
        return {"result": "ok"}

    # -- the page ------------------------------------------------------------------
    def view(self) -> dict[str, Any]:
        saved = self.repo.rules()
        states = self.repo.states()
        channels = self.repo.channels()
        rules = []
        for r in RULES:
            cfg = saved.get(r.id)
            st = states.get(r.id)
            rules.append(
                {
                    "id": r.id,
                    "name": r.name,
                    "description": r.description,
                    "enabled": cfg.enabled if cfg else r.enabled,
                    "urgent": r.urgent,
                    "channels": cfg.channels if cfg else None,
                    "settings": [
                        {"key": s.key, "label": s.label, "unit": s.unit, "min": s.min, "max": s.max, "step": s.step}
                        for s in r.settings
                    ],
                    "values": r.values(cfg.values if cfg else None),
                    "active_since": st.active_since if st and not st.quiet else None,
                }
            )
        out_channels = {}
        for kind in KINDS:
            ch = channels.get(kind)
            out_channels[kind] = {
                "enabled": bool(ch and ch.enabled),
                "config": channel_mod.masked(kind, ch.config) if ch else {},
            }
        return {
            "rules": rules,
            "channels": out_channels,
            "fields": {
                k: [{"key": f.key, "label": f.label, "required": f.required} for f in v.fields]
                for k, v in KINDS.items()
            },
            "options": self.repo.options(),
            "push": {
                "public_key": self.push.keys().public,
                "devices": [s.view() for s in self.push.subscriptions()],
            },
            "history": self.repo.history(),
        }

    # -- changes -------------------------------------------------------------------
    def save_channel(self, kind: str, body: dict[str, Any]) -> None:
        """Save a channel's settings and whether it's on. Raises ValueError, in words."""
        stored: Channel | None = self.repo.channels().get(kind)
        config = channel_mod.clean(kind, body, stored.config if stored else None)
        self.repo.save_channel(kind, bool(body.get("enabled", True)), config)

    def save_rule(self, rule_id: str, body: dict[str, Any]) -> None:
        """Turn a rule on or off, set its numbers and which channels it uses. Raises ValueError, in words."""
        rule = BY_ID.get(rule_id)
        if rule is None:
            raise ValueError(f"There's no notification called {rule_id!r}.")
        current = self.repo.rules().get(rule_id)
        values = dict(current.values) if current else {}
        for key, raw in (body.get("values") or {}).items():
            setting = next((s for s in rule.settings if s.key == key), None)
            if setting is None:
                continue
            try:
                number = float(raw)
            except (TypeError, ValueError):
                raise ValueError(f"{setting.label} needs a number.") from None
            if not setting.min <= number <= setting.max:
                raise ValueError(f"{setting.label} must be between {setting.min:g} and {setting.max:g} {setting.unit}.")
            values[key] = number
        channels = body.get("channels", current.channels if current else None)
        if channels is not None and (not isinstance(channels, list) or any(c not in CHANNELS for c in channels)):
            raise ValueError("Choose from browsers, ntfy and webhook.")
        enabled = bool(body.get("enabled", current.enabled if current else rule.enabled))
        self.repo.save_rule(rule_id, RuleSettings(enabled, values, channels))

    def save_options(self, body: dict[str, Any]) -> None:
        """Quiet hours and the day's limit. Raises ValueError, in words."""
        options = self.repo.options()
        quiet = body.get("quiet")
        if isinstance(quiet, dict):
            start, end = (
                str(quiet.get("start", options["quiet"]["start"])),
                str(quiet.get("end", options["quiet"]["end"])),
            )
            if minutes_of(start) is None or minutes_of(end) is None:
                raise ValueError("Quiet hours need times like 22:00 and 07:00.")
            options["quiet"] = {
                "enabled": bool(quiet.get("enabled", options["quiet"]["enabled"])),
                "start": start,
                "end": end,
            }
        if "daily_cap" in body:
            try:
                cap = int(body["daily_cap"])
            except (TypeError, ValueError):
                raise ValueError("The daily limit needs a whole number.") from None
            if not 1 <= cap <= MAX_CAP:
                raise ValueError(f"The daily limit must be between 1 and {MAX_CAP}.")
            options["daily_cap"] = cap
        self.repo.save_options(options)
