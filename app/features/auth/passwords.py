"""
Password hashing. Pure functions, no state.

The stored formats are `scrypt$N$r$p$salt$key` and `pbkdf2_sha256$rounds$salt$key` (base64
salt and key). They're read back from the database, so they must never change: every hash
already stored has to keep verifying.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

# scrypt cost: ~50 ms and 16 MB per check on a small server.
_N, _R, _P = 2**14, 8, 1
_PBKDF2_ROUNDS = 600_000


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    if hasattr(hashlib, "scrypt"):
        key = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
        return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(key)}"
    # Python builds without scrypt (e.g. linked against LibreSSL): PBKDF2 at OWASP's recommended cost.
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, stored: str) -> bool:
    """Whether `password` matches a hash from hash_password. A malformed hash just doesn't match."""
    try:
        algo, *params, salt, key = stored.split("$")
        if algo == "scrypt":
            n, r, p = map(int, params)
            got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=n, r=r, p=p, dklen=32)
        elif algo == "pbkdf2_sha256":
            got = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(params[0]))
        else:
            return False
    except (ValueError, TypeError, AttributeError):
        return False
    return hmac.compare_digest(got, base64.b64decode(key))
