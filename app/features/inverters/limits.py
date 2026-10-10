"""Dropping values no home system can produce (see app.core.schema.SAMPLE_BOUNDS), whatever the brand."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.core.schema import SAMPLE_BOUNDS, THREE_PHASE_BOUNDS

Bounds = Mapping[str, tuple[float, float]]


def bounds_for(info: Mapping[str, Any] | None) -> Bounds:
    """The bounds for a system, from its hybrid's details (Info): a three-phase one can carry more power."""
    phases = str((info or {}).get("phases") or "").lower()
    return THREE_PHASE_BOUNDS if phases.startswith("three") else SAMPLE_BOUNDS


def outside(values: Mapping[str, Any], bounds: Bounds = SAMPLE_BOUNDS) -> list[str]:
    """The keys whose values are out of bounds."""
    out = []
    for k, v in values.items():
        b = bounds.get(k)
        if b and isinstance(v, int | float) and not b[0] <= v <= b[1]:
            out.append(k)
    return out


def clean[T: dict[str, Any]](values: T, bounds: Bounds = SAMPLE_BOUNDS) -> T:
    """`values` with out-of-bounds values replaced by None (not stored, as if not read)."""
    for k in outside(values, bounds):
        values[k] = None
    return values
