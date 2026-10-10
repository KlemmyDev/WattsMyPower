"""
Fronius inverters (GEN24 and Tauro, and the Datamanager's Symo, Primo, Eco and Galvo), read through Fronius' Solar API:
JSON over plain HTTP on the inverter (or its Datamanager), no sign-in, no cloud. Decoded by the API's drivers of the
same ids (app/features/inverters/fronius).

    /solar_api/GetAPIVersion.cgi                              {"APIVersion": 1, ...}: what a probe asks
    /solar_api/v1/GetPowerFlowRealtimeData.fcgi               the site: solar, grid, home, battery, energy so far
    /solar_api/v1/GetMeterRealtimeData.cgi?Scope=System       the Smart Meter: power, lifetime import/export, voltage
    /solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=<unit>&DataCollection=CommonInverterData
                                                              one inverter: AC output, its strings, its own energy
    /solar_api/v1/GetStorageRealtimeData.cgi?Scope=System     the battery: charge, cells' temperature, voltage
    /solar_api/v1/GetInverterInfo.cgi                         each inverter's type code, rated power, serial, name

Fronius isn't Modbus, so a reading isn't register words but the figures the Solar API reported, as it reported them
(no scaling, signs or units changed), by name: "flow.P_PV", "meter.EnergyReal_WAC_Plus_Absolute",
"inverter.UDC". Only the figures the dashboard reads are kept, so rows stay as small as a Sungrow's. A figure the
inverter left out (or sent as null) is left out.

Fronius asks clients to make one request at a time, a few seconds apart (Solar API V1 spec, §2.6): requests go one
after another, never together. On a GEN24 the Solar API is off from the factory since firmware 1.14.1: it's turned
on in the inverter's own web page, under Communication → Solar API.
"""

from __future__ import annotations

import contextlib
import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterable, Mapping
from typing import Any

from collector.devices import RawReading, Values

PORT = 80
GAP = 1.0  # seconds between one request and the next to the same inverter

# The figures kept from each request, by where they sit in its Body.Data.
FLOW_SITE = ("P_PV", "P_Grid", "P_Load", "P_Akku", "E_Day", "E_Total", "Mode", "Meter_Location", "BackupMode",
             "BatteryStandby")  # fmt: skip
FLOW_INVERTER = ("P", "SOC", "Battery_Mode", "E_Day", "E_Total")
METER = ("PowerReal_P_Sum", "EnergyReal_WAC_Plus_Absolute", "EnergyReal_WAC_Minus_Absolute", "Voltage_AC_Phase_1",
         "Frequency_Phase_Average", "Meter_Location_Current")  # fmt: skip
INVERTER = ("PAC", "UAC", "FAC", "UDC", "IDC", "UDC_2", "IDC_2", "UDC_3", "IDC_3", "DAY_ENERGY", "TOTAL_ENERGY")
STORAGE = ("StateOfCharge_Relative", "Capacity_Maximum", "Temperature_Cell", "Voltage_DC", "Current_DC")
INFO = ("DT", "PVPower", "UniqueID", "CustomName")


def pick(prefix: str, data: Mapping[str, Any] | None, keys: Iterable[str]) -> Values:
    """The named figures from one object, as "prefix.Name". A {"Value", "Unit"} pair keeps its value."""
    out: Values = {}
    for k in keys:
        v = (data or {}).get(k)
        if isinstance(v, dict):
            v = v.get("Value")
        if isinstance(v, bool | int | float | str):
            out[f"{prefix}.{k}"] = v
    return out


class NotSupported(ConnectionError):
    """The inverter answered, but doesn't have what was asked for (a battery on a Symo without one)."""


class SolarApi:
    """One Fronius inverter's (or Datamanager's) Solar API, one request at a time."""

    def __init__(self, host: str, port: int = PORT, timeout: float = 6.0):
        self.host, self.port, self.timeout = host, port, timeout
        self._lock = threading.Lock()
        self._last = 0.0

    def get(self, path: str) -> dict[str, Any]:
        """A request's JSON. Raises ConnectionError if the inverter doesn't answer, or answers with an error."""
        with self._lock:
            wait = self._last + GAP - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            url = f"http://{self.host}:{self.port}/solar_api/{path}"
            try:
                with urllib.request.urlopen(url, timeout=self.timeout) as r:
                    body = json.loads(r.read().decode("utf-8", "replace"))
            except urllib.error.HTTPError as e:
                raise ConnectionError(f"{self.host} answered {e.code} for {path.split('?')[0]}") from e
            except (urllib.error.URLError, OSError, ValueError) as e:
                raise ConnectionError(f"{self.host}: {e}") from e
            finally:
                self._last = time.monotonic()
        if not isinstance(body, dict):
            raise ConnectionError(f"{self.host} sent something that isn't the Solar API")
        status = (body.get("Head") or {}).get("Status") or {}
        code = status.get("Code", 0)
        if code != 0:
            error = NotSupported if code in (1, 11, 255) else ConnectionError
            raise error(f"{self.host}: {status.get('Reason') or 'error'} (code {code})")
        return body

    def data(self, path: str) -> dict[str, Any]:
        data = (self.get(f"v1/{path}").get("Body") or {}).get("Data")
        return data if isinstance(data, dict) else {}

    def version(self) -> int | None:
        """The API version (1), or None if this isn't a Fronius (or its Solar API is off)."""
        try:
            v = self.get("GetAPIVersion.cgi").get("APIVersion")
        except ConnectionError:
            return None
        return v if isinstance(v, int) else None


