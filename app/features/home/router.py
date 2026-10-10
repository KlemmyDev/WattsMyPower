"""Smart-home devices (the Home page, Manage → Integrations → Smart home): connect accounts, the devices they bring,
and where the home's power went."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request

from app.container import Services
from app.dependencies import JsonBody, ServicesDep, time_range
from app.features.home import car as home_car
from app.features.home import insights, profile, usage
from app.features.home.service import HomeSetupError
from app.features.home.types import Hints
from app.features.readings.repository import KWH_PER_W_ROLLUP
from app.features.tariffs.costs import daily_costs

router = APIRouter(prefix="/api/home")

DAY = 86400


async def _run(fn: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args)
    except HomeSetupError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


@router.get("")
async def overview(svc: ServicesDep):
    """The integrations that can be connected (with their accounts), the kinds of device, and every device with what
    it's doing now."""
    return await asyncio.to_thread(svc.home.overview)


async def _hints(svc: Services, request: Request) -> Hints:
    """Where to look for devices on the network: where the inverters are, or the dashboard was opened from."""
    client = request.client.host if request.client else None
    return Hints(network=await asyncio.to_thread(svc.integrations.home_network, client, request.url.hostname))


@router.get("/hints")
async def hints(svc: ServicesDep, request: Request):
    """What a connect form left blank falls back to: the home network devices are looked for on."""
    return {"network": (await _hints(svc, request)).network}


@router.post("/integrations/{integration}")
async def connect(svc: ServicesDep, integration: str, body: JsonBody, request: Request):
    """Connect an integration with what its form asks for (signing in, for an account; finding its devices, for
    devices on the network)."""
    result = await _run(svc.home.connect, integration, body, await _hints(svc, request))
    svc.home.wake()
    return result


@router.put("/integrations/{integration}")
async def sign_in_again(svc: ServicesDep, integration: str, body: JsonBody, request: Request):
    """Sign in to a connected integration afresh (or look for its devices again), keeping its devices and their
    history."""
    result = await _run(svc.home.sign_in_again, integration, body, await _hints(svc, request))
    svc.home.wake()
    return result


@router.post("/integrations/{integration}/find")
async def find(svc: ServicesDep, integration: str):
    """Look for devices added to a connected integration since (Look for new plugs), and read them at once."""
    return await _run(svc.home.find, integration)


@router.delete("/integrations/{integration}")
async def disconnect(svc: ServicesDep, integration: str):
    """Forget an integration's account, its devices and what they used."""
    return await _run(svc.home.disconnect, integration)


@router.patch("/devices/{device_id}")
async def update_device(svc: ServicesDep, device_id: int, body: JsonBody):
    """Rename a device ({"name"}), say what it is ({"kind"}), put it in a group shown as one on the Home page
    ({"group"}: a name, or null for none), leave it out of the breakdown ({"hidden"}), or show what its runs usually
    draw while it runs, for an appliance that doesn't report its power ({"estimate"})."""
    return await _run(svc.home.update_device, device_id, body)


@router.post("/devices/{device_id}/switch")
async def switch_device(svc: ServicesDep, device_id: int, body: JsonBody):
    """Switch a device on or off ({"on": true}). A fridge or freezer is only switched off with {"confirm": true}."""
    return await _run(svc.home.switch, device_id, body.get("on"), body.get("confirm", False))


@router.put("/devices/{device_id}/rule")
async def set_rule(svc: ServicesDep, device_id: int, body: JsonBody):
    """Run a switchable device on spare solar: {"start_w", "stop_w", "from"?, "until"?, "max_price"?, "enabled"?}."""
    return await _run(svc.home.set_rule, device_id, body)


@router.delete("/devices/{device_id}/rule")
async def clear_rule(svc: ServicesDep, device_id: int):
    """Stop running a device on spare solar."""
    return await _run(svc.home.clear_rule, device_id)


@router.get("/devices/{device_id}/raw")
async def raw(svc: ServicesDep, device_id: int):
    """A device's properties as its integration last sent them, to check how they're read."""
    return await _run(svc.home.raw, device_id)


@router.get("/usage")
async def get_usage(
    svc: ServicesDep, start: int | None = None, end: int | None = None, bucket: Literal["hour", "day"] = "day"
):
    """The home's use by the hour or day over [start, end) (by default the last 7 days), each device's share, and what
    no device measured."""
    start, end = time_range(start, end, 7 * DAY)
    if end <= start or end - start > (2 * DAY if bucket == "hour" else 400 * DAY):
        raise HTTPException(status_code=422, detail="Choose up to 2 days by the hour, or 400 by the day.")

    def priced() -> dict[str, Any]:
        car = _car(svc, start, end)
        out = usage.breakdown(svc.home.repo, svc.readings, start, end, bucket, car)
        pricing, days = _pricing(svc, start, end)
        return insights.priced(out, svc.home.repo, svc.readings, pricing, days, usage.car_as_shown(car, out))

    return await asyncio.to_thread(priced)


