"""
Electricity tariff (entered by hand on the Settings page) and the cost maths.

A tariff is either a single import rate, or time of use: a list of named rates,
each active in one or more time windows, plus one "all other times" rate.
Feed-in and the daily supply charge are flat either way.

    {
      "type": "flat" | "tou",
      "flat_rate": 0.32,                     # $/kWh, used when type is flat
      "bands": [                             # used when type is tou; first match wins, but overlaps are rejected
        {"name": "Peak", "rate": 0.45, "windows": [{"days": "all", "start": "16:00", "end": "21:00"}]},   # "00:00" to "00:00" = all day
        {"name": "Off-peak", "rate": 0.22, "windows": [{"days": "all", "start": "21:00", "end": "07:00"}]},
        {"name": "Shoulder", "rate": 0.30, "other": true, "windows": []}
      ],
      "feed_in_rate": 0.05,                  # $/kWh
      "supply_charge": 1.05                  # $/day
    }

Costs are worked out per 5-minute reading (so each import is priced at the rate in
force at that time), then each day's totals are scaled to match the inverter's own
daily import/export counters, which are more accurate than integrating averages.
"""

from __future__ import annotations

import json
import re
import threading
import time
from contextlib import closing

from . import config, db

DAYS = {"all": "Every day", "weekdays": "Weekdays", "weekends": "Weekends"}
MAX_BANDS = 6
MAX_WINDOWS = 6
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$|^24:00$")

_lock = threading.Lock()
_tariff: dict | None = None
_tables: dict | None = None  # {"weekday": [band index per minute], "weekend": [...]}


def default_bands(rate: float) -> list[dict]:
    """A common Queensland-style time-of-use layout, as a starting point to edit."""
    return [
        {"name": "Peak", "rate": round(rate * 1.4, 2), "windows": [{"days": "all", "start": "16:00", "end": "21:00"}]},
        {"name": "Off-peak", "rate": round(rate * 0.7, 2), "windows": [{"days": "all", "start": "21:00", "end": "07:00"}]},
        {"name": "Shoulder", "rate": rate, "other": True, "windows": []},
    ]


def _minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _build_tables(t: dict) -> dict:
    bands = t["bands"] if t["type"] == "tou" else [{"name": "All times", "rate": t["flat_rate"], "other": True, "windows": []}]
    other = next(i for i, b in enumerate(bands) if b.get("other"))
    tables = {}
    for kind in ("weekday", "weekend"):
        tab = [other] * 1440
        owner = [None] * 1440
        for i, b in enumerate(bands):
            if b.get("other"):
                continue
            for w in b["windows"]:
                if w["days"] != "all" and w["days"][:-1] != kind:
                    continue
                s, e = _minutes(w["start"]), _minutes(w["end"])
                # start == end covers the whole day; start > end wraps past midnight
                span = range(s, e) if s < e else list(range(s, 1440)) + list(range(0, e))
                for m in span:
                    if owner[m] is not None and owner[m] != i:
                        raise ValueError(
                            f"{bands[owner[m]]['name']} and {b['name']} overlap on {'weekends' if kind == 'weekend' else 'weekdays'} "
                            f"at {m // 60:02d}:{m % 60:02d}. Change one of the time windows.")
                    owner[m] = i
                    tab[m] = i
        tables[kind] = tab
    return {"bands": bands, **tables}


def validate(raw: dict) -> dict:
    """Return a clean tariff or raise ValueError with a message fit to show on the page."""
    if not isinstance(raw, dict):
        raise ValueError("Invalid tariff.")

    def rate(v, label, hi=5.0):
        try:
            x = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"{label} must be a number.") from None
        if not 0 <= x <= hi:
            raise ValueError(f"{label} must be between 0 and {hi:g}.")
        return round(x, 4)

    typ = raw.get("type")
    if typ not in ("flat", "tou"):
        raise ValueError("Rate type must be single rate or time of use.")
    t = {
        "type": typ,
        "flat_rate": rate(raw.get("flat_rate"), "Grid import rate"),
        "feed_in_rate": rate(raw.get("feed_in_rate"), "Feed-in tariff"),
        "supply_charge": rate(raw.get("supply_charge"), "Daily supply charge", 20),
        "bands": [],
    }
    bands = raw.get("bands") or []
    if typ == "tou" or bands:
        if not isinstance(bands, list) or not 2 <= len(bands) <= MAX_BANDS:
            raise ValueError(f"Time of use needs between 2 and {MAX_BANDS} rates.")
        names = set()
        for b in bands:
            name = str(b.get("name", "")).strip()[:24]
            if not name:
                raise ValueError("Every rate needs a name.")
            if name.lower() in names:
                raise ValueError(f"Two rates are called {name}. Give each rate its own name.")
            names.add(name.lower())
            clean = {"name": name, "rate": rate(b.get("rate"), f"{name} rate"), "windows": []}
            if b.get("other"):
                clean["other"] = True
            else:
                wins = b.get("windows") or []
                if not 1 <= len(wins) <= MAX_WINDOWS:
                    raise ValueError(f"{name} needs at least one time window.")
                for w in wins:
                    days, s, e = w.get("days"), str(w.get("start", "")), str(w.get("end", ""))
                    if days not in DAYS:
                        raise ValueError(f"{name}: choose every day, weekdays, or weekends.")
                    if not _TIME.match(s) or not _TIME.match(e) or s == "24:00":
                        raise ValueError(f"{name}: enter times as HH:MM, for example 16:00.")
                    clean["windows"].append({"days": days, "start": s, "end": e})
            t["bands"].append(clean)
        others = [b for b in t["bands"] if b.get("other")]
        if len(others) != 1:
            raise ValueError("Choose exactly one rate for all other times.")
    src = raw.get("source")
    if isinstance(src, dict):  # where the rates came from, if imported from a published plan
        t["source"] = {k: str(src[k])[:120] for k in ("brand", "brand_id", "plan_id", "plan_name", "updated", "imported") if src.get(k)}
    _build_tables(t)  # raises on overlaps
    return t