class FroniusDevice:
    """What both Fronius readers share: the inverter's API, and its info (read with every reading)."""

    name: str
    driver: str

    def __init__(self, host: str, port: int = PORT, unit: int = 1, timeout: float = 6.0):
        self.host, self.port = host, port
        self.unit = unit or 1  # the inverter's device id behind a Datamanager (a GEN24 is always 1)
        self.api = SolarApi(host, port, timeout)

    def info(self) -> Values:
        inverters = self.api.data("GetInverterInfo.cgi")
        return pick("info", inverters.get(str(self.unit)), INFO)

    def inverter(self) -> Values:
        path = f"GetInverterRealtimeData.cgi?Scope=Device&DeviceId={self.unit}&DataCollection=CommonInverterData"
        data = self.api.data(path)
        return {
            **pick("inverter", data, INVERTER),
            **pick("inverter.DeviceStatus", data.get("DeviceStatus"), ("StatusCode",)),
        }

    def _need_host(self) -> None:
        if not self.host:
            raise ConnectionError("No inverter address set. Connect it in Manage → Integrations.")


class SiteDevice(FroniusDevice):
    """The whole site, as the main inverter: a GEN24 (with its battery, if any) or a Datamanager inverter, with a
    Fronius Smart Meter at the grid connection."""

    name = "hybrid"
    driver = "fronius.site"

    def __init__(self, host: str, port: int = PORT, unit: int = 1, timeout: float = 6.0):
        super().__init__(host, port, unit, timeout)
        self._battery: bool | None = None  # whether it has one: asked once a reading shows it might

    def probe(self) -> Values | None:
        """Its info and the site's power flow, or None if this isn't a Fronius with a meter (a site to run)."""
        if self.api.version() != 1:
            return None
        try:
            flow = self.api.data("GetPowerFlowRealtimeData.fcgi")
            site = flow.get("Site") or {}
            if site.get("Mode") in (None, "produce-only") or site.get("P_Grid") is None:
                return None  # no meter: it can only be a second inverter
            return {**self.info(), **pick("flow", site, FLOW_SITE)}
        except ConnectionError:
            return None

    def read(self, include_info: bool) -> RawReading:
        self._need_host()
        info = self.info() if include_info else {}
        flow = self.api.data("GetPowerFlowRealtimeData.fcgi")
        site = flow.get("Site") or {}
        values: Values = {**pick("flow", site, FLOW_SITE)}
        values.update(pick("flow.inverter", (flow.get("Inverters") or {}).get(str(self.unit)), FLOW_INVERTER))
        if not values:
            raise ConnectionError(f"{self.host} answered but reported nothing")
        for part in (self._meter, self.inverter, self._storage):
            # Asleep at night, or not fitted: the site's figures still stand.
            with contextlib.suppress(ConnectionError):
                values.update(part())
        return RawReading(input={**info, **values}, info_input=info)

    def _meter(self) -> Values:
        meters = self.api.data("GetMeterRealtimeData.cgi?Scope=System")
        # The primary meter: the one at the grid connection, else the first.
        first = next(iter(meters.values()), None) if meters else None
        grid = next((m for m in meters.values() if isinstance(m, dict) and m.get("Meter_Location_Current") == 0), first)
        return pick("meter", grid if isinstance(grid, dict) else None, METER)

    def _storage(self) -> Values:
        if self._battery is False:
            return {}
        try:
            storage = self.api.data("GetStorageRealtimeData.cgi?Scope=System")
        except NotSupported:
            self._battery = False
            return {}
        controller = next((s.get("Controller") for s in storage.values() if isinstance(s, dict)), None)
        self._battery = isinstance(controller, dict)
        return pick("storage", controller, STORAGE)


class InverterDevice(FroniusDevice):
    """One Fronius inverter as a second, AC-coupled solar system (a Primo or Symo beside another brand's hybrid)."""

    name = "pv2"
    driver = "fronius.inverter"

    def probe(self) -> Values | None:
        """Its info, or None if this isn't a Fronius with an inverter of that device id."""
        if self.api.version() != 1:
            return None
        try:
            info = self.info()
        except ConnectionError:
            return None
        return info or None

    def read(self, include_info: bool) -> RawReading:
        """Its output, with its info every time (a second inverter's details come with each reading)."""
        self._need_host()
        values = {**self.info(), **self.inverter()}
        if not values:
            raise ConnectionError(f"{self.host} answered but reported nothing")
        return RawReading(input=values)
