"""
Turn the collector's raw rows into snapshots: decode each device's reading with the driver it's
tagged with, leave out the hybrid's frozen repeats, then fold the second inverter into the
hybrid's figures. Pure, so live ingest and `reprocess` give the same result.
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
from app.features.inverters.types import HybridDriver, Snapshot, SolarValues

log = logging.getLogger(__name__)

Row = dict[str, Any]  # one device's reading, as served by the collector (see collector/PROTOCOL.md)

_unknown: set[str] = set()


def _when(ts: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))


def _garbled(ts: int, device: str, what: str) -> None:
    log.info("Dropped a garbled %s reading at %s: %s", device, _when(ts), what)


def _note_outside(ts: int, device: str, values: dict[str, Any]) -> None:
    if bad := outside(values):
        _garbled(ts, device, ", ".join(f"{k}={values[k]}" for k in bad))


def _unknown_driver(device: str, driver: str | None) -> None:
    """Log a driver this API doesn't know, once: its readings are skipped until it does (then reprocess)."""
    if f"{device}:{driver}" not in _unknown:
        _unknown.add(f"{device}:{driver}")
        log.warning("No %s driver %r in this version: skipping its readings", device, driver)


def behind_meter(pv2: dict[str, Any] | None, default: bool) -> bool:
    """Where the second inverter connects: its setting (Manage → Integrations), else PV2_BEHIND_METER."""
    value = ((pv2 or {}).get("settings") or {}).get("behind_meter")
    return value if isinstance(value, bool) else default


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


@dataclass
class Freeze:
    """
    The hybrid's last fresh poll, to tell a frozen repeat of it from a new reading.

    A gateway that stops refreshing its registers keeps answering with the same words (the
    driver's `frozen`). Those polls aren't stored, as if missed: charts show a gap rather than a
    flat line, and rollups, the forecast's calibration and solar performance aren't fed figures
    from minutes ago (with the second inverter's live output merged into them). The meter's
    lifetime counters still count energy across the gap once fresh readings resume.
    """

    last: tuple[int, Row] | None = None  # (ts, row) of the last fresh poll
    since: int | None = None  # while frozen: when the reading being repeated was taken
    repeats: int = 0  # frozen polls left out, in total

    def check(self, ts: int, row: Row, driver: HybridDriver) -> bool:
        """Whether this poll repeats the last fresh one (left out). Otherwise it becomes the last."""
        if self.last is not None and driver.frozen(self.last[1], row):
            if self.since is None:
                self.since = self.last[0]
                log.info("The inverter's readings are frozen at those from %s: leaving them out", _when(self.since))
            self.repeats += 1
            return True
        if self.since is not None:
            log.info("The inverter's readings are moving again at %s", _when(ts))
        self.last, self.since = (ts, row), None
        return False


def snapshots(
    rows: list[Row], *, has_pv2: bool, behind_meter: bool, poll_interval: int, carry: Pv2Carry, freeze: Freeze
) -> list[tuple[int, Snapshot]]:
    """(ts, snapshot) for each fresh poll the hybrid answered, oldest first. Updates `carry` and
    `freeze` as it goes, so a batch picks up where the last one left off."""
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
        if freeze.check(ts, row, main):
            continue  # the second inverter's reading still counted towards its carry, above
        snap = main.decode(row)
        _note_outside(ts, "hybrid", snap)
        snap = clean(snap)
        if has_pv2:
            snap = merge_pv2(snap, pv2, behind_meter)
        out.append((ts, snap))
    return out
