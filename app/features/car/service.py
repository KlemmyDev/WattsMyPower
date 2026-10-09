"""
The cars: each one's details (Manage → Integrations → Electric vehicle) and its battery level.

A car's level is what was last recorded for it: read from the car itself when it's a connected Tesla
(app.features.tesla). Its details (the phases it charges on, the fewest and most amps) are what charging
from spare solar works with, and its paint, shape and parking spot are how the Overview draws it.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

from app.core.database import Database
from app.features.car.catalog import BODIES, BY_ID, body_of

LEVELS_KEPT = 90 * 86400  # how long a level is kept
MAX_CARS = 6

# A car's numeric details: key -> (lowest, highest, default, name in messages, unit). Its battery's usable size, how
# it's charged (the most amps the charger gives and the fewest the car accepts, 1 or 3 phases, volts) and what it uses
# on the road (Wh/km).
NUMBERS: dict[str, tuple[float, float, float, str, str]] = {
    "car_battery_kwh": (10, 200, 75, "The car's battery", " kWh"),
    "car_amps": (1, 48, 16, "Charging current", " A"),
    "car_min_amps": (1, 32, 6, "The lowest charging current", " A"),
    "car_phases": (1, 3, 1, "Phases", ""),
    "car_voltage": (200, 260, 230, "Voltage", " V"),
    "car_wh_per_km": (50, 500, 170, "Energy use", " Wh/km"),
}
WHOLE = {"car_phases"}
# Its choices: key -> (allowed, default). Its paint, its shape and where it parks, for the Overview's drawing (None
# for the shape: the model's, else an SUV).
COLOURS = ("white", "black", "grey", "silver", "blue", "red", "green", "sand")  # or a colour of its own, #rrggbb
HEX = re.compile(r"#[0-9a-fA-F]{6}")
CHOICES: dict[str, tuple[tuple[str, ...], str | None]] = {
    "car_colour": (COLOURS, "white"),
    "car_body": (BODIES, None),
    "car_park": (("garage", "outside"), "garage"),
}
# Details kept from before charges were planned here, no longer used: left out of what's shown, and ignored if sent.
RETIRED = {"car_efficiency", "car_target_soc", "car_ready_by", "car_days", "car_battery_helps", "car_charge_mode"}


@dataclass(frozen=True)
class CarSpec:
    """How the car charges at home."""

    capacity_kwh: float
    volts: float
    phases: int
    min_amps: float
    max_amps: float
    wh_per_km: float

    def power_kw(self, amps: float, phases: int | None = None) -> float:
        return amps * self.volts * (phases or self.phases) / 1000


def defaults() -> dict[str, Any]:
    """A car's details before any are given."""
    return {
        **{k: int(d) if k in WHOLE else d for k, (_, _, d, _, _) in NUMBERS.items()},
        **{k: d for k, (_, d) in CHOICES.items()},
    }


def clean(changes: dict[str, Any]) -> dict[str, Any]:
    """Details as given, checked. Raises ValueError naming the first that isn't right, as a sentence."""
    out: dict[str, Any] = {}
    for key, raw in changes.items():
        if key in RETIRED:
            continue
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
        details = {k: v for k, v in (defaults() | json.loads(raw)).items() if k not in RETIRED}
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
        """Disconnect a car: it and its levels go."""
        with self.db.writing() as conn:
            conn.execute("DELETE FROM car_levels WHERE car = ?", (car_id,))
            return conn.execute("DELETE FROM cars WHERE id = ?", (car_id,)).rowcount > 0

    def spec(self, car_id: int) -> CarSpec:
        d = self.details(car_id)
        return CarSpec(
            capacity_kwh=d["car_battery_kwh"],
            volts=d["car_voltage"],
            phases=int(d["car_phases"]),
            min_amps=min(d["car_min_amps"], d["car_amps"]),
            max_amps=d["car_amps"],
            wh_per_km=d["car_wh_per_km"],
        )

    # ------------------------------------------------------------------ each car's level
    @staticmethod
    def _record(conn: Any, car_id: int, ts: int, soc: float, source: str) -> None:
        conn.execute(
            "INSERT OR REPLACE INTO car_levels (car, ts, soc, source) VALUES (?, ?, ?, ?)", (car_id, ts, soc, source)
        )
        conn.execute("DELETE FROM car_levels WHERE car = ? AND ts < ?", (car_id, ts - LEVELS_KEPT))

    def record_level(self, car_id: int, ts: int, soc: float, source: str) -> None:
        """The car's level as read from the car itself (app.features.tesla)."""
        with self.db.writing() as conn:
            self._record(conn, car_id, ts, soc, source)

    def level(self, car_id: int, now: int | None = None) -> dict[str, Any] | None:
        """The car's level as last recorded (at or before `now`), with the range it gives. None if never recorded."""
        now = int(now or time.time())
        with self.db.reading() as conn:
            row = conn.execute(
                "SELECT ts, soc FROM car_levels WHERE car = ? AND ts <= ? ORDER BY ts DESC LIMIT 1", (car_id, now)
            ).fetchone()
        if row is None:
            return None
        at, soc = row
        d = self.details(car_id)
        km = soc / 100 * d["car_battery_kwh"] * 1000 / d["car_wh_per_km"]
        return {"soc": round(soc, 1), "given": soc, "given_at": at, "km": round(km)}

    def last_read(self, car_id: int, now: int) -> tuple[int, float] | None:
        """When the car's level was last read from the car itself (not held while it slept, see levels), and what."""
        with self.db.reading() as conn:
            row = conn.execute(
                "SELECT ts, soc FROM car_levels WHERE car = ? AND ts <= ? AND COALESCE(source, '') NOT LIKE '%:asleep' "
                "ORDER BY ts DESC LIMIT 1",
                (car_id, now),
            ).fetchone()
        return (int(row[0]), float(row[1])) if row else None

    def levels(self, car_id: int, start: int, end: int) -> list[tuple[int, float, str]]:
        """The car's levels recorded in [start, end), oldest first, each with where it came from, with the one before
        `start` (so a line can start at the left edge) and the one after `end` (so it can reach the right)."""
        cols = "SELECT ts, soc, COALESCE(source, '') FROM car_levels WHERE car = ?"
        with self.db.reading() as conn:
            before = conn.execute(f"{cols} AND ts < ? ORDER BY ts DESC LIMIT 1", (car_id, start)).fetchall()
            within = conn.execute(f"{cols} AND ts >= ? AND ts < ? ORDER BY ts", (car_id, start, end)).fetchall()
            after = conn.execute(f"{cols} AND ts >= ? ORDER BY ts LIMIT 1", (car_id, end)).fetchall()
        return [(int(ts), float(soc), str(src)) for ts, soc, src in [*before, *within, *after]]

    # ------------------------------------------------------------------ views
    def view(self, car_id: int, now: int | None = None) -> dict[str, Any]:
        """A car: its id, name and model, its details, and its level."""
        return self._car(self._row(car_id)) | {"level": self.level(car_id, now)}

    def views(self, now: int | None = None) -> list[dict[str, Any]]:
        """Every car connected, in the order they were."""
        return [self.view(i, now) for i in self.ids()]