def _kv(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")


def load() -> None:
    global _tariff, _tables
    with closing(db.connect()) as conn:
        _kv(conn)
        row = conn.execute("SELECT value FROM kv WHERE key = 'tariff'").fetchone()
        legacy = {}
        if row is None:  # first run, or upgrading from the flat-rate settings fields
            conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL NOT NULL)")
            legacy = dict(conn.execute("SELECT key, value FROM settings WHERE key IN ('import_rate', 'feed_in_rate', 'supply_charge')").fetchall())
        conn.commit()
    if row is not None:
        t = json.loads(row[0])
    else:
        imp = legacy.get("import_rate", config.IMPORT_RATE)
        t = {"type": "flat", "flat_rate": imp, "feed_in_rate": legacy.get("feed_in_rate", config.FEED_IN_RATE),
             "supply_charge": legacy.get("supply_charge", config.SUPPLY_CHARGE), "bands": []}
    with _lock:
        _tariff, _tables = t, _build_tables(t)


def get() -> dict:
    with _lock:
        return json.loads(json.dumps(_tariff))


def save(raw: dict) -> dict:
    global _tariff, _tables
    t = validate(raw)
    tables = _build_tables(t)
    with closing(db.connect()) as conn:
        _kv(conn)
        conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES ('tariff', ?)", (json.dumps(t),))
        conn.commit()
    with _lock:
        _tariff, _tables = t, tables
    return get()


# ---------------------------------------------------------------------------
# Costs
# ---------------------------------------------------------------------------

def costs(start: int, end: int) -> dict:
    """Per-day energy and money between start and end (unix seconds, local days)."""
    with _lock:
        t, tab = _tariff, _tables
    bands = tab["bands"]
    kwh = 300 / 3.6e6  # one 5-minute rollup of 1 W, in kWh

    with closing(db.connect(readonly=True)) as conn:
        rows = conn.execute(
            "SELECT ts, pv_power, load_power, grid_power, battery_power FROM samples_5m WHERE ts >= ? AND ts < ? ORDER BY ts",
            (start, end)).fetchall()
    counters = {d["date"]: d for d in db.daily(start, end)}

    days: dict[str, dict] = {}
    for ts, pv, load, grid, bat in rows:
        lt = time.localtime(ts + 150)
        date = time.strftime("%Y-%m-%d", lt)
        tabk = "weekend" if lt.tm_wday >= 5 else "weekday"
        b = tab[tabk][lt.tm_hour * 60 + lt.tm_min]
        d = days.setdefault(date, {"imp": [0.0] * len(bands), "home": [0.0] * len(bands), "exp": 0.0})
        g = grid or 0.0
        d["imp"][b] += max(g, 0) * kwh
        d["exp"] += max(-g, 0) * kwh
        d["home"][b] += max(0.0, (pv or 0) + g + (bat or 0)) * kwh

    out = []
    for date in sorted(set(days) | set(counters)):
        d = days.get(date) or {"imp": [0.0] * len(bands), "home": [0.0] * len(bands), "exp": 0.0}
        c = counters.get(date)
        imp, home, exp = list(d["imp"]), list(d["home"]), d["exp"]
        if c and c.get("daily_import") is not None:
            # Scale the per-rate split so totals match the inverter's counters.
            ci = c["daily_import"] or 0.0
            ce = c.get("daily_export") or 0.0
            ch = max(0.0, (c.get("daily_pv") or 0) + ci - ce + (c.get("daily_discharge") or 0) - (c.get("daily_charge") or 0))
            other = next(i for i, b in enumerate(bands) if b.get("other"))
            imp = _scale(imp, ci, other)
            home = _scale(home, ch, other)
            exp = ce
        per = []
        for i, b in enumerate(bands):
            selfu = max(0.0, home[i] - imp[i])
            per.append({"name": b["name"], "rate": b["rate"], "import_kwh": round(imp[i], 3), "home_kwh": round(home[i], 3),
                        "self_kwh": round(selfu, 3),  # home use covered by solar or the battery in this rate
                        "cost": round(imp[i] * b["rate"], 4), "saved": round(selfu * b["rate"], 4)})
        import_cost = sum(p["cost"] for p in per)
        credit = exp * t["feed_in_rate"]
        out.append({
            "date": date,
            "import_kwh": round(sum(imp), 3), "export_kwh": round(exp, 3), "home_kwh": round(sum(home), 3),
            "import_cost": round(import_cost, 4), "supply": t["supply_charge"], "feed_in_credit": round(credit, 4),
            "grid_cost": round(import_cost + t["supply_charge"], 4),
            # What the day costs on the bill: usage + supply - feed-in. Negative = a credit.
            "net_cost": round(import_cost + t["supply_charge"] - credit, 4),
            "saved": round(sum(p["saved"] for p in per) + credit, 4),
            "bands": per,
        })
    return {"type": t["type"], "days": out}


def _scale(parts: list[float], total: float, fallback: int) -> list[float]:
    s = sum(parts)
    if s > 0:
        return [p * total / s for p in parts]
    out = [0.0] * len(parts)
    if total > 0:
        out[fallback] = total  # counters say energy moved but we have no readings to split it by
    return out
