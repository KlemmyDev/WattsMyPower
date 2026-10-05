"""
TPAP: how Tapo devices on the newest firmware (from late 2026; P110 1.4.8) are spoken to on the home network, in place
of KLAP. The owner proves their password with SPAKE2+ (spake2plus.py) and the session is encrypted with AES-128-CCM.
As worked out by python-kasa's contributors (github.com/python-kasa/python-kasa, pull request 1592); described here and
written for this dashboard. Unlike KLAP it needs the password itself, not a hash, each time a session is made.

Every login step is a JSON POST to http://<device>/ as {"method": "login", "params": {"sub_method": …}}, answered
{"error_code": 0, "result": {…}}:

  discover       the device's MAC, and how it wants to be spoken to: `tpap` {tls, port, pake, user_hash_type, dac}
  pake_register  {username: MD5("admin") in hex (SHA-256, upper-case, if user_hash_type is 1), user_random (32 random
                 bytes, base64), cipher_suites [1], encryption ["aes_128_ccm"], passcode_type}. The answer gives
                 dev_random, dev_salt, dev_share (the device's SPAKE2+ share), the cipher suite and PBKDF2 iterations
                 chosen, and maybe extra_crypt: a way the password is to be hashed first (see `credentials`).
  pake_share     {user_share, user_confirm}. The answer's dev_confirm proves the device holds the password's verifier;
                 it gives the session's id (sessionId, or stok) and its first sequence number (start_seq).

The password goes into SPAKE2+ as "<email>/<password>", or as extra_crypt says. The context is Hash("PAKE V1" +
user_random + dev_random), with empty identities. A device that hasn't been added to an account (pake 0) takes a
passcode made from its MAC instead.

The session's key and base nonce come from the shared key: HKDF with salt "tp-kdf-salt-aes128-key" and info
"tp-kdf-info-aes128-key" (16 bytes), and the same with "-iv" (12 bytes). A request is POSTed to
http://<device>/stok=<id>/ds as its sequence number (4 bytes, big-endian) followed by the JSON request encrypted with
AES-128-CCM (16-byte tag), whose nonce is the base nonce with its last 4 bytes replaced by the sequence number; the
sequence number goes up by one each request. The answer is the same shape (its own sequence number first).

Only plain HTTP (tls 0), as plugs use, is spoken: a device that wants TLS is said to be unsupported. The port is the
one discovery gave (tpap.port).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from Cryptodome.Cipher import AES
from Cryptodome.Hash import SHA256

from app.features.home.integrations.tapo import spake2plus
from app.features.home.integrations.tapo.crypt import md5_crypt, parse_sha256_prefix, sha256_crypt
from app.features.home.integrations.tapo.klap import TERMINAL, TIMEOUT, Post, TapoError, _post

log = logging.getLogger(__name__)

# The device's error codes: the session's gone (make a new one and try again), and the password's wrong.
SESSION_GONE = {9999, 1002, -1001, -2203, -40401, -40413}
REFUSED = {-1501, 1111, 1100}
BLOCKED = -40404
DEFAULT_SEED = b"GqY5o136oa4i6VprTlMW2DpVXxmfW8"  # the passcode of a device not on an account, with its MAC


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _unb64(s: Any) -> bytes:
    return base64.b64decode(str(s or ""))


def default_passcode(mac: str) -> str:
    """The passcode a device not on an account takes: from its MAC."""
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    out = spake2plus.hkdf(DEFAULT_SEED + raw[3:6] + raw[0:3], 32, b"tp-kdf-salt-default-passcode", SHA256,
                          b"tp-kdf-info-default-passcode")  # fmt: skip
    return out.hex().upper()


def credentials(extra: Any, username: str, passcode: str, mac: str) -> str:
    """What goes into SPAKE2+ for the password: "<username>/<password>", or put through what extra_crypt asks."""
    if not isinstance(extra, dict) or not extra:
        return f"{username}/{passcode}" if username else passcode
    kind = str(extra.get("type") or "").lower()
    got = extra.get("params")
    params: dict[str, Any] = got if isinstance(got, dict) else {}
    sha1 = lambda v: hashlib.sha1(v.encode()).hexdigest()  # noqa: E731
    md5 = lambda v: hashlib.md5(v.encode()).hexdigest()  # noqa: E731
    if kind == "password_shadow":
        try:
            which = int(params.get("passwd_id", 0))
        except (TypeError, ValueError):
            return passcode
        prefix = str(params.get("passwd_prefix") or "")
        if which == 1 and prefix.startswith("$1$"):
            return md5_crypt(passcode, prefix[3:].split("$", 1)[0])
        if which == 2:
            return sha1(passcode)
        if which == 3:
            hex12 = mac.replace(":", "").replace("-", "")
            if not username or len(hex12) != 12:
                return passcode
            return sha1(md5(username) + "_" + ":".join(hex12[i : i + 2] for i in range(0, 12, 2)).upper())
        if which == 5 and prefix:
            salt, rounds = parse_sha256_prefix(prefix)
            if params.get("passwd_rounds") is not None:
                try:
                    rounds = int(params["passwd_rounds"])
                except (TypeError, ValueError):
                    rounds = None
            return sha256_crypt(passcode, salt, rounds)
        return passcode
    if kind == "password_authkey":
        key, words = str(params.get("authkey_tmpkey") or ""), str(params.get("authkey_dictionary") or "")
        if not key or not words:
            return passcode
        n = max(len(key), len(passcode))
        lhs = [ord(c) for c in passcode] + [0xBB] * (n - len(passcode))
        rhs = [ord(c) for c in key] + [0xBB] * (n - len(key))
        return "".join(words[(a ^ b) % len(words)] for a, b in zip(lhs, rhs, strict=True))
    if kind == "password_sha_with_salt":
        try:
            name = int(params.get("sha_name", -1))
            salt = base64.b64decode(str(params.get("sha_salt") or "")).decode()
        except (TypeError, ValueError):
            return passcode
        return hashlib.sha256((("admin" if name == 0 else "user") + salt + passcode).encode()).hexdigest()
    return f"{username}/{passcode}" if username else passcode


@dataclass
class Session:
    url: str  # where requests go: …/stok=<id>/ds
    key: bytes
    nonce: bytes
    seq: int
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def _nonce(self, seq: int) -> bytes:
        return self.nonce[:-4] + (seq & 0xFFFFFFFF).to_bytes(4, "big")

    def encrypt(self, payload: bytes) -> tuple[bytes, int]:
        seq = self.seq
        self.seq += 1
        ct, tag = AES.new(self.key, AES.MODE_CCM, nonce=self._nonce(seq), mac_len=16).encrypt_and_digest(payload)
        return (seq & 0xFFFFFFFF).to_bytes(4, "big") + ct + tag, seq

    def decrypt(self, body: bytes) -> bytes:
        if len(body) < 20:
            raise ValueError("too short")
        seq = int.from_bytes(body[:4], "big")
        cipher = AES.new(self.key, AES.MODE_CCM, nonce=self._nonce(seq), mac_len=16)
        return bytes(cipher.decrypt_and_verify(body[4:-16], body[-16:]))


_SESSIONS: dict[tuple[str, str], Session] = {}
_LOCK = threading.Lock()


class TpapClient:
    """One device on TPAP, signed in to with the account's email and password."""

    def __init__(
        self,
        host: str,
        email: str,
        password: str,
        post: Post = _post,
        clock: Callable[[], float] = time.time,
        port: int = 80,
    ):
        self.host, self.email, self.password = host, email, password
        self._post, self._clock = post, clock
        self._base = f"http://{host}" + (f":{port}" if port != 80 else "")
        self._cache_key = (f"{host}:{port}", email)

    def _send(self, url: str, body: bytes, content_type: str) -> tuple[int, bytes]:
        try:
            status, _, answer = self._post(url, body, {"Content-Type": content_type}, TIMEOUT)
        except OSError as e:  # URLError and timeouts are OSErrors
            raise TapoError(f"{self.host} didn't answer.") from e
        return status, answer

    def _login(self, params: dict[str, Any], step: str) -> dict[str, Any]:
        status, body = self._send(f"{self._base}/", json.dumps({"method": "login", "params": params}).encode(),
                                  "application/json")  # fmt: skip
        if status != 200:
            raise TapoError(f"{self.host} refused {step} ({status}).", refused=step == "pake_share" and status == 403)
        try:
            reply = json.loads(body)
        except ValueError as e:
            raise TapoError(f"{self.host}'s answer to {step} couldn't be read.") from e
        code = reply.get("error_code") if isinstance(reply, dict) else None
        if code == BLOCKED:
            raise TapoError(f"{self.host} has stopped accepting sign-ins for a while (too many tries).", wait=True)
        if code in REFUSED:
            raise TapoError(f"{self.host} didn't accept the TP-Link ID and password ({code}).", refused=True)
        if code != 0:
            raise TapoError(f"{self.host} couldn't do {step} ({code}).")
        result = reply.get("result")
        return result if isinstance(result, dict) else {}

    def handshake(self) -> Session:
        found = self._login({"sub_method": "discover"}, "discover")
        got = found.get("tpap")
        tpap: dict[str, Any] = got if isinstance(got, dict) else {}
        if tpap.get("tls") in (1, 2):
            raise TapoError(f"{self.host} wants TLS, which isn't supported yet.")
        mac = str(found.get("mac") or "")
        pake = set(tpap.get("pake") or [])
        kind = "default_userpw" if 0 in pake or not pake else "userpw" if pake & {2, 5} else "shared_token"
        if tpap.get("user_hash_type") == 1:
            user = hashlib.sha256(b"admin").hexdigest().upper()
        else:
            user = hashlib.md5(b"admin").hexdigest()
        user_random = secrets.token_bytes(32)
        reg = self._login(
            {"sub_method": "pake_register", "username": user, "user_random": _b64(user_random),
             "cipher_suites": [1], "encryption": ["aes_128_ccm"], "passcode_type": kind, "stok": None},
            "pake_register",
        )  # fmt: skip
        try:
            suite = spake2plus.SUITES[int(reg.get("cipher_suites") or 0)]
            iterations = int(reg.get("iterations") or 0)
        except (TypeError, ValueError, KeyError) as e:
            raise TapoError(
                f"{self.host} chose a cipher suite that isn't supported ({reg.get('cipher_suites')})."
            ) from e
        cipher = str(reg.get("encryption") or "").lower().replace("-", "_")
        if cipher != "aes_128_ccm" or iterations <= 0 or not reg.get("dev_share"):
            raise TapoError(f"{self.host} answered the sign-in in a way that isn't supported ({cipher}).")
        extra = reg.get("extra_crypt")
        log.info(
            "TPAP sign-in to %s: suite %s, passcode %s, password hashed as %s", self.host,
            reg.get("cipher_suites"), kind, (extra or {}).get("type") if isinstance(extra, dict) else None,
        )  # fmt: skip
        secret = (
            default_passcode(mac) if kind == "default_userpw" else credentials(extra, self.email, self.password, mac)
        )
        w0, w1 = spake2plus.derive_w(secret.encode(), _unb64(reg.get("dev_salt")), iterations, suite.curve)
        prover = spake2plus.Prover(suite, w0, w1)
        context = suite.hash.new(b"PAKE V1" + user_random + _unb64(reg.get("dev_random"))).digest()
        try:
            done = prover.finish(_unb64(reg.get("dev_share")), context)
        except ValueError as e:
            raise TapoError(f"{self.host}'s share isn't a point on its curve.") from e
        shared = self._login(
            {"sub_method": "pake_share", "user_share": _b64(done.share_p), "user_confirm": _b64(done.confirm_p)},
            "pake_share",
        )
        if not hmac.compare_digest(_unb64(shared.get("dev_confirm")), done.confirm_v):
            raise TapoError(f"{self.host} didn't accept the TP-Link ID and password.", refused=True)
        session_id = str(shared.get("sessionId") or shared.get("stok") or "")
        if not session_id or shared.get("start_seq") is None:
            raise TapoError(f"{self.host} didn't give a session.")
        key = spake2plus.hkdf(done.shared_key, 16, b"tp-kdf-salt-aes128-key", suite.hash, b"tp-kdf-info-aes128-key")
        nonce = spake2plus.hkdf(done.shared_key, 12, b"tp-kdf-salt-aes128-iv", suite.hash, b"tp-kdf-info-aes128-iv")
        return Session(f"{self._base}/stok={session_id}/ds", key, nonce, int(shared["start_seq"]))

    def _session(self, fresh: bool) -> Session:
        with _LOCK:
            s = None if fresh else _SESSIONS.get(self._cache_key)
        if s is None:
            s = self.handshake()
            with _LOCK:
                _SESSIONS[self._cache_key] = s
        return s

    def request(self, method: str, params: dict[str, Any] | None = None, *, again: bool = True) -> dict[str, Any]:
        """Call a method on the device and return its result. Raises TapoError."""
        s = self._session(fresh=not again)
        payload: dict[str, Any] = {"method": method, "request_time_milis": int(self._clock() * 1000),
                                   "terminal_uuid": TERMINAL}  # fmt: skip
        if params is not None:
            payload["params"] = params
        with s.lock:
            body, _ = s.encrypt(json.dumps(payload).encode())
            status, answer = self._send(s.url, body, "application/octet-stream")
        gone = status != 200
        reply: Any = None
        if not gone:
            try:
                reply = json.loads(answer) if answer[:1] == b"{" else json.loads(s.decrypt(answer))
            except ValueError:
                gone = True  # couldn't be decrypted: the session isn't the one the device has
        code = reply.get("error_code") if isinstance(reply, dict) else None
        if gone or code in SESSION_GONE:
            if again:
                return self.request(method, params, again=False)
            raise TapoError(f"{self.host} answered {status}" + (f" ({code})." if code is not None else "."))
        if code in REFUSED:
            raise TapoError(f"{self.host} didn't accept the TP-Link ID and password ({code}).", refused=True)
        if code != 0:
            raise TapoError(f"{self.host} couldn't do {method} ({code}).")
        result = reply.get("result")
        return result if isinstance(result, dict) else {}


def forget_sessions() -> None:
    with _LOCK:
        _SESSIONS.clear()
