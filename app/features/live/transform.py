"""
Turn the collector's raw rows into snapshots: decode each device's reading with the driver it's
tagged with, then fold the second inverter into the hybrid's figures. Pure, so live ingest and
`reprocess` give the same result.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from itertools import groupby
from typing import Any

from app.features.inverters import drivers
from app.features.inverters.limits import clean, outside
from app.features.inverters.merge import merge_pv2
from app.features.inverters.types import Snapshot, SolarValues

log = logging.getLogger(__name__)

Row = dict[str, Any]  # one device's reading, as served by the collector (see collector/PROTOCOL.md)

_unknown: set[str] = set()


def _garbled(ts: int, device: str, what: str) -> None:
    log.info(
        "Dropped a garbled %s reading at %s: %s", device, time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)), what
    )


def _note_outside(ts: int, device: str, values: dict[str, Any]) -> None:
    if bad := outside(values):
        _garbled(ts, device, ", ".join(f"{k}={values[k]}" for k in bad))


def _unknown_driver(device: str, driver: str | None) -> None:
    """Log a driver this API doesn't know, once: its readings are skipped until it does (then reprocess)."""
    if f"{device}:{driver}" not in _unknown:
        _unknown.add(f"{device}:{driver}")
        log.warning("No %s driver %r in this version: skipping its readings", device, driver)


@dataclass
class Pv2Carry:
    """The second inverter's last good values, carried across polls it missed."""

    last: tuple[int, SolarValues] | None = None  # (ts, values)
    info: dict[str, Any] = field(default_factory=dict)

    def values_at(self, ts: int, read: SolarValues | None, poll_interval: int) -> SolarValues | None:
        """This poll's values: what was read, or the last values for a missed read or two."""
        if read is not None:
            self.last = (ts, read)
            return read
        if not self.last:
            return None
        at, vals = self.last
        if ts - at < poll_interval * 3:
            return vals  # a missed read or two: carry the last values
        # Longer gaps are usually the inverter asleep (they power down after dark): no output,
        # but today's counters still stand. Yesterday's counters don't carry over.
        if time.strftime("%Y-%m-%d", time.localtime(at)) != time.strftime("%Y-%m-%d", time.localtime(ts)):
            return None
        return {**vals, "pv2_power": 0, "pv2_dc_power": 0}


def snapshots(
    rows: list[Row], *, has_pv2: bool, behind_meter: bool, poll_interval: int, carry: Pv2Carry
) -> list[tuple[int, Snapshot]]:
    """(ts, snapshot) for each poll the hybrid answered, oldest first. Updates `carry` as it goes."""
    out: list[tuple[int, Snapshot]] = []
    for ts, polled in groupby(sorted(rows, key=lambda r: (r["ts"], r["device"])), key=lambda r: int(r["ts"])):
        by_device = {r["device"]: r for r in polled}
        pv2_read = None
        if (row := by_device.get("pv2")) is not None:
            if solar := drivers.solar(row.get("driver")):
                if (pv2_read := solar.decode(row)) is None:
                    _garbled(ts, "pv2", "the reading as a whole")
                else:
                    _note_outside(ts, "pv2", pv2_read)
                    pv2_read, carry.info = clean(pv2_read), solar.decode_info(row)
            else:
                _unknown_driver("pv2", row.get("driver"))
        pv2 = carry.values_at(ts, pv2_read, poll_interval) if has_pv2 else None
        if (row := by_device.get("hybrid")) is None:
            continue  # nothing to record without the hybrid's reading
        if (main := drivers.hybrid(row.get("driver"))) is None:
            _unknown_driver("hybrid", row.get("driver"))
            continue
        snap = main.decode(row)
        _note_outside(ts, "hybrid", snap)
        snap = clean(snap)
        if has_pv2:
            snap = merge_pv2(snap, pv2, behind_meter)
        out.append((ts, snap))
    return out
