"""Where each network's outages are seen on its own site (Provider.link)."""

from __future__ import annotations

from typing import Any

import pytest

from app.features.grid.outages.networks import NETWORKS


def _o(network: str, job: str = "INCD-1-x", planned: bool = False, **kw: Any) -> dict[str, Any]:
    return {"id": f"{network}:{job}", "network": network, "planned": planned, "suburbs": ["SOUTH BRISBANE"],
            "lat": -27.48, "lon": 153.02, "start": None, **kw}  # fmt: skip


@pytest.mark.parametrize(
    ("network", "planned", "url"),
    [
        (
            "energex",
            False,
            "https://www.energex.com.au/outages/outage-finder/emergency-outages-text-view?event=INCD-1-x",
        ),
        ("ausgrid", False, "https://www.ausgrid.com.au/outages/INCD-1-x"),
        ("ausgrid", True, "https://www.ausgrid.com.au/outages/NECFINCD-1-x"),
        ("essential", True, "https://www.essentialenergy.com.au/outages-and-faults/power-outages#INCD-1-x"),
        ("ausnet", False, "https://www.outagetracker.com.au/?incident=INCD-1-x"),
        ("westernpower", False, "https://www.westernpower.com.au/outages?outageId=INCD-1-x"),
    ],
)
def test_networks_that_open_one_outage(network: str, planned: bool, url: str) -> None:
    assert NETWORKS[network].link(_o(network, planned=planned)) == (url, True)


@pytest.mark.parametrize(
    ("network", "planned", "url"),
    [
        ("energex", True, "https://www.energex.com.au/outages/outage-finder/planned-outages-text-view?suburb-postcode=SOUTH+BRISBANE"),
        ("ergon", False, "https://www.ergon.com.au/network/outages/outage-finder/outage-finder-text-view?suburb=SOUTH+BRISBANE&source=1074971"),
        ("endeavour", False, "https://www.endeavourenergy.com.au/power-outages/outage-map?lat=-27.48&lng=153.02&zoom=15"),
        ("evoenergy", False, "https://www.evoenergy.com.au/outages#All"),
        ("citipower", False, "https://www.citipower.com.au/outages/live-outage-map?suburb=SOUTH+BRISBANE"),
        ("powercor", False, "https://www.powercor.com.au/outages/live-outage-map?suburb=SOUTH+BRISBANE"),
        ("jemena", True, "https://poweroutages.jemena.com.au/?suburb=SOUTH+BRISBANE"),
        ("united", False, "https://www.unitedenergy.com.au/outage-map"),
        ("sapn", False, "https://outage.apps.sapowernetworks.com.au/Outages/OutageSearch?suburb=SOUTH+BRISBANE"),
        ("tasnetworks", False, "https://www.tasnetworks.com.au/outages"),
        ("horizon", False, "https://www.horizonpower.com.au/outages"),
    ],
)  # fmt: skip
def test_networks_that_show_their_map_or_list(network: str, planned: bool, url: str) -> None:
    assert NETWORKS[network].link(_o(network, planned=planned)) == (url, False)


def test_sapn_planned_work_to_come_opens_its_future_map() -> None:
    url, exact = NETWORKS["sapn"].link(_o("sapn", planned=True, start=4_000_000_000))
    assert url == "https://outage.apps.sapowernetworks.com.au/OutageReport/OutageMap?suburb=SOUTH+BRISBANE#future"
    assert not exact


def test_nothing_to_filter_by_leaves_no_empty_query() -> None:
    for n in NETWORKS.values():
        url, _ = n.link(_o(n.id, suburbs=[], lat=None, lon=None))
        assert url.startswith(n.site) or "outagetracker" in url or "sapowernetworks" in url or "jemena" in url
        assert not url.endswith("?") and "=&" not in url and not url.endswith("=")
