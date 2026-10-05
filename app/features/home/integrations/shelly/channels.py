"""
What a Shelly measures, channel by channel. Each channel that measures power is a device of its own on the Home page:
a 2PM's two relays are two devices, as are a Pro EM's two clamps.

Gen2 and later (GET /rpc/Shelly.GetStatus, names from /rpc/Shelly.GetConfig):
  - switch:N (a relay or plug): `output` (on or off), `apower` (W), `aenergy.total` (Wh, since it was made). A
    switch without `apower` doesn't measure (a Plus 1) and is left out.
  - pm1:N (a meter alone, the Plus PM Mini): `apower`, `aenergy.total`.
  - em1:N (one clamp of a Pro EM or EM Gen3): `act_power` (W), its energy in em1data:N `total_act_energy` (Wh).
  The device's name is sys.device.name in the config, a channel's is "switch:N".name and so on.

Gen1 (GET /status, names from /settings):
  - meters[N]: `power` (W), `total` (watt-minutes since it was made), switched by relays[N] (`ison`) where there is
    one (a dimmer has a light instead, which isn't switched from here).
  - emeters[N] (the EM and 3EM's clamps): `power`, `total` (Wh).
  The device's name is `name` in the settings, a relay's is relays[N].name.

A three-phase meter's em:N (Pro 3EM) is left out: it's almost always on the whole home or the solar, which the
inverter already measures.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Channel:
    id: str  # what it's called on its device: "0" (a switch, or a Gen1 meter), "pm0", "em0" (a clamp)
    name: str | None  # its own name, when it has one
    power_w: float | None
    energy_kwh: float | None  # since the device was made
    switched_on: bool | None
    switch: bool  # it can be switched (it's a relay's)
    raw: Mapping[str, Any] = field(default_factory=dict)


def _number(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v):
        return None
    return float(v)


def _kwh(wh: Any, per_kwh: float = 1000) -> float | None:
    n = _number(wh)
    return n / per_kwh if n is not None else None


def _name(cfg: Any) -> str | None:
    if not isinstance(cfg, dict) or not cfg.get("name"):
        return None
    return str(cfg["name"]).strip() or None


def gen2(status: dict[str, Any], config: dict[str, Any]) -> tuple[str | None, list[Channel]]:
    """A Gen2 (or later) device's name, and its channels that measure, from its status and config."""
    channels: list[Channel] = []
    for key, s in status.items():
        component, _, n = key.partition(":")
        if component not in ("switch", "pm1", "em1") or not n.isdigit() or not isinstance(s, dict):
            continue
        if component == "em1":  # a clamp: its energy is in a component of its own
            data = status.get(f"em1data:{n}")
            w, wh = s.get("act_power"), data.get("total_act_energy") if isinstance(data, dict) else None
        else:
            aenergy = s.get("aenergy")
            w, wh = s.get("apower"), aenergy.get("total") if isinstance(aenergy, dict) else None
        power, energy = _number(w), _kwh(wh)
        if power is None and energy is None:  # a switch that doesn't measure
            continue
        output = s.get("output")
        channels.append(
            Channel(
                id={"switch": n, "pm1": f"pm{n}", "em1": f"em{n}"}[component],
                name=_name(config.get(key)),
                power_w=power,
                energy_kwh=energy,
                switched_on=output if component == "switch" and isinstance(output, bool) else None,
                switch=component == "switch",
                raw={key: s},
            )
        )
    sys = config.get("sys")
    device = sys.get("device") if isinstance(sys, dict) else None
    return _name(device), sorted(channels, key=_order)


def gen1(status: dict[str, Any], settings: dict[str, Any]) -> tuple[str | None, list[Channel]]:
    """A Gen1 device's name, and its channels that measure, from its status and settings."""
    relays = [r if isinstance(r, dict) else {} for r in status.get("relays") or []]
    relay_settings = list(settings.get("relays") or [])
    emeter_settings = list(settings.get("emeters") or [])
    channels: list[Channel] = []
    for n, m in enumerate(status.get("meters") or []):
        if not isinstance(m, dict) or m.get("is_valid") is False:
            continue
        relay = relays[n] if n < len(relays) else None
        ison = relay.get("ison") if relay else None
        channels.append(
            Channel(
                id=str(n),
                name=_name(relay_settings[n]) if n < len(relay_settings) else None,
                power_w=_number(m.get("power")),
                energy_kwh=_kwh(m.get("total"), 60_000),  # watt-minutes
                switched_on=ison if isinstance(ison, bool) else None,
                switch=relay is not None,
                raw={"meter": m, "relay": relay} if relay else {"meter": m},
            )
        )
    for n, e in enumerate(status.get("emeters") or []):
        if not isinstance(e, dict) or e.get("is_valid") is False:
            continue
        channels.append(
            Channel(
                id=f"em{n}",
                name=_name(emeter_settings[n]) if n < len(emeter_settings) else None,
                power_w=_number(e.get("power")),
                energy_kwh=_kwh(e.get("total")),
                switched_on=None,
                switch=False,
                raw={"emeter": e},
            )
        )
    return _name(settings), channels


def _order(c: Channel) -> tuple[int, int]:
    """Switches, then meters, then clamps; each by number."""
    prefix = c.id.rstrip("0123456789")
    return ("", "pm", "em").index(prefix), int(c.id[len(prefix) :])


def names(device: str, channels: list[Channel]) -> list[str]:
    """What each channel is called on the Home page: its own name, else the device's, numbered after the first."""
    return [c.name or (device if i == 0 else f"{device} ({i + 1})") for i, c in enumerate(channels)]
