"""
Connecting inverters (Settings → Integrations): what's connected, finding inverters on the network,
and connecting or removing them.

The collector stores the devices and runs the scan (it's the only thing that talks to the
inverters, and keeps recording while the dashboard is down or updating); this checks requests,
says in words what the collector's raw identity registers mean, and adds each device's live state.
"""

from __future__ import annotations

import ipaddress
from typing import Any

from app.core.config import Config
from app.features.inverters.drivers import KINDS, identify
from app.features.live.client import CollectorError, Devices
from app.features.live.service import LiveService

ROLES = ("hybrid", "pv2")
DEFAULT_NETWORK = "192.168.1.0/24"
READ_ONLY = (
    "This dashboard follows another server's collector read-only (COLLECTOR_WRITES=false), so its inverters "
    "can only be changed from that server's own dashboard."
)
DEMO = (
    "The demo (MOCK=1) makes up its readings without a collector, so there are no inverters to connect. "
    "To try this, run the collector with COLLECTOR_MOCK=1 and point the dashboard at it."
)


class IntegrationError(ValueError):
    """A request that can't be done; `status` is the HTTP status to answer with."""

    def __init__(self, detail: str, status: int = 422):
        super().__init__(detail)
        self.status = status


def _kind(driver: str | None) -> dict[str, Any]:
    k = KINDS.get(driver or "")
    return {"label": k.label, "via": k.via, "brand": k.brand} if k else {"label": driver, "via": None, "brand": None}


HOME_NETWORKS = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]


