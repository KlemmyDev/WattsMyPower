"""
Settings people can change from the dashboard: the forecast location (and its place
name), the billing period, and the system details the inverter doesn't report (array
size, battery overrides). Tariffs are structured, so they have their own store.

Environment variables provide the defaults; anything saved from the Settings page is
stored in the database and wins over the environment. The system details were only
set in the environment before they could be edited here: seed_system copies those
values in once, and after that the database is the only source.
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any

from app.core.config import Config
from app.core.database import Database

# Text settings: key -> max length. Stored in the kv table (the settings table holds REALs).
TEXT: dict[str, int] = {"location_name": 120}
# Text settings with a fixed set of values: key -> (allowed values, default).
CHOICES: dict[str, tuple[tuple[str, ...], str]] = {
    # Open-Meteo's weather model for the forecast: its own pick for the location, or one model.
    "weather_model": (
        ("best_match", "bom_access_global", "ecmwf_ifs025", "gfs_seamless", "icon_seamless"),
        "best_match",
    ),
}
# Settings that only take whole numbers.
WHOLE = {"bill_months", "bill_day", "bill_anchor", "temp_unit_f", "forecast_learning", "panel_bearing"}
# The system details (Settings → System): key -> (name in messages, unit). Their range errors are
# written as sentences, since the dashboard shows them as they are.
SYSTEM: dict[str, tuple[str, str]] = {
    "pv_kw": ("Solar array size", " kW"),
    "battery_kwh_override": ("Battery capacity", " kWh"),
    "battery_reserve_fallback": ("Backup reserve", "%"),
    "battery_max_kw": ("Maximum charge and discharge rate", " kW"),
}
# kv marker: the system details have been copied from the environment (see seed_system).
SYSTEM_SEEDED = "system_seeded"


class SettingsStore:
    def __init__(self, db: Database, config: Config):
        self.db = db
        # key -> (min, max, default)
        self.editable: dict[str, tuple[float, float, float]] = {
            "latitude": (-90, 90, config.latitude),
            "longitude": (-180, 180, config.longitude),
            # The billing period: every 1, 2 or 3 months, starting on this day of the month, in step
            # with a month a bill starts in (1-12). The default is calendar quarters.
            "bill_months": (1, 3, 3),
            "bill_day": (1, 28, 1),
            "bill_anchor": (1, 12, 1),
            # Solar array size in kW of panels: the forecast's starting point before it calibrates.
            "pv_kw": (0.1, 100, config.pv_kw),
            # Battery capacity in kWh. 0 = use what the inverter reports.
            "battery_kwh_override": (0, 200, config.battery_kwh),
            # Backup reserve (%) for when the inverter doesn't report one.
            "battery_reserve_fallback": (0, 100, config.battery_reserve),
            # The battery's max charge/discharge rate in kW, for the forecast.
            "battery_max_kw": (0.1, 50, config.battery_max_kw),
            # Weather (Settings → Integrations → Weather). Temperatures in °F (1) rather than °C (0).
            "temp_unit_f": (0, 1, 0),
            # How the panels sit: tilt from flat (0 = flat, or not known), and the compass bearing they face.
            "panel_tilt": (0, 90, 0),
            "panel_bearing": (0, 359, 0),
            # Let the forecast use what it has learned from weather history when that's more accurate (1).
            "forecast_learning": (0, 1, 1),
        }
        self._lock = threading.Lock()
        self._values: dict[str, float] = {}
        self._text: dict[str, str] = {}

    def load(self) -> None:
        with self.db.reading() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
            keys = [*TEXT, *CHOICES]
            marks = ",".join("?" * len(keys))
            text = conn.execute(f"SELECT key, value FROM kv WHERE key IN ({marks})", keys).fetchall()
        with self._lock:
            self._values = {k: v for k, v in rows if k in self.editable}
            self._text = dict(text)

    def seed_system(self) -> bool:
        """Store the system details the environment sets (PV_KW, BATTERY_KWH, BATTERY_RESERVE,
        BATTERY_MAX_KW), or the defaults an install without them runs on, once ever.

        This moves an install from before these were edited in the dashboard into the database
        with exactly the values it was using. After it has run the environment isn't read for
        them again. Returns whether it ran. Call before load().
        """
        values = {k: self.editable[k][2] for k in SYSTEM}
        with self.db.writing() as conn:
            if conn.execute("SELECT 1 FROM kv WHERE key = ?", (SYSTEM_SEEDED,)).fetchone():
                return False
            # Taken as they are, even outside the ranges the dashboard allows: they're what the
            # install has been running on. Only a value that isn't a number at all is left out.
            conn.executemany(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                [(k, v) for k, v in values.items() if math.isfinite(v)],
            )
            conn.execute("INSERT INTO kv (key, value) VALUES (?, ?)", (SYSTEM_SEEDED, str(int(time.time()))))
            return True

    def get(self, key: str) -> float:
        with self._lock:
            return self._values.get(key, self.editable[key][2])

    def get_text(self, key: str) -> str | None:
        with self._lock:
            return self._text.get(key)

    def get_choice(self, key: str) -> str:
        allowed, default = CHOICES[key]
        value = self.get_text(key)
        return value if value in allowed else default

    def all_values(self) -> dict[str, Any]:
        values = {k: self.get(k) for k in self.editable}
        whole = {k: int(v) for k, v in values.items() if k in WHOLE}
        choices = {k: self.get_choice(k) for k in CHOICES}
        return {**values, **whole, **{k: self.get_text(k) for k in TEXT}, **choices}

    def save(self, changes: dict[str, Any]) -> dict[str, Any]:
        """Validate and store. Raises ValueError naming the first bad field."""
        clean: dict[str, float] = {}
        text: dict[str, str | None] = {}
        for key, raw in changes.items():
            if key in TEXT:
                text[key] = str(raw or "").strip()[: TEXT[key]] or None
                continue
            if key in CHOICES:
                allowed, default = CHOICES[key]
                if raw not in allowed:
                    raise ValueError(f"{key} must be one of {', '.join(allowed)}")
                text[key] = None if raw == default else raw
                continue
            if key not in self.editable:
                raise ValueError(f"Unknown setting: {key}")
            name, unit = SYSTEM.get(key, (key, ""))
            end = "." if key in SYSTEM else ""
            try:
                value = float(raw)
            except (TypeError, ValueError):
                raise ValueError(f"{name} must be a number{end}") from None
            lo, hi, _ = self.editable[key]
            if not lo <= value <= hi:  # also catches NaN
                raise ValueError(f"{name} must be between {lo:g} and {hi:g}{unit}{end}")
            if key in WHOLE and not value.is_integer():
                raise ValueError(f"{key} must be a whole number")
            clean[key] = round(value, 6)
        with self.db.writing() as conn:
            conn.executemany("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", clean.items())
            for k, t in text.items():
                if t is None:
                    conn.execute("DELETE FROM kv WHERE key = ?", (k,))
                else:
                    conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (k, t))
        with self._lock:
            self._values.update(clean)
            for k, t in text.items():
                if t is None:
                    self._text.pop(k, None)
                else:
                    self._text[k] = t
        return self.all_values()
