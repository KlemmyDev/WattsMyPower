"""
The collector's HTTP feed (see PROTOCOL.md): `python -m collector`, or `uvicorn collector.main:app`.
Build one for tests with create_app(Config(...), hybrid=..., poll=False).
"""

from __future__ import annotations

import asyncio
import hmac
import ipaddress
import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, FastAPI, Header, HTTPException, Request, Response

from collector.config import Config
from collector.devices import ROLES, Device, DeviceConfig, Words
from collector.devices.drivers import READERS, build_device, env_devices
from collector.devices.sungrow.mock import MOCK_HOSTS, MockSite, backfill, mock_probe
from collector.poller import Poller
from collector.scan import Scanner
from collector.storage import SPECS, measure
from collector.store import Row, Store

log = logging.getLogger(__name__)

PROTOCOL_VERSION = 1
DEFAULT_LIMIT, MAX_LIMIT = 1000, 5000
MAX_WAIT = 30.0
MOCK_BACKFILL_DAYS = 7


async def _mock_open(host: str, port: int) -> bool:
    """In mock mode, only the fake inverters' addresses answer a scan."""
    await asyncio.sleep(0.01)
    return host in MOCK_HOSTS


def _row_json(r: Row) -> str:
    """A row as JSON, splicing in the stored word objects as they are (they're JSON already)."""
    holding = "" if r.holding is None else f',"holding":{r.holding}'
    return f'{{"ts":{r.ts},"device":{json.dumps(r.device)},"driver":{json.dumps(r.driver)},"input":{r.input}{holding}}}'


def require_token(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    token: str = request.app.state.config.token
    if not token:
        raise HTTPException(503, "The feed is disabled: set COLLECTOR_TOKEN (and give the API the same token)")
    scheme, _, given = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(given.strip().encode(), token.encode()):
        raise HTTPException(401, "Missing or wrong token", headers={"WWW-Authenticate": "Bearer"})


router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])


@router.get("/readings")
async def readings(request: Request, since: int = 0, limit: int = DEFAULT_LIMIT, wait: float = 0) -> Response:
    """Rows after `since`. With nothing new and `wait` > 0, holds the request until the next poll lands."""
    store: Store = request.app.state.store
    poller: Poller = request.app.state.poller
    limit = min(max(limit, 1), MAX_LIMIT)
    wait = min(max(wait, 0.0), MAX_WAIT)
    landed = poller.landed()  # before looking, so a poll landing meanwhile isn't missed
    rows, more = await asyncio.to_thread(store.since, since, limit)
    if not rows and wait > 0:
        with suppress(TimeoutError):
            await asyncio.wait_for(landed.wait(), wait)
            rows, more = await asyncio.to_thread(store.since, since, limit)
    body = '{"readings":[' + ",".join(map(_row_json, rows)) + '],"more":' + ("true" if more else "false") + "}"
    return Response(body, media_type="application/json")


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    store: Store = request.app.state.store
    poller: Poller = request.app.state.poller
    oldest, latest = await asyncio.to_thread(store.bounds)
    return {
        "version": PROTOCOL_VERSION,
        "poll_interval": poller.config.poll_interval,
        "started_at": poller.started_at,
        "next_poll": poller.next_poll,
        "oldest_ts": oldest,
        "latest_ts": latest,
        "devices": {name: st.as_json() for name, st in poller.status.items()},
    }


@router.get("/storage")
async def storage(request: Request) -> dict[str, Any]:
    """The database measured table by table (see storage.py), with how long readings are kept."""
    store: Store = request.app.state.store

    def run() -> dict[str, Any]:
        with store.reading() as conn:
            return measure(conn, store.path, SPECS)

    return {**await asyncio.to_thread(run), "retention_days": store.retention_days}


# -- devices: the inverters to read, connected in the dashboard (Settings → Integrations) ---------

_HOSTNAME = re.compile(
    r"^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$"
)


