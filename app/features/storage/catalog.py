"""
What each table in the two databases holds, in plain words: the group it's shown in, how long its rows
are kept, the column its rows are dated by, and how it breaks down. Tables not listed here (one added
without updating this) still show, under "Other", with their own name.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.features.storage.measure import Spec

# Groups, in the order they're shown: id -> (name, what's in it).
GROUPS: dict[str, tuple[str, str]] = {
    "registers": (
        "Raw inverter registers",
        "Every word read from your inverters each poll, exactly as they sent it. The dashboard decodes these into "
        "readings, and can decode them again if a mapping is fixed.",
    ),
    "readings": ("Readings", "Your inverters' decoded figures, like power, energy counters, battery and temperatures."),
    "weather": ("Weather and forecast", "Hourly weather from Open-Meteo, and the day-ahead solar forecast."),
    "prices": ("Electricity prices", "Amber's prices for each interval, when a tariff follows them."),
    "meter": ("Smart meter", "Interval readings from smart-meter (NEM12) files imported in Bills → Rates & settings."),
    "imports": ("Imported history", "History imported from files, and the recorded readings an import replaced."),
    "cars": ("Electric cars", "The cars connected, and their battery levels."),
    "home": (
        "Smart home",
        "What each appliance and smart plug from Manage → Integrations used, and each run of a washer or dryer.",
    ),
    "battery": ("Battery controls", "Each standby, reserve or grid charge started on the Battery page."),
    "settings": ("Settings and account", "Your settings, rates, the dashboard's account and signed-in browsers."),
    "devices": ("Connected inverters", "The inverters the collector reads, connected in Manage → Integrations."),
    "sqlite": ("SQLite's own", "The database's description of its tables, kept by SQLite itself."),
    "other": ("Other", "Tables this page doesn't know about yet."),
}


@dataclass(frozen=True)
class Table:
    group: str
    label: str
    about: str
    # How long rows are kept, in words. {raw} is the raw-readings retention, {collector} the collector's.
    kept: str
    spec: Spec = field(default_factory=Spec)
    # Rows are added as time passes (rather than when something is set up or imported), so the last
    # week's rows say how fast it grows.
    grows: bool = False
    # Rows older than this many days are deleted ("raw" / "collector": the configured retention).
    retention: int | str | None = None
    # Only this many rows are kept.
    cap: int | None = None


_DEVICE = (
    "SELECT COALESCE(d.name, 'Device ' || x.device), COUNT(*), COUNT(*) FROM {} x"
    " LEFT JOIN home_devices d ON d.id = x.device GROUP BY x.device ORDER BY COUNT(*) DESC"
)
_CAR = "SELECT COALESCE(c.name, c.model, 'Car ' || x.car), COUNT(*), COUNT(*) FROM {} x LEFT JOIN cars c ON c.id = x.car GROUP BY x.car"

DASHBOARD: dict[str, Table] = {
    "samples": Table(
        "readings",
        "Every poll",
        "Each reading as it arrived, about once a minute.",
        "{raw}",
        Spec("ts"),
        grows=True,
        retention="raw",
    ),
    "samples_5m": Table(
        "readings",
        "5-minute averages",
        "Readings averaged over each 5 minutes. Long charts and history read these, so they're kept for good.",
        "Kept for good",
        Spec(
            "ts",
            "SELECT CASE WHEN import_id IS NULL THEN 'Recorded' ELSE 'Imported from files' END, COUNT(*),"
            " COUNT(*) FROM samples_5m GROUP BY 1 ORDER BY 1 DESC",
        ),
        grows=True,
    ),
    "weather_hours": Table(
        "weather",
        "Hourly weather",
        "Sunlight, temperature, cloud, rain and wind for each hour. Forecasts for the hours ahead and best "
        "estimates for the hours past, used by History and to help the forecast learn.",
        "Kept for good",
        Spec(
            "ts",
            "SELECT CASE source WHEN 'forecast' THEN 'Forecast, hours to come'"
            " WHEN 'recent' THEN 'Hours past, as last forecast' WHEN 'archive' THEN 'Hours past, from the archive'"
            " ELSE source END, COUNT(*), COUNT(*) FROM weather_hours GROUP BY source ORDER BY COUNT(*) DESC",
        ),
        grows=True,
    ),
    "forecast_hours": Table(
        "weather",
        "Day-ahead solar forecast",
        "The solar forecast for each hour as it stood the day before, to measure it against what your panels made.",
        "Kept for good",
        Spec("ts"),
        grows=True,
    ),
    "prices": Table(
        "prices",
        "Amber prices",
        "What a kWh costs to import and earns to export, for each 5 or 30 minutes.",
        "Kept while Amber is connected",
        Spec(
            "ts",
            "SELECT CASE channel WHEN 'general' THEN 'Grid price' WHEN 'feedIn' THEN 'Feed-in price'"
            " WHEN 'controlledLoad' THEN 'Controlled load' ELSE channel END"
            " || CASE actual WHEN 1 THEN ', final' ELSE ', forecast' END, COUNT(*), COUNT(*)"
            " FROM prices GROUP BY channel, actual ORDER BY COUNT(*) DESC",
        ),
        grows=True,
    ),
    "meter_intervals": Table(
        "meter",
        "Meter intervals",
        "Grid import or export for each meter interval, from the files you imported.",
        "Kept until the file is removed",
        Spec(
            "ts",
            "SELECT CASE direction WHEN 'import' THEN 'Grid import' WHEN 'export' THEN 'Grid export'"
            " ELSE direction END, COUNT(*), COUNT(*) FROM meter_intervals GROUP BY direction",
        ),
    ),
    "meter_imports": Table(
        "meter",
        "Meter files",
        "Each smart-meter file imported, with its name and when.",
        "Kept until removed",
        Spec("imported_at"),
    ),
    "imports": Table(
        "imports",
        "History imports",
        "Each import of history from files (e.g. iSolarCloud), so it can be removed.",
        "Kept until removed",
        Spec("created_at"),
    ),
    "import_replaced": Table(
        "imports",
        "Replaced readings",
        "Recorded 5-minute averages an import replaced, kept so removing the import puts them back.",
        "Kept until the import is removed",
        Spec("ts"),
    ),
    "cars": Table(
        "cars",
        "Cars",
        "Each connected car, with its name, model and charging details.",
        "Kept until removed",
        Spec("created_at"),
    ),
    "car_levels": Table(
        "cars",
        "Battery levels",
        "Each car's battery level, as read from the car.",
        "90 days",
        Spec("ts", _CAR.format("car_levels")),
        grows=True,
        retention=90,
    ),
    "ev_levels": Table(
        "cars",
        "Tesla battery levels",
        "The battery level of each connected Tesla that isn't tied to a car of its own (Integrations → Tesla), as "
        "read from the car.",
        "90 days",
        Spec("ts"),
        grows=True,
        retention=90,
    ),
    "ev_energy": Table(
        "cars",
        "Charging energy",
        "What a connected Tesla drew from the house in each 5 minutes it charged at home, and how much came from "
        "the grid. The Home page's car line uses it.",
        "Kept for good",
        Spec("ts"),
        grows=True,
    ),
    "ev_sessions": Table(
        "cars",
        "Trips and charges",
        "Each trip a connected Tesla made (its level out and back, and the distance) and each charge at home.",
        "Kept for good",
        Spec("start"),
        grows=True,
    ),
    "ev_wakes": Table(
        "cars",
        "Wakes",
        "Each time the dashboard woke a connected Tesla, and why. It shows the car isn't being woken too often.",
        "90 days",
        Spec("ts"),
        grows=True,
        retention=90,
    ),
    "ev_events": Table(
        "cars",
        "Activity",
        "What the dashboard did with a connected Tesla and what it saw happen, like solar charging starting, a change "
        "in the car's app or each charge's total. The EV page's day-by-day chart uses it.",
        "Kept for good",
        Spec("ts"),
        grows=True,
    ),
    "home_accounts": Table(
        "home",
        "Connected accounts",
        "Each connected smart-home integration, with what it needs to sign in (never shown) and how its polling is going.",
        "Kept until disconnected",
        Spec("created_at"),
    ),
    "home_devices": Table(
        "home",
        "Devices",
        "Each appliance or plug from a connected account, with its name, what it's set as, and how far its readings go.",
        "Kept until its account is disconnected",
        Spec("created_at"),
    ),
    "home_energy": Table(
        "home",
        "Device energy",
        "What each device used in each 5 minutes, for the Home page's breakdown.",
        "Kept for good",
        Spec("ts", _DEVICE.format("home_energy")),
        grows=True,
    ),
    "home_peaks": Table(
        "home",
        "Device peaks",
        "The most each device drew in each 5 minutes, for the power spikes on its page and its room's page.",
        "Kept for good",
        Spec("ts", _DEVICE.format("home_peaks")),
        grows=True,
    ),
    "home_runs": Table(
        "home",
        "Appliance runs",
        "Each cycle of an appliance like a washer or dryer, with when it ran, how long for, and what it used.",
        "Kept for good",
        Spec("start", _DEVICE.format("home_runs")),
        grows=True,
    ),
    "battery_controls": Table(
        "battery",
        "Battery controls",
        "Each battery control as it ran, with when it started and ended and how it was set. The Battery page's chart uses it.",
        "Kept for good",
        Spec("started_at"),
        grows=True,
    ),
    "settings": Table(
        "settings",
        "Settings",
        "Numbers saved in the dashboard, like location, system details and costs.",
        "Kept until changed",
    ),
    "kv": Table(
        "settings",
        "Saved details",
        "Text saved in the dashboard, like your tariff, the place name, the set-up guide's progress and "
        "connections. Only the names show here, never what's in them.",
        "Kept until changed",
        Spec(None, "SELECT key, 1, LENGTH(key) + LENGTH(value) FROM kv ORDER BY LENGTH(value) DESC"),
    ),
    "users": Table(
        "settings",
        "Account",
        "The dashboard's account, with its username and a hash of its password.",
        "Kept until reset",
        Spec("created_at"),
    ),
    "sessions": Table(
        "settings",
        "Signed-in browsers",
        "Browsers signed in to the dashboard (a hash of each one's token).",
        "30 days, or until signed out",
        Spec(
            "created_at",
            "SELECT CASE WHEN expires_at >= strftime('%s', 'now') THEN 'Signed in' ELSE 'Expired' END,"
            " COUNT(*), COUNT(*) FROM sessions GROUP BY 1",
        ),
    ),
    "sqlite_schema": Table("sqlite", "Schema", "Every table's and index's definition.", "Always"),
    "sqlite_sequence": Table("sqlite", "Sequences", "The last id given in tables that never reuse one.", "Always"),
    "sqlite_stat1": Table(
        "sqlite", "Query statistics", "What SQLite learned about the tables to plan queries.", "Replaced when updated"
    ),
}

COLLECTOR: dict[str, Table] = {
    "readings": Table(
        "registers",
        "Register reads",
        "The raw 16-bit words each inverter sent back each poll, by register address, as JSON.",
        "{collector}",
        grows=True,
        retention="collector",
    ),
    "devices": Table(
        "devices", "Inverters", "Each connected inverter, with its driver, address and settings.", "Kept until removed"
    ),
    "kv": Table(
        "devices",
        "Saved details",
        "Small notes, e.g. that the inverters were moved from the environment.",
        "Kept for good",
    ),
    "sqlite_schema": DASHBOARD["sqlite_schema"],
}

SPECS: dict[str, Spec] = {name: t.spec for name, t in DASHBOARD.items()}