def _slash24(host: str) -> str | None:
    """The /24 a home network address is in (RFC 1918 only: not loopback, documentation or public ranges)."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return None
    if not isinstance(ip, ipaddress.IPv4Address) or not any(ip in n for n in HOME_NETWORKS):
        return None
    return str(ipaddress.ip_network(f"{ip}/24", strict=False))


class IntegrationsService:
    def __init__(self, config: Config, collector: Devices | None, live: LiveService):
        self.config = config
        self.collector = collector  # None in mock mode: there's no collector
        self.live = live

    def _need(self, write: bool = False) -> Devices:
        if self.collector is None:
            raise IntegrationError(DEMO, 503)
        if write and not self.config.collector_writes:
            raise IntegrationError(READ_ONLY, 403)
        return self.collector

    def _call(self, fn: Any, *args: Any) -> Any:
        try:
            return fn(*args)
        except CollectorError as e:
            raise IntegrationError(e.detail, e.status if e.status in (404, 409, 422) else 502) from e

    # -- what's connected -----------------------------------------------------
    def _device(self, d: dict[str, Any]) -> dict[str, Any]:
        """A connected device with its kind, what it reported about itself, and its live state."""
        role = d["role"]
        if role == "hybrid":
            info = self.live.info
            state = {"last_success": self.live.last_success, "error": self.live.last_error}
        else:
            info = self.live.pv2 or {}
            state = {"last_success": info.get("last_success"), "error": info.get("error")}
        out = {
            **d,
            **_kind(d.get("driver")),
            "model": info.get("model"),
            "serial": info.get("serial"),
            "nominal_kw": info.get("nominal_kw"),
            **state,
        }
        if role == "pv2":
            setting = (d.get("settings") or {}).get("behind_meter")
            out["behind_meter"] = setting if isinstance(setting, bool) else self.config.pv2_behind_meter
        return out

    def overview(self, client_host: str | None = None) -> dict[str, Any]:
        """The connected inverters, the kinds that can be connected, the last scan, and a network to scan."""
        kinds = [{"driver": k, "role": v.role, "brand": v.brand, "label": v.label, "via": v.via, "example": v.example}
                 for k, v in KINDS.items()]  # fmt: skip
        if self.collector is None:
            return {"available": False, "error": DEMO, "read_only": True, "devices": [], "kinds": kinds,
                    "scan": None, "network": DEFAULT_NETWORK}  # fmt: skip
        try:
            listed = self.collector.devices()
            scan = self.collector.scan()
        except CollectorError as e:
            return {"available": False, "error": e.detail, "read_only": not self.config.collector_writes,
                    "devices": [], "kinds": kinds, "scan": None, "network": DEFAULT_NETWORK}  # fmt: skip
        devices = [self._device(d) for d in listed.get("devices", [])]
        return {
            "available": True,
            "error": None,
            "read_only": not self.config.collector_writes,
            "devices": devices,
            "kinds": [k for k in kinds if k["driver"] in (listed.get("drivers") or {})],
            "scan": self._scan(scan, devices),
            "network": self.suggest_network(devices, client_host),
        }

    def has_hybrid(self) -> bool | None:
        """Whether a main inverter is connected. None: there's no collector, or it can't be reached."""
        if self.collector is None:
            return None
        try:
            return any(d.get("role") == "hybrid" for d in self.collector.devices().get("devices", []))
        except CollectorError:
            return None

    def suggest_network(self, devices: list[dict[str, Any]], client_host: str | None) -> str:
        """Where to look: the connected inverters' network, else the browser's (when it's a home network)."""
        for host in [d["host"] for d in devices] + [client_host or ""]:
            if net := _slash24(host):
                return net
        return DEFAULT_NETWORK

    # -- scanning -------------------------------------------------------------
    def _scan(self, state: dict[str, Any], devices: list[dict[str, Any]]) -> dict[str, Any]:
        """The collector's scan, with each find said in words."""
        by_host = {d["host"]: d for d in devices}
        found = []
        for f in state.get("found") or []:
            connected = by_host.get(f["host"])
            if connected:  # not probed (see collector/scan.py): it's what it was connected as
                found.append(
                    {
                        "host": f["host"],
                        "port": f.get("port", 502),
                        **{
                            k: connected.get(k)
                            for k in ("driver", "role", "label", "via", "brand", "model", "serial", "nominal_kw")
                        },
                        "supported": True,
                        "connected_as": connected["role"],
                        "rescan": False,
                    }
                )
                continue
            driver = f.get("driver")
            kind = KINDS.get(driver or "")
            found.append(
                {
                    "host": f["host"],
                    "port": f.get("port", 502),
                    "driver": driver,
                    "role": kind.role if kind else None,
                    **_kind(driver),
                    **identify(driver, {k: int(v) for k, v in (f.get("input") or {}).items()}),
                    "connected_as": None,
                    # Connected when it was scanned, so not asked what it is, and removed since.
                    "rescan": bool(f.get("connected")),
                }
            )
        # Inverters first, then what's connected, then anything else answering on the Modbus port.
        found.sort(key=lambda f: (f["connected_as"] is None and not f["supported"], f["connected_as"] is not None))
        return {**state, "found": found}

    def scan(self) -> dict[str, Any]:
        collector = self._need()
        listed = self._call(collector.devices)
        return self._scan(self._call(collector.scan), [self._device(d) for d in listed.get("devices", [])])

    def start_scan(self, network: str) -> dict[str, Any]:
        collector = self._need(write=True)  # it talks to the inverters on that server's network
        self._call(collector.start_scan, network)
        return self.scan()

    # -- connecting -----------------------------------------------------------
    def connect(self, role: str, body: dict[str, Any]) -> dict[str, Any]:
        """Connect an inverter in `role`. Returns it, with what it said it is."""
        collector = self._need(write=True)
        if role not in ROLES:
            raise IntegrationError(f"No inverter role {role!r}.", 404)
        driver = body.get("driver")
        kind = KINDS.get(driver if isinstance(driver, str) else "")
        if kind is None:
            raise IntegrationError("Choose which kind of inverter it is.")
        if kind.role != role:
            raise IntegrationError(
                f"A {kind.brand} {kind.label} can only be connected as "
                + ("the main inverter." if kind.role == "hybrid" else "a second solar inverter.")
            )
        settings: dict[str, Any] = {}
        if role == "pv2":
            bm = body.get("behind_meter", (body.get("settings") or {}).get("behind_meter", True))
            if not isinstance(bm, bool):
                raise IntegrationError("Say whether it's on the house side of the main inverter's meter.")
            settings["behind_meter"] = bm
        request = {
            "driver": driver,
            "host": str(body.get("host") or "").strip(),
            "port": body.get("port", 502),
            "unit": body.get("unit", 1),
            "settings": settings,
            "check": body.get("check", True) is not False,
        }
        try:
            result = collector.put_device(role, request)
        except CollectorError as e:
            if e.status == 422 and "answered like" in e.detail:  # say which inverter in words, not its driver id
                where = request["host"] + (f":{request['port']}" if request["port"] != 502 else "")
                raise IntegrationError(f"Nothing at {where} answered like a {kind.brand} {kind.label}.") from e
            raise IntegrationError(e.detail, e.status if e.status in (404, 409, 422) else 502) from e
        device = self._device(result["device"])
        return {**device, "identified": identify(driver, {k: int(v) for k, v in (result.get("input") or {}).items()})}

    def update(self, role: str, changes: dict[str, Any]) -> dict[str, Any]:
        """Change a connected inverter's settings (where a second inverter connects), without re-checking it."""
        collector = self._need(write=True)
        current = next((d for d in self._call(collector.devices).get("devices", []) if d["role"] == role), None)
        if current is None:
            raise IntegrationError("That inverter isn't connected.", 404)
        return self.connect(role, {**current, **changes, "check": False})

    def remove(self, role: str) -> bool:
        collector = self._need(write=True)
        removed: bool = self._call(collector.remove_device, role).get("removed", False)
        return removed
