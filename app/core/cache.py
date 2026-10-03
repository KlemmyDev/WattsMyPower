"""A small thread-safe cache with per-entry expiry, for slow lookups (weather, plan data, places)."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any


class TTLCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[Any, tuple[float, Any]] = {}

    def get(self, key: Any, ttl: float) -> tuple[bool, Any]:
        """(True, value) if `key` was stored less than `ttl` seconds ago, else (False, None)."""
        with self._lock:
            hit = self._entries.get(key)
        if hit and time.time() - hit[0] < ttl:
            return True, hit[1]
        return False, None

    def set(self, key: Any, value: Any, age: float = 0) -> None:
        """Store `value`. With `age`, store it as if set that many seconds ago, so it expires sooner
        (e.g. keep serving stale data after a failed refresh, but retry in a few minutes)."""
        with self._lock:
            self._entries[key] = (time.time() - age, value)

    def forget(self, key: Any) -> None:
        """Drop `key`, so the next lookup loads it afresh."""
        with self._lock:
            self._entries.pop(key, None)

    def get_or_load(self, key: Any, ttl: float, load: Callable[[], Any]) -> Any:
        """The cached value, or `load()`'s result (cached). Errors from load aren't cached."""
        found, value = self.get(key, ttl)
        if found:
            return value
        value = load()
        self.set(key, value)
        return value
