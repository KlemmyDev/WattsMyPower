"""
AEMO's public data for the National Electricity Market (NEM): what power costs wholesale in each region now, how much
the region's using, prices through to the early hours (pre-dispatch), and AEMO's market notices, which is where it
warns of tight supply (Lack of Reserve), load shedding and power system events.

No account or key: these are the feeds behind AEMO's own data dashboard (aemo.com.au → Data dashboard), the same for
everyone. Times are NEM time (AEST, UTC+10 all year, no daylight saving) and mark the end of their interval.

Endpoints used:
    GET  /aemo/apps/api/report/ELEC_NEM_SUMMARY   each region's price and demand now, and the latest ten notices
    POST /aemo/apps/api/report/5MIN                {"timeScale": ["30MIN"]}: the last day's 5-minute prices and demand
                                                   (ACTUAL), and the pre-dispatch half hours ahead (FORECAST)
"""

from __future__ import annotations

import datetime as dt
import json
import re
import urllib.error
from collections.abc import Callable
from typing import Any

from app.core.http import get_json, request_json

BASE = "https://visualisations.aemo.com.au/aemo/apps/api/report"
NEM_TIME = dt.timezone(dt.timedelta(hours=10))

REGIONS = {"NSW1": "NSW", "QLD1": "QLD", "VIC1": "VIC", "SA1": "SA", "TAS1": "TAS"}
REGION_NAMES = {
    "NSW1": "New South Wales & ACT",
    "QLD1": "Queensland",
    "VIC1": "Victoria",
    "SA1": "South Australia",
    "TAS1": "Tasmania",
}


class AemoError(Exception):
    """AEMO couldn't be reached, or answered with something that couldn't be read."""


def nem_time(s: str) -> int:
    """An AEMO timestamp ("2026-10-08T10:25:00", NEM time) as epoch seconds."""
    return int(dt.datetime.fromisoformat(s).replace(tzinfo=NEM_TIME).timestamp())


def _float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _why(e: Exception) -> str:
    if isinstance(e, urllib.error.HTTPError):
        return f"AEMO answered {e.code}."
    if isinstance(e, (urllib.error.URLError, OSError)):
        return "Couldn't reach AEMO. Check this machine's internet connection."
    return "AEMO's answer couldn't be read."


Get = Callable[[str], Any]
Post = Callable[[str, bytes], Any]


