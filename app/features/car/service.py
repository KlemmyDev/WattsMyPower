"""
The cars: each one's details (Settings → Integrations → Electric vehicle), its battery level, and charges planned
ahead. Until a car can be charged from spare solar automatically, you say when it will charge and how (or take a
suggested charge, app.features.car.planner), and the forecast counts it as home use (app.features.forecast).

A car's level is what you last said it was, plus what its planned charges have put in since (as if they ran as
planned). Driving isn't known, so the level only goes up between times you give it.

There's taken to be one charger: charges planned for different cars don't overlap.

A charge draws amps × volts × phases from the wall for as long as it runs. Only some of that reaches the
car's battery (the charger and battery lose the rest as heat; `car_efficiency`, about 90% on a home AC
charge). So a charge to a level needs (target − now) × the battery's size, divided by the efficiency,
from the wall; a charge for a set time draws its power for that long, stopping early if the car fills.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

from app.core.database import Database
from app.features.car.catalog import BODIES, BY_ID, body_of

KEEP_SECONDS = 12 * 3600  # how long a charge stays listed after it ends
MAX_HOURS = 48  # the longest charge that can be planned
LEVELS_KEPT = 90 * 86400  # how long a level given is kept
MAX_CARS = 6

# A car's numeric details: key -> (lowest, highest, default, name in messages, unit). Its battery's usable size,
# how much of what comes from the wall reaches it (%), how it's charged (the most amps the charger gives and the
# fewest the car accepts, 1 or 3 phases, volts), what it uses on the road (Wh/km), the level it's usually charged
# to (%), when it's needed (minutes after local midnight), and whether the home battery may help charge it (1).
NUMBERS: dict[str, tuple[float, float, float, str, str]] = {
    "car_battery_kwh": (10, 200, 75, "The car's battery", " kWh"),
    "car_efficiency": (50, 100, 90, "Charging efficiency", "%"),
    "car_amps": (1, 48, 16, "Charging current", " A"),
    "car_min_amps": (1, 32, 6, "The lowest charging current", " A"),
    "car_phases": (1, 3, 1, "Phases", ""),
    "car_voltage": (200, 260, 230, "Voltage", " V"),
    "car_wh_per_km": (50, 500, 170, "Energy use", " Wh/km"),
    "car_target_soc": (50, 100, 80, "The charge limit", "%"),
    "car_ready_by": (0, 1439, 450, "Ready by", " minutes after midnight"),
    "car_battery_helps": (0, 1, 1, "Whether the home battery helps", ""),
}
WHOLE = {"car_phases", "car_ready_by", "car_battery_helps"}
# Its choices: key -> (allowed, default). What suggested charges aim for (app.features.car.planner); its paint,
# its shape and where it parks, for the Overview's drawing (None for the shape: the model's, else an SUV).
COLOURS = ("white", "black", "grey", "silver", "blue", "red", "green", "sand")  # or a colour of its own, #rrggbb
HEX = re.compile(r"#[0-9a-fA-F]{6}")
CHOICES: dict[str, tuple[tuple[str, ...], str | None]] = {
    "car_charge_mode": (("cheapest", "solar", "battery", "fastest"), "cheapest"),
    "car_colour": (COLOURS, "white"),
    "car_body": (BODIES, None),
    "car_park": (("garage", "outside"), "garage"),
}
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")  # car_days: the days it's needed (none: every day)


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


def defaults() -> dict[str, Any]:
    """A car's details before any are given."""
    return {
        **{k: int(d) if k in WHOLE else d for k, (_, _, d, _, _) in NUMBERS.items()},
        **{k: d for k, (_, d) in CHOICES.items()},
        "car_days": [],
    }


def clean(changes: dict[str, Any]) -> dict[str, Any]:
    """Details as given, checked. Raises ValueError naming the first that isn't right, as a sentence."""
    out: dict[str, Any] = {}
    for key, raw in changes.items():
        if key in NUMBERS:
            lo, hi, _, name, unit = NUMBERS[key]
            try:
                x = float(raw)
            except (TypeError, ValueError):
                raise ValueError(f"{name} must be a number.") from None
            if not lo <= x <= hi:  # also catches NaN
                raise ValueError(f"{name} must be between {lo:g} and {hi:g}{unit}.")
            if key in WHOLE and not x.is_integer():
                raise ValueError(f"{name} must be a whole number.")
            out[key] = int(x) if key in WHOLE else round(x, 3)
        elif key == "car_colour" and isinstance(raw, str) and HEX.fullmatch(raw):
            out[key] = raw.lower()  # a paint of its own
        elif key in CHOICES:
            allowed, default = CHOICES[key]
            if raw not in allowed and not (raw is None and default is None):
                raise ValueError(f"{key} must be one of {', '.join(allowed)}.")
            out[key] = raw
        elif key == "car_days":
            if not isinstance(raw, list) or any(d not in WEEKDAYS for d in raw):
                raise ValueError(f"car_days must be a list of {', '.join(WEEKDAYS)}.")
            out[key] = [d for d in WEEKDAYS if d in raw]
        else:
            raise ValueError(f"Unknown detail: {key}")
    return out


