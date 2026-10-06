"""
The drivers the API can decode, by the id the collector tags each reading with (the driver of the
device it was read from). Supporting a new inverter means adding a module that implements the
protocol in types.py and listing it here, plus its reader in the collector.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.features.inverters.sungrow import sg_d, sh_control, sh_rs
from app.features.inverters.types import ControlDriver, HybridDriver, SolarDriver

HYBRIDS: dict[str, HybridDriver] = {
    "sungrow.sh_rs": sh_rs,
}

SOLAR: dict[str, SolarDriver] = {
    "sungrow.sg_d": sg_d,
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
    """How a driver is shown when connecting an inverter (Settings → Integrations)."""

    role: str  # "hybrid" or "pv2"
    brand: str
    label: str  # the model family
    via: str  # how the collector reaches it
    example: str  # a model, for the manual form


KINDS: dict[str, Kind] = {
    "sungrow.sh_rs": Kind("hybrid", "Sungrow", "SH-series hybrid", "WiNet-S or WiNet-S2 dongle", "SH5.0RS"),
    "sungrow.sg_d": Kind("pv2", "Sungrow", "SG-D string inverter", "Wi-Fi dongle (encrypted Modbus)", "SG5K-D"),
}


def hybrid(driver: str | None) -> HybridDriver | None:
    return HYBRIDS.get(driver or DEFAULT_HYBRID)


def control(driver: str | None) -> ControlDriver | None:
    return CONTROLS.get(driver or "")


def solar(driver: str | None) -> SolarDriver | None:
    return SOLAR.get(driver or DEFAULT_SOLAR)


def identify(driver: str | None, words: dict[str, int]) -> dict[str, Any]:
    """What a device's identity registers (read by the collector's probe) say it is: brand, model,
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
