"""
KLAP: how Tapo devices are spoken to directly on the home network (HTTP on port 80), with no cloud in between. As
worked out by the python-kasa project (github.com/python-kasa/python-kasa); described here and written for this
dashboard.

Every device knows its owner's TP-Link ID only as auth_hash = SHA-256(SHA-1(email) + SHA-1(password)), so that's all
that's kept: never the password. A device not yet added to a TP-Link account answers to a blank email and password,
or to TP-Link's test account, and those are tried too.

  handshake1   POST /app/handshake1 with 16 random bytes (local_seed). The device answers with its remote_seed (16
               bytes) and SHA-256(local_seed + remote_seed + auth_hash), which says whose it is, and sets cookies:
               TP_SESSIONID, and TIMEOUT (seconds the session lasts, a day).
  handshake2   POST /app/handshake2 with SHA-256(remote_seed + local_seed + auth_hash), with the session cookie.
  requests     The session's key is the first 16 bytes of SHA-256("lsk" + seeds + auth_hash), its IV the first 12 of
               SHA-256("iv" + …) followed by a sequence number (that hash's last 4 bytes, signed, big-endian), and its
               signing key the first 28 of SHA-256("ldk" + …). Each request adds 1 to the sequence number, encrypts its
               JSON with AES-128-CBC (PKCS#7 padding), and is sent to /app/request?seq=N as SHA-256(signing key +
               seq + ciphertext) followed by the ciphertext. The answer is the same, decrypted with the same IV.

Requests are JSON: {"method", "params", "request_time_milis", "terminal_uuid"}; answers {"error_code": 0, "result"}.
A session is kept and reused until it expires; a 403 means it's no longer good, so it's made again once.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from Cryptodome.Cipher import AES
from Cryptodome.Util.Padding import pad, unpad

from app.core.http import USER_AGENT

TIMEOUT = 5  # seconds: a plug on the home network answers in well under one
RENEW_EARLY = 300  # seconds before a session expires to make a new one
TERMINAL = hashlib.md5(uuid.uuid4().bytes).hexdigest()  # who's asking, as the device sees it: one per process

# (url, body, headers, timeout) -> (status, the Set-Cookie headers, body). Doesn't raise for an HTTP status.
Post = Callable[[str, bytes, dict[str, str], float], tuple[int, list[str], bytes]]


class TapoError(Exception):
    """A Tapo device that couldn't be spoken to (by KLAP here, or TPAP). `refused`: it answered, but not to our TP-Link
    ID. `wait`: it's stopped accepting sign-ins for a while (too many tries)."""

    def __init__(self, message: str, refused: bool = False, wait: bool = False):
        super().__init__(message)
        self.refused = refused
        self.wait = wait


KlapError = TapoError


def auth_hash(email: str, password: str) -> bytes:
    sha1 = lambda s: hashlib.sha1(s.encode()).digest()  # noqa: E731
    return hashlib.sha256(sha1(email) + sha1(password)).digest()


# A device not on a TP-Link account yet answers to these.
FALLBACK_HASHES = (auth_hash("", ""), auth_hash("test@tp-link.net", "test"))


def _sha256(*parts: bytes) -> bytes:
    return hashlib.sha256(b"".join(parts)).digest()


