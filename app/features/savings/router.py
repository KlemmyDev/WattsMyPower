"""
The Savings page: this quarter's bill and system payback, and what a year of your
usage would cost on a retailer's published plans.

/api/plans/compare lives here rather than with the plans router because it prices
plans against your usage; it's a distinct literal path, so it can't clash with theirs.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api")


@router.get("/savings")
async def get_savings(svc: ServicesDep):
    """This quarter's bill (so far and estimated) and system payback."""
    return await asyncio.to_thread(svc.savings.build, svc.live.latest)


@router.get("/plans/compare")
async def plan_compare(svc: ServicesDep, brand: str, postcode: str):
    """A year of your actual usage priced on each of a retailer's published plans, cheapest first."""
    try:
        return await asyncio.to_thread(svc.savings.compare, brand, postcode)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"The retailer's plan data could not be loaded ({type(e).__name__}). Try again shortly.",
        ) from e
