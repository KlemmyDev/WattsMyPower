"""
SPAKE2+ (RFC 9383), the prover's side: proving knowledge of a password to a device that holds only a verifier for it,
and agreeing a key, without the password crossing the network. TPAP (tpap.py) is this, with the suites below.

  w0, w1     two scalars from the password: PBKDF2 output, 40 bytes each, reduced mod the curve's order (`derive_w`)
  shareP     X = x·G + w0·M, for a random x
  shareV     Y, the device's
  Z, V       x·(Y − w0·N) and w1·(Y − w0·N)
  TT         the transcript: each of Context, idProver, idVerifier, M, N, shareP, shareV, Z, V and w0, as an 8-byte
             little-endian length followed by the value (points uncompressed)
  keys       K_main = Hash(TT); K_confirmP ‖ K_confirmV = HKDF(K_main, "ConfirmationKeys"); K_shared = HKDF(K_main,
             "SharedKey"); confirmP = MAC(K_confirmP, shareV) is sent, MAC(K_confirmV, shareP) is expected back

M and N are the RFC's fixed points for each curve. Checked against the RFC's test vectors (tests/test_tapo.py).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Any

from Cryptodome.Cipher import AES
from Cryptodome.Hash import CMAC, SHA256, SHA512
from Cryptodome.Protocol.KDF import HKDF
from Cryptodome.PublicKey import ECC

# RFC 9383 section 4: M and N for each curve, compressed.
POINTS = {
    "P-256": (
        "02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f",
        "03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49",
    ),
    "P-384": (
        "030ff0895ae5ebf6187080a82d82b42e2765e3b2f8749c7e05eba366434b363d3dc36f15314739074d2eb8613fceec2853",
        "02c72cf2e390853a1c1c4ad816a62fd15824f56078918f43f922ca21518f9c543bb252c5490214cf9aa3f0baab4b665c10",
    ),
    "P-521": (
        "02003f06f38131b2ba2600791e82488e8d20ab889af753a41806c5db18d37d85608cfae06b82e4a72cd744c719193562a653ea1f119eef"
        "9356907edc9b56979962d7aa",
        "0200c7924b9ec017f3094562894336a53c50167ba8c5963876880542bc669e494b2532d76c5b53dfb349fdf69154b9e0048c58a42e8ed0"
        "4cef052a3bc349d95575cd25",
    ),
}


@dataclass(frozen=True)
class Suite:
    curve: str
    hash: Any  # a Cryptodome hash module
    cmac: bool = False  # confirmations by AES-CMAC (16 bytes) rather than HMAC

    @property
    def hashlib_name(self) -> str:
        return "sha512" if self.hash is SHA512 else "sha256"

    @property
    def digest_len(self) -> int:
        return 64 if self.hash is SHA512 else 32


# TPAP's cipher suite numbers.
SUITES = {
    1: Suite("P-256", SHA256),
    2: Suite("P-256", SHA512),
    3: Suite("P-384", SHA256),
    4: Suite("P-384", SHA512),
    5: Suite("P-521", SHA512),
    8: Suite("P-256", SHA256, cmac=True),
    9: Suite("P-256", SHA512, cmac=True),
}


def _curve(name: str) -> Any:
    return ECC._curves[name]  # the generator and order: not otherwise exposed by pycryptodome


def size(curve: str) -> int:
    return (int(_curve(curve).order).bit_length() + 7) // 8


def point(sec1: bytes, curve: str) -> Any:
    """A point from its SEC1 encoding (compressed or not). Raises ValueError if it isn't on the curve."""
    return ECC.import_key(sec1, curve_name=curve).pointQ


def encode(p: Any, curve: str) -> bytes:
    """A point, uncompressed (0x04 ‖ x ‖ y)."""
    n = size(curve)
    return b"\x04" + int(p.x).to_bytes(n, "big") + int(p.y).to_bytes(n, "big")


def encode_w(w: int) -> bytes:
    """w0 as TPAP puts it in the transcript: big-endian, shortest form, but an odd length that starts with a set top
    bit gets a zero byte in front (an even length is left as it is)."""
    raw = w.to_bytes(max(1, (w.bit_length() + 7) // 8), "big")
    if len(raw) % 2 == 0 or not raw[0] & 0x80:
        return raw
    return b"\x00" + raw


def derive_w(credentials: bytes, salt: bytes, iterations: int, curve: str) -> tuple[int, int]:
    """w0 and w1 from the password (as TPAP derives them: PBKDF2-HMAC-SHA256, 40 bytes each)."""
    order = int(_curve(curve).order)
    out = hashlib.pbkdf2_hmac("sha256", credentials, salt, iterations, 80)
    return int.from_bytes(out[:40], "big") % order, int.from_bytes(out[40:], "big") % order


def _len8(b: bytes) -> bytes:
    return len(b).to_bytes(8, "little") + b


def hkdf(key: bytes, length: int, salt: bytes, hash: Any, info: bytes) -> bytes:
    out = HKDF(key, length, salt, hash, context=info)
    assert isinstance(out, bytes)
    return out


def _kdf(suite: Suite, key: bytes, label: bytes, length: int) -> bytes:
    return hkdf(key, length, b"\x00" * suite.digest_len, suite.hash, label)


def _mac(suite: Suite, key: bytes, data: bytes) -> bytes:
    if suite.cmac:
        return bytes(CMAC.new(key, data, ciphermod=AES).digest())
    return hmac.new(key, data, suite.hashlib_name).digest()


@dataclass
class Result:
    share_p: bytes  # X, uncompressed: what's sent
    confirm_p: bytes  # what's sent to prove the password
    confirm_v: bytes  # what the device must send back to prove it holds the verifier
    shared_key: bytes
    transcript: bytes


class Prover:
    """One run of SPAKE2+ as the prover. `x` is random unless given (for test vectors)."""

    def __init__(self, suite: Suite, w0: int, w1: int, x: int | None = None):
        self.suite, self.w0, self.w1 = suite, w0, w1
        c = _curve(suite.curve)
        self.order = int(c.order)
        self.x = x if x is not None else secrets.randbelow(self.order - 1) + 1
        m, n = POINTS[suite.curve]
        self.M, self.N = point(bytes.fromhex(m), suite.curve), point(bytes.fromhex(n), suite.curve)
        self.X = c.G * self.x + self.M * w0

    @property
    def share(self) -> bytes:
        return encode(self.X, self.suite.curve)

    def finish(self, share_v: bytes, context: bytes, id_prover: bytes = b"", id_verifier: bytes = b"") -> Result:
        """Everything that follows from the device's share. Raises ValueError for a share that isn't on the curve."""
        curve = self.suite.curve
        Y = point(share_v, curve)
        base = Y + (-(self.N * self.w0))
        Z, V = base * self.x, base * self.w1
        y_bytes, x_bytes = encode(Y, curve), self.share
        tt = b"".join(
            _len8(v)
            for v in (context, id_prover, id_verifier, encode(self.M, curve), encode(self.N, curve), x_bytes,
                      y_bytes, encode(Z, curve), encode(V, curve), encode_w(self.w0))
        )  # fmt: skip
        k_main = self.suite.hash.new(tt).digest()
        mac_len = 16 if self.suite.cmac else 32
        keys = _kdf(self.suite, k_main, b"ConfirmationKeys", 2 * mac_len)
        return Result(
            share_p=x_bytes,
            confirm_p=_mac(self.suite, keys[:mac_len], y_bytes),
            confirm_v=_mac(self.suite, keys[mac_len:], x_bytes),
            shared_key=_kdf(self.suite, k_main, b"SharedKey", self.suite.digest_len),
            transcript=tt,
        )
