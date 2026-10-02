"""
Fake Sungrow inverters for COLLECTOR_MOCK=1: an SH5.0RS hybrid with a battery and an AC-coupled SG5K-D behind its
meter, encoded into raw words exactly as the real ones report them, so the API's decoding runs on
mock data unchanged.

Encodings follow the API's register map (app/features/inverters/sungrow/sh_rs.py and sg_d.py): scaled
integers, signed values as two's complement, 32-bit values low word first, daily counters that
grow through the day and reset at local midnight. Like the real hybrid, it reports the second
system's output as lower (even negative) home use, since that output enters behind its meter.
The SG5K-D powers down after dark, so the mock pv2 stops answering then too.
"""

from __future__ import annotations

import logging
import math
import random
import time
from contextlib import suppress

from collector.devices import Device, RawReading, Words
from collector.devices.sungrow.sg_d import RANGES
from collector.devices.sungrow.sh_rs import BLOCKS
from collector.store import PollRow, Store

log = logging.getLogger(__name__)

FLOW_PV, FLOW_CHARGING, FLOW_DISCHARGING, FLOW_LOAD, FLOW_EXPORT, FLOW_IMPORT = 1, 2, 4, 8, 16, 32
FLOW_NEGATIVE_LOAD = 1 << 7  # seen on real hardware alongside negative load readings
CAPACITY_WH = 16_000


def _u32(v: float) -> list[int]:
    """Low word first; negative values as two's complement."""
    raw = round(v) & 0xFFFFFFFF
    return [raw & 0xFFFF, raw >> 16]


def _s16(v: float) -> int:
    return round(v) & 0xFFFF


def _fill(ranges: tuple[tuple[int, int], ...]) -> Words:
    """Every address in the ranges, as a real block read returns them (unmapped ones are zero here)."""
    return {a: 0 for start, count in ranges for a in range(start, start + count)}


def _put(words: Words, address: int, values: list[int]) -> None:
    words.update(zip(range(address, address + len(values)), values, strict=True))


class MockSite:
    """One house: a sunny-ish day, an evening load peak, a 16 kWh battery, two solar systems."""

    def __init__(self) -> None:
        self.soc = 55.0
        self.cloud = 1.0
        self.day: int | None = None
        self.last_ts: float | None = None
        self._cached: tuple[int, dict[str, RawReading | None]] | None = None
        # kWh. pv: the hybrid's panels; export/import: through the meter; pv_export: the hybrid's own share.
        self.totals = {"pv": 8_000.0, "import": 3_000.0, "export": 4_000.0, "pv_export": 2_500.0,
                       "charge": 2_000.0, "discharge": 1_800.0, "pv2": 51_000.0}  # fmt: skip
        self.daily = dict.fromkeys(self.totals, 0.0)
        self.pv2_hours = 52_500.0
        self.hybrid = MockDevice(self, "hybrid", "sungrow.sh_rs")
        self.pv2 = MockDevice(self, "pv2", "sungrow.sg_d")

    def readings(self, ts: int) -> dict[str, RawReading | None]:
        """Both devices' words at `ts` (None: not answering). Cached so one poll sees one moment."""
        if self._cached is None or self._cached[0] != ts:
            self._cached = (ts, self.simulate(ts))
        return self._cached[1]

    def simulate(self, ts: int) -> dict[str, RawReading | None]:
        lt = time.localtime(ts)
        if lt.tm_yday != self.day:
            self.day = lt.tm_yday
            self.daily = dict.fromkeys(self.totals, 0.0)
        dt_h = 0 if self.last_ts is None else min(ts - self.last_ts, 600) / 3600
        self.last_ts = ts
        hour = lt.tm_hour + lt.tm_min / 60 + lt.tm_sec / 3600

        self.cloud = min(1.0, max(0.25, self.cloud + random.uniform(-0.02, 0.02)))
        sun = max(0.0, math.sin(math.pi * (hour - 6) / 13))
        pv = 5200 * sun**1.4 * self.cloud
        pv2 = 4300 * sun**1.4 * self.cloud
        house = 350 + 150 * random.random() + 1800 * math.exp(-((hour - 18.5) ** 2) / 3)
        house += 600 * math.exp(-((hour - 7.5) ** 2) / 1)
        load = house - pv2  # what the hybrid sees: pv2's output enters behind its meter

        surplus = pv + pv2 - house
        batt = 0.0  # + discharging
        if surplus > 0 and self.soc < 100:
            batt = -min(surplus, 5000)
        elif surplus < 0 and self.soc > 5:
            batt = min(-surplus, 5000)
        self.soc = min(100.0, max(0.0, self.soc - batt * dt_h / CAPACITY_WH * 100))
        grid = house - pv - pv2 - batt  # + importing
        export = max(-grid, 0.0)
        pv_export = export * pv / (pv + pv2) if pv + pv2 else 0.0

        for k, w in (("pv", pv), ("import", max(grid, 0)), ("export", export), ("pv_export", pv_export),
                     ("charge", max(-batt, 0)), ("discharge", max(batt, 0)), ("pv2", pv2)):  # fmt: skip
            self.daily[k] += w * dt_h / 1000
            self.totals[k] += w * dt_h / 1000
        if pv2:
            self.pv2_hours += dt_h

        def daily(k: str) -> int:
            return round(self.daily[k] * 10)

        def total(k: str) -> list[int]:
            return _u32(self.totals[k] * 10)

        flow = (FLOW_PV if pv else 0) | (FLOW_CHARGING if batt < 0 else 0) | (FLOW_DISCHARGING if batt > 0 else 0)
        flow |= FLOW_LOAD | (FLOW_EXPORT if grid < 0 else 0) | (FLOW_IMPORT if grid > 0 else 0)
        flow |= FLOW_NEGATIVE_LOAD if load < 0 else 0
        amps = abs(batt) / (360 + self.soc * 0.4)

        h = _fill(BLOCKS)
        h[5008] = _s16((30 + 15 * sun) * 10)  # inverter temp, 0.1 °C
        _put(h, 5011, [round(320 * min(1, sun * 4) * 10), round(pv * 0.55 / 320 * 10)])  # MPPT1 V, A (0.1)
        _put(h, 5013, [round(310 * min(1, sun * 4) * 10), round(pv * 0.45 / 310 * 10)])  # MPPT2 V, A (0.1)
        _put(h, 5017, _u32(pv))  # W
        h[5036] = round((50 + random.uniform(-0.05, 0.05)) * 10)  # 0.1 Hz
        _put(h, 13000, [0, flow, daily("pv"), *total("pv"), daily("pv_export"), *total("pv_export")])
        _put(h, 13008, _u32(load))  # signed 32-bit, two's complement
        _put(h, 13010, _u32(-grid))  # export power, signed, + exporting
        h[13017] = round(max(0.0, self.daily["pv"] - self.daily["pv_export"] - self.daily["charge"]) * 10)
        h[13020] = round((360 + self.soc * 0.4) * 10)  # battery V, 0.1
        h[13021] = _s16(-amps * 10 if batt < 0 else amps * 10)  # charging reads negative on real hardware
        h[13022] = round(abs(batt))  # W, direction from power_flow
        _put(h, 13023, [round(self.soc * 10), 990, _s16((24 + 4 * sun) * 10)])  # SOC, SOH, temp (0.1)
        _put(h, 13026, [daily("discharge"), *total("discharge")])
        _put(h, 13036, [daily("import"), *total("import")])
        _put(h, 13040, [daily("charge"), *total("charge")])
        _put(h, 13045, [daily("export"), *total("export")])

        info: Words = {a: 0 for a in range(4990, 5000)}
        serial = b"MOCK0000001".ljust(20, b"\x00")
        info.update({4990 + i: int.from_bytes(serial[2 * i : 2 * i + 2], "big") for i in range(10)})
        info.update({5000: 0x0D0F, 5001: 50, 5002: 0, 5639: 1600})  # SH5.0RS, 5.0 kW, single phase, 16 kWh
        hybrid = RawReading(input=h, info_input=info, info_holding={13059: 50})  # reserve 5.0 %

        if not pv2:
            return {"hybrid": hybrid, "pv2": None}
        p = _fill(RANGES)
        _put(p, 5000, [0x0126, 50, 0, round(self.daily["pv2"] * 10), *_u32(self.totals["pv2"]),
                       *_u32(self.pv2_hours), _s16((28 + 20 * sun) * 10)])  # fmt: skip
        _put(p, 5011, [round(300 * min(1, sun * 4) * 10), round(pv2 * 0.5 / 300 * 10)] * 2)
        _put(p, 5017, _u32(pv2 * 1.03))  # DC power, a little above AC
        _put(p, 5031, _u32(pv2))
        return {"hybrid": hybrid, "pv2": RawReading(input=p)}


