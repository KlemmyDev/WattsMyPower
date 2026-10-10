"""
Electrolux Group's Developer API (developer.electrolux.one): the official way in to Electrolux, AEG, Frigidaire and
+home (Westinghouse) appliances. They report only to Electrolux's cloud and there's no way to reach them on the home
network, so this is a cloud integration by necessity.

The household makes an API key in the portal's dashboard and, with GET ACCESS TOKEN, an access token and a refresh
token for the account their appliances are in. Every request carries the key (x-api-key) and the access token
(Authorization: Bearer). The paths, headers and bodies here are as the portal's OpenAPI and Electrolux's own
Apache-2.0 SDK (github.com/electrolux-oss/electrolux-group-developer-sdk) use them:

  POST /api/v1/token/refresh               {"refreshToken"} -> {"accessToken", "expiresIn", "refreshToken", …}
  GET  /api/v1/appliances                  [{"applianceId", "applianceName", "applianceType", "created"}]
  GET  /api/v1/appliances/{id}/info        {"applianceInfo": {"brand", "model", "pnc", "deviceType", …},
                                            "capabilities": {…}}
  GET  /api/v1/appliances/{id}/state       {"applianceId", "connectionState", "status",
                                            "properties": {"reported": {…}}}
  PUT  /api/v1/appliances/{id}/command     (not used: this integration only reads)

An access token lasts about 12 hours. It's renewed when it has less than a minute left (by the `exp` in the token
itself, read without checking its signature: only Electrolux needs to trust it), or when a request is refused with
401. **Every refresh hands back a new refresh token and the old one stops working**, so the pair is kept as soon as
it arrives (`tokens`, saved by the integration even if the rest of the poll then fails). Whether refreshing needs the
API key isn't documented; it's sent anyway.

The free tier allows 10 requests a second, 5 at once and 5,000 a day, and answers 429 past that. Requests here go
one at a time; how often they're made is up to the integration (see __init__.py).
"""

from __future__ import annotations

import base64
import binascii
import json
import time
import urllib.error
import urllib.parse
from collections.abc import Callable
from typing import Any

from app.core.http import request_json
from app.features.home.types import IntegrationError

BASE = "https://api.developer.electrolux.one"
REFRESH = "/api/v1/token/refresh"
APPLIANCES = "/api/v1/appliances"
RENEW_EARLY = 60  # seconds before the access token expires to renew it, as Electrolux's SDK does
RATE_LIMITED_WAIT = 600  # seconds to wait after a 429 that doesn't say how long
TIMEOUT = 20

# (method, url, headers, body, timeout) -> the decoded JSON answer. Raises as urllib does.
Transport = Callable[[str, str, dict[str, str], bytes | None, float], Any]

UNREACHABLE = "Electrolux couldn't be reached. Check the server's internet connection; it'll try again shortly."
NEW_TOKENS = (
    "Get new tokens at developer.electrolux.one (Dashboard → GET ACCESS TOKEN) and sign in again here with them."
)


