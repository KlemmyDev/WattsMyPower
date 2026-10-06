"""
Battery controls for Sungrow's SH hybrids: what their battery settings say, and what to write to change them.
The collector reads and writes these holding registers on request (collector/devices/sungrow/sh_rs.py,
CONTROL_HOLDING and WRITABLE); what they mean lives here.

    13050  EMS mode: 0 self-consumption (the battery runs the house, solar charges it), 2 forced (it follows
           13051), 3 an external energy manager, 4 VPP. iSolarCloud's remote commands (e.g. a forced charge
           started in its app) show as 4, so VPP here means "iSolarCloud is in charge".
    13051  forced command: 0xAA charge, 0xBB discharge, 0xCC stop (standby: neither charge nor discharge)
    13052  forced power, W
    13058  max SOC, 0.1 %
    13059  min SOC, 0.1 %: the backup reserve, below which the battery isn't discharged
    33047  most the battery may charge at, 10 W (33048: discharge)

Addresses, scaling and values are from Sungrow's "Communication Protocol of Residential Hybrid Inverter"
as used by https://github.com/mkaiser/Sungrow-SHx-Inverter-Modbus-Home-Assistant, and were read back from
an SH5.0RS + WiNet-S2 (2026-10-06: EMS 4 with a forced charge at 6600 W running from iSolarCloud, max/min
SOC 100 % / 5 %, max charge 660 = 6.6 kW).
"""

from __future__ import annotations

from collections.abc import Mapping

from app.features.inverters.types import BatterySettings, Writes

EMS, COMMAND, POWER, MAX_SOC, MIN_SOC, MAX_CHARGE = 13050, 13051, 13052, 13058, 13059, 33047
SELF, FORCED, EXTERNAL, VPP = 0, 2, 3, 4
CHARGE, DISCHARGE, STOP = 0xAA, 0xBB, 0xCC
MODES = {SELF: "self", FORCED: "forced", EXTERNAL: "external", VPP: "vpp"}
COMMANDS = {CHARGE: "charge", DISCHARGE: "discharge", STOP: "stop"}
UNSET = 0xFFFF

# The floors (min SOC) the dashboard offers. Kept to 50 % at most: the Home Assistant integration for these
# inverters caps min SOC there, and higher values haven't been tried on real hardware.
FLOOR_RANGE = (5.0, 50.0)


def _word(words: Mapping[int, int], address: int) -> int | None:
    w = words.get(address)
    return None if w is None or w == UNSET else w


def decode(words: Mapping[int, int]) -> BatterySettings:
    """The battery's settings, from the words read (keyed by register address)."""
    ems, cmd, power = _word(words, EMS), _word(words, COMMAND), _word(words, POWER)
    top, bottom, most = _word(words, MAX_SOC), _word(words, MIN_SOC), _word(words, MAX_CHARGE)
    return {
        "mode": None if ems is None else MODES.get(ems, "other"),
        "mode_code": ems,
        "command": None if cmd is None else COMMANDS.get(cmd),
        "power_w": power,
        "max_soc": None if top is None else top / 10,
        "min_soc": None if bottom is None else bottom / 10,
        "max_charge_w": None if most is None else most * 10,
    }


def normal() -> Writes:
    """Back to self-consumption: the battery runs the house and soaks up spare solar."""
    return [(COMMAND, STOP), (EMS, SELF)]


def standby() -> Writes:
    """Neither charge nor discharge: the house runs on solar and the grid, the battery keeps what it has."""
    return [(COMMAND, STOP), (EMS, FORCED)]


def charge(power_w: int) -> Writes:
    """Charge at `power_w` from whatever's available, grid included."""
    return [(POWER, power_w), (COMMAND, CHARGE), (EMS, FORCED)]


def floor(pct: float) -> Writes:
    """Discharge no lower than `pct` (the min SOC); then the house runs on the grid."""
    return [(MIN_SOC, round(pct * 10))]


def holds(settings: BatterySettings, writes: Writes) -> bool:
    """Whether the settings read show these writes in effect."""
    read = {
        EMS: settings.get("mode_code"),
        COMMAND: {v: k for k, v in COMMANDS.items()}.get(settings.get("command") or ""),
        POWER: settings.get("power_w"),
        MIN_SOC: None if settings.get("min_soc") is None else round(settings["min_soc"] * 10),
    }
    return all(read.get(a) == w for a, w in writes)
