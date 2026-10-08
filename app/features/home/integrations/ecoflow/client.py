"""
EcoFlow's IoT Developer API (developer.ecoflow.com): an access key and secret key, made for the account in EcoFlow's
developer portal, read and control the account's devices through EcoFlow's cloud.

Every request is signed: its parameters (a GET's query; a PUT's JSON body, flattened as a.b=1 for nested objects and
a[0]=1 for lists) sorted by name and joined as k=v&k=v, then accessKey=…&nonce=…&timestamp=… appended, HMAC-SHA256
with the secret key, hex. The key, nonce, timestamp (ms) and signature go in headers. Answers are
{"code": "0", "message": "Success", "data": …}; code 8513 is a key that was refused, often one made in a different
region: keys work on their region's host only (api-e for Europe, api-a for the Americas, api for the rest), so
connecting tries each.

  GET /iot-open/sign/device/list             the account's devices: [{"sn", "deviceName", "productName", "online"}]
  GET /iot-open/sign/device/quota/all?sn=…   everything one device reports, as flat keys ("pd.soc", "powOutSumW")
  PUT /iot-open/sign/device/quota            a command (its shape depends on the device: see models.py)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.parse
from collections.abc import Callable
from typing import Any

from app.core.http import request_json
from app.features.home.types import IntegrationError

HOSTS = ("api.ecoflow.com", "api-e.ecoflow.com", "api-a.ecoflow.com")
KEY_REFUSED = "8513"
TIMEOUT = 20
UNREACHABLE = "EcoFlow couldn't be reached. Check the server's internet connection; it'll try again shortly."

# (method, url, headers, body, timeout) -> the decoded JSON answer. Raises as urllib does.
Transport = Callable[[str, str, dict[str, str], bytes | None, float], Any]


def _transport(method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Any:
    return request_json(method, url, body, headers, timeout)


def _text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def flatten(value: Any, prefix: str = "") -> list[tuple[str, str]]:
    """A body's fields as signed: nested objects as a.b, lists as a[0]."""
    if isinstance(value, dict):
        return [p for k, v in value.items() for p in flatten(v, f"{prefix}.{k}" if prefix else str(k))]
    if isinstance(value, list):
        return [p for n, v in enumerate(value) for p in flatten(v, f"{prefix}[{n}]")]
    return [(prefix, _text(value))]


def signature(fields: list[tuple[str, str]], access_key: str, secret_key: str, nonce: str, timestamp: str) -> str:
    signed = "&".join(f"{k}={v}" for k, v in sorted(fields)) if fields else ""
    auth = f"accessKey={access_key}&nonce={nonce}&timestamp={timestamp}"
    message = f"{signed}&{auth}" if signed else auth
    return hmac.new(secret_key.encode(), message.encode(), hashlib.sha256).hexdigest()


class EcoFlowClient:
    def __init__(
        self,
        access_key: str,
        secret_key: str,
        host: str = HOSTS[0],
        transport: Transport = _transport,
        clock: Callable[[], float] = time.time,
    ):
        self.access_key = access_key.strip()
        self.secret_key = secret_key.strip()
        self.host = host
        self.transport = transport
        self.clock = clock

    def _headers(self, fields: list[tuple[str, str]]) -> dict[str, str]:
        nonce = str(100_000 + secrets.randbelow(900_000))
        timestamp = str(int(self.clock() * 1000))
        return {
            "accessKey": self.access_key,
            "nonce": nonce,
            "timestamp": timestamp,
            "sign": signature(fields, self.access_key, self.secret_key, nonce, timestamp),
        }

    def _send(self, method: str, path: str, query: dict[str, str] | None = None, body: Any = None) -> Any:
        fields = sorted((query or {}).items()) if body is None else flatten(body)
        url = f"https://{self.host}/iot-open/sign{path}"
        if query:
            url += "?" + urllib.parse.urlencode(sorted(query.items()))
        headers = self._headers(fields)
        data = None
        if body is not None:
            data = json.dumps(body, separators=(",", ":")).encode()
            headers["Content-Type"] = "application/json;charset=UTF-8"
        try:
            answer = self.transport(method, url, headers, data, TIMEOUT)
        except urllib.error.HTTPError as e:
            raise IntegrationError(f"EcoFlow answered with an error ({e.code}). It'll try again shortly.") from e
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise IntegrationError(UNREACHABLE) from e
        if not isinstance(answer, dict):
            raise IntegrationError("EcoFlow answered with something unexpected. It'll try again shortly.")
        code = str(answer.get("code", ""))
        if code == KEY_REFUSED:
            raise IntegrationError(
                "EcoFlow didn't accept that access key and secret key. Check them in EcoFlow's developer portal "
                "(Profile → Developer → Access key).",
                signed_out=True,
            )
        if code != "0":
            raise IntegrationError(f"EcoFlow refused: {answer.get('message') or 'code ' + code}.")
        return answer.get("data")

    def devices(self) -> list[dict[str, Any]]:
        data = self._send("GET", "/device/list")
        return [d for d in data or [] if isinstance(d, dict) and d.get("sn")]

    def quota(self, sn: str) -> dict[str, Any]:
        data = self._send("GET", "/device/quota/all", {"sn": sn})
        return data if isinstance(data, dict) else {}

    def command(self, body: dict[str, Any]) -> None:
        self._send("PUT", "/device/quota", body=body)


def find_host(access_key: str, secret_key: str, transport: Transport = _transport) -> tuple[str, list[dict[str, Any]]]:
    """The host the keys work on (they're made for one region), and the account's devices. Raises IntegrationError."""
    refused: IntegrationError | None = None
    for host in HOSTS:
        try:
            return host, EcoFlowClient(access_key, secret_key, host, transport).devices()
        except IntegrationError as e:
            if not e.signed_out:
                raise
            refused = e
    assert refused is not None
    raise refused