def _car(svc: Services, start: int, end: int) -> dict[int, float] | None:
    """What the cars drew in each rollup of [start, end): as a connected Tesla measured it while charging at home
    (app.features.tesla.history), and elsewhere as found in what no device measured (app.features.home.car); None
    without a car connected."""
    if not svc.car.ids():
        return None
    measured = svc.tesla.history.charged_w(start, end)
    return home_car.car_use(svc.home.repo, svc.readings, svc.car, start, end) | measured


def _pricing(svc: Services, start: int, end: int) -> tuple[insights.Pricing, list[dict[str, Any]]]:
    """The tariff's rates over [start, end) (Amber's prices, on Amber), and each day's costs as Bills works them out."""
    t, tables = svc.tariffs.current()
    days = daily_costs(svc.readings, t, tables, start, end, svc.meter, svc.amber.repo)["days"]
    return insights.pricing_now(svc.tariffs, svc.amber.repo, start - DAY, end + 2 * DAY), days


@router.get("/patterns")
async def get_patterns(svc: ServicesDep):
    """Each device's habits over the last eight weeks: when it runs, and what it uses through the day and week."""
    return await asyncio.to_thread(usage.patterns, svc.home.repo, int(time.time()))


@router.get("/insights")
async def get_insights(svc: ServicesDep):
    """What's always on (and what it costs a year), habits in what no device measures, the best time today or tomorrow
    to run each appliance that runs in cycles, what changed this week, and what running at the best times would have
    saved."""

    def build() -> dict[str, Any]:
        now = int(time.time())
        pricing = insights.pricing_now(svc.tariffs, svc.amber.repo, now - 29 * DAY, now + 2 * DAY)
        car = _car(svc, now - 21 * DAY, now)
        patterns = usage.patterns(svc.home.repo, now)
        return {
            "standby": insights.standby(svc.home.repo, svc.readings, pricing, now, car),
            "unexplained": insights.unexplained(svc.home.repo, svc.readings, now, car),
            "best_times": insights.best_times(
                svc.home.repo.devices(), patterns, svc.forecast.steps(now, days=2), pricing, now
            ),
            "changes": insights.changes(svc.home.repo, svc.readings, now, car),
            "savings": insights.savings(svc.home.repo, svc.readings, pricing, now),
        }

    return await asyncio.to_thread(build)


@router.get("/profile")
async def get_profile(svc: ServicesDep, devices: str):
    """Some devices' use together (a room's), looked at closely: today against a usual day, when in the week they use
    power, their power spikes, and what they're likely to use in the days ahead and this month. `devices`: their ids,
    comma-separated."""
    try:
        ids = [int(x) for x in devices.split(",") if x.strip()]
    except ValueError as e:
        raise HTTPException(status_code=422, detail="devices: device ids, comma-separated.") from e
    if not ids:
        raise HTTPException(status_code=422, detail="Choose at least one device.")
    return await asyncio.to_thread(profile.profile, svc.home.repo, ids, int(time.time()))


@router.get("/runs/{run_id}/curve")
async def get_run_curve(svc: ServicesDep, run_id: int):
    """A run with what the appliance drew through it: average W in each 5 minutes, from a little before to a little
    after."""

    def curve() -> dict[str, Any]:
        run = svc.home.repo.run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="There's no such run.")
        start, end = run["start"] - 600, (run["end"] or int(time.time())) + 900
        used = {ts: kwh for ts, _, kwh in svc.home.repo.energy(start, end, run["device"])}
        t = list(range(start // 300 * 300, end, 300))
        return {"run": run, "t": t, "w": [round(used.get(ts, 0.0) / KWH_PER_W_ROLLUP) for ts in t]}

    return await asyncio.to_thread(curve)


@router.get("/runs")
async def get_runs(svc: ServicesDep, start: int | None = None, end: int | None = None, device: int | None = None):
    """Appliance runs that started in [start, end) (by default the last 7 days), newest first."""
    start, end = time_range(start, end, 7 * DAY)
    runs = await asyncio.to_thread(svc.home.repo.runs, start, end, device)
    return runs[::-1]
