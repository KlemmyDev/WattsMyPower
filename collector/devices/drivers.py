"""
The readers the collector can run, by driver id. Each connected device (Manage → Integrations,
stored in the devices table) names its driver. Supporting a new inverter means adding a reader here
and a decoder with the same id in the API (app/features/inverters/drivers.py).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from collector.config import Config
from collector.devices import Device, DeviceConfig, Values
from collector.devices.fronius.solar_api import PORT as FRONIUS_PORT
from collector.devices.fronius.solar_api import InverterDevice, SiteDevice
from collector.devices.goodwe.dt import DtDevice
from collector.devices.goodwe.et import EtDevice
from collector.devices.goodwe.protocol import UDP_PORT, rtu_request
from collector.devices.sungrow.sg_d import SgDDevice
from collector.devices.sungrow.sh_rs import ShRsDevice

if TYPE_CHECKING:
    from collector.devices.sungrow.mock import MockSite


@dataclass(frozen=True)
class Reader:
    role: str  # the role a device read this way has (see collector.devices.ROLES)
    build: Callable[[str, int, int], Device]  # (host, port, unit) -> the device
    # (host, port, unit) -> the words that identify it, or None if what's there isn't this kind of device
    probe: Callable[[str, int, int], Values | None]
    port: int = 502  # where it usually listens: what a scan checks, and the port when none is given
    unit: int = 1  # its usual Modbus unit
    udp: bool = False  # the port is a UDP one: there's no connection to try, so a scan sends `hello` to each address
    hello: bytes = b""  # a datagram any device of this kind replies to


# In the order a network scan tries them on each address that answers: plain Modbus first (quick to
# answer or refuse), then the encrypted dongle (which ignores plain requests until they time out).
READERS: dict[str, Reader] = {
    "sungrow.sh_rs": Reader("hybrid", ShRsDevice, lambda h, p, u: ShRsDevice(h, p, u).probe()),
    "sungrow.sg_d": Reader("pv2", SgDDevice, lambda h, p, u: SgDDevice(h, p, u, timeout=3).probe()),
    # GoodWe's dongles answer Modbus over UDP 8899 (newer LAN ones Modbus TCP on 502 too: connect with that port).
    "goodwe.et": Reader(
        "hybrid", EtDevice, lambda h, p, u: EtDevice(h, p, u).probe(), UDP_PORT, EtDevice.default_unit,
        udp=True, hello=rtu_request(EtDevice.default_unit, *EtDevice.identity),
    ),
    "goodwe.dt": Reader(
        "pv2", DtDevice, lambda h, p, u: DtDevice(h, p, u).probe(), UDP_PORT, DtDevice.default_unit,
        udp=True, hello=rtu_request(DtDevice.default_unit, *DtDevice.identity),
    ),
    # Fronius' Solar API (JSON over HTTP): a Fronius with a Smart Meter runs the site; any Fronius can be a second one.
    "fronius.site": Reader("hybrid", SiteDevice, lambda h, p, u: SiteDevice(h, p, u, timeout=3).probe(), FRONIUS_PORT),
    "fronius.inverter": Reader(
        "pv2", InverterDevice, lambda h, p, u: InverterDevice(h, p, u, timeout=3).probe(), FRONIUS_PORT
    ),
}  # fmt: skip


def reader(driver: str) -> Reader:
    if driver not in READERS:
        raise ValueError(f"Unknown driver {driver!r}. Known: {', '.join(READERS)}")
    return READERS[driver]


def build_device(device: DeviceConfig, site: MockSite | None = None) -> Device:
    """The reader for a connected device; with a mock site (COLLECTOR_MOCK=1), its fake for that role."""
    if site is not None:
        from collector.devices.sungrow.mock import MockDevice, MockHybrid

        cls = MockHybrid if device.role == "hybrid" else MockDevice
        return cls(site, device.role, device.driver, device.host)
    built = reader(device.driver).build(device.host, device.port, device.unit)
    built.name = device.role
    return built


def env_devices(config: Config) -> list[DeviceConfig]:
    """The devices the environment configures (INVERTER_HOST, PV2_HOST): how installs from before
    the dashboard managed them were set up. Seeded into the database once (Store.seed_devices).
    In mock mode, a mock of each, so a fresh mock collector has something to read."""
    if config.mock and not config.inverter_host:
        return [
            DeviceConfig("hybrid", "sungrow.sh_rs", "mock"),
            DeviceConfig("pv2", "sungrow.sg_d", "mock", settings={"behind_meter": True}),
        ]
    out = []
    if config.inverter_host:
        out.append(DeviceConfig("hybrid", config.inverter_driver, config.inverter_host, config.inverter_port, config.inverter_unit))  # fmt: skip
    if config.pv2_host:
        out.append(
            DeviceConfig(
                "pv2", config.pv2_driver, config.pv2_host, config.pv2_port, config.pv2_unit,
                settings={"behind_meter": config.pv2_behind_meter},
            )
        )  # fmt: skip
    return out
