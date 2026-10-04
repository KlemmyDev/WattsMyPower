"""
The SQLite schema: every table the app uses, and the migrations that create and change them.

    samples      one row per poll (raw snapshots), keyed on unix-seconds `ts`
    samples_5m   5-minute rollups of samples, kept up to date on every insert; used for
                 long ranges so a year's chart never touches raw rows. Rows imported from
                 another source (iSolarCloud) carry their import's id in `import_id`; a rollup
                 rebuilt from real samples replaces them, clearing it
    imports      each import of history from a file, so it can be listed and removed, and whether it
                 replaced readings the dashboard recorded (rather than only filling gaps)
    import_replaced  the recorded rollups an import replaced, put back when it's removed
    settings     numeric settings saved from the dashboard (location, system cost)
    kv           text values: the tariff (JSON), the location's place name, the set-up guide's progress,
                 and the Amber connection
    users        the household account
    sessions     signed-in browsers (only a hash of each token is stored)
    meter_imports    smart-meter (NEM12) files imported from Settings → Billing
    meter_intervals  their readings: grid import or export per meter interval, in kWh
    alert_channels   where alerts are sent (ntfy, a webhook, Pushover), one row per kind, with its secrets
    alert_rules      alert rules switched on or off, or with changed thresholds (defaults aren't stored)
    alert_state      each rule's progress: a problem seen but not yet reported, an alert out, its cooldown
    alert_history    alerts sent and resolved, daily summaries, and whether each reached its channels
    prices           dynamic electricity prices (from Amber), one row per channel and interval
    weather_hours    the weather each hour (Open-Meteo): the latest forecast for hours to come, and the
                     best estimate of what it was for hours past, kept so History can show it and the
                     forecast can learn from it
    forecast_hours   the solar forecast for each hour as it stood the day before, to measure it against
                     what the panels really made
    car_charges  car charges planned ahead, which the forecast counts as home use
    car_levels   the car's battery level (%) as it was given, to estimate it between times

`ts INTEGER PRIMARY KEY` keeps rows physically ordered by time, so range scans are cheap.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable

# Sample column -> how it rolls up into 5-minute buckets.
SAMPLE_COLUMNS: dict[str, str] = {
    "pv_power": "AVG", "load_power": "AVG", "grid_power": "AVG", "battery_power": "AVG",
    "battery_soc": "AVG", "battery_soh": "AVG", "battery_temp": "AVG",
    "battery_voltage": "AVG", "battery_current": "AVG",
    "inverter_temp": "AVG", "grid_freq": "AVG",
    "mppt1_v": "AVG", "mppt1_a": "AVG", "mppt2_v": "AVG", "mppt2_a": "AVG",
    # second inverter, and the hybrid's own figures before it's added in (see inverters.merge)
    "pv1_power": "AVG", "pv2_power": "AVG", "load_hybrid": "AVG", "grid_hybrid": "AVG", "pv2_temp": "AVG",
    "running_state": "MAX", "power_flow": "MAX",
    # counters: monotonic within their period, so MAX == latest
    "daily_pv": "MAX", "daily_import": "MAX", "daily_export": "MAX",
    "daily_charge": "MAX", "daily_discharge": "MAX", "daily_direct": "MAX",
    "total_pv": "MAX", "total_import": "MAX", "total_export": "MAX",
    "total_charge": "MAX", "total_discharge": "MAX",
    "daily_pv1": "MAX", "daily_pv2": "MAX", "daily_export1": "MAX", "total_pv1": "MAX", "total_pv2": "MAX",
    # the hybrid's own panels' share of export (daily_export/total_export are the meter's)
    "daily_pv_export": "MAX", "total_pv_export": "MAX",
}  # fmt: skip
SAMPLE_TABLES = ("samples", "samples_5m")

ROLLUP = 300  # seconds per rollup bucket
# Rebuild the rollups of the buckets in [?, ?) from the raw samples.
ROLLUP_SQL = (
    f"INSERT OR REPLACE INTO samples_5m (ts, {', '.join(SAMPLE_COLUMNS)}) "
    f"SELECT (ts / {ROLLUP}) * {ROLLUP} AS b, "
    + ", ".join(f"{agg}({c})" for c, agg in SAMPLE_COLUMNS.items())
    + " FROM samples WHERE ts >= ? AND ts < ? GROUP BY b"
)
# The same, leaving alone buckets an import replaced on purpose ("use the file's readings" for days the
# dashboard had recorded): what everything after the migrations rebuilds rollups with.
ROLLUP_KEEPING_SQL = (
    f"INSERT OR REPLACE INTO samples_5m (ts, {', '.join(SAMPLE_COLUMNS)}) "
    f"SELECT (ts / {ROLLUP}) * {ROLLUP} AS b, "
    + ", ".join(f"{agg}({c})" for c, agg in SAMPLE_COLUMNS.items())
    + " FROM samples WHERE ts >= ?1 AND ts < ?2 GROUP BY b HAVING b NOT IN ("
    "SELECT s.ts FROM samples_5m s JOIN imports i ON i.id = s.import_id"
    " WHERE i.replaces = 1 AND s.ts >= ?1 AND s.ts < ?2)"
)

# The range each sample column can physically hold for a home system. A value outside it isn't a
# measurement but a garbled read: a frame decrypted with a stale key comes out as random words, and
# a 32-bit register pair read across an update turns -600 W into +64,936 W. Such values are dropped
# as readings are decoded (app.features.inverters.limits), and were cleaned out of older history by
# the migration below. Columns not listed aren't checked.
MAX_W = 30_000  # more than any home inverter, battery or grid connection here can carry
_POWER = (-MAX_W, MAX_W)
_OUTPUT = (0, MAX_W)
_TEMP = (-40, 100)
_DAY_KWH = (0, 500)
_TOTAL_KWH = (0, 10_000_000)
SAMPLE_BOUNDS: dict[str, tuple[float, float]] = {
    "pv_power": _OUTPUT, "pv1_power": _OUTPUT, "pv2_power": _OUTPUT,
    "load_power": _POWER, "load_hybrid": _POWER, "grid_power": _POWER, "grid_hybrid": _POWER,
    "battery_power": _POWER,
    "battery_soc": (0, 100), "battery_soh": (0, 100),
    "battery_voltage": (0, 1000), "battery_current": (-500, 500),
    "battery_temp": _TEMP, "inverter_temp": _TEMP, "pv2_temp": _TEMP,
    "grid_freq": (40, 70),
    "mppt1_v": (0, 1500), "mppt2_v": (0, 1500), "mppt1_a": (0, 100), "mppt2_a": (0, 100),
    **{c: _DAY_KWH for c in SAMPLE_COLUMNS if c.startswith("daily_")},
    **{c: _TOTAL_KWH for c in SAMPLE_COLUMNS if c.startswith("total_")},
}  # fmt: skip

_SAMPLES = "ts INTEGER PRIMARY KEY, " + ", ".join(f"{c} REAL" for c in SAMPLE_COLUMNS)


def _baseline(conn: sqlite3.Connection) -> None:
    """Every table as of the first versioned schema. IF NOT EXISTS: databases from before
    migrations existed already have some of these, and upgrade in place."""
    for table in SAMPLE_TABLES:
        conn.execute(f"CREATE TABLE IF NOT EXISTS {table} ({_SAMPLES})")
    conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL NOT NULL)")
    conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,"
        " password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,"
        " created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"
    )


def _drop_impossible_values(conn: sqlite3.Connection) -> None:
    """Null out readings outside SAMPLE_BOUNDS (garbled reads stored before they were caught at
    decode time), then rebuild the rollups they skewed. Rollups whose raw samples are gone past
    retention are only cleaned, as there's nothing to rebuild them from."""
    add_missing_sample_columns(conn)
    outside = " OR ".join(f"{c} < {lo} OR {c} > {hi}" for c, (lo, hi) in SAMPLE_BOUNDS.items())
    buckets = [b for (b,) in conn.execute(f"SELECT DISTINCT ts / {ROLLUP} * {ROLLUP} FROM samples WHERE {outside}")]
    for table in SAMPLE_TABLES:
        for c, (lo, hi) in SAMPLE_BOUNDS.items():
            conn.execute(f"UPDATE {table} SET {c} = NULL WHERE {c} < ? OR {c} > ?", (lo, hi))
    for b in buckets:
        conn.execute(ROLLUP_SQL, (b, b + ROLLUP))


