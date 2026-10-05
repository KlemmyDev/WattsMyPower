"""
Speaking to a Shelly on the home network, over plain HTTP.

Every Shelly answers GET /shelly, without a password, with what it is (see discovery.py). When a password is set (in
the Shelly app: the device → Settings → Authentication), everything else asks for it: Gen1 by HTTP Basic, Gen2 and
later (Plus, Pro, Gen3, Gen4) by HTTP Digest with SHA-256 (RFC 7616), the user being "admin" on both. A request goes
without it first; the device's 401 says which it wants (and, for Digest, the nonce to answer), and it's sent again
with it. A Gen2 device answers a request it can't do with an error status and {"code": …, "message": …}.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import re
import secrets
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

from app.core.http import USER_AGENT

USER = "admin"  # the only user a Shelly has
TIMEOUT = 4.0  # seconds: a Shelly on the home network answers in well under one

# (url, headers, timeout) -> (status, headers with lower-case names, body). Raises OSError when nothing answers.
Get = Callable[[str, dict[str, str], float], tuple[int, dict[str, str], bytes]]


def _get(url: str, headers: dict[str, str], timeout: float) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
    except urllib.error.HTTPError as e:  # an answer all the same: a 401 says how to sign in
        try:
            return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read()
        finally:
            e.close()


class ShellyError(Exception):
    """A Shelly that couldn't be read. `refused`: it answered, but not to the password (or asked for one)."""

    def __init__(self, message: str, *, refused: bool = False):
        super().__init__(message)
        self.refused = refused


def challenge(header: str) -> tuple[str, dict[str, str]]:
    """A WWW-Authenticate header: its scheme ("digest", "basic") and its parameters."""
    scheme, _, rest = header.strip().partition(" ")
    params = {k.lower(): quoted or bare for k, quoted, bare in re.findall(r'(\w+)=(?:"([^"]*)"|([^\s,]+))', rest)}
    return scheme.lower(), params


def digest(params: dict[str, str], password: str, method: str, uri: str, cnonce: str, user: str = USER) -> str:
    """The Authorization header answering a Digest challenge (SHA-256 on a Shelly; MD5 if a challenge says nothing)."""
    algorithm = params.get("algorithm", "MD5").upper()
    hash_ = hashlib.sha256 if algorithm.startswith("SHA-256") else hashlib.md5

    def h(s: str) -> str:
        return hash_(s.encode()).hexdigest()

    realm, nonce = params.get("realm", ""), params.get("nonce", "")
    ha1, ha2 = h(f"{user}:{realm}:{password}"), h(f"{method}:{uri}")
    header = f'Digest username="{user}", realm="{realm}", nonce="{nonce}", uri="{uri}", algorithm={algorithm}'
    if "auth" in [q.strip() for q in params.get("qop", "").split(",")]:
        nc = "00000001"
        response = h(f"{ha1}:{nonce}:{nc}:{cnonce}:auth:{ha2}")
        header += f', response="{response}", qop=auth, nc={nc}, cnonce="{cnonce}"'
    else:
        header += f', response="{h(f"{ha1}:{nonce}:{ha2}")}"'
    if "opaque" in params:
        header += f', opaque="{params["opaque"]}"'
    return header


class ShellyClient:
    """One Shelly, by its address. `password` is None when none was given."""

    def __init__(self, host: str, password: str | None, get: Get = _get, timeout: float = TIMEOUT):
        self.host = host
        self.password = password
        self._get = get
        self._timeout = timeout

    def _authorization(self, header: str, path: str) -> str:
        scheme, params = challenge(header)
        if scheme == "digest":
            return digest(params, self.password or "", "GET", path, secrets.token_hex(8))
        return "Basic " + base64.b64encode(f"{USER}:{self.password}".encode()).decode()

    def request(self, path: str) -> Any:
        """GET a path ("/rpc/Shelly.GetStatus", "/status") and decode its JSON. Raises ShellyError."""
        url = f"http://{self.host}{path}"
        try:
            status, headers, body = self._get(url, {}, self._timeout)
            if status == 401:
                if not self.password:
                    raise ShellyError(f"{self.host} asks for a password.", refused=True)
                auth = self._authorization(headers.get("www-authenticate", ""), path)
                status, headers, body = self._get(url, {"Authorization": auth}, self._timeout)
                if status == 401:
                    raise ShellyError(f"{self.host} didn't accept the password.", refused=True)
        except (OSError, http.client.HTTPException) as e:
            raise ShellyError(f"{self.host} didn't answer.") from e
        try:
            answer = json.loads(body) if body else None
        except ValueError as e:
            raise ShellyError(f"{self.host} answered with something that isn't a Shelly's.") from e
        if status != 200:
            message = answer.get("message") if isinstance(answer, dict) else None
            raise ShellyError(f"{self.host} answered {status}" + (f": {message}" if message else "") + ".")
        return answer
