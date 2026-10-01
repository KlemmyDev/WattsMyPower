"""
Look up retail electricity plans from the Consumer Data Right "energy product
reference data" APIs (the same data Energy Made Easy shows), and turn one into
our tariff format.

- The AER hosts every retailer's plan data at https://cdr.energymadeeasy.gov.au/<brand>,
  with GET .../cds-au/v1/energy/plans and .../plans/{planId}. No login needed.
  (Retailers' own CDR hosts in the CDR Register don't serve plan data, and unknown
  brands just return an empty list, so the brand slugs come from the AER's published
  "Energy Retailer Base URIs" list, bundled as retailers.json - January 2026 edition,
  filtered to brands that currently publish electricity plans.)
- CDR prices exclude GST; we add 10% to usage and supply charges so they match a
  household bill. Feed-in tariffs aren't subject to GST for households.

Only brand ids from the register are ever turned into URLs, and plan ids are
checked against a strict pattern, so requests can only go to registered retailers.

Fetching and caching live in cdr.py; the conversions (pure functions of plan JSON) in convert.py.
"""

from __future__ import annotations

import concurrent.futures as cf
import logging
import re
from typing import Any

from app.features.plans import convert
from app.features.plans.cdr import Brand, CdrClient, Plan
from app.features.tariffs.store import TariffStore

log = logging.getLogger(__name__)

MAX_DETAILS = 400  # plan details fetched per search (then cached for a day)


def _serves(plan: Plan, postcode: str) -> bool:
    g = plan.get("geography") or {}
    if postcode in (g.get("excludedPostcodes") or []):
        return False
    inc = g.get("includedPostcodes")
    return not inc or postcode in inc


class PlansService:
    def __init__(self, tariffs: TariffStore, cdr: CdrClient | None = None) -> None:
        self.tariffs = tariffs
        self.cdr = cdr or CdrClient()

    def brands(self) -> list[Brand]:
        return self.cdr.brands()

    def search(self, brand_id: str, postcode: str, query: str = "") -> dict[str, Any]:
        """A retailer's current residential plans at a postcode, with headline prices. Market offers first."""
        if not re.fullmatch(r"\d{4}", postcode or ""):
            raise ValueError("Enter a four-digit postcode.")
        brand = self.cdr.brand(brand_id)
        q = (query or "").strip().lower()
        matches = [
            p
            for p in self.cdr.plan_list(brand)
            if p.get("customerType", "RESIDENTIAL") == "RESIDENTIAL"
            and _serves(p, postcode)
            and (not q or q in p.get("displayName", "").lower())
        ]
        truncated = len(matches) > MAX_DETAILS
        matches = matches[:MAX_DETAILS]

        def summarise(p: Plan) -> dict[str, Any] | None:
            try:
                return convert.summary(p, self.cdr.detail(brand, p["planId"]))
            except Exception as e:  # one bad plan shouldn't sink the search
                log.info("plan %s detail failed: %s", p.get("planId"), e)
                return None

        with cf.ThreadPoolExecutor(12) as ex:
            out = [s for s in ex.map(summarise, matches) if s]
        # Market offers first, then by name; identical names stay distinguishable by their prices.
        out.sort(key=lambda s: (s["type"] != "MARKET", s["name"].lower(), s["pricing"]))
        return {
            "brand": brand["name"],
            "postcode": postcode,
            "plans": out,
            "truncated": truncated,
            "limit": MAX_DETAILS,
        }

    def to_tariff(self, brand_id: str, plan_id: str) -> dict[str, Any]:
        """One published plan as a tariff for the editor (not saved), with notes on anything simplified."""
        brand = self.cdr.brand(brand_id)
        d = self.cdr.detail(brand, plan_id)
        return convert.to_tariff(brand, plan_id, d, self.tariffs.get())
