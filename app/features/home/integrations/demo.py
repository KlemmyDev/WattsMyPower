"""
Made-up appliances for mock mode (MOCK=1): a washer, a dryer, a fridge and a TV on a smart plug, so the Home page
can be worked on without an account. What each is doing follows the clock, so the same moment always reads the
same, and it can look back (four weeks of history when it's connected).

- The washer runs a 75-minute cycle on Wednesday evenings and weekend mornings: heating, washing, then a spin.
  It counts each cycle's energy from 0, as many appliances do.
- The dryer starts a quarter of an hour after each wash and runs a heat-pump cycle for an hour and a half.
- The fridge's compressor runs 15 minutes in every 40, on a lifetime counter.
- The TV only reports its power, through its plug: on most evenings. Its plug can be switched off and on. Every
  eleventh day a heater shares its plug for a quarter of an hour, at 950 W: a power spike.
- A portable battery in the bedroom charges from the house at 400 W from 10:00 until it's full, and powers the bedroom
  (70 W) from 19:00 to 07:00. Its outlets can be switched off and on.
"""

from __future__ import annotations

import time
from typing import Any

from app.features.home.stations import Station, reading
from app.features.home.types import Hints, Integration, IntegrationError, Reading

MIN = 60
WASH = 75 * MIN
DRY = 90 * MIN
DRY_AFTER = 15 * MIN
FRIDGE_PERIOD, FRIDGE_ON = 40 * MIN, 15 * MIN
FRIDGE_ON_W, FRIDGE_OFF_W = 120.0, 4.0
FRIDGE_START_KWH = 1234.0  # what its lifetime counter had at FRIDGE_FROM
FRIDGE_FROM = 1_735_689_600  # 2025-01-01
BATTERY_KWH = 1.152
CHARGE_W, BEDROOM_W = 400.0, 70.0
CHARGES_FROM, POWERS_FROM, POWERS_UNTIL = 10 * 3600, 19 * 3600, 7 * 3600
LOSS = 0.9  # what's kept of each kWh, charging or discharging
CHARGE_PCT_H = CHARGE_W * LOSS / 1000 / BATTERY_KWH * 100  # % gained an hour charging
DRAIN_PCT_H = BEDROOM_W / LOSS / 1000 / BATTERY_KWH * 100  # % spent an hour powering the bedroom
EMPTIEST = 100 - DRAIN_PCT_H * (24 - (POWERS_FROM - POWERS_UNTIL) / 3600)  # its charge at 07:00, after the night


def _local(ts: float) -> time.struct_time:
    return time.localtime(ts)


def _midnight(ts: float) -> int:
    lt = _local(ts)
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))


def _wash_start(ts: float) -> int | None:
    """When the day's wash starts, if there's one that day: Wednesdays at 18:30, weekends at 08:30."""
    wday = _local(ts).tm_wday
    if wday == 2:
        return _midnight(ts) + 18 * 3600 + 30 * MIN
    if wday >= 5:
        return _midnight(ts) + 8 * 3600 + 30 * MIN
    return None


def _wash_w(t: float) -> float:
    """The washer's power `t` seconds into a cycle: heating the water, washing, then spinning."""
    if t < 15 * MIN:
        return 1900.0
    if t < WASH - 10 * MIN:
        return 160.0
    return 420.0


def _dry_w(t: float) -> float:
    return 850.0 if t < DRY - 10 * MIN else 120.0  # cooling down at the end


def _cycle_kwh(power: Any, seconds: float) -> float:
    """Energy used in the first `seconds` of a cycle, a minute at a time."""
    wh = sum(power(t) for t in range(0, int(seconds), MIN)) / 60
    return round(wh / 1000, 3)


def _battery(ts: float, outlets_on: bool) -> tuple[float, float, float]:
    """The bedroom battery's charge (%), what it's drawing from the house and what it's powering (W). It's assumed to
    have powered the bedroom through the night, whether its outlets are on now or not."""
    s = ts - _midnight(ts)
    if s < POWERS_UNTIL:  # through the night, since 19:00
        return 100 - DRAIN_PCT_H * (s + 24 * 3600 - POWERS_FROM) / 3600, 0.0, BEDROOM_W if outlets_on else 0.0
    if s >= POWERS_FROM:
        return 100 - DRAIN_PCT_H * (s - POWERS_FROM) / 3600, 0.0, BEDROOM_W if outlets_on else 0.0
    if s < CHARGES_FROM:
        return EMPTIEST, 0.0, 0.0
    soc = min(100.0, EMPTIEST + CHARGE_PCT_H * (s - CHARGES_FROM) / 3600)
    return soc, CHARGE_W if soc < 100 else 0.0, 0.0


def _cycle(ts: float, start: int | None, length: int) -> float | None:
    """How far into a cycle `ts` is, if one is under way."""
    return ts - start if start is not None and start <= ts < start + length else None


