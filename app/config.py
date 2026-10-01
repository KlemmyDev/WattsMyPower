"""Runtime configuration, read once from environment variables."""

import os


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# IP address of the hybrid inverter's WiNet-S dongle. Required (install.sh asks for it).
INVERTER_HOST = os.getenv("INVERTER_HOST", "").strip()
INVERTER_PORT = int(os.getenv("INVERTER_PORT", "502"))
INVERTER_UNIT = int(os.getenv("INVERTER_UNIT", "1"))

# Optional second, AC-coupled solar system on an older Sungrow string inverter
# (e.g. SG5K-D) with a Wi-Fi dongle. Empty = not fitted.
PV2_HOST = os.getenv("PV2_HOST", "").strip()
PV2_PORT = int(os.getenv("PV2_PORT", "502"))
PV2_UNIT = int(os.getenv("PV2_UNIT", "1"))
# Where the second system connects. true (default, the usual AC-coupled setup): on the house
# side of the hybrid's meter, so the hybrid sees its output as lower (even negative) home use.
# false: outside the hybrid's meter, so all its output is exported and home use is already right.
PV2_BEHIND_METER = _bool("PV2_BEHIND_METER", True)

# The WiNet-S2 gets unhappy under aggressive polling and only refreshes most
# registers every ~30-60s anyway, so 60s is both the default and the floor.
POLL_INTERVAL = max(60, int(os.getenv("POLL_INTERVAL", "60")))
# Upper bound for exponential backoff when the inverter stops answering.
MAX_BACKOFF = int(os.getenv("MAX_BACKOFF", "300"))

DB_PATH = os.getenv("DB_PATH", "/data/wattsmypower.db")
# Raw (every-poll) rows older than this are deleted; 5-minute rollups are kept forever.
# ~20 MB of raw rows at 90 days; rollups add ~18 MB/year. 0 = keep raw rows forever.
RAW_RETENTION_DAYS = int(os.getenv("RAW_RETENTION_DAYS", "90"))

# --- system ------------------------------------------------------------------
# Solar array size (kW of panels). The inverter doesn't report this.
PV_KW = float(os.getenv("PV_KW", "6.6"))
# Battery capacity in kWh. 0 = read it from the inverter (register 5639).
BATTERY_KWH = float(os.getenv("BATTERY_KWH", "0"))
# Backup reserve (%) if the inverter doesn't report one, and the battery's max charge/discharge rate.
BATTERY_RESERVE = float(os.getenv("BATTERY_RESERVE", "10"))
BATTERY_MAX_KW = float(os.getenv("BATTERY_MAX_KW", "5"))

# --- tariffs (AUD) -- defaults only; the Settings page can override them ---------
IMPORT_RATE = float(os.getenv("IMPORT_RATE", "0.32"))    # per kWh
FEED_IN_RATE = float(os.getenv("FEED_IN_RATE", "0.05"))  # per kWh
SUPPLY_CHARGE = float(os.getenv("SUPPLY_CHARGE", "1.05"))  # per day

# --- forecast (Open-Meteo, no API key) -- location can be changed in Settings ---
FORECAST = _bool("FORECAST", True)
LATITUDE = float(os.getenv("LATITUDE", "-27.47"))
LONGITUDE = float(os.getenv("LONGITUDE", "153.03"))

# Generate synthetic data instead of talking to an inverter (for local dev / demos).
MOCK = _bool("MOCK", False)