def _device_from(role: str, body: dict[str, Any]) -> DeviceConfig:
    """A device to connect, from a request body. Raises HTTPException(422) with what's wrong."""
    if role not in ROLES:
        raise HTTPException(404, f"No device role {role!r}. Roles: {', '.join(ROLES)}")
    driver = body.get("driver")
    if driver not in READERS:
        raise HTTPException(422, f"Unknown driver {driver!r}. Known: {', '.join(READERS)}")
    if READERS[driver].role != role:
        raise HTTPException(422, f"{driver} reads a {READERS[driver].role} device, not a {role} one")
    host = str(body.get("host") or "").strip()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if not _HOSTNAME.match(host):
            raise HTTPException(422, "Enter the inverter's IP address, e.g. 192.168.1.20.") from None
    port, unit, settings = body.get("port", 502), body.get("unit", 1), body.get("settings", {})
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise HTTPException(422, "The port must be between 1 and 65535.")
    if not isinstance(unit, int) or not 0 <= unit <= 247:
        raise HTTPException(422, "The Modbus unit must be between 0 and 247.")
    if not isinstance(settings, dict):
        raise HTTPException(422, "settings must be an object")
    return DeviceConfig(role, driver, host, port, unit, settings)


@router.get("/devices")
async def list_devices(request: Request) -> dict[str, Any]:
    """The connected devices, and the drivers that can read them (driver id -> role)."""
    store: Store = request.app.state.store
    devices = await asyncio.to_thread(store.devices)
    return {"devices": [d.as_json() for d in devices], "drivers": {k: r.role for k, r in READERS.items()}}


@router.put("/devices/{role}")
async def put_device(request: Request, role: str, body: Annotated[dict[str, Any], Body()]) -> dict[str, Any]:
    """Connect a device in `role` (replacing any there), reading from the next poll. Unless `check` is
    false, it must answer its driver's probe first; what that read comes back as `input`."""
    store: Store = request.app.state.store
    device = _device_from(role, body)
    current = next((d for d in await asyncio.to_thread(store.devices) if d.role == role), None)
    same = current is not None and (current.driver, current.host, current.port, current.unit) == (
        device.driver, device.host, device.port, device.unit,
    )  # fmt: skip
    words: Words = {}
    if body.get("check", True) and not same:  # only settings changed: no need to bother the inverter
        found = await asyncio.to_thread(request.app.state.check, device)
        if found is None:
            raise HTTPException(
                422, f"Nothing at {device.host}:{device.port} answered like a {device.driver} inverter."
            )
        words = found
    saved = await asyncio.to_thread(
        store.put_device,
        DeviceConfig(role, device.driver, device.host, device.port, device.unit, device.settings,
                     current.added_at if same and current else 0),
    )  # fmt: skip
    await asyncio.to_thread(request.app.state.reload)
    log.info("Connected %s: %s at %s:%s", role, saved.driver, saved.host, saved.port)
    return {"device": saved.as_json(), "input": {str(a): w for a, w in sorted(words.items())}}


@router.delete("/devices/{role}")
async def delete_device(request: Request, role: str) -> dict[str, bool]:
    store: Store = request.app.state.store
    removed = await asyncio.to_thread(store.remove_device, role)
    if removed:
        await asyncio.to_thread(request.app.state.reload)
        log.info("Removed %s", role)
    return {"removed": removed}


@router.get("/scan")
async def scan_state(request: Request) -> dict[str, Any]:
    scanner: Scanner = request.app.state.scanner
    return scanner.state()


@router.post("/scan")
async def start_scan(request: Request, body: Annotated[dict[str, Any], Body()]) -> dict[str, Any]:
    """Look for inverters on a network (body {"network": "192.168.1.0/24"}). Poll GET /v1/scan for progress."""
    scanner: Scanner = request.app.state.scanner
    store: Store = request.app.state.store
    connected = [d.host for d in await asyncio.to_thread(store.devices)]
    try:
        return scanner.start(str(body.get("network") or ""), connected)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e


health_router = APIRouter()


