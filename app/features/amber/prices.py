"""
Amber's priced intervals, turned into the prices we store and cost with, and looking up the price
in force at a moment.

What the API docs say (the `Interval` schema in Amber's OpenAPI spec, api.amber.com.au/v1):

- `perKwh` is the "number of cents you will pay per kilowatt-hour (c/kWh) - includes GST". Every
  channel is priced from the bill's point of view, as what you pay per kWh on that channel. So on
  the `feedIn` channel a negative `perKwh` is money you're paid for each kWh exported, and a positive
  one is a charge for exporting (as happens when wholesale prices go negative in the middle of a
  sunny day). Amber's own Home Assistant integration flips feed-in's sign for the same reason.
- `endTime` is the interval's end in UTC. `startTime` is one second past its start (02:00:01Z for
  the interval from 02:00 to 02:30), so the start is taken as `endTime - duration` instead.
- `duration` is the interval's length in minutes: 30, or 5 for sites billed on 5-minute prices
  (`intervalLength` on the site). Prices come at the site's own length unless asked otherwise.
- `type` is ActualInterval (the final price), ForecastInterval, or CurrentInterval (the interval
  under way: an estimate until `estimate` turns false in its last 5 minutes).

What we store, in $/kWh including GST, as it lands on the bill:

    general, controlledLoad:  rate =  perKwh / 100   what a kWh from the grid costs
    feedIn:                   rate = -perKwh / 100   what a kWh sent to the grid earns
                                                     (negative: exporting costs you)

so a feed-in price reads like a feed-in tariff, the same way round as the other tariff types'.
"""

from __future__ import annotations

import bisect
import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

CHANNELS = ("general", "feedIn", "controlledLoad")


@dataclass(frozen=True)
class Price:
    channel: str
    ts: int  # interval start, unix seconds
    duration: int  # seconds
    rate: float  # $/kWh incl. GST; feed-in is what a kWh exported earns
    actual: bool  # a final price, not a forecast


def to_rate(channel: str, per_kwh: float) -> float:
    """Amber's c/kWh (what you pay on that channel) as $/kWh, with feed-in turned into what you earn."""
    dollars = float(per_kwh) / 100
    return -dollars if channel == "feedIn" else dollars


def _is_actual(interval: dict[str, Any]) -> bool:
    kind = interval.get("type")
    if kind == "ActualInterval":
        return True
    # The interval under way is final once Amber stops calling it an estimate.
    return kind == "CurrentInterval" and interval.get("estimate") is False


def convert(intervals: Iterable[dict[str, Any]]) -> list[Price]:
    """The intervals of a /prices or /prices/current response as prices. Malformed entries are skipped."""
    out = []
    for i in intervals:
        try:
            channel = i["channelType"]
            minutes = int(i["duration"])
            end = dt.datetime.fromisoformat(str(i["endTime"]).replace("Z", "+00:00"))
            if channel not in CHANNELS or minutes <= 0 or end.tzinfo is None:
                continue
            out.append(
                Price(
                    channel=channel,
                    ts=int(end.timestamp()) - minutes * 60,
                    duration=minutes * 60,
                    rate=round(to_rate(channel, i["perKwh"]), 6),
                    actual=_is_actual(i),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return out


class PriceLookup:
    """The price in force at any moment, from one channel's intervals (oldest first)."""

    def __init__(self, rows: Iterable[tuple[int, int, float]]):
        rows = list(rows)  # (ts, duration, rate)
        self._starts = [r[0] for r in rows]
        self._rows = rows

    def at(self, ts: int) -> float | None:
        """The rate of the interval covering ts, or None if there's no price for that time."""
        i = bisect.bisect_right(self._starts, ts) - 1
        if i < 0:
            return None
        start, duration, rate = self._rows[i]
        return rate if ts < start + duration else None

    def over(self, start: int, end: int) -> tuple[int, float]:
        """How many seconds of [start, end) have a price, and the sum of rate × seconds over them
        (so their time-weighted average is the second over the first)."""
        i = max(0, bisect.bisect_right(self._starts, start) - 1)
        covered, total = 0, 0.0
        while i < len(self._rows) and self._rows[i][0] < end:
            s, duration, rate = self._rows[i]
            overlap = min(end, s + duration) - max(start, s)
            if overlap > 0:
                covered += overlap
                total += rate * overlap
            i += 1
        return covered, total

    def __len__(self) -> int:
        return len(self._rows)
