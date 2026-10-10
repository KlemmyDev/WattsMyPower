"""
Settings people can change from the dashboard: the forecast location (and its place
name), the billing period with its discounts, credits and budget, and the system details the inverter doesn't report (array
size, battery overrides). Tariffs are structured, so they have their own store.

Environment variables provide the defaults; anything saved from the Settings page is
stored in the database and wins over the environment. The system details were only
set in the environment before they could be edited here: seed_system copies those
values in once, and after that the database is the only source.

The location has no default: until someone chooses one (or LATITUDE/LONGITUDE set it), nothing that
depends on where the house is (the forecast, weather, outages, warnings, the AEMO region) is fetched.
Installs from when it defaulted to Brisbane keep it: seed_location saves it for them, once.
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.core.schema import SAMPLE_TABLES

# Text settings: key -> max length. Stored in the kv table (the settings table holds REALs).
TEXT: dict[str, int] = {
    "location_name": 120,
    # The house's street (its name only, no number) and suburb, to tell which of the network's outages reach it.
    "home_street": 80,
    "home_suburb": 60,
}
# Text settings with a fixed set of values: key -> (allowed values, default).
CHOICES: dict[str, tuple[tuple[str, ...], str]] = {
    # Open-Meteo's weather model for the forecast: its own pick for the location, or one model.
    "weather_model": (
        ("best_match", "ecmwf_ifs025", "gfs_seamless", "icon_seamless"),
        "best_match",
    ),
    # What a bill's discount comes off (Bills → Rates & settings): usage alone, or usage and the supply charge.
    "bill_discount_on": (("usage", "usage_supply"), "usage"),
    # How the Overview draws the house (Manage → System → Your house).
    "house_style": (("estate", "modern", "queenslander", "federation", "farmhouse"), "estate"),
    # The NEM region whose wholesale prices and notices the Grid page follows (from AEMO): worked out from the
    # location ("auto"), one region, or none (outside the NEM, or not wanted: then nothing is asked of AEMO).
    "nem_region": (("auto", "QLD1", "NSW1", "VIC1", "SA1", "TAS1", "none"), "auto"),
    # The electricity network (distributor) whose outages the Grid page follows: worked out from the location, one of
    # those supported, or none.
    "power_network": (("auto", "energex", "ergon", "none"), "auto"),
}
# Text settings holding a short list of choices: key -> (allowed values, most items). Where each inverter and
# battery is, in the order they're connected, for the drawing of the house: on an outside wall, or in the garage.
LISTS: dict[str, tuple[tuple[str, ...], int]] = {
    "inverter_places": (("wall", "garage"), 3),
    "battery_places": (("wall", "garage"), 3),
}
# Settings that only take whole numbers.
WHOLE = {
    "bill_months", "bill_day", "bill_anchor", "temp_unit_f", "forecast_learning", "panel_bearing",
    "house_storeys", "garage_spaces", "system_installed", "battery_installed", "home_standby_goal", "update_check",
    "hazard_warnings",
}  # fmt: skip
# The system details (Manage → System): key -> (name in messages, unit). Their range errors are
# written as sentences, since the dashboard shows them as they are.
SYSTEM: dict[str, tuple[str, str]] = {
    "pv_kw": ("Solar array size", " kW"),
    "battery_kwh_override": ("Battery capacity", " kWh"),
    "battery_reserve_fallback": ("Backup reserve", "%"),
    "battery_max_kw": ("Maximum charge and discharge rate", " kW"),
}
# What the system cost, when it went in, and the battery's warranty (Manage → System): named the same
# way, but only ever entered from the dashboard, never seeded from the environment.
OWNERSHIP: dict[str, tuple[str, str]] = {
    "system_cost": ("What the system cost", ""),
    "system_installed": ("When the system was installed", ""),
    "battery_installed": ("When the battery was installed", ""),
    "battery_warranty_years": ("Battery warranty", " years"),
    "battery_warranty_mwh": ("Battery warranty energy", " MWh"),
}
# Discounts, credits and the budget (Bills → Rates & settings), named the same way.
BILLS: dict[str, tuple[str, str]] = {
    "bill_discount_pct": ("The discount", "%"),
    "bill_credits_year": ("Credits a year", ""),
    "bill_budget": ("The budget", ""),
}
# Goals on the Home page: what's always on (W) should come down to. 0 = none.
HOME: dict[str, tuple[str, str]] = {"home_standby_goal": ("The always-on target", " W")}
NAMED = SYSTEM | OWNERSHIP | BILLS | HOME
# kv marker: the system details have been copied from the environment (see seed_system).
SYSTEM_SEEDED = "system_seeded"
# kv marker: an install from before the location had to be chosen has had the one it ran on saved (see seed_location).
LOCATION_SEEDED = "location_seeded"
# Where the location used to default to (Brisbane CBD), for installs that ran on it without saving one.
OLD_DEFAULT = (-27.47, 153.03)


class SettingsStore:
    def __init__(self, db: Database, config: Config):
        self.db = db
        # key -> (min, max, default)
        self.editable: dict[str, tuple[float, float, float]] = {
            # The location: LATITUDE/LONGITUDE, else none (NaN) until one is saved. See location().
            "latitude": (-90, 90, math.nan if config.latitude is None else config.latitude),
            "longitude": (-180, 180, math.nan if config.longitude is None else config.longitude),
            # The billing period: every 1, 2 or 3 months, starting on this day of the month, in step
            # with a month a bill starts in (1-12). The default is calendar quarters.
            "bill_months": (1, 3, 3),
            "bill_day": (1, 28, 1),
            "bill_anchor": (1, 12, 1),
            # A retailer's discount (% off usage, or usage and supply: bill_discount_on), credits a year that
            # come off bills (concessions, government rebates: dollars, spread over the days), and a budget a
            # bill (dollars). 0 = none.
            "bill_discount_pct": (0, 50, 0),
            "bill_credits_year": (0, 10_000, 0),
            "bill_budget": (0, 100_000, 0),
            # What's always on should come down to, W (the Home page's goals). 0 = none.
            "home_standby_goal": (0, 20_000, 0),
            # Solar array size in kW of panels: the forecast's starting point before it calibrates.
            "pv_kw": (0.1, 100, config.pv_kw),
            # Battery capacity in kWh. 0 = use what the inverter reports.
            "battery_kwh_override": (0, 200, config.battery_kwh),
            # Backup reserve (%) for when the inverter doesn't report one.
            "battery_reserve_fallback": (0, 100, config.battery_reserve),
            # The battery's max charge/discharge rate in kW, for the forecast.
            "battery_max_kw": (0.1, 50, config.battery_max_kw),
            # Weather (Manage → Integrations → Weather). Temperatures in °F (1) rather than °C (0).
            "temp_unit_f": (0, 1, 0),
            # How the panels sit: tilt from flat (0 = flat, or not known), and the compass bearing they face.
            "panel_tilt": (0, 90, 0),
            "panel_bearing": (0, 359, 0),
            # Let the forecast use what it has learned from weather history when that's more accurate (1).
            "forecast_learning": (0, 1, 1),
            # Ask GitHub every few hours whether there's a newer version (Manage → System → Updates).
            "update_check": (0, 1, 1),
            # How far around the house (km) the network's outages, and fires, are shown (the Grid page).
            "outage_radius_km": (1, 100, 15),
            # Follow the Bureau of Meteorology's warnings and Queensland Fire Department's for the house (the Grid
            # page's outlook and its alerts).
            "hazard_warnings": (0, 1, 1),
            # The house as the Overview draws it (Manage → System → Your house): storeys, and car spaces in
            # the garage (0 = none).
            "house_storeys": (1, 2, 1),
            "garage_spaces": (0, 2, 0),
            # What the system cost (dollars, after rebates) and when it went in, for payback on the Bills
            # page; when the battery went in (if later) and its warranty, for the Battery page. 0 = not set. Dates
            # are unix seconds at local midnight.
            "system_cost": (0, 500_000, 0),
            "system_installed": (0, 4_102_444_800, 0),
            "battery_installed": (0, 4_102_444_800, 0),
            "battery_warranty_years": (0, 30, 0),
            "battery_warranty_mwh": (0, 1000, 0),
        }
        self._lock = threading.Lock()
        self._values: dict[str, float] = {}
        self._text: dict[str, str] = {}

    def load(self) -> None:
        with self.db.reading() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
            keys = [*TEXT, *CHOICES, *LISTS]
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

    def seed_location(self) -> tuple[float, float] | None:
        """Save the location an install from before it had to be chosen was running on, once ever: the one
        LATITUDE/LONGITUDE set, else the old default (Brisbane). Only for an install with readings and no location
        saved, so nothing changes for it; a new one starts with none. Returns what was saved. Call before load()."""
        with self.db.writing() as conn:
            if conn.execute("SELECT 1 FROM kv WHERE key = ?", (LOCATION_SEEDED,)).fetchone():
                return None
            conn.execute("INSERT INTO kv (key, value) VALUES (?, ?)", (LOCATION_SEEDED, str(int(time.time()))))
            saved = dict(conn.execute("SELECT key, value FROM settings WHERE key IN ('latitude', 'longitude')"))
            used = any(conn.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone() for t in SAMPLE_TABLES)
            if len(saved) == 2 or not used:
                return None

            # Each as it was worked out then: saved, else the environment's, else the old default.
            def used_for(key: str, old: float) -> float:
                env = self.editable[key][2]
                return saved.get(key, env if math.isfinite(env) else old)

            where = (used_for("latitude", OLD_DEFAULT[0]), used_for("longitude", OLD_DEFAULT[1]))
            conn.executemany(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                [("latitude", where[0]), ("longitude", where[1])],
            )
            return where

    def location(self) -> tuple[float, float] | None:
        """Where the house is (latitude, longitude): saved in Settings, or LATITUDE/LONGITUDE in the environment.
        None until it's been chosen."""
        lat, lon = self.get("latitude"), self.get("longitude")
        return (lat, lon) if math.isfinite(lat) and math.isfinite(lon) else None

    def location_set(self) -> bool:
        """Whether the location has been chosen. Nothing that depends on where the house is is fetched until it is."""
        return self.location() is not None

    def get_text(self, key: str) -> str | None:
        with self._lock:
            return self._text.get(key)

    def get_choice(self, key: str) -> str:
        allowed, default = CHOICES[key]
        value = self.get_text(key)
        return value if value in allowed else default

    def get_list(self, key: str) -> list[str]:
        allowed, _ = LISTS[key]
        return [v for v in (self.get_text(key) or "").split(",") if v in allowed]

    def all_values(self) -> dict[str, Any]:
        values: dict[str, Any] = {k: self.get(k) for k in self.editable}
        if self.location() is None:  # not chosen yet: null, rather than NaN (not JSON)
            values.update(latitude=None, longitude=None)
        whole = {k: int(v) for k, v in values.items() if k in WHOLE}
        choices = {k: self.get_choice(k) for k in CHOICES} | {k: self.get_list(k) for k in LISTS}
        return {**values, **whole, **{k: self.get_text(k) for k in TEXT}, **choices}

    def save(self, changes: dict[str, Any]) -> dict[str, Any]:
        """Validate and store. Raises ValueError naming the first bad field."""
        clean: dict[str, float] = {}
        text: dict[str, str | None] = {}
        for key, raw in changes.items():
            if key in TEXT:
                text[key] = str(raw or "").strip()[: TEXT[key]] or None
                continue
            if key in LISTS:
                allowed, most = LISTS[key]
                if not isinstance(raw, list) or len(raw) > most or any(v not in allowed for v in raw):
                    raise ValueError(f"{key} must be a list of up to {most} of {', '.join(allowed)}")
                text[key] = ",".join(raw) or None
                continue
            if key in CHOICES:
                allowed, default = CHOICES[key]
                if raw not in allowed:
                    raise ValueError(f"{key} must be one of {', '.join(allowed)}")
                text[key] = None if raw == default else raw
                continue
            if key not in self.editable:
                raise ValueError(f"Unknown setting: {key}")
            name, unit = NAMED.get(key, (key, ""))
            end = "." if key in NAMED else ""
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