def _transport(method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Any:
    return request_json(method, url, body, headers, timeout)


def token_expiry(token: str) -> float | None:
    """When an access token expires (unix seconds), from the `exp` in its payload, or None if it doesn't say (not a
    JWT, or one without an expiry). Its signature isn't checked: Electrolux does that."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        exp = claims["exp"]
    except (IndexError, KeyError, TypeError, ValueError, binascii.Error):
        return None
    return float(exp) if isinstance(exp, int | float) and not isinstance(exp, bool) else None


def _retry_after(e: urllib.error.HTTPError) -> int:
    """How long a 429 says to wait, else RATE_LIMITED_WAIT."""
    try:
        return max(1, int(str(e.headers.get("Retry-After") or "") if e.headers is not None else ""))
    except ValueError:
        return RATE_LIMITED_WAIT


class ElectroluxClient:
    """One account: its API key, and its tokens (access_token, refresh_token, and when the access token expires,
    expires_at), which change as they're refreshed. Keep `tokens` after using it."""

    def __init__(
        self,
        api_key: str,
        tokens: dict[str, Any],
        transport: Transport = _transport,
        clock: Callable[[], float] = time.time,
    ):
        self.api_key = api_key.strip()
        self.tokens: dict[str, Any] = dict(tokens)
        self._transport = transport
        self._clock = clock

    # -- tokens ----------------------------------------------------------------------
    def refresh(self) -> None:
        """Swap the refresh token for a new access token and a new refresh token (the old one stops working)."""
        refresh = str(self.tokens.get("refresh_token") or "")
        if not refresh:
            raise IntegrationError(f"There's no refresh token for Electrolux. {NEW_TOKENS}", signed_out=True)
        body = json.dumps({"refreshToken": refresh}).encode()
        headers = {"x-api-key": self.api_key, "Content-Type": "application/json"}
        try:
            answer = self._transport("POST", BASE + REFRESH, headers, body, TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise IntegrationError(
                    "Electrolux is limiting requests for now. It'll try again later.", retry_after=_retry_after(e)
                ) from e
            if e.code in (400, 401, 403):
                raise IntegrationError(
                    f"Electrolux didn't accept the refresh token (it may have been used already, or the API key "
                    f"changed). {NEW_TOKENS}",
                    signed_out=True,
                ) from e
            raise IntegrationError(f"Electrolux had a problem ({e.code}). It'll try again shortly.") from e
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise IntegrationError(UNREACHABLE) from e
        if not isinstance(answer, dict) or not answer.get("accessToken"):
            raise IntegrationError("Electrolux answered the token refresh strangely. It'll try again shortly.")
        access = str(answer["accessToken"])
        expires_in = answer.get("expiresIn")
        expires_at = token_expiry(access)
        if expires_at is None and isinstance(expires_in, int | float):
            expires_at = self._clock() + float(expires_in)
        self.tokens = {
            "access_token": access,
            "refresh_token": str(answer.get("refreshToken") or refresh),
            "expires_at": expires_at,
        }

    def _access(self) -> str:
        """A current access token: the one kept, or a refreshed one when it's (nearly) expired or there's none."""
        token = str(self.tokens.get("access_token") or "")
        expires_at = self.tokens.get("expires_at")
        if expires_at is None and token:
            expires_at = token_expiry(token)
        if token and (expires_at is None or self._clock() < float(expires_at) - RENEW_EARLY):
            return token
        self.refresh()
        return str(self.tokens["access_token"])

    # -- requests --------------------------------------------------------------------
    def _get(self, path: str, *, again: bool = True) -> Any:
        headers = {"x-api-key": self.api_key, "Authorization": f"Bearer {self._access()}"}
        try:
            return self._transport("GET", BASE + path, headers, None, TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code == 401 and again:  # expired early, or revoked: refresh once and ask again
                self.refresh()
                return self._get(path, again=False)
            if e.code == 401:
                raise IntegrationError(
                    f"Electrolux didn't accept the API key and access token. Check the API key; if it's right, "
                    f"{NEW_TOKENS[0].lower()}{NEW_TOKENS[1:]}",
                    signed_out=True,
                ) from e
            if e.code == 403 and path == APPLIANCES:  # the account's own list: the key itself was refused
                raise IntegrationError(
                    "Electrolux didn't accept the API key. Check it at developer.electrolux.one (Dashboard), then "
                    "sign in again here.",
                    signed_out=True,
                ) from e
            if e.code == 429:
                raise IntegrationError(
                    "Electrolux is limiting requests for now (its free tier allows 5,000 a day). It'll try again "
                    "later.",
                    retry_after=_retry_after(e),
                ) from e
            if e.code in (403, 404):
                raise IntegrationError("Electrolux doesn't have that appliance on the account any more.") from e
            raise IntegrationError(f"Electrolux had a problem ({e.code}). It'll try again shortly.") from e
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise IntegrationError(UNREACHABLE) from e

    @staticmethod
    def _path(appliance_id: str, what: str) -> str:
        return f"{APPLIANCES}/{urllib.parse.quote(appliance_id, safe=':')}/{what}"

    def appliances(self) -> list[dict[str, Any]]:
        """Every appliance on the account: [{"applianceId", "applianceName", "applianceType", "created"}]."""
        answer = self._get(APPLIANCES)
        if not isinstance(answer, list):
            raise IntegrationError("Electrolux answered with something unexpected. It'll try again shortly.")
        return [a for a in answer if isinstance(a, dict) and a.get("applianceId")]

    def info(self, appliance_id: str) -> dict[str, Any]:
        """What an appliance is: {"applianceInfo": {"brand", "model", "pnc", …}, "capabilities": {…}}."""
        answer = self._get(self._path(appliance_id, "info"))
        return answer if isinstance(answer, dict) else {}

    def state(self, appliance_id: str) -> dict[str, Any]:
        """What an appliance is doing: {"connectionState", "status", "properties": {"reported": {…}}}."""
        answer = self._get(self._path(appliance_id, "state"))
        return answer if isinstance(answer, dict) else {}
