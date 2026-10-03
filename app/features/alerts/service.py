"""
Alerts and notifications: watching the system and saying when something needs attention.

A background task follows the live status (LiveService.publish, once per poll or collector
retry, and at least every minute) and evaluates every rule switched on (rules.py). Each rule's
progress lives in the alert_state table, so a restart picks up where it left off rather than
repeating alerts already sent. For each rule:

- debounce: a problem has to last the rule's debounce before it's reported, and starts over
  whenever the rule can't tell or it clears;
- one alert per problem: while an alert is out, nothing more is sent about it;
- cooldown: after an alert, the same rule waits this long before it sends another, so a problem
  that comes and goes is reported once, then again only if it's still there after the cooldown;
- resolved: when the problem clears, a follow-up says so (only if the alert reached someone);
- retry: an alert that reached no channel (often the same outage that cut the home internet) is
  tried again every few minutes while it lasts.

Nothing is evaluated until a channel is set up, so alerts are off on a fresh install.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
from dataclasses import asdict, replace
from typing import Any

from app.core.database import Database
from app.core.http import post
from app.features.alerts.channels import KINDS, DeliveryError, Message, Send, clean, deliver, masked
from app.features.alerts.repository import AlertsRepository, Channel, RuleSettings
from app.features.alerts.rules import BY_ID, RULES, Check, Facts, Rule, RuleState, Values
from app.features.alerts.sun import daylight_since, elevation
from app.features.amber.repository import PriceRepository
from app.features.insights.service import InsightsService
from app.features.live.ingest import NO_INVERTER
from app.features.live.service import LiveService, Status
from app.features.readings.repository import ReadingsRepository
from app.features.settings.store import SettingsStore
from app.features.tariffs.costs import daily_costs
from app.features.tariffs.store import TariffStore

log = logging.getLogger(__name__)

TICK = 60  # seconds: evaluate at least this often, even when no status arrives
RETRY = 300  # seconds between attempts to deliver an alert that reached no channel
TEST_TITLE = "WattsMyPower test"
TEST_BODY = "This is a test from WattsMyPower. Alerts will arrive like this."


class AlertsService:
    def __init__(
        self,
        db: Database,
        live: LiveService,
        settings: SettingsStore,
        readings: ReadingsRepository,
        tariffs: TariffStore,
        insights: InsightsService,
        send: Send = post,
        prices: PriceRepository | None = None,
    ):
        self.repo = AlertsRepository(db)
        self.live = live
        self.settings = settings
        self.readings = readings
        self.tariffs = tariffs
        self.insights = insights
        self.prices = prices  # Amber's stored prices, for an Amber tariff
        self.send = send
        self._lock = threading.Lock()
        self._perf: tuple[str, dict[str, Any] | None] | None = None  # (hour checked, performance)
        self._queue: asyncio.Queue[Status] | None = None
        self._task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------ background task
    async def start(self) -> None:
        self._queue = self.live.subscribe()
        self._task = asyncio.create_task(self._run(self._queue))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._queue:
            self.live.unsubscribe(self._queue)

    async def _run(self, queue: asyncio.Queue[Status]) -> None:
        while True:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(queue.get(), timeout=TICK)
            while not queue.empty():  # only the latest status matters
                queue.get_nowait()
            try:
                await asyncio.to_thread(self.evaluate, self.facts())
            except asyncio.CancelledError:
                raise
            except Exception:  # never let one bad evaluation stop the alerts
                log.exception("Evaluating alerts failed")

    # ------------------------------------------------------------------ facts
    def facts(self, now: float | None = None) -> Facts:
        """The live status, the sun, and lookups the rules can ask for. Read on the event loop."""
        now = time.time() if now is None else now
        live = self.live
        lat, lon = self.settings.get("latitude"), self.settings.get("longitude")
        return Facts(
            now=now,
            snapshot=live.latest,
            hybrid_connected=live.last_success is not None or live.last_error != NO_INVERTER,
            last_success=live.last_success,
            error=live.last_error,
            poll_interval=live.config.poll_interval,
            pv2=dict(live.pv2) if live.pv2 is not None else None,
            reserve=live.reserve(),
            sun=elevation(lat, lon, now),
            daylight_since=daylight_since(lat, lon, now),
            frozen_since=live.frozen_since,
            performance=self._performance,
            yesterday=lambda: self._yesterday(now),
        )

    def _performance(self) -> dict[str, Any] | None:
        """Solar performance from the Health page's figures (whole days only change once a day: checked hourly)."""
        hour = time.strftime("%Y-%m-%d %H")
        if self._perf and self._perf[0] == hour:
            return self._perf[1]
        perf: dict[str, Any] | None = self.insights.build(None, 0.0).get("performance")
        self._perf = (hour, perf)
        return perf

    def _yesterday(self, now: float) -> dict[str, Any] | None:
        """Yesterday's energy and cost, priced the same way as the Bills page."""
        lt = time.localtime(now)
        start = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday - 1, 0, 0, 0, 0, 0, -1)))
        end = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))
        date = time.strftime("%Y-%m-%d", time.localtime(start))
        t, tables = self.tariffs.current()
        costs = daily_costs(self.readings, t, tables, start, end, prices=self.prices)["days"]
        day = next((d for d in costs if d["date"] == date), None)
        if day is None:
            return None
        pv = next((d.get("daily_pv") for d in self.readings.daily(start, end) if d["date"] == date), None)
        return {
            "date": date,
            "pv": pv,
            "home": day["home_kwh"],
            "imp": day["import_kwh"],
            "exp": day["export_kwh"],
            "cost": day["net_cost"],
            "credit": day["feed_in_credit"],
            "supply": day["supply"],
            # On Amber: energy costed at the fallback rates because Amber had no price for its time.
            "unpriced": day.get("unpriced_kwh") or 0.0,
        }

    # ------------------------------------------------------------------ evaluation
    def evaluate(self, facts: Facts) -> None:
        """Check every rule switched on against `facts`, and send what needs sending."""
        with self._lock:
            channels = [c for c in self.repo.channels().values() if c.enabled]
            states = self.repo.states()
            if not channels:  # alerts are off: start afresh when they're turned on
                if states:
                    self.repo.clear_state()
                return
            saved = self.repo.rules()
            for rule in RULES:
                setting = saved.get(rule.id)
                if not (setting.enabled if setting else rule.enabled):
                    if rule.id in states:
                        self.repo.clear_state(rule.id)
                    continue
                values = rule.values(setting.settings if setting else None)
                state = states.get(rule.id) or RuleState(rule.id)
                try:
                    check = rule.check(facts, values, state)
                except Exception:
                    log.exception("Alert rule %s failed", rule.id)
                    continue
                new = self._step(rule, values, state, check, facts.now, channels)
                if new != state:
                    self.repo.save_state(new)

    def _step(
        self, rule: Rule, values: Values, state: RuleState, check: Check, now: float, channels: list[Channel]
    ) -> RuleState:
        """A rule's next state, sending whatever its check calls for."""
        s = replace(state, data=dict(state.data))
        if check.state == "report":  # a scheduled message (the daily summary): send it once
            if check.message:
                msg = Message("summary", rule.id, check.title, check.message, int(now))
                status, error = self._deliver(channels, msg)
                self.repo.add_event(now, rule.id, "summary", check.title, check.message, status, error)
            s.data.update(check.data or {})
        elif check.state == "bad":
            if s.active_since is None:
                if s.pending_since is None:
                    s.pending_since = check.since or now
                due = now - s.pending_since >= rule.debounce(values)
                cooled = s.last_fired is None or now - s.last_fired >= (rule.cooldown or 0)
                if due and cooled:
                    msg = Message("alert", rule.id, check.title, check.message, int(now), rule.urgent)
                    status, error = self._deliver(channels, msg)
                    s.event_id = self.repo.add_event(now, rule.id, "alert", check.title, check.message, status, error)
                    s.active_since = s.last_fired = now
                    s.pending_since = None
                    s.delivered = status != "failed"
                    s.retry_at = None if s.delivered else now + RETRY
        elif check.state == "ok":
            s.pending_since = None
            if s.active_since is not None:
                if s.event_id is not None:
                    self.repo.update_event(s.event_id, resolved_at=int(now))
                if s.delivered and check.message:
                    msg = Message("resolved", rule.id, check.title, check.message, int(now))
                    status, error = self._deliver(channels, msg)
                    self.repo.add_event(now, rule.id, "resolved", check.title, check.message, status, error)
                s.active_since = s.retry_at = s.event_id = None
                s.delivered = False
        else:  # can't tell: a problem just noticed has to be seen afresh; an alert out stays out
            s.pending_since = None
        if s.active_since is not None and not s.delivered and s.retry_at is not None and now >= s.retry_at:
            self._retry(s, now, channels)
        return s

    def _retry(self, s: RuleState, now: float, channels: list[Channel]) -> None:
        """Try again to deliver an alert that reached no channel."""
        event = self.repo.event(s.event_id) if s.event_id is not None else None
        if event is None:
            s.retry_at = None
            return
        msg = Message("alert", s.rule, event["title"], event["message"], int(now), BY_ID[s.rule].urgent)
        status, error = self._deliver(channels, msg)
        s.delivered = status != "failed"
        s.retry_at = None if s.delivered else now + RETRY
        self.repo.update_event(event["id"], status=status, error=error)

    def _deliver(self, channels: list[Channel], msg: Message) -> tuple[str, str | None]:
        """Send to every channel. (sent, partial or failed; what went wrong, by channel)."""
        errors = []
        for c in channels:
            try:
                deliver(c.kind, c.config, msg, self.send)
            except DeliveryError as e:
                errors.append(f"{KINDS[c.kind].label}: {e}")
            except Exception as e:  # a bug in a channel shouldn't stop the others
                log.exception("Sending through %s failed", c.kind)
                errors.append(f"{KINDS[c.kind].label}: {type(e).__name__}")
        if errors:
            log.warning("Alert %r not delivered everywhere: %s", msg.title, "; ".join(errors))
        status = "sent" if not errors else "failed" if len(errors) == len(channels) else "partial"
        return status, "; ".join(errors) or None

    # ------------------------------------------------------------------ settings (the API)
    def overview(self) -> dict[str, Any]:
        """Channels (secrets masked), rules with their settings and whether they're active, and recent history."""
        channels = self.repo.channels()
        saved = self.repo.rules()
        states = self.repo.states()
        return {
            "enabled": any(c.enabled for c in channels.values()),
            "channels": [self._channel_view(k, channels.get(k)) for k in KINDS],
            "rules": [self._rule_view(r, saved.get(r.id), states.get(r.id)) for r in RULES],
            "history": self.history(),
        }

    def history(self, limit: int = 50) -> list[dict[str, Any]]:
        events = self.repo.history(limit)
        return [{**e, "rule_name": BY_ID[e["rule"]].name if e["rule"] in BY_ID else e["rule"]} for e in events]

    def _channel_view(self, kind: str, c: Channel | None) -> dict[str, Any]:
        return {
            "kind": kind,
            "label": KINDS[kind].label,
            "configured": c is not None,
            "enabled": bool(c and c.enabled),
            "config": masked(kind, c.config if c else {}),
            "updated_at": c.updated_at if c else None,
        }

    def _rule_view(self, rule: Rule, saved: RuleSettings | None, state: RuleState | None) -> dict[str, Any]:
        values = rule.values(saved.settings if saved else None)
        return {
            "id": rule.id,
            "name": rule.name,
            "description": rule.description,
            "enabled": saved.enabled if saved else rule.enabled,
            "cooldown_hours": None if rule.cooldown is None else round(rule.cooldown / 3600, 1),
            "settings": [{**asdict(s), "value": values[s.key]} for s in rule.settings],
            "active_since": state.active_since if state else None,
        }

    def save_channel(self, kind: str, body: dict[str, Any]) -> dict[str, Any]:
        """Set up or change a channel. Raises ValueError, in words."""
        stored = self.repo.channels().get(kind)
        config = clean(kind, body, stored.config if stored else None)
        enabled = body.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError("Say whether the channel is on.")
        self.repo.save_channel(kind, enabled, config)
        return self._channel_view(kind, self.repo.channels()[kind])

    def remove_channel(self, kind: str) -> bool:
        if kind not in KINDS:
            raise LookupError(f"There's no alert channel called {kind!r}.")
        return self.repo.delete_channel(kind)

    def test_channel(self, kind: str, body: dict[str, Any]) -> dict[str, Any]:
        """Send a test through a channel: the settings in `body` if any (so a form can be tried before
        it's saved), else the saved ones. Raises ValueError for bad settings, DeliveryError if it fails."""
        if kind not in KINDS:
            raise LookupError(f"There's no alert channel called {kind!r}.")
        stored = self.repo.channels().get(kind)
        if not any(f.key in body for f in KINDS[kind].fields):
            if stored is None:
                raise ValueError(f"Set up {KINDS[kind].label} first.")
            body = stored.config
        config = clean(kind, body, stored.config if stored else None)
        deliver(kind, config, Message("test", None, TEST_TITLE, TEST_BODY, int(time.time())), self.send)
        return {"ok": True}

    def save_rule(self, rule_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Switch a rule on or off, or change its thresholds. Raises ValueError, in words."""
        rule = BY_ID.get(rule_id)
        if rule is None:
            raise LookupError(f"There's no alert called {rule_id!r}.")
        saved = self.repo.rules().get(rule_id)
        enabled = body.get("enabled", saved.enabled if saved else rule.enabled)
        if not isinstance(enabled, bool):
            raise ValueError("Say whether the alert is on.")
        values = rule.values(saved.settings if saved else None)
        changes = body.get("settings") or {}
        if not isinstance(changes, dict):
            raise ValueError("Settings must be an object.")
        for s in rule.settings:
            if s.key not in changes:
                continue
            try:
                value = float(changes[s.key])
            except (TypeError, ValueError):
                raise ValueError(f"{s.label} must be a number.") from None
            if not s.min <= value <= s.max or not value.is_integer():
                raise ValueError(f"{s.label} must be a whole number from {s.min:g} to {s.max:g} {s.unit}.")
            values[s.key] = value
        if unknown := set(changes) - {s.key for s in rule.settings}:
            raise ValueError(f"Unknown setting: {sorted(unknown)[0]}")
        self.repo.save_rule(rule_id, enabled, values)
        return self._rule_view(rule, RuleSettings(enabled, values), self.repo.states().get(rule_id))
