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
    "readings": ("Readings", "Your inverters' figures, decoded: power, energy counters, battery, temperatures."),
    "weather": ("Weather and forecast", "Hourly weather from Open-Meteo, and the day-ahead solar forecast."),
    "prices": ("Electricity prices", "Amber's prices for each interval, when a tariff follows them."),
    "meter": ("Smart meter", "Interval readings from smart-meter (NEM12) files imported in Settings → Bills."),
    "imports": ("Imported history", "History imported from files, and the recorded readings an import replaced."),
    "cars": ("Electric cars", "The cars connected, their planned charges, and battery levels given."),
    "home": (
        "Smart home",
        "Appliances and smart plugs connected in Settings → Integrations: what each used, and each run of a washer "
        "or dryer.",
    ),
    "alerts": ("Alerts", "Where alerts go, the rules, their progress, and the alerts sent."),
    "settings": ("Settings and account", "Your settings, rates, the dashboard's account and signed-in browsers."),
    "devices": ("Connected inverters", "The inverters the collector reads, connected in Settings → Integrations."),
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
        "One row per poll: each reading as it arrived, about once a minute.",
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
        "Sunlight, temperature, cloud, rain and wind for each hour: the forecast for hours to come, and the best "
        "estimate of hours past, for History and so the forecast can learn.",
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
        "The price of each 5 or 30 minutes: what a kWh costs to import and earns to export.",
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
        "Each smart-meter file imported: its name and when.",
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
        "Each car connected: its name, model and charging details.",
        "Kept until removed",
        Spec("created_at"),
    ),
    "car_charges": Table(
        "cars",
        "Planned charges",
        "Charges planned ahead, which the forecast counts as home use.",
        "Kept until removed",
        Spec("start", _CAR.format("car_charges")),
    ),
    "car_levels": Table(
        "cars",
        "Battery levels",
        "Each car's battery level as you gave it, to estimate it in between.",
        "90 days",
        Spec("ts", _CAR.format("car_levels")),
        grows=True,
        retention=90,
    ),
    "home_accounts": Table(
        "home",
        "Connected accounts",
        "Each smart-home integration connected: what it keeps to sign in (never shown), and how its polling is going.",
        "Kept until disconnected",
        Spec("created_at"),
    ),
    "home_devices": Table(
        "home",
        "Devices",
        "Each appliance or plug an account brought: its name, what it's set as, and where its readings had got to.",
        "Kept until its account is disconnected",
        Spec("created_at"),
    ),
    "home_energy": Table(
        "home",
        "Device energy",
        "What each device used in every 5 minutes, for the Home page's breakdown.",
        "Kept for good",
        Spec("ts", _DEVICE.format("home_energy")),
        grows=True,
    ),
    "home_runs": Table(
        "home",
        "Appliance runs",
        "Each run of an appliance that runs in cycles (a wash, a dry): when, how long, and what it used.",
        "Kept for good",
        Spec("start", _DEVICE.format("home_runs")),
        grows=True,
    ),
    "alert_history": Table(
        "alerts",
        "Alerts sent",
        "Alerts sent and resolved, daily summaries, and whether each was delivered.",
        "The latest 500",
        Spec(
            "ts",
            "SELECT CASE kind WHEN 'alert' THEN 'Alerts' WHEN 'resolved' THEN 'Resolved'"
            " WHEN 'summary' THEN 'Daily summaries' WHEN 'test' THEN 'Tests' ELSE kind END, COUNT(*), COUNT(*)"
            " FROM alert_history GROUP BY kind ORDER BY COUNT(*) DESC",
        ),
        grows=True,
        cap=500,
    ),
    "push_subscriptions": Table(
        "alerts",
        "Browsers notified",
        "Browsers that turned on notifications: the address their push service gave, and the keys to encrypt for them.",
        "Kept until turned off",
        Spec("created_at"),
    ),
    "alert_channels": Table(
        "alerts", "Alert channels", "Where alerts are sent: ntfy, a webhook or Pushover.", "Kept until removed"
    ),
    "alert_rules": Table(
        "alerts", "Alert rules", "Rules switched on or off, or with changed thresholds.", "Kept until changed back"
    ),
    "alert_state": Table(
        "alerts",
        "Alert progress",
        "Each rule's progress: a problem seen, an alert out, its cooldown.",
        "Replaced as it changes",
    ),
    "settings": Table(
        "settings",
        "Settings",
        "Numbers saved from the dashboard: location, system details, costs.",
        "Kept until changed",
    ),
    "kv": Table(
        "settings",
        "Saved details",
        "Text saved from the dashboard: your tariff, the place name, the set-up guide's progress and connections. "
        "Only the names are shown here, never what's in them.",
        "Kept until changed",
        Spec(None, "SELECT key, 1, LENGTH(key) + LENGTH(value) FROM kv ORDER BY LENGTH(value) DESC"),
    ),
    "users": Table(
        "settings",
        "Account",
        "The dashboard's account: its username and a hash of its password.",
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
        "One row per inverter per poll: the raw 16-bit words it answered with, by register address, as JSON.",
        "{collector}",
        grows=True,
        retention="collector",
    ),
    "devices": Table(
        "devices", "Inverters", "Each inverter connected: its driver, address and settings.", "Kept until removed"
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