class Demo(Integration):
    id = "demo"
    name = "Demo appliances"
    via = "made-up readings"
    about = (
        "A washer, dryer, fridge, TV and a bedroom battery that follow the clock, for trying the Home page without an "
        "account."
    )
    icon = "flask"
    kinds = ("washer", "dryer", "fridge", "plug", "power_station")
    fields = ()
    poll_seconds = 60
    demo = True
    can_switch = True

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        return {"connected": True}

    def label(self) -> str:
        return "Five simulated appliances"

    def switch(self, key: str, on: bool) -> None:
        if key not in ("tv", "battery"):
            raise IntegrationError("Only the demo TV's plug and the bedroom battery can be switched.")
        self.saved = {**self.saved, f"{key}_off": not on}

    def poll(self) -> list[Reading]:
        return self.at(time.time())

    def past(self, start: int, end: int) -> list[tuple[int, list[Reading]]]:
        step = 2 * MIN
        return [(ts, self.at(ts)) for ts in range(start - start % step, end, step)]

    def at(self, ts: float) -> list[Reading]:
        wash_start = _wash_start(ts)
        wash = _cycle(ts, wash_start, WASH)
        dry = _cycle(ts, wash_start + WASH + DRY_AFTER if wash_start else None, DRY)
        wash_kwh = _cycle_kwh(_wash_w, wash) if wash is not None else None
        dry_kwh = _cycle_kwh(_dry_w, dry) if dry is not None else None

        periods, into = divmod(ts - FRIDGE_FROM, FRIDGE_PERIOD)
        on = into < FRIDGE_ON
        per_period = (FRIDGE_ON * FRIDGE_ON_W + (FRIDGE_PERIOD - FRIDGE_ON) * FRIDGE_OFF_W) / 3.6e6
        so_far = (min(into, FRIDGE_ON) * FRIDGE_ON_W + max(0.0, into - FRIDGE_ON) * FRIDGE_OFF_W) / 3.6e6
        fridge_kwh = FRIDGE_START_KWH + periods * per_period + so_far

        lt = _local(ts)
        evening = 18 <= lt.tm_hour < 22 or (lt.tm_hour == 22 and lt.tm_min < 30)
        tv_on = evening and lt.tm_wday != 1  # not Tuesdays
        heater = lt.tm_yday % 11 == 0 and lt.tm_hour == 19 and lt.tm_min < 15
        weekend = lt.tm_wday >= 5
        switched_off = bool(self.saved.get("tv_off"))
        outlets_on = not self.saved.get("battery_off")
        soc, charging, powering = _battery(ts, outlets_on)
        return [
            Reading(
                key="washer",
                name="Laundry washer",
                kind="washer",
                power_w=_wash_w(wash) if wash is not None else 1.0,
                energy_kwh=wash_kwh if wash_kwh is not None else 0.0,
                counter="cycle",
                running=wash is not None,
                program=("Cotton 40°" if weekend else "Quick 30") if wash is not None else None,
                phase=None
                if wash is None
                else "Heating"
                if wash < 15 * MIN
                else "Washing"
                if wash < WASH - 10 * MIN
                else "Spinning",
                remaining_min=round((WASH - wash) / MIN) if wash is not None else None,
                details={"Door": "Locked" if wash is not None else "Closed"},
                raw={"simulated": True},
            ),
            Reading(
                key="dryer",
                name="Laundry dryer",
                kind="dryer",
                power_w=_dry_w(dry) if dry is not None else 0.5,
                energy_kwh=dry_kwh if dry_kwh is not None else 0.0,
                counter="cycle",
                running=dry is not None,
                program="Cotton dry" if dry is not None else None,
                phase=None if dry is None else "Drying" if dry < DRY - 10 * MIN else "Cooling",
                remaining_min=round((DRY - dry) / MIN) if dry is not None else None,
                raw={"simulated": True},
            ),
            Reading(
                key="fridge",
                name="Kitchen fridge",
                kind="fridge",
                power_w=FRIDGE_ON_W if on else FRIDGE_OFF_W,
                energy_kwh=round(fridge_kwh, 3),
                details={"Fridge": "3 °C", "Freezer": "−18 °C"},
                raw={"simulated": True},
            ),
            Reading(
                key="tv",
                name="TV",
                kind="plug",
                power_w=0.0 if switched_off else (950.0 if heater else 0.0) + (110.0 if tv_on else 0.8),
                switched_on=not switched_off,
                info={"Wi-Fi signal": "Good (−62 dBm)", "On today": "3 h 40 min", "Firmware": "1.4.8"},
                raw={"simulated": True},
            ),
            reading(
                "battery",
                "Bedroom battery",
                "AC180",
                Station(
                    soc=round(soc, 1),
                    house_w=charging,
                    solar_w=0.0,
                    output_w=powering,
                    ac_on=outlets_on,
                    capacity_kwh=BATTERY_KWH,
                ),
                info={"Serial number": "2235000123456", "Register layout": "V2"},
                raw={"simulated": True},
            ),
        ]