@health_router.get("/healthz")
async def healthz(request: Request) -> dict[str, bool]:
    poller: Poller = request.app.state.poller
    return {"ok": True, "fresh": poller.hybrid_fresh()}


def _probes(
    site: MockSite | None,
) -> tuple[Callable[[str, int], tuple[str, Words] | None], Callable[[DeviceConfig], Words | None]]:
    """(what a scan asks each address: the first reader that recognises it; whether a device to
    connect answers its driver). In mock mode, the fake inverters answer at MOCK_HOSTS."""
    if site is not None:
        drivers = {r.role: k for k, r in READERS.items()}

        def mock_scan(host: str, port: int) -> tuple[str, Words] | None:
            hit = mock_probe(site, host)
            return (drivers[hit[0]], hit[1]) if hit else None

        def mock_check(d: DeviceConfig) -> Words | None:
            hit = mock_probe(site, d.host)
            if d.host == "mock":
                return {}
            return hit[1] if hit and drivers[hit[0]] == d.driver else None

        return mock_scan, mock_check

    def scan(host: str, port: int) -> tuple[str, Words] | None:
        for driver, r in READERS.items():
            if (words := r.probe(host, port, 1)) is not None:
                return driver, words
        return None

    return scan, lambda d: READERS[d.driver].probe(d.host, d.port, d.unit)


def create_app(
    config: Config | None = None,
    *,
    hybrid: Device | None = None,
    pv2: Device | None = None,
    poll: bool = True,
    build: Callable[[DeviceConfig], Device] | None = None,
    scanner: Scanner | None = None,
    check: Callable[[DeviceConfig], Words | None] | None = None,
) -> FastAPI:
    """The feed and its poller. The devices are the ones connected in the database (or mocks), built
    with `build`; passing `hybrid` (and `pv2`) reads those instead until devices change. `poll=False`
    doesn't start the loop (tests drive `app.state.poller.poll_once()` themselves)."""
    config = config or Config.from_env()
    store = Store(config.db_path, config.retention_days)
    poller = Poller(config, store, hybrid, pv2)
    site = MockSite() if config.mock else None
    build = build or (lambda d: build_device(d, site))
    scan_probe, device_check = _probes(site)
    if scanner is None:
        scanner = Scanner(scan_probe, _mock_open) if site else Scanner(scan_probe)

    def reload() -> None:
        """Read the devices connected in the database from the next poll on."""
        configs = store.devices()
        devices = []
        for c in configs:
            try:
                devices.append(build(c))
            except ValueError as e:  # e.g. a driver this version doesn't have
                log.warning("Not reading %s at %s: %s", c.role, c.host, e)
        poller.set_devices(devices, {c.role: c for c in configs})

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(store.migrate)
        if await asyncio.to_thread(store.seed_devices, env_devices(config)):
            seeded = await asyncio.to_thread(store.devices)
            if seeded:
                log.info(
                    "Moved the inverters set in the environment into the database: %s. They're managed in "
                    "the dashboard from now on (Settings → Integrations); INVERTER_HOST and PV2_HOST are no longer read.",
                    ", ".join(f"{d.role} at {d.host}" for d in seeded),
                )
        if hybrid is None:
            await asyncio.to_thread(reload)
        if not config.token:
            log.warning("COLLECTOR_TOKEN is not set: /v1/* will refuse every request (503) until it is")
        if not poller.devices:
            log.info("No inverter connected yet: connect one in the dashboard (Settings → Integrations)")
        if config.mock and await asyncio.to_thread(store.is_empty):
            await asyncio.to_thread(backfill, store, poller.devices, config.poll_interval, MOCK_BACKFILL_DAYS)
        if poll:
            await poller.start()
        yield
        await scanner.stop()
        await poller.stop()

    app = FastAPI(title="WattsMyPower collector", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config, app.state.store, app.state.poller = config, store, poller
    app.state.scanner, app.state.reload, app.state.check = scanner, reload, check or device_check
    app.include_router(router)
    app.include_router(health_router)
    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
