"""
The ConnectLife cloud, which Hisense (and Gorenje and ASKO) appliances report to through the ConnectLife app. It has
no public API: this follows what the app does, as worked out by the open-source projects that read it (the
`connectlife` Python library and its Home Assistant integration, github.com/oyvindwe). The protocol is described
here and written for this dashboard, not copied from them.

Signing in (with the email and password of a ConnectLife account; one made with Google or Apple sign-in has none):

  1. Gigya (SAP's account service) accounts.login, with the email, password and the app's Gigya key: the account's
     UID and a login token. Gigya answers 200 even when it refuses, with an errorCode.
  2. accounts.getJWT with the login token: an id token.
  3. HijuConn's OAuth authorize, with the id token and UID (JSON): an authorisation code.
  4. Its token endpoint, exchanging the code: an access token (expires_in, seconds), and a refresh token
     (refreshTokenExpiredTime, ms since the epoch). Refreshing goes to the same endpoint; when that fails, sign in
     again from step 1.

Reading the appliances: GET /clife-svc/pu/get_device_status_list on the gateway, which answers for every appliance
on the account at once. Every gateway request carries the access token and the app's ids, a fresh random string and
the time, and a signature: the fields sorted and joined as k=v&k=v, with a fixed suffix, SHA-256, encrypted to the
gateway's RSA key (PKCS#1 v1.5), base64. The answer is {"response": {"resultCode": 0, …}}; errorCode 100026 means the
access token was refused (sign in again and retry once), 101005 that the random string was (retry once).

Nothing here is documented by Hisense, so it can change without notice. The Home Assistant integration polls every
60 seconds to stay clear of any limit, and so does this.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import secrets
import time
import urllib.error
import urllib.parse
from collections.abc import Callable
from typing import Any

from Cryptodome.Cipher import PKCS1_v1_5
from Cryptodome.PublicKey import RSA

from app.core.http import request_json
from app.features.home.types import IntegrationError

GIGYA_KEY = "4_yhTWQmHFpZkQZDSV1uV-_A"
GIGYA_LOGIN = "https://accounts.eu1.gigya.com/accounts.login"
GIGYA_JWT = "https://accounts.eu1.gigya.com/accounts.getJWT"
OAUTH_AUTHORIZE = "https://oauth.hijuconn.com/oauth/authorize"
OAUTH_TOKEN = "https://oauth.hijuconn.com/oauth/token"
CLIENT_ID = "5065059336212"
CLIENT_SECRET = "07swfKgvJhC3ydOUS9YV_SwVz0i4LKqlOLGNUukYHVMsJRF1b-iWeUGcNlXyYCeK"
REDIRECT_URI = "https://api.connectlife.io/swagger/oauth2-redirect.html"  # registered with the client; never visited

GATEWAY = "https://clife-eu-gateway.hijuconn.com"
DEVICE_LIST = f"{GATEWAY}/clife-svc/pu/get_device_status_list"
APP_ID = "47110565134383"
APP_SECRET = "yOzhz6junYno-nmULM3Wr7PU_dpSZN22ZdluvVWZ4uW5ZwwG8fIGCHTbrhcnU-iv"
SIGN_SUFFIX = "D9519A4B756946F081B7BB5B5E8D1197"
GATEWAY_KEY = RSA.import_key(
    "-----BEGIN PUBLIC KEY-----\n"
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyyWrNG6q475HIHu7sMVu\n"
    "vHof6vlgPeixmxa4EL/UsvVvHPz33NnWoQetQqit9TBNzUjMXw0KlY9PXM4iqHUU\n"
    "U+dSyNDq1jZWIiJ2C2FccppswJtIKL3NRMFvT9PFh6NlP/4FUcQKojgKFbF7Kacc\n"
    "JPKYHlwaO7qgoIjLxAHlSOXGpucJcOkPzT2EqsSVnW8sn8kenvNmghXDayhgxsh6\n"
    "AyxK4kehJplEnmX/iYCfNoFXknGcLqFWYccgBz3fybvx30C/0IgU1980L8QsUAv5\n"
    "esZmN8ugnbRgLRxKRlkQQLxQAiZMZdKTAx665YflT3YMHJvEFE8c2XFgoxHzSMc4\n"
    "BwIDAQAB\n"
    "-----END PUBLIC KEY-----\n"
)
TOKEN_REFUSED = 100026
RANDSTR_REFUSED = 101005
RENEW_EARLY = 90  # seconds before the access token expires to renew it
TIMEOUT = 30

# (method, url, headers, body, timeout) -> the decoded JSON answer. Raises as urllib does.
Transport = Callable[[str, str, dict[str, str], bytes | None, float], Any]

UNREACHABLE = "ConnectLife couldn't be reached. Check the server's internet connection; it'll try again shortly."


def _transport(method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Any:
    return request_json(method, url, body, headers, timeout)


def sign(fields: dict[str, Any]) -> str:
    """The gateway's signature over a request's fields (see the module docstring)."""
    parts = []
    for k in sorted(k for k in fields if k != "sign"):
        v = fields[k]
        parts.append(f"{k}={json.dumps(v, separators=(',', ':')) if isinstance(v, dict | list) else v}")
    digest = hashlib.sha256(("&".join(parts) + SIGN_SUFFIX).encode()).digest()
    return base64.b64encode(PKCS1_v1_5.new(GATEWAY_KEY).encrypt(digest)).decode()


def _gigya_error(body: dict[str, Any]) -> IntegrationError:
    """What a refusal from Gigya means, in words."""
    code = body.get("errorCode")
    if code == 403042:
        return IntegrationError(
            "ConnectLife didn't accept that email and password. If you sign in to the ConnectLife app with Google or "
            "Apple, set a password first with “Forgot password” in the app.",
            signed_out=True,
        )
    if code == 206001:
        return IntegrationError(
            "ConnectLife needs you to accept its updated terms first. Open the ConnectLife app, accept them, then sign "
            "in again here.",
            signed_out=True,
        )
    if code == 403048:
        return IntegrationError(
            "ConnectLife is limiting sign-ins for now. It'll try again in 15 minutes.", retry_after=900
        )
    if code == 403120:
        return IntegrationError(
            "ConnectLife has locked the account for a while after too many sign-ins. It'll try again in 30 minutes.",
            retry_after=1800,
        )
    detail = body.get("errorDetails") or body.get("errorMessage") or "no reason given"
    return IntegrationError(f"ConnectLife refused the sign-in ({code}: {detail}).", signed_out=True)


def _expiry_ms(v: Any) -> float | None:
    """refreshTokenExpiredTime, as unix seconds: ms since the epoch, or an ISO time."""
    if isinstance(v, int | float) or (isinstance(v, str) and v.isdigit()):
        return float(v) / 1000
    if isinstance(v, str):
        try:
            return dt.datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


class ConnectLifeClient:
    """One account. `tokens` (access and refresh tokens, and when they expire) are kept between polls, so it only signs
    in with the password when there's no other way."""

    def __init__(
        self,
        email: str,
        password: str,
        tokens: dict[str, Any] | None = None,
        transport: Transport = _transport,
        clock: Callable[[], float] = time.time,
    ):
        self.email = email
        self.password = password
        self.tokens: dict[str, Any] = dict(tokens or {})
        self._transport = transport
        self._clock = clock

    # -- HTTP --------------------------------------------------------------------
    def _send(self, method: str, url: str, *, form: dict[str, str] | None = None, body: Any = None) -> Any:
        headers: dict[str, str] = {}
        data: bytes | None = None
        if form is not None:
            data, headers["Content-Type"] = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
        elif body is not None:
            data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
        try:
            return self._transport(method, url, headers, data, TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and url == OAUTH_TOKEN:
                raise IntegrationError("ConnectLife refused the sign-in. Sign in again.", signed_out=True) from e
            if e.code == 429:
                raise IntegrationError("ConnectLife is limiting requests for now.", retry_after=900) from e
            raise IntegrationError(f"ConnectLife had a problem ({e.code}). It'll try again shortly.") from e
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            raise IntegrationError(UNREACHABLE) from e

    # -- signing in ----------------------------------------------------------------
    def sign_in(self) -> None:
        """Sign in from the start, with the email and password."""
        login = self._send(
            "POST", GIGYA_LOGIN, form={"loginID": self.email, "password": self.password, "APIKey": GIGYA_KEY}
        )
        if not isinstance(login, dict):
            raise IntegrationError("ConnectLife answered the sign-in strangely. It'll try again shortly.")
        if login.get("errorCode") or login.get("errorMessage"):
            raise _gigya_error(login)
        uid, cookie = login.get("UID"), (login.get("sessionInfo") or {}).get("cookieValue")
        jwt = self._send("POST", GIGYA_JWT, form={"APIKey": GIGYA_KEY, "login_token": str(cookie)})
        if not uid or not cookie or not isinstance(jwt, dict) or not jwt.get("id_token"):
            raise IntegrationError("ConnectLife's sign-in didn't give what it should. It'll try again shortly.")
        code = self._send(
            "POST",
            OAUTH_AUTHORIZE,
            body={"client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "idToken": jwt["id_token"],
                  "response_type": "code", "thirdType": "CDC", "thirdClientId": uid},
        )  # fmt: skip
        if not isinstance(code, dict) or not code.get("code"):
            raise IntegrationError("ConnectLife didn't authorise the sign-in. It'll try again shortly.")
        self._token({"grant_type": "authorization_code", "code": str(code["code"])})

    def _token(self, grant: dict[str, str]) -> None:
        body = self._send(
            "POST",
            OAUTH_TOKEN,
            form={"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "redirect_uri": REDIRECT_URI, **grant},
        )
        if not isinstance(body, dict) or not body.get("access_token"):
            raise IntegrationError("ConnectLife didn't give an access token. Sign in again.", signed_out=True)
        now = self._clock()
        self.tokens = {
            "access_token": body["access_token"],
            "expires_at": now + float(body.get("expires_in") or 3600),
            "refresh_token": body.get("refresh_token") or self.tokens.get("refresh_token"),
            "refresh_expires_at": _expiry_ms(body.get("refreshTokenExpiredTime"))
            or self.tokens.get("refresh_expires_at"),
        }

    def _ready(self) -> str:
        """A current access token: the one kept, refreshed, or from signing in again."""
        now = self._clock()
        if self.tokens.get("access_token") and now < (self.tokens.get("expires_at") or 0) - RENEW_EARLY:
            return str(self.tokens["access_token"])
        refresh, until = self.tokens.get("refresh_token"), self.tokens.get("refresh_expires_at")
        if refresh and (until is None or now < until):
            try:
                self._token({"grant_type": "refresh_token", "refresh_token": str(refresh)})
                return str(self.tokens["access_token"])
            except IntegrationError as e:
                if e.retry_after:
                    raise
        self.sign_in()
        return str(self.tokens["access_token"])

    # -- the gateway ---------------------------------------------------------------
    def _gateway(self, url: str, payload: dict[str, Any] | None = None, *, again: bool = True) -> dict[str, Any]:
        fields: dict[str, Any] = {
            "accessToken": self._ready(),
            "appId": APP_ID,
            "appSecret": APP_SECRET,
            "languageId": "12",
            "randStr": secrets.token_hex(16),
            "timeStamp": str(int(self._clock() * 1000)),
            "timezone": "1.0",
            "version": "5.0",
            **(payload or {}),
        }
        fields["sign"] = sign(fields)
        body = self._send("GET", f"{url}?{urllib.parse.urlencode(fields)}")
        answer = body.get("response") if isinstance(body, dict) else None
        if not isinstance(answer, dict):
            raise IntegrationError("ConnectLife answered strangely. It'll try again shortly.")
        if answer.get("resultCode") in (0, "0", None):
            return answer
        code = answer.get("errorCode")
        if again and code == TOKEN_REFUSED:
            self.tokens = {}
            return self._gateway(url, payload, again=False)
        if again and code == RANDSTR_REFUSED:
            return self._gateway(url, payload, again=False)
        raise IntegrationError(f"ConnectLife couldn't answer ({code}: {answer.get('errorDesc') or 'no reason given'}).")

    def appliances(self) -> list[dict[str, Any]]:
        """Every appliance on the account, with its properties now (statusList)."""
        devices = self._gateway(DEVICE_LIST).get("deviceList")
        return [d for d in devices if isinstance(d, dict)] if isinstance(devices, list) else []
