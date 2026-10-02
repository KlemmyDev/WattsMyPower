"""Dropping values no home system can produce (see app.core.schema.SAMPLE_BOUNDS), whatever the brand."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.core.schema import SAMPLE_BOUNDS


def outside(values: Mapping[str, Any]) -> list[str]:
    """The keys whose values are out of bounds."""
    out = []
    for k, v in values.items():
        bounds = SAMPLE_BOUNDS.get(k)
        if bounds and isinstance(v, int | float) and not bounds[0] <= v <= bounds[1]:
            out.append(k)
    return out


def clean[T: dict[str, Any]](values: T) -> T:
    """`values` with out-of-bounds values replaced by None (not stored, as if not read)."""
    for k in outside(values):
        values[k] = None
    return values