class MockDevice:
    def __init__(self, site: MockSite, name: str, driver: str, host: str = "mock"):
        self.site, self.name, self.driver, self.host = site, name, driver, host

    def read(self, include_info: bool) -> RawReading:
        return self.at(int(time.time()), include_info)

    def at(self, ts: int, include_info: bool) -> RawReading:
        r = self.site.readings(ts)[self.name]
        if r is None:
            raise ConnectionError("mock inverter asleep (it's dark)")
        if not include_info:
            return RawReading(input=r.input)
        return RawReading({**r.info_input, **r.input}, dict(r.info_holding), r.info_input, r.info_holding)


# Where a scan in mock mode "finds" the fake inverters.
MOCK_HOSTS = {"192.168.0.244": "hybrid", "192.168.0.10": "pv2"}


def mock_probe(site: MockSite, host: str) -> tuple[str, Words] | None:
    """(role, identity words) of the fake inverter at `host`, as a scan would read them."""
    role = MOCK_HOSTS.get(host)
    if role is None:
        return None
    r = site.readings(int(time.time()))
    if role == "hybrid":
        return role, dict(r["hybrid"].info_input) if r["hybrid"] else {}
    p = r["pv2"]
    return (role, {a: w for a, w in p.input.items() if a < 5009}) if p else None


def backfill(store: Store, devices: list[Device], interval: int, days: int) -> None:
    """Some history for an empty mock database, so the API has something to follow from the start.
    Does nothing unless every device is a mock."""
    mocks = [d for d in devices if isinstance(d, MockDevice)]
    if not mocks or len(mocks) != len(devices):
        return
    log.info("Mock mode: generating %d days of history", days)
    now = int(time.time())
    polls: list[tuple[int, list[PollRow]]] = []
    for ts in range(now - days * 86400, now, interval):
        rows: list[PollRow] = []
        for d in mocks:
            with suppress(ConnectionError):  # pv2 is asleep after dark
                r = d.at(ts, include_info=False)
                rows.append((d.name, d.driver, r.input, r.holding))
        polls.append((ts, rows))
    store.write_polls(polls)
