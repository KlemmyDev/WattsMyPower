from __future__ import annotations

import pytest

from app.core.cache import TTLCache


def test_get_or_load_caches_until_expiry() -> None:
    cache = TTLCache()
    calls: list[int] = []

    def load() -> int:
        calls.append(1)
        return len(calls)

    assert cache.get_or_load("k", 60, load) == 1
    assert cache.get_or_load("k", 60, load) == 1
    assert cache.get_or_load("k", 0, load) == 2  # expired: loads again


def test_errors_are_not_cached() -> None:
    cache = TTLCache()

    def fail() -> int:
        raise RuntimeError("down")

    with pytest.raises(RuntimeError):
        cache.get_or_load("k", 60, fail)
    assert cache.get("k", 60) == (False, None)


def test_age_makes_an_entry_expire_sooner() -> None:
    cache = TTLCache()
    cache.set("stale", "last good", age=1800 - 300)  # keep serving it, but retry in 5 minutes
    assert cache.get("stale", 1800) == (True, "last good")
    assert cache.get("stale", 1800 - 300) == (False, None)
