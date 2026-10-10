"""
Every network whose outages can be followed, by state, and how a house's state is told.

Within a state the order is the order they're asked whether they serve a house: the ones that can tell for sure (a
service area, a suburb list) and the smaller first, the network that covers the rest last.
"""

from __future__ import annotations

import re

from app.features.grid.outages.base import Provider, in_bounds
from app.features.grid.outages.energyq import ENERGEX, ERGON
from app.features.grid.outages.nsw import AUSGRID, ENDEAVOUR, ESSENTIAL, EVOENERGY
from app.features.grid.outages.sa import SAPN
from app.features.grid.outages.tas import TASNETWORKS
from app.features.grid.outages.vic import AUSNET, CITIPOWER, JEMENA, POWERCOR, UNITED
from app.features.grid.outages.wa import HORIZON, WESTERNPOWER

NETWORKS: dict[str, Provider] = {
    n.id: n
    for n in (
        ENERGEX, ERGON,
        AUSGRID, EVOENERGY, ENDEAVOUR, ESSENTIAL,
        CITIPOWER, JEMENA, UNITED, AUSNET, POWERCOR,
        SAPN,
        TASNETWORKS,
        WESTERNPOWER, HORIZON,
    )
}  # fmt: skip

# The states (and territory) whose networks are asked about a house in each: the ACT is in NSW's NEM region, and
# Queanbeyan, just over the border, is Essential Energy's.
REGION_STATES = {"QLD1": ("QLD",), "NSW1": ("NSW", "ACT"), "VIC1": ("VIC",), "SA1": ("SA",), "TAS1": ("TAS",)}
STATES = {"QLD": ("QLD",), "NSW": ("NSW", "ACT"), "ACT": ("ACT", "NSW"), "VIC": ("VIC",), "SA": ("SA",),
          "TAS": ("TAS",), "WA": ("WA",)}  # fmt: skip
WA_BOUNDS = (-35.2, 112.9, -13.6, 129.0)


def place_state(place: str | None) -> str | None:
    """The state a place name ends with ("Paddington, QLD"), if it does."""
    m = re.search(r"\b(QLD|NSW|ACT|VIC|SA|TAS|WA|NT)\b\s*$", (place or "").strip().upper())
    return m.group(1) if m else None


def place_suburb(place: str | None) -> str:
    """The suburb a place name starts with ("Paddington, QLD" → "PADDINGTON")."""
    return " ".join((place or "").split(",")[0].upper().split()) if "," in (place or "") else ""


def states_for(region: str | None, place: str | None, lat: float, lon: float) -> tuple[str, ...]:
    """The states whose networks might serve the house: from its NEM region (GridService's), else its place name,
    else where it is (Western Australia, outside the NEM, is told by its longitude)."""
    if region in REGION_STATES:
        return REGION_STATES[region]
    state = place_state(place)
    if state:
        return STATES.get(state, ())
    from app.features.grid.service import region_at  # (GridService uses this module's service)

    region = region_at(lat, lon)
    if region in REGION_STATES:
        return REGION_STATES[region]
    return ("WA",) if in_bounds(WA_BOUNDS, lat, lon) else ()
