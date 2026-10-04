"""
The car: its details (Settings → Integrations → Electric vehicle), its battery level, and charges planned ahead.
Until the car can be charged from spare solar automatically, you say when it will charge and how (or take a
suggested charge, app.features.car.planner), and the forecast counts it as home use (app.features.forecast).

Its level is what you last said it was, plus what planned charges have put in since (as if they ran as planned).
Driving isn't known, so the level only goes up between times you give it.

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
from app.features.car.catalog import BY_ID
from app.features.settings.store import SettingsStore

KEEP_SECONDS = 12 * 3600  # how long a charge stays listed after it ends
MAX_HOURS = 48  # the longest charge that can be planned
LEVELS_KEPT = 90 * 86400  # how long a level given is kept

# The car's details, as settings.
DETAILS = (
    "car_battery_kwh", "car_efficiency", "car_amps", "car_min_amps", "car_phases", "car_voltage", "car_wh_per_km",
    "car_target_soc", "car_ready_by", "car_battery_helps",
)  # fmt: skip


@dataclass(frozen=True)
class Charge:
    """A planned charge, as the forecast needs it: when it draws power, how much, and whether the home
    battery may help supply it."""

    start: int
    end: int
    power_w: float
    battery_helps: bool


@dataclass(frozen=True)
class CarSpec:
    """How the car charges, for suggesting charges (app.features.car.planner)."""

    capacity_kwh: float
    efficiency: float  # %, of what comes from the wall that reaches the battery
    volts: float
    phases: int
    min_amps: float
    max_amps: float
    battery_helps: bool
    wh_per_km: float

    def power_kw(self, amps: float, phases: int | None = None) -> float:
        return amps * self.volts * (phases or self.phases) / 1000


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
            # The car's charge now, as given with the charge (unless it's where an earlier planned charge leaves it).
            if e["soc_from"] is not None and body.get("level_now", True):
                self._record(conn, now, e["soc_from"], "charge")
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

    # ------------------------------------------------------------------ the car's level
    @staticmethod
    def _record(conn: Any, ts: int, soc: float, source: str) -> None:
        conn.execute("INSERT OR REPLACE INTO car_levels (ts, soc, source) VALUES (?, ?, ?)", (ts, soc, source))
        conn.execute("DELETE FROM car_levels WHERE ts < ?", (ts - LEVELS_KEPT,))

    def set_level(self, body: dict[str, Any], now: int | None = None) -> dict[str, Any] | None:
        """The car's charge now, as given. Raises ValueError, in words."""
        now = int(now or time.time())
        soc = _number(body, "soc", 0, 100, "The car's charge")
        if soc is None:
            raise ValueError("Give the car's charge, 0 to 100%.")
        with self.db.writing() as conn:
            self._record(conn, now, soc, "level")
        return self.level(now)

    def _added(self, since: int, until: int, soc: float) -> float:
        """The car's level after the planned charges running between `since` and `until`, from `soc` at `since`:
        each adds what reaches the battery while it runs, up to the level it was planned to stop at."""
        cap = self.settings.get("car_battery_kwh")
        eff = self.settings.get("car_efficiency") / 100
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT start, end, power_w, soc_to FROM car_charges WHERE end > ? AND start < ? ORDER BY start",
                (since, until),
            ).fetchall()
        for start, end, power_w, soc_to in rows:
            ran = min(end, until) - max(start, since)
            if ran > 0:
                stop = soc_to if soc_to is not None else 100.0
                soc = max(soc, min(stop, soc + power_w / 1000 * ran / 3600 * eff / cap * 100))
        return min(100.0, soc)

    def level(self, now: int | None = None) -> dict[str, Any] | None:
        """The car's level now: as last given, plus what planned charges have put in since. None if never given."""
        now = int(now or time.time())
        with self.db.reading() as conn:
            row = conn.execute(
                "SELECT ts, soc FROM car_levels WHERE ts <= ? ORDER BY ts DESC LIMIT 1", (now,)
            ).fetchone()
        if row is None:
            return None
        at, given = row
        soc = self._added(at, now, given)
        km = soc / 100 * self.settings.get("car_battery_kwh") * 1000 / self.settings.get("car_wh_per_km")
        return {"soc": round(soc, 1), "given": given, "given_at": at, "charged": soc > given + 0.05, "km": round(km)}

    def planned_soc(self, soc: float, start: int, end: int) -> float:
        """The car's level at `end` from `soc` at `start`, with the planned charges between."""
        return round(self._added(start, end, soc), 1)

    # ------------------------------------------------------------------ the car
    def spec(self) -> CarSpec:
        g = self.settings.get
        return CarSpec(
            capacity_kwh=g("car_battery_kwh"),
            efficiency=g("car_efficiency"),
            volts=g("car_voltage"),
            phases=int(g("car_phases")),
            min_amps=min(g("car_min_amps"), g("car_amps")),
            max_amps=g("car_amps"),
            battery_helps=bool(g("car_battery_helps")),
            wh_per_km=g("car_wh_per_km"),
        )

    def view(self, now: int | None = None) -> dict[str, Any]:
        """The car: whether one's connected, its name and model, its details, its level, and its planned charges."""
        model = self.settings.get_text("car_model")
        values = self.settings.all_values()  # whole numbers as such
        return {
            "connected": bool(self.settings.get("car_connected")),
            "name": self.settings.get_text("car_name"),
            "model": BY_ID.get(model or ""),
            "car": {k: values[k] for k in DETAILS},
            "level": self.level(now),
            "charges": self.listed(now),
        }
