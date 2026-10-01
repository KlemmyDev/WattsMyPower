"""Retail plans from Energy Made Easy: retailers, plan search, and importing a plan as the tariff."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.dependencies import ServicesDep

router = APIRouter(prefix="/api")


@router.get("/plans/brands")
async def plan_brands(svc: ServicesDep):
    """Energy retailers from the CDR Register (cached for a day)."""
    try:
        return [{"id": b["id"], "name": b["name"]} for b in await asyncio.to_thread(svc.plans.brands)]
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=f"The retailer list could not be loaded ({type(e).__name__})."
        ) from e


@router.get("/plans/search")
async def plan_search(svc: ServicesDep, brand: str, postcode: str, q: str = ""):
    """A retailer's current residential electricity plans available at a postcode, with headline prices (incl. GST)."""
    try:
        return await asyncio.to_thread(svc.plans.search, brand, postcode, q)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"The retailer's plan data could not be loaded ({type(e).__name__}). Try again shortly.",
        ) from e


@router.get("/plans/tariff")
async def plan_tariff(svc: ServicesDep, brand: str, plan: str):
    """Convert one published plan into a tariff for the editor. Not saved until PUT /api/tariff."""
    try:
        return await asyncio.to_thread(svc.plans.to_tariff, brand, plan)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=f"The plan could not be loaded ({type(e).__name__}). Try again shortly."
        ) from e
