"""
Car charges planned ahead: until the car can be charged from spare solar automatically, you say when it
will charge and how, and the forecast counts it as home use (app.features.forecast).

A charge draws amps × volts × phases from the wall for as long as it runs. Only some of that reaches the
car's battery (the charger and battery lose the rest as heat; `car_efficiency`, about 90% on a home AC
charge). So a charge to a level needs (target − now) × the battery's size, divided by the efficiency,
from the wall; a charge for a set time draws its power for that long, stopping early if the car fills.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from app.core.database import Database
from app.features.settings.store import SettingsStore

KEEP_SECONDS = 12 * 3600  # how long a charge stays listed after it ends
MAX_HOURS = 48  # the longest charge that can be planned


@dataclass(frozen=True)
class Charge:
    """A planned charge, as the forecast needs it: when it draws power, how much, and whether the home
    battery may help supply it."""

    start: int
    end: int
    power_w: float
    battery_helps: bool


def estimate(
    *,
    start: int,
    amps: float,
    phases: int,
    volts: float,
    efficiency: float,
    capacity_kwh: float,
    soc_now: float | None,
    soc_to: float | None,
    hours: float | None,
) -> dict[str, Any]:
    """What a charge comes to: its power from the wall, how long it runs, the energy from the wall and into
    the car, and the car's charge at the end. Give either `soc_to` (with `soc_now`) or `hours`.
    Raises ValueError, in words, for a charge that can't be worked out."""
    power_kw = amps * volts * phases / 1000
    eff = efficiency / 100
    room = (100 - soc_now) / 100 * capacity_kwh if soc_now is not None else None
    if hours is not None:
        if not 0 < hours <= MAX_HOURS:
            raise ValueError(f"A charge can run for up to {MAX_HOURS} hours.")
        into = power_kw * hours * eff
        if room is not None and into > room:  # it fills first and stops
            into = room
            hours = into / eff / power_kw
    else:
        if soc_now is None or soc_to is None:
            raise ValueError("Give the car's charge now and the level to charge it to, or how long to charge.")
        if soc_to <= soc_now:
            raise ValueError("The level to charge to must be above the car's charge now.")
        into = (soc_to - soc_now) / 100 * capacity_kwh
        hours = into / eff / power_kw
        if hours > MAX_HOURS:
            raise ValueError(f"That would take {hours:.0f} hours at {power_kw:.1f} kW: more than {MAX_HOURS}.")
    wall = into / eff
    return {
        "start": start,
        "end": int(start + hours * 3600),
        "power_kw": round(power_kw, 2),
        "hours": round(hours, 2),
        "wall_kwh": round(wall, 2),
        "car_kwh": round(into, 2),
        "soc_from": soc_now,
        "soc_to": round(min(100.0, soc_now + into / capacity_kwh * 100), 1) if soc_now is not None else None,
    }


def _number(body: dict[str, Any], key: str, lo: float, hi: float, name: str) -> float | None:
    v = body.get(key)
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number.") from None
    if not lo <= x <= hi:
        raise ValueError(f"{name} must be between {lo:g} and {hi:g}.")
    return x


class CarService:
    def __init__(self, db: Database, settings: SettingsStore):
        self.db = db
        self.settings = settings

    def _estimate(self, body: dict[str, Any]) -> dict[str, Any]:
        """A charge from the dashboard's form: its own amps and phases, or the car's usual ones."""
        start = _number(body, "start", 0, 4_102_444_800, "The start")
        if start is None:
            raise ValueError("Choose when the charge starts.")
        amps = _number(body, "amps", 1, 48, "The charging current") or self.settings.get("car_amps")
        phases = int(_number(body, "phases", 1, 3, "Phases") or self.settings.get("car_phases"))
        return estimate(
            start=int(start),
            amps=amps,
            phases=phases,
            volts=self.settings.get("car_voltage"),
            efficiency=self.settings.get("car_efficiency"),
            capacity_kwh=self.settings.get("car_battery_kwh"),
            soc_now=_number(body, "soc_now", 0, 100, "The car's charge now"),
            soc_to=_number(body, "soc_to", 1, 100, "The level to charge to"),
            hours=_number(body, "hours", 0, MAX_HOURS, "How long to charge"),
        ) | {"amps": amps, "phases": phases}

    def preview(self, body: dict[str, Any]) -> dict[str, Any]:
        """What a charge would come to, before it's saved. Raises ValueError, in words."""
        return self._estimate(body)

    def add(self, body: dict[str, Any], now: int | None = None) -> dict[str, Any]:
        """Plan a charge. Raises ValueError, in words."""
        now = int(now or time.time())
        e = self._estimate(body)
        if e["end"] <= now:
            raise ValueError("That charge would already be over.")
        with self.db.writing() as conn:
            cur = conn.execute(
                "INSERT INTO car_charges (start, end, power_w, kwh, amps, phases, soc_from, soc_to, battery_helps,"
                " created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    e["start"],
                    e["end"],
                    e["power_kw"] * 1000,
                    e["wall_kwh"],
                    e["amps"],
                    e["phases"],
                    e["soc_from"],
                    e["soc_to"],
                    int(bool(body.get("battery_helps", True))),
                    now,
                ),
            )
        return {**e, "id": cur.lastrowid, "battery_helps": bool(body.get("battery_helps", True))}

    def remove(self, charge_id: int) -> bool:
        with self.db.writing() as conn:
            return conn.execute("DELETE FROM car_charges WHERE id = ?", (charge_id,)).rowcount > 0

    def listed(self, now: int | None = None) -> list[dict[str, Any]]:
        """Charges still to come, under way, or ended in the last 12 hours, soonest first."""
        now = int(now or time.time())
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT id, start, end, power_w, kwh, amps, phases, soc_from, soc_to, battery_helps FROM car_charges"
                " WHERE end > ? ORDER BY start",
                (now - KEEP_SECONDS,),
            ).fetchall()
        return [
            {
                "id": r[0],
                "start": r[1],
                "end": r[2],
                "power_kw": round(r[3] / 1000, 2),
                "wall_kwh": r[4],
                "amps": r[5],
                "phases": r[6],
                "soc_from": r[7],
                "soc_to": r[8],
                "battery_helps": bool(r[9]),
            }
            for r in rows
        ]

    def charges(self, start: int, end: int) -> list[Charge]:
        """Planned charges drawing power at some point in [start, end), for the forecast."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT start, end, power_w, battery_helps FROM car_charges WHERE end > ? AND start < ?",
                (start, end),
            ).fetchall()
        return [Charge(s, e, p, bool(b)) for s, e, p, b in rows]

    def view(self, now: int | None = None) -> dict[str, Any]:
        keys = ("car_battery_kwh", "car_efficiency", "car_amps", "car_phases", "car_voltage")
        return {"car": {k: self.settings.get(k) for k in keys}, "charges": self.listed(now)}
