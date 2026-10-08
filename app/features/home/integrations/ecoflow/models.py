"""
What EcoFlow's power stations report through the Developer API, and how to switch their AC outlets. There are three
generations, each with its own keys:

- The first (DELTA Pro, DELTA Max): "pd.soc", "inv.inputWatts", "mppt.inWatts" in tenths of a watt, "pd.wattsOutSum",
  the outlets at "inv.cfgAcEnabled", switched by a "TCP" command.
- The second (RIVER 2, DELTA 2 and their Max and Pro): "bms_bmsStatus.soc", "inv.inputWatts", "mppt.inWatts" in watts,
  "pd.wattsOutSum", the outlets at "mppt.cfgAcEnabled" (or "inv.cfgAcEnabled" on a DELTA 2 Max), switched by
  "acOutCfg".
- The third (DELTA Pro 3, DELTA 3, RIVER 3): "cmsBattSoc", "powGetAcIn", "powGetPv…", "powOutSumW", the outlets at
  "cfgAcOutOpen", switched by a cmdId 17 command.

A product not listed is read by the generation its keys say it is; its size isn't known and its outlets aren't
switched. The keys, and each command's shape, are as the hassio-ecoflow-cloud project
(github.com/tolwi/hassio-ecoflow-cloud) uses them with the same API.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Literal

from app.features.home.stations import Station

Generation = Literal[1, 2, 3]


@dataclass(frozen=True)
class Model:
    generation: Generation
    capacity_kwh: float | None  # the station on its own: extra batteries add to it
    # How its AC outlets are switched: "tcp" (first generation), the acOutCfg module (second), "cmd17" (third), or
    # None: not from here.
    outlets: Literal["tcp", "cmd17"] | int | None


MODELS: dict[str, Model] = {
    "DELTA Pro": Model(1, 3.6, "tcp"),
    "DELTA Max": Model(1, 2.016, "tcp"),
    "DELTA 2": Model(2, 1.024, 5),
    "DELTA 2 Max": Model(2, 2.048, 3),
    "RIVER 2": Model(2, 0.256, 5),
    "RIVER 2 Max": Model(2, 0.512, 5),
    "RIVER 2 Pro": Model(2, 0.768, 5),
    "Delta Pro 3": Model(3, 4.096, None),  # high- and low-voltage AC outlets, switched apart
    "DELTA 3": Model(3, 1.024, "cmd17"),
    "DELTA 3 Plus": Model(3, 1.024, "cmd17"),
    "DELTA 3 Max Plus": Model(3, 2.048, "cmd17"),
    "RIVER 3": Model(3, 0.245, "cmd17"),
    "RIVER 3 Plus": Model(3, 0.286, "cmd17"),
}


def _number(quota: dict[str, Any], *keys: str) -> float | None:
    """The first of `keys` the device reports, as a number."""
    for k in keys:
        v = quota.get(k)
        if isinstance(v, int | float) and not isinstance(v, bool):
            return float(v)
    return None


def _switch(quota: dict[str, Any], *keys: str) -> bool | None:
    for k in keys:
        v = quota.get(k)
        if isinstance(v, bool | int | float):
            return bool(v)
    return None


def generation(quota: dict[str, Any]) -> Generation | None:
    """Which generation a device's keys say it is (None: it's no power station)."""
    if "cmsBattSoc" in quota or "bmsBattSoc" in quota or "powOutSumW" in quota:
        return 3
    if "bms_bmsStatus.soc" in quota:
        return 2
    if "bmsMaster.soc" in quota or "pd.soc" in quota:
        return 1
    return None


def model(product: str | None, quota: dict[str, Any]) -> Model | None:
    """A device's model, by its product name or, failing that, by its keys (None: it's no power station)."""
    known = MODELS.get(product or "") or next(
        (m for name, m in MODELS.items() if name.casefold() == (product or "").casefold()), None
    )
    if known:
        return known
    g = generation(quota)
    return Model(g, None, None) if g else None


def station(m: Model, quota: dict[str, Any]) -> Station | None:
    """What a station is doing, from everything it reported (None: its charge isn't among it)."""
    if m.generation == 3:
        soc = _number(quota, "cmsBattSoc", "bmsBattSoc")
        house = _number(quota, "powGetAcIn")
        solar = sum(abs(_number(quota, k) or 0.0) for k in ("powGetPv", "powGetPv2", "powGetPvH", "powGetPvL"))
        output = _number(quota, "powOutSumW")
        ac_on = _switch(quota, "cfgAcOutOpen")
        dc_on = _switch(quota, "cfgDc12vOutOpen")
    else:
        soc = _number(quota, "pd.soc", "bms_bmsStatus.soc", "bmsMaster.soc")
        house = _number(quota, "inv.inputWatts")
        solar = (_number(quota, "mppt.inWatts") or 0.0) / (10 if m.generation == 1 else 1)
        solar += _number(quota, "mppt.pv2InWatts") or 0.0
        output = _number(quota, "pd.wattsOutSum")
        ac_on = _switch(quota, "mppt.cfgAcEnabled", "inv.cfgAcEnabled")
        dc_on = _switch(quota, "pd.carState", "pd.dcOutState")
    if soc is None or not 0 <= soc <= 100:
        return None
    return Station(
        soc=soc,
        house_w=abs(house or 0.0),
        solar_w=solar,
        output_w=abs(output or 0.0),
        ac_on=ac_on if m.outlets is not None else None,
        dc_on=dc_on,
        capacity_kwh=m.capacity_kwh,
    )


def ac_command(m: Model, sn: str, on: bool) -> dict[str, Any] | None:
    """The command that switches a station's AC outlets (None: it can't be from here)."""
    seq = int(time.time() * 1000) % 1_000_000_000
    if m.outlets == "tcp":
        return {
            "id": seq,
            "version": "1.0",
            "sn": sn,
            "moduleType": 0,
            "operateType": "TCP",
            "params": {"cmdSet": 32, "id": 66, "enabled": int(on)},
        }
    if m.outlets == "cmd17":
        return {
            "sn": sn,
            "cmdId": 17,
            "dirDest": 1,
            "dirSrc": 1,
            "cmdFunc": 254,
            "dest": 2,
            "params": {"cfgAcOutOpen": on},
        }
    if isinstance(m.outlets, int):
        return {
            "id": seq,
            "version": "1.0",
            "sn": sn,
            "moduleType": m.outlets,
            "operateType": "acOutCfg",
            "params": {"enabled": int(on), "out_voltage": -1, "out_freq": 255, "xboost": 255},
        }
    return None
