"""Helpers for devices read over Modbus, whatever the brand."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable

from collector.devices import Words

log = logging.getLogger(__name__)

# (first register address, number of registers)
Range = tuple[int, int]


def read_ranges(
    read: Callable[[int, int], list[int] | None], ranges: Iterable[Range], bad: set[int], label: str
) -> Words:
    """Read each range in one request; a range the device rejects falls back to one register at a time.

    `read(address, count)` returns the words, or None if the device rejected the request (it raises
    when the device can't be talked to at all). Some models answer "Illegal Data Address" for a
    whole block because of a gap inside it (e.g. MPPT3 on an SH5.0RS), so a rejected range is
    remembered in `bad` and goes straight to single reads after that. Words that still can't be
    read are left out. A range is only remembered once its single reads completed, so a reply
    garbled by a dropped connection doesn't condemn it.
    """
    words: Words = {}
    for start, count in ranges:
        block = None if start in bad else read(start, count)
        if block is not None and len(block) == count:
            words.update(zip(range(start, start + count), block, strict=True))
            continue
        if count == 1:
            continue  # the single read was the request that failed
        if start not in bad:
            log.warning("%s: range %s+%s rejected; reading its registers one at a time", label, start, count)
        for address in range(start, start + count):
            w = read(address, 1)
            if w is not None and len(w) == 1:
                words[address] = w[0]
        bad.add(start)
    return words
