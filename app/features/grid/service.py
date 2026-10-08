"""
The grid (the Grid page, and the grid alerts): the wholesale market the house is connected to, and how the grid is
holding up, from three places.

- AEMO (aemo.py): the region's wholesale price and demand every five minutes, its prices ahead (refreshed every half
  hour, as AEMO's pre-dispatch is), and its market notices: where AEMO warns of tight supply (Lack of Reserve),
  load shedding and power system events. The region is the nem_region setting, or worked out from where the house
  is; "none" turns this off.
- The weather forecast: thunderstorms in the next day, the usual cause of a local blackout.
- The inverter: whether it's running off-grid (the grid's down), and the grid's voltage and frequency as it measures
  them.

What it adds up to is the outlook: normal, watch (worth knowing), warning (keep the battery charged) or outage.
Nothing here is kept in the database: after a restart the last day of prices and the latest notices are fetched again.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import threading
import time
from collections.abc import Callable
from typing import Any

from app.features.grid.aemo import REGION_NAMES, REGIONS, AemoClient, AemoError
from app.features.inverters.sungrow.sh_rs import OFF_GRID
from app.features.inverters.types import Snapshot
from app.features.settings.store import SettingsStore
from app.features.weather.service import WeatherService

log = logging.getLogger(__name__)

EVERY = 300  # AEMO dispatches every five minutes
AFTER = 45  # seconds after the interval for its figures to be published
FORECAST_EVERY = 1800  # pre-dispatch runs every half hour; the report is ~400 kB, so it isn't fetched every time
NOTICES_KEPT = 2 * 86400
NOTICE_ACTIVE = 12 * 3600  # a notice not cancelled is taken as current for this long
STORM_AHEAD = 24 * 3600
STORM_CODES = {95, 96, 99}  # WMO weather codes: thunderstorm, with hail

# The supply voltage Australia's standard allows (AS 60038: 230 V +10 % / -6 %), and the frequency band the NEM is run
# in normally (49.85 to 50.15 Hz); outside 49.5 to 50.5 Hz something on the system has tripped.
VOLTAGE_LOW, VOLTAGE_HIGH = 216.0, 253.0
FREQ_LOW, FREQ_HIGH = 49.85, 50.15
FREQ_EVENT_LOW, FREQ_EVENT_HIGH = 49.5, 50.5
# A wholesale price this high ($/MWh) is a spike: supply is tight, or something's gone wrong.
SPIKE = 300.0

LEVELS = ("normal", "watch", "warning", "outage")
# Notice kinds worth an alert (the rest are shown on the page only).
ALERTING = {"lor2", "lor3", "load_shedding", "suspension", "price_cap"}

STATES = {"QLD": "QLD1", "NSW": "NSW1", "ACT": "NSW1", "VIC": "VIC1", "SA": "SA1", "TAS": "TAS1"}


def region_at(lat: float, lon: float, place: str | None = None) -> str | None:
    """The NEM region a house is in: from the state in its place name ("Paddington, QLD") when there is one, else
    roughly from where it is. None outside the NEM (WA and the NT have their own grids)."""
    if place:
        m = re.search(r"\b(QLD|NSW|ACT|VIC|SA|TAS|WA|NT)\b\s*$", place.strip())
        if m:
            return STATES.get(m.group(1))
    if not (-44.5 <= lat <= -9 and 112 <= lon <= 154.5):
        return None  # not in Australia
    if lat < -39.2:
        return "TAS1"
    if lon < 129 or (lon < 138 and lat > -26):
        return None  # WA, the NT
    if lon < 141:
        return "SA1"
    if lat > -29:
        return "QLD1"
    # The Murray, roughly: from (141, -34) to (150, -37.5).
    return "VIC1" if lat < -34 - (lon - 141) * 0.39 else "NSW1"


class GridService:
    def __init__(
        self,
        settings: SettingsStore,
        weather: WeatherService | None,
        latest: Callable[[], Snapshot | None],
        client: AemoClient | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.settings = settings
        self.weather = weather
        self.latest = latest
        self.client = client or AemoClient()
        self.clock = clock
        self._lock = threading.Lock()
        self._market: dict[str, dict[str, Any]] = {}  # region -> now
        self._prices: list[dict[str, Any]] = []  # the region's, oldest first
        self._prices_region: str | None = None
        self._forecast_at: float | None = None
        self._notices: dict[int, dict[str, Any]] = {}
        self._fetched_at: float | None = None
        self._error: str | None = None
        self._task: asyncio.Task[None] | None = None
        self._wake: asyncio.Event | None = None

    # ------------------------------------------------------------------ settings
    def enabled(self) -> bool:
        """Whether AEMO is followed: the house is in the NEM, and it hasn't been turned off."""
        return self.region()[0] is not None

    def region(self) -> tuple[str | None, bool]:
        """The NEM region, and whether it was worked out (True) rather than chosen."""
        chosen = self.settings.get_choice("nem_region")
        if chosen == "none":
            return None, False
        if chosen != "auto":
            return chosen, False
        lat, lon = self.settings.get("latitude"), self.settings.get("longitude")
        return region_at(lat, lon, self.settings.get_text("location_name")), True

    # ------------------------------------------------------------------ fetching
    async def start(self) -> None:
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def wake(self) -> None:
        """Fetch now (the region or the setting changed). Call from the event loop."""
        if self._wake:
            self._wake.set()

    async def _run(self) -> None:
        while True:
            if self.enabled():
                try:
                    await asyncio.to_thread(self.refresh)
                except Exception:  # a failed fetch must never end the loop
                    log.exception("Fetching AEMO's market data failed")
            assert self._wake is not None
            now = self.clock()
            wait = (now // EVERY + 1) * EVERY + AFTER - now
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=wait)
            self._wake.clear()

    def refresh(self) -> None:
        """Fetch the regions' prices now and the latest notices, and the prices ahead when they're due."""
        region, _ = self.region()
        now = self.clock()
        try:
            summary = self.client.summary()
            with self._lock:
                self._market = summary["regions"]
                for n in summary["notices"]:
                    self._notices[n["id"]] = n
                self._notices = {k: n for k, n in self._notices.items() if now - n["at"] <= NOTICES_KEPT}
                # Each five minutes' price goes onto the region's day of prices as it comes.
                at = self._market.get(region or "")
                if at and region == self._prices_region and self._prices and at["at"] > self._last_actual():
                    self._add_actual(at)
            due = (
                region != self._prices_region or self._forecast_at is None or now - self._forecast_at >= FORECAST_EVERY
            )
            if region and due:
                prices = self.client.prices(region)
                with self._lock:
                    self._prices, self._prices_region, self._forecast_at = prices, region, now
            with self._lock:
                self._fetched_at, self._error = now, None
        except AemoError as e:
            with self._lock:
                self._error = str(e)
            log.warning("AEMO: %s", e)

    def _last_actual(self) -> int:
        return max((p["at"] for p in self._prices if not p["forecast"]), default=0)

    def _add_actual(self, market: dict[str, Any]) -> None:
        """Put a five-minute price from the summary onto the day, before the forecast it replaces."""
        row = {"at": market["at"], "price": market["price"], "demand": market["demand"], "forecast": False}
        actual = [p for p in self._prices if not p["forecast"]]
        # A pre-dispatch half hour stays until it's over (its stamp is its end).
        ahead = [p for p in self._prices if p["forecast"] and p["at"] > row["at"]]
        self._prices = [*actual, row, *ahead]

    # ------------------------------------------------------------------ the page
    def view(self) -> dict[str, Any]:
        now = self.clock()
        region, auto = self.region()
        enabled = self.enabled()
        with self._lock:
            market = self._market.get(region or "") if enabled else None
            prices = list(self._prices) if enabled and region == self._prices_region else []
            notices = self._region_notices(region, now) if enabled else []
            fetched_at, error = self._fetched_at, self._error
        return {
            "enabled": enabled,
            "region": region,
            "region_name": REGION_NAMES.get(region or ""),
            "region_auto": auto,
            "market": market,
            "prices": [{"at": p["at"], "price": p["price"], "forecast": p["forecast"]} for p in prices],
            "notices": notices,
            "storms": self._storms(now),
            "outlook": self.outlook(now, notices=notices),
            "fetched_at": fetched_at,
            "error": error if enabled else None,
            "limits": {
                "voltage_low": VOLTAGE_LOW,
                "voltage_high": VOLTAGE_HIGH,
                "freq_low": FREQ_LOW,
                "freq_high": FREQ_HIGH,
                "spike": SPIKE,
            },
        }

    def _region_notices(self, region: str | None, now: float) -> list[dict[str, Any]]:
        """The region's notices, newest first, each marked active until it's cancelled or old. Call with the lock."""
        if not region:
            return []
        mine = sorted((n for n in self._notices.values() if region in n["regions"]), key=lambda n: (n["at"], n["id"]))
        out = []
        for i, n in enumerate(mine):
            cancelled = n["cancels"] or any(later["cancels"] and later["kind"] == n["kind"] for later in mine[i + 1 :])
            out.append({**n, "active": not cancelled and now - n["at"] <= NOTICE_ACTIVE})
        return out[::-1]

    def _storms(self, now: float) -> list[dict[str, Any]]:
        """Hours with thunderstorms in the forecast for the next day."""
        if self.weather is None:
            return []
        try:
            hours = self.weather.hours(int(now) - 3600, int(now) + STORM_AHEAD)
        except Exception:
            log.exception("Reading the weather for storms failed")
            return []
        return [
            {"ts": h["ts"], "code": int(h["code"]), "precip_prob": h.get("precip_prob")}
            for h in hours
            if h.get("code") is not None and int(h["code"]) in STORM_CODES and h["ts"] + 3600 > now
        ]

    # ------------------------------------------------------------------ the outlook
    def outlook(self, now: float | None = None, notices: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """How the grid's holding up: a level, and the reasons for it, most pressing first."""
        now = self.clock() if now is None else now
        if notices is None:
            region = self.region()[0]
            with self._lock:
                notices = self._region_notices(region, now) if self.enabled() else []
        reasons: list[dict[str, Any]] = []

        snap = self.latest()
        fresh = snap is not None and now - (snap.get("ts") or 0) <= 300
        if fresh and snap is not None:
            state = snap.get("running_state")
            if state is not None and int(state) in OFF_GRID:
                reasons.append(
                    {
                        "kind": "off_grid",
                        "level": "outage",
                        "title": "The grid's down",
                        "detail": "Your inverter is running the house without the grid.",
                    }
                )
            v, f = snap.get("grid_voltage"), snap.get("grid_freq")
            if v is not None and v > VOLTAGE_HIGH:
                reasons.append(
                    {
                        "kind": "voltage_high",
                        "level": "watch",
                        "title": f"High grid voltage, {v:.0f} V",
                        "detail": f"Above the {VOLTAGE_HIGH:.0f} V the standard allows. Your inverter may hold back "
                        "solar it sends to the grid until it comes down.",
                    }
                )
            elif v is not None and 50 < v < VOLTAGE_LOW:
                reasons.append(
                    {
                        "kind": "voltage_low",
                        "level": "watch",
                        "title": f"Low grid voltage, {v:.0f} V",
                        "detail": f"Below the {VOLTAGE_LOW:.0f} V the standard allows: the local network is "
                        "under strain.",
                    }
                )
            if f is not None and f > 0 and not FREQ_EVENT_LOW <= f <= FREQ_EVENT_HIGH:
                reasons.append(
                    {
                        "kind": "frequency",
                        "level": "warning",
                        "title": f"Grid frequency at {f:.2f} Hz",
                        "detail": "Well outside the normal 49.85 to 50.15 Hz: something big on the grid has tripped.",
                    }
                )

        for n in notices:
            if not n["active"] or n["level"] == "info":
                continue
            reasons.append(
                {
                    "kind": n["kind"],
                    "level": "warning" if n["level"] == "critical" or n["kind"] in ALERTING else "watch",
                    "title": NOTICE_TITLES.get(n["kind"], n["title"]),
                    "detail": n["title"],
                    "at": n["at"],
                    "alert": n["kind"] in ALERTING,
                }
            )

        storms = self._storms(now)
        if storms:
            first = storms[0]["ts"] - 3600  # the hour before the stamp
            reasons.append(
                {
                    "kind": "storm",
                    "level": "watch",
                    "title": "Storms forecast",
                    "detail": "Thunderstorms are forecast"
                    + (" now" if first <= now else f" from {time.strftime('%-I %p', time.localtime(first))}")
                    + ". Storms are the most common cause of blackouts.",
                    "at": first,
                    "alert": True,
                }
            )

        region = self.region()[0]
        with self._lock:
            market = self._market.get(region) if region else None
            prices = self._prices if region and region == self._prices_region else []
            ahead = [p for p in prices if p["forecast"] and p["at"] > now and p["price"] is not None]
        if market and market.get("capped"):
            reasons.append(
                {
                    "kind": "price_cap",
                    "level": "warning",
                    "title": "Prices capped",
                    "detail": "AEMO has capped wholesale prices after a run of extreme ones: supply is very tight.",
                    "alert": True,
                }
            )
        if market and market.get("price") is not None and market["price"] >= SPIKE:
            reasons.append(
                {
                    "kind": "spike",
                    "level": "watch",
                    "title": f"Wholesale price spike, {market['price'] / 10:.0f}c/kWh",
                    "detail": f"Power is selling for ${market['price']:,.0f}/MWh in your region now.",
                }
            )
        elif (peak := max(ahead[:24], key=lambda p: p["price"], default=None)) and peak["price"] >= SPIKE:
            reasons.append(
                {
                    "kind": "spike",
                    "level": "watch",
                    "title": "Price spike forecast",
                    "detail": f"AEMO expects ${peak['price']:,.0f}/MWh around "
                    f"{time.strftime('%-I:%M %p', time.localtime(peak['at'] - 1800))}.",
                    "at": peak["at"] - 1800,
                }
            )

        reasons.sort(key=lambda r: -LEVELS.index(r["level"]))
        level = reasons[0]["level"] if reasons else "normal"
        return {"level": level, "reasons": reasons}


NOTICE_TITLES = {
    "lor1": "Supply getting tight",
    "lor2": "Low reserve warning",
    "lor3": "Load shedding possible",
    "load_shedding": "Load shedding",
    "system_event": "Power system event",
    "suspension": "Market suspended",
    "price_cap": "Prices under review",
    "msl1": "Low grid demand",
    "msl2": "Low grid demand",
    "msl3": "Rooftop solar may be switched off",
}

__all__ = ["REGIONS", "GridService", "region_at"]
