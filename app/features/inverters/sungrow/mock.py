"""A fake Sungrow SH5.0RS hybrid for local development and demos (MOCK=1)."""

from __future__ import annotations

import math
import random
import time
from typing import Any

from app.features.inverters.sungrow.sh_rs import FLOW_BATTERY_CHARGING, FLOW_BATTERY_DISCHARGING
from app.features.inverters.types import Snapshot


class MockInverter:
    """Plausible fake data: a sunny-ish day, an evening load peak, a 10 kWh battery."""

    CAPACITY_WH = 16_000
    model = "Mock SH5.0RS"
    battery_kwh = 16.0

    def __init__(self) -> None:
        self.info: dict[str, Any] = {
            "brand": "Sungrow",
            "model": self.model,
            "device_type": 0x0D0F,  # an SH5.0RS, whose battery controls have been tried
            "serial": "MOCK0000001",
            "nominal_kw": 5.0,
            "phases": "Single phase",
            "battery_kwh": self.battery_kwh,
            "reserve": 5.0,
        }
        self.soc = 55.0
        # The battery's settings (sh_control's registers): self-consumption, max/min SOC 100 % / 5 %, 5 kW.
        self.holding: dict[int, int] = {13050: 0, 13051: 0xCC, 13052: 0, 13058: 1000, 13059: 50, 33047: 500}
        self.day: int | None = None
        self.totals = {"pv": 8_000.0, "import": 3_000.0, "export": 4_000.0, "charge": 2_000.0, "discharge": 1_800.0}
        self.daily = dict.fromkeys(self.totals, 0.0)
        self.last_ts: float | None = None
        self.cloud = 1.0

    def simulate(self, ts: float) -> Snapshot:
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
        load = (
            350
            + 150 * random.random()
            + 1800 * math.exp(-((hour - 18.5) ** 2) / 3)
            + 600 * math.exp(-((hour - 7.5) ** 2) / 1)
        )
        if random.random() < 0.003:
            load += 2000  # kettle

        surplus = pv - load
        batt = 0.0  # + discharge
        top, bottom = self.holding[13058] / 10, self.holding[13059] / 10
        if self.holding[13050] == 2:  # forced: standby, or charging at a set power
            if self.holding[13051] == 0xAA and self.soc < top:
                batt = -min(self.holding[13052], 5000)
        elif surplus > 0 and self.soc < top:
            batt = -min(surplus, 5000)
        elif surplus < 0 and self.soc > bottom:
            batt = min(-surplus, 5000)
        self.soc = min(100.0, max(0.0, self.soc - batt * dt_h / self.CAPACITY_WH * 100))
        grid = load - pv - batt

        for k, w in (
            ("pv", pv),
            ("import", max(grid, 0)),
            ("export", max(-grid, 0)),
            ("charge", max(-batt, 0)),
            ("discharge", max(batt, 0)),
        ):
            self.daily[k] += w * dt_h / 1000
            self.totals[k] += w * dt_h / 1000

        flow = (
            (1 if pv > 0 else 0)
            | (FLOW_BATTERY_CHARGING if batt < 0 else 0)
            | (FLOW_BATTERY_DISCHARGING if batt > 0 else 0)
            | 8
            | (16 if grid < 0 else 0)
            | (32 if grid > 0 else 0)
        )

        def r(v: float, n: int = 1) -> float:
            return round(v, n)

        return {
            "pv_power": r(pv, 0),
            "load_power": r(load, 0),
            "grid_power": r(grid, 0),
            "battery_power": r(batt, 0),
            "battery_soc": r(self.soc),
            "battery_soh": 99.0,
            "battery_temp": r(24 + 4 * sun),
            "battery_voltage": r(360 + self.soc * 0.4),
            "battery_current": r(abs(batt) / 380),
            "inverter_temp": r(30 + 15 * sun),
            "grid_freq": r(50 + random.uniform(-0.05, 0.05), 2),
            # The street's voltage rises with the solar sent into it, and sags with the house drawing hard.
            "grid_voltage": r(240 + 0.0022 * -grid + random.uniform(-1.5, 1.5)),
            "mppt1_v": r(320 * min(1, sun * 4)),
            "mppt1_a": r(pv * 0.55 / 320 if pv else 0),
            "mppt2_v": r(310 * min(1, sun * 4)),
            "mppt2_a": r(pv * 0.45 / 310 if pv else 0),
            "running_state": 0x0800 if self.holding[13050] == 2 else 0,
            "power_flow": flow,
            "daily_pv": r(self.daily["pv"]),
            "daily_import": r(self.daily["import"]),
            "daily_export": r(self.daily["export"]),
            "daily_pv_export": r(self.daily["export"]),  # no second system here: all export is the hybrid's
            "daily_charge": r(self.daily["charge"]),
            "daily_discharge": r(self.daily["discharge"]),
            "daily_direct": r(max(0.0, self.daily["pv"] - self.daily["export"] - self.daily["charge"])),
            "total_pv": r(self.totals["pv"]),
            "total_import": r(self.totals["import"]),
            "total_export": r(self.totals["export"]),
            "total_pv_export": r(self.totals["export"]),
            "total_charge": r(self.totals["charge"]),
            "total_discharge": r(self.totals["discharge"]),
        }

    def read_snapshot(self) -> Snapshot:
        return self.simulate(time.time())


class MockRegisters:
    """The mock inverter's battery settings, read and written as the collector would the real one's."""

    def __init__(self, inverter: MockInverter):
        self.inverter = inverter

    def read(self) -> dict[int, int]:
        return dict(self.inverter.holding)

    def write(self, words: list[tuple[int, int]]) -> dict[int, int]:
        for address, word in words:
            self.inverter.holding[address] = word
        self.inverter.info["reserve"] = self.inverter.holding[13059] / 10
        return self.read()
