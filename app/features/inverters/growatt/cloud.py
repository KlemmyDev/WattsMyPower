"""
A Growatt string inverter read from Growatt's cloud (collector/devices/growatt/cloud.py), as a second, AC-coupled solar
system. The collector stores the figures Growatt reported, by name and as reported (often as strings); this turns them
into values.

Field names are those Home Assistant's Growatt integration reads (an older inverter's, and a newer "tlx" one's where
they differ); not yet checked against a real account here:

    pac         AC output (W)                ppv           DC power from the panels (W)
    powerToday  today's yield (kWh)          eacToday      the same, on a tlx
    powerTotal  lifetime yield (kWh)         eacTotal      the same, on a tlx
    temperature inverter temperature (°C)    temp1         the same, on a tlx
    lastUpdateTime / time   when the inverter last reported, on the plant's clock ("2026-10-12 14:05:00")
    nominalPower  rated power (W)            deviceModel   its model, when Growatt says

The collector also adds `sn`, `type` and `fetched_at` (when it asked, unix seconds; it asks every 5 minutes and stores
that answer at each poll in between).
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Mapping
from typing import Any

from app.features.inverters.types import Info, Raw, SolarValues

brand = "Growatt"

STALE = 900  # seconds: a fetch older than this at the poll is a missed reading (the cloud stopped answering)
ASLEEP = 1200  # seconds: an inverter that hasn't reported for this long has stopped for the night


def hash_password(password: str) -> str:
    """The password as Growatt's sign-in takes it (and all the dashboard keeps): its MD5 in hex, with every "0" at an
    even position made a "c". The collector's reader signs in with it (collector/devices/growatt/cloud.py)."""
    md5 = hashlib.md5(password.encode("utf-8")).hexdigest()  # Growatt's scheme, not a password store
    return "".join("c" if c == "0" and i % 2 == 0 else c for i, c in enumerate(md5))


def num(f: Mapping[str, Any], *keys: str) -> float | None:
    """The first of `keys` Growatt reported as a number (it sends most as strings: "2412.5", "1,234.5")."""
    for k in keys:
        v = f.get(k)
        if v is None or v == "":
            continue
        try:
            return float(str(v).replace(",", ""))
        except ValueError:
            continue
    return None


def reported_at(f: Mapping[str, Any]) -> float | None:
    """When the inverter last reported to Growatt, on the house's clock, as unix seconds; None if it's not said."""
    for k in ("lastUpdateTime", "time"):
        if isinstance(v := f.get(k), str):
            try:
                return time.mktime(time.strptime(v.strip()[:19], "%Y-%m-%d %H:%M:%S"))
            except ValueError:
                continue
    return None


def nominal_kw(f: Mapping[str, Any]) -> float | None:
    w = num(f, "nominalPower")
    return round(w / 1000, 1) if w is not None and 500 <= w <= 100_000 else None


def decode(raw: Raw) -> SolarValues | None:
    """This poll's figures; None when the cloud's answer is too old to count, or more than the inverter can make."""
    f = raw.get("input") or {}
    fetched = num(f, "fetched_at")
    ts = raw.get("ts")
    if fetched is None or (isinstance(ts, (int, float)) and ts - fetched > STALE):
        return None
    values: SolarValues = {
        "pv2_power": num(f, "pac"),
        "pv2_dc_power": num(f, "ppv"),
        "daily_pv2": num(f, "powerToday", "eacToday"),
        "total_pv2": num(f, "powerTotal", "eacTotal"),
        "pv2_temp": num(f, "temperature", "temp1"),
    }
    last = reported_at(f)
    if last is not None and fetched - last > ASLEEP:
        # Stopped for the night (or offline): Growatt keeps showing its last output, so it's none now; a report from
        # an earlier day means today's yield hasn't started.
        values["pv2_power"] = values["pv2_dc_power"] = 0.0
        if time.localtime(last).tm_yday != time.localtime(fetched).tm_yday:
            values["daily_pv2"] = 0.0
    if (kw := nominal_kw(f)) is not None and (
        any((values[k] or 0) > kw * 1000 * 1.5 for k in ("pv2_power", "pv2_dc_power"))
        or (values["daily_pv2"] or 0) > kw * 24
    ):
        return None
    return values


def decode_info(raw: Raw) -> Info:
    """Model, serial and rated power, which come with every poll's reading."""
    f = raw.get("input") or {}
    serial = f.get("sn") or f.get("serialNum")
    if not serial:
        return {}
    kw = nominal_kw(f)
    model = f.get("deviceModel") or f.get("modelText")
    if isinstance(model, str):
        model = model.removeprefix("Growatt").strip() or None
    return {
        "brand": brand,
        "model": model or (f"{kw:g} kW inverter" if kw else "Inverter"),
        "serial": str(serial),
        "nominal_kw": kw,
        "firmware": f.get("fwVersion") or None,
    }
