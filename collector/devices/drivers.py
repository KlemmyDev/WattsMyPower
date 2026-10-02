"""
The readers the collector can run, by driver id: INVERTER_DRIVER picks the hybrid's, PV2_DRIVER
the second inverter's. Supporting a new inverter means adding a reader here and a decoder with
the same id in the API (app/features/inverters/drivers.py).
"""

from __future__ import annotations

from collections.abc import Callable

from collector.config import Config
from collector.devices import Device
from collector.devices.sungrow.sg_d import SgDDevice
from collector.devices.sungrow.sh_rs import ShRsDevice

# driver id -> reader, built from (host, port, unit)
HYBRIDS: dict[str, Callable[[str, int, int], Device]] = {
    "sungrow.sh_rs": ShRsDevice,
}
SOLAR: dict[str, Callable[[str, int, int], Device]] = {
    "sungrow.sg_d": SgDDevice,
}


def _pick(registry: dict[str, Callable[[str, int, int], Device]], driver: str, setting: str) -> Callable[..., Device]:
    if driver not in registry:
        raise ValueError(f"Unknown {setting} {driver!r}. Known: {', '.join(sorted(registry))}")
    return registry[driver]


def build_devices(config: Config) -> tuple[Device, Device | None]:
    """The hybrid, and the second inverter if one is configured (always, in mock mode)."""
    if config.mock:
        from collector.devices.sungrow.mock import MockSite

        site = MockSite()
        return site.hybrid, site.pv2
    hybrid = _pick(HYBRIDS, config.inverter_driver, "INVERTER_DRIVER")
    pv2 = _pick(SOLAR, config.pv2_driver, "PV2_DRIVER")
    return (
        hybrid(config.inverter_host, config.inverter_port, config.inverter_unit),
        pv2(config.pv2_host, config.pv2_port, config.pv2_unit) if config.pv2_host else None,
    )
