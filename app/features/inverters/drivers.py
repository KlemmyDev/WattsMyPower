"""
The drivers the API can decode, by the id the collector tags each reading with (its
INVERTER_DRIVER / PV2_DRIVER settings). Supporting a new inverter means adding a module that
implements the protocol in types.py and listing it here, plus its reader in the collector.
"""

from __future__ import annotations

from app.features.inverters.sungrow import sg_d, sh_rs
from app.features.inverters.types import HybridDriver, SolarDriver

HYBRIDS: dict[str, HybridDriver] = {
    "sungrow.sh_rs": sh_rs,
}

SOLAR: dict[str, SolarDriver] = {
    "sungrow.sg_d": sg_d,
}

# Readings stored before the collector tagged them with a driver were all from these.
DEFAULT_HYBRID = "sungrow.sh_rs"
DEFAULT_SOLAR = "sungrow.sg_d"


def hybrid(driver: str | None) -> HybridDriver | None:
    return HYBRIDS.get(driver or DEFAULT_HYBRID)


def solar(driver: str | None) -> SolarDriver | None:
    return SOLAR.get(driver or DEFAULT_SOLAR)
