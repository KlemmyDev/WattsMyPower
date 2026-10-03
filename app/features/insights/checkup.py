"""
The Health page's checkup: one line for each part of the system, green, amber or red, with why.

It's judged from the same facts as the alerts (app.features.alerts.rules), and an alert that's out
for a part makes it red, so the page and the notifications never disagree. Each line also points at
the card on the page with the detail.
"""

from __future__ import annotations

import statistics
import time
from typing import Any, Literal

from app.features.alerts.rules import Facts, clock, span

Status = Literal["ok", "warn", "bad", "unknown"]

GOOD_COVERAGE = 0.97  # share of 5-minute readings recorded before gaps are worth mentioning
PANELS_OK = 0.9  # median clear-day output against expected
PANELS_BAD = 0.75  # the solar underperforming alert's default
CLEAR_DAYS = 5  # recent clear days the panels are judged on
SOH_BAD = 70.0
SOH_DROP = 3.0  # points of health lost over three months worth a mention
EFFICIENCY_LOW = 80.0
WARRANTY_NEAR = 90.0
FORECAST_OK = 0.25  # day-ahead error as a share of a typical day


def short_date(date: str) -> str:
    """ "2026-09-12" as "12 Sep"."""
    lt = time.strptime(date, "%Y-%m-%d")
    return f"{lt.tm_mday} {time.strftime('%b', lt)}"


def item(id: str, name: str, status: Status, summary: str, anchor: str) -> dict[str, Any]:
    return {"id": id, "name": name, "status": status, "summary": summary, "anchor": anchor}


def inverter(f: Facts, coverage: dict[str, Any] | None, active: set[str]) -> dict[str, Any]:
    name, anchor = "Inverter and readings", "h-data"
    if not f.hybrid_connected:
        return item("inverter", name, "unknown", "No inverter is connected yet.", anchor)
    if not f.fresh(f.last_success):
        since = f"since {clock(f.last_success, f.now)}" if f.last_success else "yet"
        return item("inverter", name, "bad", f"No readings {since}.", anchor)
    if f.frozen_since is not None or "readings_frozen" in active:
        since = clock(f.frozen_since, f.now) if f.frozen_since else "a while"
        return item("inverter", name, "bad", f"Answering, but with the same readings since {since}.", anchor)
    if coverage and coverage["share"] < GOOD_COVERAGE:
        gap = coverage.get("longest")
        worst = f" The longest gap was {span(gap['seconds'])}, on {clock(gap['at'], f.now)}." if gap else ""
        return item(
            "inverter",
            name,
            "warn",
            f"{coverage['share']:.0%} of readings recorded over the last {coverage['days']} days.{worst}",
            anchor,
        )
    share = f" {coverage['share']:.1%} of readings recorded over the last {coverage['days']} days." if coverage else ""
    return item("inverter", name, "ok", f"Answering every minute.{share}", anchor)


def second_inverter(f: Facts, active: set[str]) -> dict[str, Any] | None:
    if f.pv2 is None:
        return None
    name, anchor = "Second inverter", "h-data"
    last = f.pv2.get("last_success")
    if f.fresh(last):
        return item("pv2", name, "ok", "Answering, and its solar is being counted.", anchor)
    if "pv2_offline" in active:
        return item(
            "pv2", name, "bad", f"Not answering since {clock(last, f.now) if last else 'it was added'}.", anchor
        )
    if f.daylight_since is None:
        when = f" It last answered at {clock(last, f.now)}." if last else ""
        return item("pv2", name, "ok", f"Asleep for the night, as it should be.{when}", anchor)
    return item("pv2", name, "warn", "Hasn't answered since the sun came up.", anchor)


