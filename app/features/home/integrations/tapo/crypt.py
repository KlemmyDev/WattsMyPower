"""
The Unix password hashes some Tapo firmware asks the password to be put through before TPAP (tpap.py): MD5-crypt
("$1$", as in FreeBSD and glibc) and SHA-256-crypt ("$5$", Ulrich Drepper's specification, akkadia.org/drepper/
SHA-crypt.txt). Python no longer has these built in. Checked against openssl and the specification's test vectors.
"""

from __future__ import annotations

import hashlib

ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _b64(value: int, chars: int) -> str:
    out = ""
    for _ in range(chars):
        out += ITOA64[value & 0x3F]
        value >>= 6
    return out


def md5_crypt(password: str, salt: str) -> str:
    pw, s = password.encode(), salt[:8].encode()
    alt = hashlib.md5(pw + s + pw).digest()
    ctx = pw + b"$1$" + s
    for n in range(len(pw), 0, -16):
        ctx += alt[: min(16, n)]
    n = len(pw)
    while n:
        ctx += b"\x00" if n & 1 else pw[:1]
        n >>= 1
    f = hashlib.md5(ctx).digest()
    for i in range(1000):
        step = pw if i & 1 else f
        if i % 3:
            step += s
        if i % 7:
            step += pw
        step += f if i & 1 else pw
        f = hashlib.md5(step).digest()
    triples = ((0, 6, 12), (1, 7, 13), (2, 8, 14), (3, 9, 15), (4, 10, 5))
    out = "".join(_b64((f[a] << 16) | (f[b] << 8) | f[c], 4) for a, b, c in triples) + _b64(f[11], 2)
    return f"$1${s.decode()}${out}"


ROUNDS_DEFAULT, ROUNDS_MIN, ROUNDS_MAX = 5000, 1000, 999_999_999


def sha256_crypt(password: str, salt: str, rounds: int | None = None) -> str:
    """SHA-256-crypt. `rounds` given (even 5000) is written into the result, as glibc does."""
    pw, s = password.encode(), salt[:16].encode()
    r = ROUNDS_DEFAULT if rounds is None else max(ROUNDS_MIN, min(ROUNDS_MAX, rounds))
    b = hashlib.sha256(pw + s + pw).digest()
    a = hashlib.sha256(pw + s)
    n = len(pw)
    while n > 32:
        a.update(b)
        n -= 32
    a.update(b[:n])
    n = len(pw)
    while n:
        a.update(b if n & 1 else pw)
        n >>= 1
    c = a.digest()
    dp = hashlib.sha256(pw * len(pw)).digest()
    p = (dp * (len(pw) // 32 + 1))[: len(pw)]
    ds = hashlib.sha256(s * (16 + c[0])).digest()
    sp = (ds * (len(s) // 32 + 1))[: len(s)]
    for i in range(r):
        h = hashlib.sha256(p if i & 1 else c)
        if i % 3:
            h.update(sp)
        if i % 7:
            h.update(p)
        h.update(c if i & 1 else p)
        c = h.digest()
    order = ((0, 10, 20), (21, 1, 11), (12, 22, 2), (3, 13, 23), (24, 4, 14), (15, 25, 5), (6, 16, 26), (27, 7, 17),
             (18, 28, 8), (9, 19, 29))  # fmt: skip
    out = "".join(_b64((c[x] << 16) | (c[y] << 8) | c[z], 4) for x, y, z in order) + _b64((c[31] << 8) | c[30], 3)
    prefix = "$5$" if rounds is None else f"$5$rounds={r}$"
    return f"{prefix}{s.decode()}${out}"


def parse_sha256_prefix(prefix: str) -> tuple[str, int | None]:
    """The salt and rounds from a "$5$rounds=N$salt" (or "$5$salt") prefix."""
    spec = prefix[3:] if prefix.startswith("$5$") else prefix
    rounds = None
    if spec.startswith("rounds="):
        part, _, spec = spec.partition("$")
        try:
            rounds = int(part.split("=", 1)[1])
        except ValueError:
            rounds = ROUNDS_DEFAULT
    return spec.split("$", 1)[0], rounds
