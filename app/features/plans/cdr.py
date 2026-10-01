"""
Fetching from the AER's Consumer Data Right "energy product reference data" APIs,
cached so a search or comparison doesn't refetch what it already has.

- The AER hosts every retailer's plan data at https://cdr.energymadeeasy.gov.au/<brand>,
  with GET .../cds-au/v1/energy/plans and .../plans/{planId}. No login needed.
  (Retailers' own CDR hosts in the CDR Register don't serve plan data, and unknown
  brands just return an empty list, so the brand slugs come from the AER's published
  "Energy Retailer Base URIs" list, bundled as retailers.json - January 2026 edition,
  filtered to brands that currently publish electricity plans.)

Only brand ids from the register are ever turned into URLs, and plan ids are
checked against a strict pattern, so requests can only go to registered retailers.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path
from typing import Any

from app.core.cache import TTLCache
from app.core.http import get_json

AER_HOST = "https://cdr.energymadeeasy.gov.au"
RETAILERS = Path(__file__).with_name("retailers.json")
PLAN_ID = re.compile(r"^[A-Za-z0-9@._\-]{3,80}$")
TIMEOUT = 25  # seconds; the AER's plan list for a big retailer is slow to come back

Brand = dict[str, str]  # {"id", "name", "base"}
Plan = dict[str, Any]  # a CDR plan, as listed or in detail


class CdrClient:
    def __init__(self, retailers: Path = RETAILERS) -> None:
        self.retailers = retailers
        self._cache = TTLCache()

    def _get(self, url: str, version: str) -> Any:
        return get_json(url, headers={"x-v": version, "x-min-v": "1"}, timeout=TIMEOUT)

    def brands(self) -> list[Brand]:
        def load() -> list[Brand]:
            rows = json.loads(self.retailers.read_text())
            return sorted(
                ({"id": r["slug"], "name": r["name"], "base": f"{AER_HOST}/{r['slug']}"} for r in rows),
                key=lambda b: b["name"].lower(),
            )

        brands: list[Brand] = self._cache.get_or_load("brands", 24 * 3600, load)
        return brands

    def brand(self, brand_id: str) -> Brand:
        """The registered brand with this id. Nothing else is ever turned into a URL."""
        for b in self.brands():
            if b["id"] == brand_id:
                return b
        raise ValueError("Unknown retailer.")

    def plan_list(self, brand: Brand) -> list[Plan]:
        def load() -> list[Plan]:
            plans: list[Plan] = []
            page = 1
            while True:
                q = urllib.parse.urlencode(
                    {"fuelType": "ELECTRICITY", "effective": "CURRENT", "type": "ALL", "page": page, "page-size": 1000}
                )
                d = self._get(f"{brand['base']}/cds-au/v1/energy/plans?{q}", "1")
                plans += d["data"]["plans"]
                if page >= int(d.get("meta", {}).get("totalPages") or 1) or page >= 10:
                    return plans
                page += 1

        plans: list[Plan] = self._cache.get_or_load(f"list:{brand['id']}", 6 * 3600, load)
        return plans

    def detail(self, brand: Brand, plan_id: str) -> Plan:
        if not PLAN_ID.match(plan_id):
            raise ValueError("Invalid plan id.")
        url = f"{brand['base']}/cds-au/v1/energy/plans/{urllib.parse.quote(plan_id, safe='@')}"
        plan: Plan = self._cache.get_or_load(
            f"plan:{brand['id']}:{plan_id}", 24 * 3600, lambda: self._get(url, "3")["data"]
        )
        return plan
