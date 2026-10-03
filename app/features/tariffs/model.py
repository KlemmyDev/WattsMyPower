"""
The tariff model: validation, and which rate applies at each minute of the week.

A tariff is either a single import rate; time of use: a list of named rates,
each active in one or more time windows, plus one "all other times" rate; or Amber:
the import and feed-in prices Amber Electric sets for every 5 or 30 minutes
(app.features.amber), with the single and feed-in rates standing in for any time
Amber has no price for. Otherwise feed-in and the daily supply charge are flat.

    {
      "type": "flat" | "tou" | "amber",
      "flat_rate": 0.32,                     # $/kWh, used when type is flat (and where Amber has no price)
      "bands": [                             # used when type is tou; first match wins, but overlaps are rejected
        {"name": "Peak", "rate": 0.45, "windows": [{"days": "all", "start": "16:00", "end": "21:00"}]},   # "00:00" to "00:00" = all day
        {"name": "Off-peak", "rate": 0.22, "windows": [{"days": "all", "start": "21:00", "end": "07:00"}]},
        {"name": "Shoulder", "rate": 0.30, "other": true, "windows": []}
      ],
      "feed_in_rate": 0.05,                  # $/kWh (for type amber: where Amber has no price)
      "supply_charge": 1.05,                 # $/day
      "source": {...}                        # optional: the published plan it was imported from
    }
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

Tariff = dict[str, Any]

DAYS = {"all": "Every day", "weekdays": "Weekdays", "weekends": "Weekends"}
TYPES = ("flat", "tou", "amber")
# An Amber tariff's two "bands": energy at Amber's prices, and energy at times Amber had no price for.
AMBER_PRICED, AMBER_FALLBACK = 0, 1
MAX_BANDS = 6
MAX_WINDOWS = 6
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$|^24:00$")


@dataclass(frozen=True)
class RateTables:
    """The bands, and the index of the band in force at each minute of a weekday and a weekend day."""

    bands: list[dict[str, Any]]
    weekday: list[int]
    weekend: list[int]

    def at(self, weekend: bool, minute: int) -> int:
        return (self.weekend if weekend else self.weekday)[minute]

    @property
    def other(self) -> int:
        """Index of the band for all other times."""
        return next(i for i, b in enumerate(self.bands) if b.get("other"))


def default_bands(rate: float) -> list[dict[str, Any]]:
    """A common Queensland-style time-of-use layout, as a starting point to edit."""
    return [
        {"name": "Peak", "rate": round(rate * 1.4, 2), "windows": [{"days": "all", "start": "16:00", "end": "21:00"}]},
        {
            "name": "Off-peak",
            "rate": round(rate * 0.7, 2),
            "windows": [{"days": "all", "start": "21:00", "end": "07:00"}],
        },
        {"name": "Shoulder", "rate": rate, "other": True, "windows": []},
    ]


def _minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def rate_tables(t: Tariff) -> RateTables:
    """Which band applies at each minute. Raises ValueError (naming the clash) if windows overlap.

    An Amber tariff has no time windows: its costs are priced interval by interval (costs.py), and its
    bands only name the two ways energy gets priced, with every minute pointing at the fallback."""
    if t["type"] == "amber":
        bands = [
            {"name": "Amber prices", "rate": t["flat_rate"], "windows": []},
            {"name": "No Amber price", "rate": t["flat_rate"], "other": True, "windows": []},
        ]
        return RateTables(bands=bands, weekday=[AMBER_FALLBACK] * 1440, weekend=[AMBER_FALLBACK] * 1440)
    bands = (
        t["bands"]
        if t["type"] == "tou"
        else [{"name": "All times", "rate": t["flat_rate"], "other": True, "windows": []}]
    )
    other = next(i for i, b in enumerate(bands) if b.get("other"))
    tables: dict[str, list[int]] = {}
    for kind in ("weekday", "weekend"):
        tab = [other] * 1440
        owner: list[int | None] = [None] * 1440
        for i, b in enumerate(bands):
            if b.get("other"):
                continue
            for w in b["windows"]:
                if w["days"] != "all" and w["days"][:-1] != kind:
                    continue
                s, e = _minutes(w["start"]), _minutes(w["end"])
                # start == end covers the whole day; start > end wraps past midnight
                span = range(s, e) if s < e else [*range(s, 1440), *range(0, e)]
                for m in span:
                    o = owner[m]
                    if o is not None and o != i:
                        raise ValueError(
                            f"{bands[o]['name']} and {b['name']} overlap on {'weekends' if kind == 'weekend' else 'weekdays'} "
                            f"at {m // 60:02d}:{m % 60:02d}. Change one of the time windows."
                        )
                    owner[m] = i
                    tab[m] = i
        tables[kind] = tab
    return RateTables(bands=bands, weekday=tables["weekday"], weekend=tables["weekend"])


def validate(raw: Any) -> Tariff:
    """Return a clean tariff or raise ValueError with a message fit to show on the page."""
    if not isinstance(raw, dict):
        raise ValueError("Invalid tariff.")

    def rate(v: Any, label: str, hi: float = 5.0) -> float:
        try:
            x = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"{label} must be a number.") from None
        if not 0 <= x <= hi:
            raise ValueError(f"{label} must be between 0 and {hi:g}.")
        return round(x, 4)

    typ = raw.get("type")
    if typ not in TYPES:
        raise ValueError("Rate type must be single rate, time of use, or Amber.")
    t: Tariff = {
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
            clean: dict[str, Any] = {"name": name, "rate": rate(b.get("rate"), f"{name} rate"), "windows": []}
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
        keys = ("brand", "brand_id", "plan_id", "plan_name", "updated", "imported")
        t["source"] = {k: str(src[k])[:120] for k in keys if src.get(k)}
    rate_tables(t)  # raises on overlaps
    return t
