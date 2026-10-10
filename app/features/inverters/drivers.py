"""
The drivers the API can decode, by the id the collector tags each reading with (the driver of the
device it was read from). Supporting a new inverter means adding a module that implements the
protocol in types.py and listing it here, plus its reader in the collector.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.features.inverters.fronius import inverter as fronius_inverter
from app.features.inverters.fronius import site as fronius_site
from app.features.inverters.goodwe import dt as goodwe_dt
from app.features.inverters.goodwe import et as goodwe_et
from app.features.inverters.sungrow import sg_d, sh_control, sh_rs
from app.features.inverters.types import ControlDriver, HybridDriver, SolarDriver

HYBRIDS: dict[str, HybridDriver] = {
    "sungrow.sh_rs": sh_rs,
    "goodwe.et": goodwe_et,
    "fronius.site": fronius_site,
}

SOLAR: dict[str, SolarDriver] = {
    "sungrow.sg_d": sg_d,
    "goodwe.dt": goodwe_dt,
    "fronius.inverter": fronius_inverter,
}

# Hybrids whose battery can be controlled from the dashboard (app.features.battery), by driver id.
CONTROLS: dict[str, ControlDriver] = {
    "sungrow.sh_rs": sh_control,
}

# Readings stored before the collector tagged them with a driver were all from these.
DEFAULT_HYBRID = "sungrow.sh_rs"
DEFAULT_SOLAR = "sungrow.sg_d"


@dataclass(frozen=True)
class Kind:
    """How a driver is shown when connecting an inverter (Manage → Integrations)."""

    role: str  # "hybrid" or "pv2"
    brand: str
    label: str  # the model family
    via: str  # how the collector reaches it
    example: str  # a model, for the manual form
    port: int = 502  # where it listens, unless told otherwise
    unit: int = 1  # its Modbus unit
    # Tried on a real one. False: read from what its maker (or a well-used library) documents, not yet tried here.
    verified: bool = True


KINDS: dict[str, Kind] = {
    "sungrow.sh_rs": Kind("hybrid", "Sungrow", "SH-series hybrid", "WiNet-S or WiNet-S2 dongle", "SH5.0RS"),
    "sungrow.sg_d": Kind("pv2", "Sungrow", "SG-D string inverter", "Wi-Fi dongle (encrypted Modbus)", "SG5K-D"),
    "goodwe.et": Kind(
        "hybrid", "GoodWe", "ET/EH/BT/BH hybrid", "Wi-Fi or LAN dongle (UDP port 8899)", "GW5K-EH", 8899, 0xF7, False
    ),
    "goodwe.dt": Kind(
        "pv2",
        "GoodWe",
        "DNS/XS/DT string inverter",
        "Wi-Fi or LAN dongle (UDP port 8899)",
        "GW5000D-NS",
        8899,
        0x7F,
        False,
    ),
    "fronius.site": Kind(
        "hybrid", "Fronius", "GEN24, or an inverter with a Smart Meter",
        "Solar API on its network port (on a GEN24, turn it on under Communication → Solar API)", "Primo GEN24 5.0",
        80, 1, False,
    ),
    "fronius.inverter": Kind(
        "pv2", "Fronius", "Primo, Symo or GEN24 string inverter", "Solar API on its network port", "Primo 5.0-1", 80,
        1, False,
    ),
}  # fmt: skip


def hybrid(driver: str | None) -> HybridDriver | None:
    return HYBRIDS.get(driver or DEFAULT_HYBRID)


def control(driver: str | None) -> ControlDriver | None:
    return CONTROLS.get(driver or "")


def solar(driver: str | None) -> SolarDriver | None:
    return SOLAR.get(driver or DEFAULT_SOLAR)


def identify(driver: str | None, words: Mapping[str, Any]) -> dict[str, Any]:
    """What a device's identity registers (or, for Fronius, the figures read by the collector's probe) say it is: brand, model,
    serial, nominal_kw, whether that model is one this driver supports, and whether it's one the driver reads
    but doesn't know by name yet (`untested`: a newer model of a family that shares its registers)."""
    decoder = HYBRIDS.get(driver or "") or SOLAR.get(driver or "")
    info = decoder.decode_info({"input": words}) if decoder and words else {}
    model = info.get("model")
    return {
        "brand": info.get("brand"),
        "model": model,
        "serial": info.get("serial") or None,
        "nominal_kw": info.get("nominal_kw"),
        "supported": bool(model) and not str(model).startswith("Unknown"),
        "untested": bool(info.get("untested")),
    }
