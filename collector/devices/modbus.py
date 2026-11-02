"""Helpers for devices read over Modbus, whatever the brand."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterable

from collector.devices import Words

log = logging.getLogger(__name__)

# (first register address, number of registers)
Range = tuple[int, int]

RETRY_AFTER = 600  # seconds before a rejected range is asked for as a whole again


class BadRanges(set[int]):
    """Ranges (by first address) the device rejected, read one register at a time meanwhile.

    A dongle can refuse a block for a while (a hiccup, another client talking to it) and then answer it again, so
    each is asked for as a whole again once `RETRY_AFTER` seconds have passed since it was last refused.
    """

    def __init__(self) -> None:
        super().__init__()
        self._refused: dict[int, float] = {}

    def add(self, element: int, /) -> None:
        super().add(element)
        self._refused[element] = time.monotonic()

    def discard(self, element: object, /) -> None:
        super().discard(element)
        self._refused = {a: t for a, t in self._refused.items() if a != element}

    def retry_due(self, start: int) -> bool:
        return time.monotonic() - self._refused.get(start, 0.0) >= RETRY_AFTER


def read_ranges(
    read: Callable[[int, int], list[int] | None], ranges: Iterable[Range], bad: set[int], label: str
) -> Words:
    """Read each range in one request; a range the device rejects falls back to one register at a time.

    `read(address, count)` returns the words, or None if the device rejected the request (it raises
    when the device can't be talked to at all). Some models answer "Illegal Data Address" for a
    whole block because of a gap inside it (e.g. MPPT3 on an SH5.0RS), so a rejected range is
    remembered in `bad` and goes straight to single reads after that, until `RETRY_AFTER` seconds on
    (when `bad` is a `BadRanges`) it is asked for as a whole again, in case the refusal was passing.
    Words that still can't be read are left out. A range is only remembered once its single reads
    completed, so a reply garbled by a dropped connection doesn't condemn it.
    """
    words: Words = {}
    for start, count in ranges:
        skip = start in bad and not (isinstance(bad, BadRanges) and bad.retry_due(start))
        block = None if skip else read(start, count)
        if block is not None and len(block) == count:
            words.update(zip(range(start, start + count), block, strict=True))
            if start in bad:
                bad.discard(start)
                log.info("%s: range %s+%s is being answered as a whole again", label, start, count)
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
