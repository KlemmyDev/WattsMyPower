"""
South Australia's network, SA Power Networks: the whole state's outages now and planned work to come.

No API: these are the feeds behind its own outage map, public and the same for everyone, and can change without
notice. Its site sits behind Imperva, which so far lets a plain request through.

    outage.apps.sapowernetworks.com.au/Outages/GetPublicisedCurrentOutages/   {currentOutages: [...]}
    outage.apps.sapowernetworks.com.au/Outages/GetPublicisedPlannedOutages/   {plannedOutages: [...]}

Each: jobID, status (in words: "Our crews are travelling to this area"), reason, affectedCustomers, startDateTime,
estimatedRestoration or endDateTime (Adelaide time, no offset; 0001-01-01 when not known), affectedSuburbs ({name,
postcode}), and geometry, the area off as a ring of {lat, lng}. isPaw marks planned work under way among the current.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.features.grid.outages.base import (
    ADELAIDE,
    Around,
    Get,
    Provider,
    ask,
    gone,
    kept,
    outage,
    ring_of,
    suburb_of,
    when,
    with_query,
)

FEED = "https://outage.apps.sapowernetworks.com.au/Outages"


def sapn_outage(o: dict[str, Any], planned: bool) -> dict[str, Any] | None:
    if gone(o.get("status")):
        return None
    ring = ring_of(o.get("geometry") or [])
    return outage(
        "sapn",
        o.get("jobID"),
        planned=planned or bool(o.get("isPaw")),
        status=o.get("status"),
        reason=o.get("reason"),
        customers=o.get("affectedCustomers"),
        start=when(o.get("startDateTime"), ADELAIDE),
        end=when(o.get("estimatedRestoration"), ADELAIDE) or when(o.get("endDateTime"), ADELAIDE),
        suburbs=[str(s.get("name") or "").strip() for s in o.get("affectedSuburbs") or [] if isinstance(s, dict)],
        area=[ring] if ring else [],
    )


@dataclass(frozen=True)
class SAPowerNetworks(Provider):
    def link(self, o: Mapping[str, Any]) -> tuple[str, bool]:
        """SA Power Networks' pages can't open an outage, only its suburb's: the outages there now (in full, when
        it's the only one), or planned work to come on the map (work under way is among the outages now)."""
        site = "https://outage.apps.sapowernetworks.com.au"
        suburb = suburb_of(o)
        if o["planned"] and (o.get("start") or 0) > time.time():
            return with_query(f"{site}/OutageReport/OutageMap", "future", suburb=suburb), False
        return with_query(f"{site}/Outages/OutageSearch", suburb=suburb), False

    def outages(self, which: str, get: Get, around: Around | None = None) -> list[dict[str, Any]]:
        future = which == "future"
        data = ask(self.name, get, f"{FEED}/GetPublicised{'Planned' if future else 'Current'}Outages/")
        items = data.get("plannedOutages" if future else "currentOutages") if isinstance(data, dict) else None
        return kept(sapn_outage(o, future) for o in items or [] if isinstance(o, dict))


SAPN = SAPowerNetworks(
    "sapn", "SA Power Networks", "https://www.sapowernetworks.com.au", "SA", (-38.1, 129.0, -26.0, 141.0)
)
