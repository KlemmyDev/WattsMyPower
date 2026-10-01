from __future__ import annotations

import hashlib

import pytest

from app.features.auth.passwords import hash_password, verify_password


def test_round_trip() -> None:
    h = hash_password("correct horse")
    assert verify_password("correct horse", h)
    assert not verify_password("wrong horse", h)


def test_pbkdf2_hashes_verify_where_scrypt_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr(hashlib, "scrypt", raising=False)
    h = hash_password("correct horse")
    assert h.startswith("pbkdf2_sha256$")
    assert verify_password("correct horse", h)


@pytest.mark.parametrize("stored", ["", "nonsense", "md5$abc$def", "scrypt$x$y$z$salt$key"])
def test_malformed_hashes_never_verify(stored: str) -> None:
    assert not verify_password("anything", stored)
