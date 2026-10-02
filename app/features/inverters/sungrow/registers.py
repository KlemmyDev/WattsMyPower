"""
Reading Sungrow's Modbus registers, common to every model: addresses are protocol addresses as
printed in Sungrow's docs, 32-bit values are low word first, and a few raw values mean "no data".
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from app.features.inverters.types import Raw

Words = Mapping[int, int]  # protocol address -> raw 16-bit word

# Raw values that mean "no data" (e.g. export power with no meter fitted).
SENTINELS = {0xFFFF, 0x7FFF, 0xFFFFFFFF, 0x7FFFFFFF}


@dataclass(frozen=True)
class Reg:
    key: str
    address: int  # protocol address, as printed in the Sungrow doc
    count: int = 1
    signed: bool = False
    scale: float = 1.0


def words(raw: Raw, kind: str = "input") -> dict[int, int]:
    """One kind of register ("input" or "holding") from a stored reading, keyed by address."""
    return {int(a): int(w) for a, w in (raw.get(kind) or {}).items()}


def span(words: Words, address: int, count: int) -> list[int] | None:
    """`count` words from `address`, or None if any of them wasn't read."""
    out = [words.get(a) for a in range(address, address + count)]
    return None if any(w is None for w in out) else [w for w in out if w is not None]


def combine(words: list[int]) -> int:
    """Low word first, per Sungrow doc."""
    return words[0] if len(words) == 1 else (words[1] << 16) | words[0]


def value(reg: Reg, words: Words) -> float | None:
    """A register's scaled value, or None if it wasn't read or holds a "no data" sentinel."""
    w = span(words, reg.address, reg.count)
    if w is None:
        return None
    raw = combine(w)
    if raw in SENTINELS:
        return None
    if reg.signed:
        bits = 16 * reg.count
        if raw >= 1 << (bits - 1):
            raw -= 1 << bits
    return round(raw * reg.scale, 3)