class AemoClient:
    def __init__(
        self,
        get: Get = lambda url: get_json(url, timeout=20),
        post: Post = lambda url, body: request_json(
            "POST", url, body, {"Content-Type": "application/json"}, timeout=30
        ),
    ):
        self._get = get
        self._post = post

    def summary(self) -> dict[str, Any]:
        """Each region now ({region: {at, price, demand, status, capped, suspended}}) and the latest notices."""
        try:
            data = self._get(f"{BASE}/ELEC_NEM_SUMMARY")
            regions: dict[str, dict[str, Any]] = {}
            for r in data.get("ELEC_NEM_SUMMARY") or []:
                region = r.get("REGIONID")
                if region not in REGIONS:
                    continue
                regions[region] = {
                    "at": nem_time(r["SETTLEMENTDATE"]),
                    "price": _float(r.get("PRICE")),  # $/MWh
                    "demand": _float(r.get("TOTALDEMAND")),  # MW
                    "status": r.get("PRICE_STATUS"),  # FIRM, or NOT FIRM until the interval's settled
                    # The administered price cap is in force (prices held down after a run of very high ones), or
                    # AEMO has suspended the market: both happen only when the system is in real trouble.
                    "capped": bool(_float(r.get("APCFLAG"))),
                    "suspended": bool(_float(r.get("MARKETSUSPENDEDFLAG"))),
                }
            notices = [n for n in (notice(x) for x in data.get("ELEC_NEM_SUMMARY_MARKET_NOTICE") or []) if n]
            return {"regions": regions, "notices": notices}
        except (urllib.error.URLError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as e:
            raise AemoError(_why(e)) from e

    def prices(self, region: str) -> list[dict[str, Any]]:
        """The region's last day of 5-minute prices and demand, then the pre-dispatch half hours ahead, oldest first:
        [{at, price, demand, forecast}]."""
        try:
            data = self._post(f"{BASE}/5MIN", json.dumps({"timeScale": ["30MIN"]}).encode())
            rows = [
                {
                    "at": nem_time(r["SETTLEMENTDATE"]),
                    "price": _float(r.get("RRP")),
                    "demand": _float(r.get("TOTALDEMAND")),
                    "forecast": r.get("PERIODTYPE") != "ACTUAL",
                }
                for r in data.get("5MIN") or []
                if r.get("REGIONID") == region
            ]
            return sorted(rows, key=lambda r: r["at"])
        except (urllib.error.URLError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as e:
            raise AemoError(_why(e)) from e


# --------------------------------------------------------------------------- notices

# What a notice means for a household, by its type and what it says. Most notices are market housekeeping
# (constraints, settlements, IT changes) and say nothing to a household: those are left out.
LOR = re.compile(r"\bLOR\s*([123])\b", re.I)
MSL = re.compile(r"\bMSL\s*([123])\b", re.I)
REGION_WORD = {abbr: re.compile(rf"\b{abbr}\b") for abbr in REGIONS.values()}
CANCELLED = re.compile(r"^\s*(cancellation|cancelled|cancel)\b", re.I)


def notice(raw: dict[str, Any]) -> dict[str, Any] | None:
    """A market notice that matters to a household, with its kind, how serious it is, and the regions it's about; None
    for the rest."""
    try:
        nid = int(float(raw["NOTICEID"]))
        at = nem_time(raw["EFFECTIVEDATE"])
    except (KeyError, TypeError, ValueError):
        return None
    kind_id = str(raw.get("TYPEID") or "").upper()
    title = str(raw.get("EXTERNALREFERENCE") or "").strip()
    body = str(raw.get("REASON") or "")
    text = f"{title}\n{body}"
    kind, level = None, "info"
    if "LOAD RESTRICTION" in kind_id or re.search(r"load shedding|load restriction", text, re.I):
        kind, level = "load_shedding", "critical"
    elif kind_id == "RESERVE NOTICE" or LOR.search(title):
        m = LOR.search(title)
        n = int(m.group(1)) if m else 1
        kind = f"lor{n}"
        level = {1: "info", 2: "warning", 3: "critical"}[n]
        # Actual (it's happening) is more pressing than Forecast (it might).
        if n == 2 and re.search(r"\bactual\b", title, re.I):
            level = "critical"
    elif "POWER SYSTEM EVENT" in kind_id:
        kind, level = "system_event", "warning"
    elif "MARKET SUSPENSION" in kind_id or "SUSPENSION" in kind_id:
        kind, level = "suspension", "critical"
    elif "PRICES SUBJECT TO REVIEW" in kind_id or "ADMINISTERED PRICE" in kind_id:
        kind, level = "price_cap", "warning"
    elif kind_id == "MINIMUM SYSTEM LOAD" or MSL.search(title):
        m = MSL.search(title)
        n = int(m.group(1)) if m else 1
        # Too little demand on the grid: at MSL3 networks may switch rooftop solar off to keep the system secure.
        kind, level = f"msl{n}", "warning" if n == 3 else "info"
    if not kind:
        return None
    regions = [code for code, abbr in REGIONS.items() if REGION_WORD[abbr].search(title)] or [
        code for code, abbr in REGIONS.items() if REGION_WORD[abbr].search(body)
    ]
    cancelled = bool(CANCELLED.search(title))
    return {
        "id": nid,
        "at": at,
        "kind": kind,
        "level": "info" if cancelled else level,
        "cancels": cancelled,
        "title": title,
        "body": body.replace("\r\n", "\n").strip(),
        "regions": regions,
    }