def from_model(model_id: str | None) -> dict[str, Any]:
    """A catalog model's figures as a car's details, for those not given when it's connected."""
    m = BY_ID.get(model_id or "")
    if not m:
        return {}
    return {
        "car_battery_kwh": m["battery_kwh"],
        "car_wh_per_km": m["wh_per_km"],
        "car_amps": m["max_amps"],
        "car_min_amps": m["min_amps"],
        "car_phases": m["phases"],
        "car_target_soc": m["target_soc"],
    }


class NoSuchCar(LookupError):
    pass


class CarService:
    def __init__(self, db: Database):
        self.db = db

    # ------------------------------------------------------------------ the cars
    def _row(self, car_id: int) -> tuple[Any, ...]:
        with self.db.reading() as conn:
            row = conn.execute("SELECT id, name, model, details FROM cars WHERE id = ?", (car_id,)).fetchone()
        if row is None:
            raise NoSuchCar(car_id)
        return row

    @staticmethod
    def _car(row: tuple[Any, ...]) -> dict[str, Any]:
        """A car as kept: its id, name, the model it was chosen from, and its details (defaults filled in)."""
        car_id, name, model, raw = row
        details = defaults() | json.loads(raw)
        if details["car_body"] is None:
            details["car_body"] = body_of(model)
        return {"id": car_id, "name": name, "model": BY_ID.get(model or ""), "car": details}

    def details(self, car_id: int) -> dict[str, Any]:
        return self._car(self._row(car_id))["car"]

    def ids(self) -> list[int]:
        with self.db.reading() as conn:
            return [r[0] for r in conn.execute("SELECT id FROM cars ORDER BY position, id")]

    @staticmethod
    def _identity(body: dict[str, Any]) -> tuple[str | None, str | None]:
        name = body.get("name")
        model = body.get("model")
        if model is not None and model not in BY_ID:
            raise ValueError("That isn't one of the cars to choose from.")
        return (str(name).strip()[:60] or None) if name else None, model

    def create(self, body: dict[str, Any], now: int | None = None) -> dict[str, Any]:
        """Connect a car: its name, the model chosen (or none), and its details. Raises ValueError, in words."""
        now = int(now or time.time())
        name, model = self._identity(body)
        details = from_model(model) | clean({k: v for k, v in body.items() if k not in ("name", "model")})
        with self.db.writing() as conn:
            if conn.execute("SELECT COUNT(*) FROM cars").fetchone()[0] >= MAX_CARS:
                raise ValueError(f"Up to {MAX_CARS} cars can be connected.")
            position = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM cars").fetchone()[0]
            car_id = conn.execute(
                "INSERT INTO cars (name, model, details, position, created_at) VALUES (?, ?, ?, ?, ?)",
                (name, model, json.dumps(details), position, now),
            ).lastrowid
        assert car_id is not None
        return self.view(car_id, now)

    def update(self, car_id: int, body: dict[str, Any], now: int | None = None) -> dict[str, Any]:
        """Change a car's name, model or details (only those given). Raises ValueError, in words."""
        _, name, model, raw = self._row(car_id)
        if "name" in body or "model" in body:
            new_name, new_model = self._identity(body)
            name = new_name if "name" in body else name
            model = new_model if "model" in body else model
        details = json.loads(raw) | clean({k: v for k, v in body.items() if k not in ("name", "model")})
        with self.db.writing() as conn:
            conn.execute(
                "UPDATE cars SET name = ?, model = ?, details = ? WHERE id = ?",
                (name, model, json.dumps(details), car_id),
            )
        return self.view(car_id, now)

    def delete(self, car_id: int) -> bool:
        """Disconnect a car: it, its planned charges and its levels go."""
        with self.db.writing() as conn:
            conn.execute("DELETE FROM car_charges WHERE car = ?", (car_id,))
            conn.execute("DELETE FROM car_levels WHERE car = ?", (car_id,))
            return conn.execute("DELETE FROM cars WHERE id = ?", (car_id,)).rowcount > 0

    def spec(self, car_id: int) -> CarSpec:
        d = self.details(car_id)
        return CarSpec(
            capacity_kwh=d["car_battery_kwh"],
            efficiency=d["car_efficiency"],
            volts=d["car_voltage"],
            phases=int(d["car_phases"]),
            min_amps=min(d["car_min_amps"], d["car_amps"]),
            max_amps=d["car_amps"],
            battery_helps=bool(d["car_battery_helps"]),
            wh_per_km=d["car_wh_per_km"],
        )

    # ------------------------------------------------------------------ planned charges
    def _estimate(self, car_id: int, body: dict[str, Any]) -> dict[str, Any]:
        """A charge from the dashboard's form: its own amps and phases, or the car's usual ones."""
        d = self.details(car_id)
        start = _number(body, "start", 0, 4_102_444_800, "The start")
        if start is None:
            raise ValueError("Choose when the charge starts.")
        amps = _number(body, "amps", 1, 48, "The charging current") or d["car_amps"]
        phases = int(_number(body, "phases", 1, 3, "Phases") or d["car_phases"])
        return estimate(
            start=int(start),
            amps=amps,
            phases=phases,
            volts=d["car_voltage"],
            efficiency=d["car_efficiency"],
            capacity_kwh=d["car_battery_kwh"],
            soc_now=_number(body, "soc_now", 0, 100, "The car's charge now"),
            soc_to=_number(body, "soc_to", 1, 100, "The level to charge to"),
            hours=_number(body, "hours", 0, MAX_HOURS, "How long to charge"),
        ) | {"amps": amps, "phases": phases}

    def preview(self, car_id: int, body: dict[str, Any]) -> dict[str, Any]:
        """What a charge would come to, before it's saved. Raises ValueError, in words."""
        return self._estimate(car_id, body)

    def add(self, car_id: int, body: dict[str, Any], now: int | None = None) -> dict[str, Any]:
        """Plan a charge. Raises ValueError, in words."""
        now = int(now or time.time())
        e = self._estimate(car_id, body)
        if e["end"] <= now:
            raise ValueError("That charge would already be over.")
        with self.db.writing() as conn:
            cur = conn.execute(
                "INSERT INTO car_charges (car, start, end, power_w, kwh, amps, phases, soc_from, soc_to,"
                " battery_helps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    car_id,
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
                self._record(conn, car_id, now, e["soc_from"], "charge")
        return {**e, "id": cur.lastrowid, "car": car_id, "battery_helps": bool(body.get("battery_helps", True))}

    def add_plan(self, car_id: int, body: dict[str, Any], now: int | None = None) -> list[dict[str, Any]]:
        """Plan a charge in steps (a suggested plan): `steps` of start, end and amps, in order and not overlapping,
        on `phases`, from the car's level `soc_now`. Each step is kept as a charge, tied to the others by `plan`.
        Raises ValueError, in words."""
        now = int(now or time.time())
        d = self.details(car_id)
        steps = body.get("steps")
        if not isinstance(steps, list) or not 1 <= len(steps) <= 96:
            raise ValueError("Give the plan's steps.")
        phases = int(_number(body, "phases", 1, 3, "Phases") or d["car_phases"])
        soc = _number(body, "soc_now", 0, 100, "The car's charge now")
        volts, eff, cap = d["car_voltage"], d["car_efficiency"] / 100, d["car_battery_kwh"]
        helps = int(bool(body.get("battery_helps", True)))
        rows = []
        last = now - 1
        for raw in steps:
            if not isinstance(raw, dict):
                raise ValueError("Give each step a start, an end and a current.")
            start = int(_number(raw, "start", 0, 4_102_444_800, "A step's start") or 0)
            end = int(_number(raw, "end", 0, 4_102_444_800, "A step's end") or 0)
            amps = _number(raw, "amps", 1, 48, "A step's current") or 0
            if not start < end or end <= now or start < last or end - start > MAX_HOURS * 3600:
                raise ValueError("The plan's steps must be in order, not overlap, and not be over already.")
            last = end
            power_kw = amps * volts * phases / 1000
            kwh = power_kw * (end - start) / 3600
            soc_from = None if soc is None else round(soc, 1)
            if soc is not None:
                soc = min(100.0, soc + kwh * eff / cap * 100)
            rows.append((car_id, start, end, power_kw * 1000, round(kwh, 2), amps, phases, soc_from,
                         None if soc is None else round(soc, 1), helps, now))  # fmt: skip
        with self.db.writing() as conn:
            ids = [
                conn.execute(
                    "INSERT INTO car_charges (car, start, end, power_w, kwh, amps, phases, soc_from, soc_to,"
                    " battery_helps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    r,
                ).lastrowid
                for r in rows
            ]
            conn.execute(f"UPDATE car_charges SET plan = ? WHERE id IN ({','.join('?' * len(ids))})", (ids[0], *ids))
            if rows[0][7] is not None and body.get("level_now", True):
                self._record(conn, car_id, now, rows[0][7], "charge")
        return [c for c in self.listed(now, car_id) if c["plan"] == ids[0]]

    def remove(self, charge_id: int) -> bool:
        """Remove a charge, or the whole plan it's a step of."""
        with self.db.writing() as conn:
            return (
                conn.execute(
                    "DELETE FROM car_charges WHERE id = ? OR plan = (SELECT plan FROM car_charges WHERE id = ?)",
                    (charge_id, charge_id),
                ).rowcount
                > 0
            )

    def listed(self, now: int | None = None, car_id: int | None = None) -> list[dict[str, Any]]:
        """Charges still to come, under way, or ended in the last 12 hours, soonest first: one car's, or every car's."""
        now = int(now or time.time())
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT id, start, end, power_w, kwh, amps, phases, soc_from, soc_to, battery_helps, plan, car"
                " FROM car_charges WHERE end > ? AND (? IS NULL OR car = ?) ORDER BY start",
                (now - KEEP_SECONDS, car_id, car_id),
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
                "plan": r[10],
                "car": r[11],
            }
            for r in rows
        ]

    def charges(self, start: int, end: int) -> list[Charge]:
        """Every car's planned charges drawing power at some point in [start, end), for the forecast."""
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT start, end, power_w, battery_helps FROM car_charges WHERE end > ? AND start < ?",
                (start, end),
            ).fetchall()
        return [Charge(s, e, p, bool(b)) for s, e, p, b in rows]

    # ------------------------------------------------------------------ each car's level
    @staticmethod
    def _record(conn: Any, car_id: int, ts: int, soc: float, source: str) -> None:
        conn.execute(
            "INSERT OR REPLACE INTO car_levels (car, ts, soc, source) VALUES (?, ?, ?, ?)", (car_id, ts, soc, source)
        )
        conn.execute("DELETE FROM car_levels WHERE car = ? AND ts < ?", (car_id, ts - LEVELS_KEPT))

    def set_level(self, car_id: int, body: dict[str, Any], now: int | None = None) -> dict[str, Any] | None:
        """The car's charge now, as given. Raises ValueError, in words."""
        now = int(now or time.time())
        self._row(car_id)
        soc = _number(body, "soc", 0, 100, "The car's charge")
        if soc is None:
            raise ValueError("Give the car's charge, 0 to 100%.")
        with self.db.writing() as conn:
            self._record(conn, car_id, now, soc, "level")
        return self.level(car_id, now)

    def _added(self, car_id: int, since: int, until: int, soc: float) -> float:
        """The car's level after its planned charges running between `since` and `until`, from `soc` at `since`:
        each adds what reaches the battery while it runs, up to the level it was planned to stop at."""
        d = self.details(car_id)
        cap, eff = d["car_battery_kwh"], d["car_efficiency"] / 100
        with self.db.reading() as conn:
            rows = conn.execute(
                "SELECT start, end, power_w, soc_to FROM car_charges WHERE car = ? AND end > ? AND start < ?"
                " ORDER BY start",
                (car_id, since, until),
            ).fetchall()
        for start, end, power_w, soc_to in rows:
            ran = min(end, until) - max(start, since)
            if ran > 0:
                stop = soc_to if soc_to is not None else 100.0
                soc = max(soc, min(stop, soc + power_w / 1000 * ran / 3600 * eff / cap * 100))
        return min(100.0, soc)

    def level(self, car_id: int, now: int | None = None) -> dict[str, Any] | None:
        """The car's level now: as last given, plus what planned charges have put in since. None if never given."""
        now = int(now or time.time())
        with self.db.reading() as conn:
            row = conn.execute(
                "SELECT ts, soc FROM car_levels WHERE car = ? AND ts <= ? ORDER BY ts DESC LIMIT 1", (car_id, now)
            ).fetchone()
        if row is None:
            return None
        at, given = row
        soc = self._added(car_id, at, now, given)
        d = self.details(car_id)
        km = soc / 100 * d["car_battery_kwh"] * 1000 / d["car_wh_per_km"]
        return {"soc": round(soc, 1), "given": given, "given_at": at, "charged": soc > given + 0.05, "km": round(km)}

    def planned_soc(self, car_id: int, soc: float, start: int, end: int) -> float:
        """The car's level at `end` from `soc` at `start`, with its planned charges between."""
        return round(self._added(car_id, start, end, soc), 1)

    # ------------------------------------------------------------------ views
    def view(self, car_id: int, now: int | None = None) -> dict[str, Any]:
        """A car: its id, name and model, its details, its level, and its planned charges."""
        return self._car(self._row(car_id)) | {"level": self.level(car_id, now), "charges": self.listed(now, car_id)}

    def views(self, now: int | None = None) -> list[dict[str, Any]]:
        """Every car connected, in the order they were."""
        return [self.view(i, now) for i in self.ids()]
