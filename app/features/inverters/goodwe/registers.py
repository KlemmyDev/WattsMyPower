"""
Reading GoodWe's registers, common to every model: addresses as the `goodwe` library and GoodWe's docs give them,
32-bit values high word first (unlike Sungrow), and all-ones meaning "no data".
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from app.features.inverters.sungrow.registers import span, words

__all__ = ["Reg", "span", "text", "value", "words"]

Words = Mapping[int, int]


@dataclass(frozen=True)
class Reg:
    key: str
    address: int
    count: int = 1
    signed: bool = False
    scale: float = 1.0


def value(reg: Reg, w: Words) -> float | None:
    """A register's scaled value, or None if it wasn't read or holds all ones ("no data")."""
    got = span(w, reg.address, reg.count)
    if got is None:
        return None
    raw = 0
    for x in got:
        raw = (raw << 16) | x
    bits = 16 * reg.count
    if raw == (1 << bits) - 1:
        return None
    if reg.signed and raw >= 1 << (bits - 1):
        raw -= 1 << bits
    return round(raw * reg.scale, 3)


def text(w: Words, address: int, count: int) -> str | None:
    """ASCII from `count` registers (two characters each), without padding; None if it wasn't read or is empty."""
    got = span(w, address, count)
    if got is None:
        return None
    raw = b"".join(x.to_bytes(2, "big") for x in got)
    s = raw.decode("ascii", "replace").replace("�", "").strip("\x00 \xff")
    return s or None