def _meter_data(conn: sqlite3.Connection) -> None:
    """Smart-meter interval data imported from NEM12 files (app.features.meter).

    One row per meter channel and interval, keyed so re-importing the same interval replaces it.
    `ts` is when the interval starts (unix seconds) and `minutes` how long it is (5, 15 or 30);
    `direction` is "import" or "export"; `quality` is the file's flag and method ("A" actual,
    "E52" estimated, "S53" substituted…). Each row remembers the import it came from, so an
    import can be removed again.
    """
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meter_imports (id INTEGER PRIMARY KEY, filename TEXT NOT NULL,"
        " imported_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meter_intervals (nmi TEXT NOT NULL, suffix TEXT NOT NULL, ts INTEGER NOT NULL,"
        " minutes INTEGER NOT NULL, direction TEXT NOT NULL, kwh REAL NOT NULL, quality TEXT NOT NULL,"
        " import_id INTEGER NOT NULL, PRIMARY KEY (nmi, suffix, ts)) WITHOUT ROWID"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS meter_intervals_by_time ON meter_intervals (ts)")
    conn.execute("CREATE INDEX IF NOT EXISTS meter_intervals_by_import ON meter_intervals (import_id)")


def _alerts(conn: sqlite3.Connection) -> None:
    """Alerts and notifications (app.features.alerts). New tables only: nothing existing changes."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS alert_channels (kind TEXT PRIMARY KEY, enabled INTEGER NOT NULL,"
        " config TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS alert_rules (rule TEXT PRIMARY KEY, enabled INTEGER NOT NULL, settings TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS alert_state (rule TEXT PRIMARY KEY, pending_since INTEGER, active_since INTEGER,"
        " last_fired INTEGER, delivered INTEGER NOT NULL DEFAULT 0, retry_at INTEGER, event_id INTEGER,"
        " data TEXT NOT NULL DEFAULT '{}')"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS alert_history (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, rule TEXT NOT NULL,"
        " kind TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, error TEXT,"
        " resolved_at INTEGER)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS alert_history_ts ON alert_history (ts)")


def _prices(conn: sqlite3.Connection) -> None:
    """Dynamic prices, for a tariff that follows Amber's wholesale prices (app.features.amber).

    `ts` is the interval's start (unix seconds) and `duration` its length in seconds (300 or 1800).
    `rate` is $/kWh including GST, as it lands on the bill: for `general` and `controlledLoad` what a
    kWh imported costs, for `feedIn` what a kWh exported earns (negative when exporting costs money).
    `actual` is 1 for a final price, 0 for a forecast (replaced by the final price once it's known)."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS prices (channel TEXT NOT NULL, ts INTEGER NOT NULL, duration INTEGER NOT NULL,"
        " rate REAL NOT NULL, actual INTEGER NOT NULL, fetched INTEGER NOT NULL, PRIMARY KEY (channel, ts))"
        " WITHOUT ROWID"
    )


def _imports(conn: sqlite3.Connection) -> None:
    """History imported from files: a record per import, and its id on each rollup it wrote."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, label TEXT NOT NULL, files INTEGER NOT NULL,"
        " created_at INTEGER NOT NULL)"
    )
    if not any(r[1] == "import_id" for r in conn.execute("PRAGMA table_info(samples_5m)")):
        conn.execute("ALTER TABLE samples_5m ADD COLUMN import_id INTEGER")
    conn.execute("CREATE INDEX IF NOT EXISTS samples_5m_import ON samples_5m (import_id) WHERE import_id IS NOT NULL")


def _weather(conn: sqlite3.Connection) -> None:
    """Weather history and the day-ahead solar forecast (app.features.weather). New tables only.

    `weather_hours.ts` is the start of the hour; the sunlight figures (W/m², on flat ground) are means over
    the hour, the rest are at its start. `source` is "forecast" for an hour still to come, "recent" for one
    past as the forecast service last estimated it, or "archive" for one filled in later from its history.
    """
    conn.execute(
        "CREATE TABLE IF NOT EXISTS weather_hours (ts INTEGER PRIMARY KEY, latitude REAL NOT NULL,"
        " longitude REAL NOT NULL, ghi REAL, dni REAL, dhi REAL, temp REAL, cloud REAL, code INTEGER,"
        " precip REAL, precip_prob REAL, wind REAL, is_day INTEGER, source TEXT NOT NULL,"
        " fetched_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS forecast_hours (ts INTEGER PRIMARY KEY, pv_kwh REAL NOT NULL,"
        " issued_at INTEGER NOT NULL, model TEXT NOT NULL)"
    )


def _import_replacing(conn: sqlite3.Connection) -> None:
    """Imports that replace recorded readings: which do, and the recorded rollups each replaced (a row's columns
    as JSON), so removing the import puts them back."""
    if not any(r[1] == "replaces" for r in conn.execute("PRAGMA table_info(imports)")):
        conn.execute("ALTER TABLE imports ADD COLUMN replaces INTEGER NOT NULL DEFAULT 0")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS import_replaced (ts INTEGER PRIMARY KEY, import_id INTEGER NOT NULL,"
        " data TEXT NOT NULL)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS import_replaced_by_import ON import_replaced (import_id)")


def _car_charges(conn: sqlite3.Connection) -> None:
    """Car charges planned ahead (app.features.car), which the forecast counts as home use. `start` and
    `end` are unix seconds; `power_w` is what it draws from the wall, `kwh` the energy from the wall in
    all; the charge levels are the car's battery, % (null when not given)."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS car_charges (id INTEGER PRIMARY KEY, start INTEGER NOT NULL,"
        " end INTEGER NOT NULL, power_w REAL NOT NULL, kwh REAL NOT NULL, amps REAL NOT NULL,"
        " phases INTEGER NOT NULL, soc_from REAL, soc_to REAL, battery_helps INTEGER NOT NULL,"
        " created_at INTEGER NOT NULL)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS car_charges_end ON car_charges (end)")


def _car_levels(conn: sqlite3.Connection) -> None:
    """The car's battery level (%) as given from the dashboard (app.features.car), at unix seconds `ts`.
    `source` says where it was given: "level" (told directly) or "charge" (with a planned charge)."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS car_levels (ts INTEGER PRIMARY KEY, soc REAL NOT NULL, source TEXT NOT NULL)"
    )


# Applied in order; the database's PRAGMA user_version records how many have run.
# Never edit or reorder one that has shipped: add a new one.
MIGRATIONS: list[Callable[[sqlite3.Connection], None]] = [
    _baseline,
    _drop_impossible_values,
    _meter_data,
    _alerts,
    _prices,
    _imports,
    _weather,
    _import_replacing,
    _car_charges,
    _car_levels,
]


def add_missing_sample_columns(conn: sqlite3.Connection) -> None:
    """Sample columns are added as new readings are supported; add any the database lacks."""
    for table in SAMPLE_TABLES:
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for column in SAMPLE_COLUMNS:
            if column not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} REAL")