def _post(url: str, body: bytes, headers: dict[str, str], timeout: float) -> tuple[int, list[str], bytes]:
    req = urllib.request.Request(url, data=body, method="POST", headers={"User-Agent": USER_AGENT, **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.headers.get_all("Set-Cookie") or [], resp.read()
    except urllib.error.HTTPError as e:
        return e.code, [], b""


def _cookies(headers: list[str]) -> dict[str, str]:
    """TP_SESSIONID and TIMEOUT, from however the device sent them ("TP_SESSIONID=…;TIMEOUT=86400")."""
    out: dict[str, str] = {}
    for h in headers:
        for part in h.split(";"):
            k, _, v = part.strip().partition("=")
            if k in ("TP_SESSIONID", "TIMEOUT"):
                out[k] = v
    return out


@dataclass
class Session:
    """An encrypted session with one device (see the module docstring)."""

    key: bytes
    iv: bytes
    seq: int
    sig: bytes
    cookie: str
    expires: float
    hash: bytes  # the auth hash it was made with
    # One request at a time: its sequence numbers must reach the device in order.
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    @classmethod
    def derive(cls, local: bytes, remote: bytes, hash: bytes, cookie: str, expires: float) -> Session:
        seeds = local + remote + hash
        iv = _sha256(b"iv", seeds)
        return cls(
            key=_sha256(b"lsk", seeds)[:16],
            iv=iv[:12],
            seq=int.from_bytes(iv[-4:], "big", signed=True),
            sig=_sha256(b"ldk", seeds)[:28],
            cookie=cookie,
            expires=expires,
            hash=hash,
        )

    def _iv(self, seq: int) -> bytes:
        return self.iv + seq.to_bytes(4, "big", signed=True)

    def encrypt(self, payload: bytes) -> tuple[bytes, int]:
        """The next request's body, and its sequence number."""
        self.seq += 1
        cipher = AES.new(self.key, AES.MODE_CBC, self._iv(self.seq)).encrypt(pad(payload, 16))
        return _sha256(self.sig, self.seq.to_bytes(4, "big", signed=True), cipher) + cipher, self.seq

    def decrypt(self, body: bytes, seq: int) -> bytes:
        return unpad(AES.new(self.key, AES.MODE_CBC, self._iv(seq)).decrypt(body[32:]), 16)


# Sessions kept between polls: (host:port, the account's auth hash) -> session.
_SESSIONS: dict[tuple[str, bytes], Session] = {}
_LOCK = threading.Lock()


class KlapClient:
    """One device. `hashes`: the auth hashes to try, the account's first."""

    def __init__(
        self,
        host: str,
        hashes: list[bytes],
        post: Post = _post,
        clock: Callable[[], float] = time.time,
        port: int = 80,
    ):
        self.host = host
        self.hashes = [*hashes, *(h for h in FALLBACK_HASHES if h not in hashes)]
        self._post = post
        self._clock = clock
        self._base = f"http://{host}" + (f":{port}" if port != 80 else "") + "/app"
        self._cache_key = (f"{host}:{port}", hashes[0] if hashes else b"")

    def _send(self, path: str, body: bytes, cookie: str | None = None) -> tuple[int, list[str], bytes]:
        headers = {
            "Content-Type": "application/octet-stream",
            **({"Cookie": f"TP_SESSIONID={cookie}"} if cookie else {}),
        }
        try:
            return self._post(f"{self._base}/{path}", body, headers, TIMEOUT)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise KlapError(f"{self.host} didn't answer.") from e

    def handshake(self) -> Session:
        local = secrets.token_bytes(16)
        status, cookies, body = self._send("handshake1", local)
        if status != 200 or len(body) != 48:
            raise KlapError(f"{self.host} isn't a Tapo device that can be read on the network ({status}).")
        remote, proof = body[:16], body[16:]
        hash = next((h for h in self.hashes if _sha256(local, remote, h) == proof), None)
        if hash is None:
            raise KlapError(f"{self.host} belongs to another TP-Link account.", refused=True)
        got = _cookies(cookies)
        cookie = got.get("TP_SESSIONID", "")
        status, _, _ = self._send("handshake2", _sha256(remote, local, hash), cookie)
        if status != 200:
            raise KlapError(f"{self.host} refused the session ({status}).", refused=status == 403)
        lasts = float(got.get("TIMEOUT") or 86400)
        return Session.derive(local, remote, hash, cookie, self._clock() + lasts)

    def _session(self, fresh: bool = False) -> Session:
        with _LOCK:
            s = None if fresh else _SESSIONS.get(self._cache_key)
        if s is None or self._clock() > s.expires - RENEW_EARLY or s.seq >= 2**31 - 1000:
            s = self.handshake()
            with _LOCK:
                _SESSIONS[self._cache_key] = s
        return s

    def request(self, method: str, params: dict[str, Any] | None = None, *, again: bool = True) -> dict[str, Any]:
        """Call a method on the device and return its result. Raises KlapError."""
        s = self._session(fresh=not again)
        payload = {"method": method, "request_time_milis": int(self._clock() * 1000), "terminal_uuid": TERMINAL}
        if params is not None:
            payload["params"] = params
        with s.lock:
            body, seq = s.encrypt(json.dumps(payload).encode())
            status, _, answer = self._send(f"request?seq={seq}", body, s.cookie)
        if status == 403 and again:  # the session's gone (the device restarted, or another took its place)
            return self.request(method, params, again=False)
        if status != 200:
            raise KlapError(f"{self.host} answered {status}.")
        try:
            reply = json.loads(s.decrypt(answer, seq))
        except ValueError as e:
            raise KlapError(f"{self.host}'s answer couldn't be read.") from e
        if reply.get("error_code") != 0:
            raise KlapError(f"{self.host} couldn't do {method} ({reply.get('error_code')}).")
        result = reply.get("result")
        return result if isinstance(result, dict) else {}


def forget_sessions() -> None:
    """Drop every kept session (for tests)."""
    with _LOCK:
        _SESSIONS.clear()