def panels(perf: dict[str, Any] | None, active: set[str]) -> dict[str, Any]:
    name, anchor = "Solar panels", "h-sp"
    if not perf or not perf.get("days"):
        return item("panels", name, "unknown", "Needs a few days of readings and weather to judge.", anchor)
    clear = [d["ratio"] for d in perf["days"] if d.get("clear") and d.get("ratio") is not None][-CLEAR_DAYS:]
    if not clear:
        return item("panels", name, "unknown", "Waiting for a clear day to judge by.", anchor)
    ratio = statistics.median(clear)
    causes = perf.get("causes") or {}
    hints = []
    if causes.get("dust"):
        d = causes["dust"]
        hints.append(
            f"rain on {short_date(d['date'])} lifted output by {d['after'] - d['before']:.0%}, so dust may be a factor"
        )
    if causes.get("shade"):
        s = causes["shade"]
        hints.append(f"{s['part']}s are {s['drop']:.0%} down on the rest of the day lately")
    if causes.get("capped") and causes["capped"]["days"]:
        hints.append(f"the inverter capped output on {causes['capped']['days']} days")
    hint = f" Lately {hints[0]}." if hints else ""
    status: Status = (
        "bad" if "solar_underperforming" in active or ratio < PANELS_BAD else "warn" if ratio < PANELS_OK else "ok"
    )
    days = f"last {len(clear)} clear {'day' if len(clear) == 1 else 'days'}"
    return item(
        "panels", name, status, f"{ratio:.0%} of what they usually make in that weather, over the {days}.{hint}", anchor
    )


def battery(insights: dict[str, Any], active: set[str]) -> dict[str, Any] | None:
    life = insights.get("lifetime") or {}
    months = [m for m in (insights.get("battery") or {}).get("months") or [] if m.get("soh") or m.get("efficiency")]
    if not life.get("battery_kwh") and life.get("soh") is None:
        return None  # no battery
    name, anchor = "Battery", "h-bhl"
    soh = life.get("soh")
    if "battery_not_charging" in active:
        return item("battery", name, "bad", "Not charging while solar goes to the grid.", anchor)
    if soh is not None and soh < SOH_BAD:
        return item("battery", name, "bad", f"Its health is down to {soh:.0f}%.", anchor)
    sohs = [m["soh"] for m in months if m.get("soh") is not None]
    if len(sohs) >= 4 and sohs[-4] - sohs[-1] >= SOH_DROP:
        return item(
            "battery", name, "warn", f"Its health fell {sohs[-4] - sohs[-1]:.0f} points over three months.", anchor
        )
    # The latest whole month: this one's so far is too short to judge.
    whole = [m for m in months if m["month"] < time.strftime("%Y-%m")]
    eff = next((m["efficiency"] for m in reversed(whole) if m.get("efficiency") is not None), None)
    if eff is not None and eff < EFFICIENCY_LOW:
        return item("battery", name, "warn", f"Only {eff:.0f}% of what went in came back out last month.", anchor)
    w = insights.get("warranty") or {}
    if max(w.get("time_pct") or 0, w.get("energy_pct") or 0) >= WARRANTY_NEAR:
        return item("battery", name, "warn", "Near the end of its warranty.", anchor)
    parts = [f"health {soh:.0f}%" if soh is not None else None, f"{eff:.0f}% round-trip efficiency" if eff else None]
    said = ", ".join(p for p in parts if p)
    return item("battery", name, "ok", f"Working normally{f': {said}' if said else ''}.", anchor)


def forecast(accuracy: dict[str, Any] | None) -> dict[str, Any]:
    name, anchor = "Forecast", "forecast"
    if not accuracy or accuracy.get("mae_kwh") is None:
        return item("forecast", name, "unknown", "Comparisons start after its first full day.", anchor)
    mae, typical = accuracy["mae_kwh"], accuracy.get("actual_mean") or 0
    rel = mae / typical if typical else 1
    days = len(accuracy.get("days") or [])
    summary = f"Out by {mae:.1f} kWh a day on average over the last {days} days."
    if rel <= FORECAST_OK:
        return item("forecast", name, "ok", summary, anchor)
    return item("forecast", name, "warn", f"{summary} It keeps learning from your system.", anchor)


def checkup(
    f: Facts,
    active: set[str],
    insights: dict[str, Any],
    coverage: dict[str, Any] | None,
    accuracy: dict[str, Any] | None,
) -> dict[str, Any]:
    items = [
        inverter(f, coverage, active),
        second_inverter(f, active),
        panels(insights.get("performance"), active),
        battery(insights, active),
        forecast(accuracy),
    ]
    rows = [i for i in items if i is not None]
    worst = next((s for s in ("bad", "warn") if any(i["status"] == s for i in rows)), "ok")
    return {"checked_at": int(f.now), "status": worst, "items": rows}
