"""
A Growatt string inverter read from Growatt's cloud, signed in with the owner's ShinePhone username and password, as a
second, AC-coupled solar system. Decoded by the API's driver of the same id (app/features/inverters/growatt/cloud.py).

Growatt's Wi-Fi sticks (ShineWiFi) only send their readings to Growatt's servers, so without an RS485 adapter (see
inverter.py) the cloud is the only way to them. This uses the ShinePhone app's API, as Home Assistant's Growatt
integration does (by way of the MIT-licensed growattServer library):

    POST newTwoLoginAPI.do                                     userName, password (hashed: see hash_password)
                                                               -> {"back": {"success": true, "user": {"id": 123}}}
    GET  PlantListAPI.do?userId=<id>                           -> {"back": {"data": [{"plantId", "plantName"}]}}
    GET  newTwoPlantAPI.do?op=getAllDeviceList&plantId=<id>    -> {"deviceList": [{"deviceSn", "deviceType"}]}
    GET  newInverterAPI.do?op=getInverterDetailData&inverterId=<sn>   an older inverter ("inverter"): its figures
    GET  newTlxApi.do?op=getTlxDetailData&id=<sn>              a newer one ("tlx", MIN/MIC): {"data": {...}}

The stick sends a reading every 5 minutes, so the cloud is asked at most that often; polls in between store the last
answer again, with when it was fetched (`fetched_at`) so the API can tell a fresh reading from a stale one. Like
Fronius' Solar API, a reading is the figures Growatt reported, by name and as reported (strings or numbers, no
scaling), keeping only those the dashboard reads.

The device's settings hold the sign-in: `username`, `password_hash` (never the password itself) and optionally `serial`
(which inverter, when the account has more than one). Its host is the Growatt server for the owner's region.
"""

from __future__ import annotations

import hashlib
import http.cookiejar
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from typing import Any

from collector.devices import RawReading, Values

PORT = 443
EVERY = 300  # seconds between asks: the stick reports every 5 minutes, and Growatt bans clients that ask much more
AGENT = "Dalvik/2.1.0 (Linux; U; Android 12; WattsMyPower)"
# Growatt's ShinePhone servers, by region. Only these are ever asked: a device's host must be one of them.
SERVERS = {
    "openapi-au.growatt.com": "Australia and New Zealand",
    "openapi.growatt.com": "Other regions",
    "openapi-us.growatt.com": "North America",
    "openapi-cn.growatt.com": "China",
}
STRING_TYPES = ("inverter", "tlx")  # the device types that are string inverters (not storage, mix or sph hybrids)
# The figures kept from an inverter's details: its output and strings, energy, grid, temperatures, state, the time it
# last reported, and what it is. An older inverter and a newer (tlx) one name some of them differently.
KEEP = frozenset(
    {
        "pac", "ppv", "powerToday", "powerTotal", "eacToday", "eacTotal", "epvToday", "epvTotal",
        "vpv1", "ipv1", "ppv1", "vpv2", "ipv2", "ppv2", "vpv3", "ipv3", "ppv3", "vpv4", "ipv4", "ppv4",
        "fac", "vacr", "vacrs", "temperature", "ipmTemperature", "temp1", "status", "lastUpdateTime", "time",
        "nominalPower", "deviceModel", "modelText", "fwVersion", "serialNum",
    }
)  # fmt: skip


class SignInFailed(ConnectionError):
    """Growatt refused the username and password."""


def hash_password(password: str) -> str:
    """The password as Growatt's sign-in takes it: its MD5 in hex, with every "0" at an even position made a "c"."""
    md5 = hashlib.md5(password.encode("utf-8")).hexdigest()  # Growatt's scheme, not a password store
    return "".join("c" if c == "0" and i % 2 == 0 else c for i, c in enumerate(md5))


class CloudDevice:
    name = "pv2"
    driver = "growatt.cloud"

    def __init__(self, host: str, settings: Mapping[str, Any], timeout: float = 15, every: float = EVERY):
        self.host, self.timeout, self.every = host, timeout, every
        self.username = str(settings.get("username") or "")
        self.password_hash = str(settings.get("password_hash") or "")
        self.serial = str(settings.get("serial") or "") or None
        self._opener: urllib.request.OpenerDirector | None = None
        self._device: tuple[str, str] | None = None  # (serial, type) once found
        self._last: Values | None = None
        self._failed_at = (
            0.0  # when the last fetch failed: not tried again for EVERY seconds, so Growatt isn't pestered
        )
        self._lock = threading.Lock()

    # -- talking to Growatt ---------------------------------------------------------------------------------------
    def _url(self, page: str, query: Mapping[str, Any] | None = None) -> str:
        if self.host not in SERVERS:
            raise ConnectionError(f"{self.host} isn't one of Growatt's servers")
        return f"https://{self.host}/{page}" + (f"?{urllib.parse.urlencode(query)}" if query else "")

    def _json(self, url: str, form: Mapping[str, str] | None = None) -> Any:
        assert self._opener is not None
        data = urllib.parse.urlencode(form).encode() if form is not None else None
        req = urllib.request.Request(url, data=data, headers={"User-Agent": AGENT})
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                body = resp.read()
        except urllib.error.HTTPError as e:
            raise ConnectionError(f"Growatt answered {e.code}") from e
        except (urllib.error.URLError, OSError) as e:
            raise ConnectionError(f"Couldn't reach {self.host}: {e}") from e
        try:
            return json.loads(body)
        except ValueError as e:  # an HTML page: signed out, or the server's busy
            raise ConnectionError("Growatt sent something that isn't a reading") from e

    def _sign_in(self) -> str:
        """Sign in (with a fresh session) and return the account's user id."""
        if not self.username or not self.password_hash:
            raise SignInFailed("No Growatt username and password set")
        self._opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        back = (
            self._json(self._url("newTwoLoginAPI.do"), {"userName": self.username, "password": self.password_hash})
            or {}
        ).get("back") or {}
        if not back.get("success"):
            raise SignInFailed(f"Growatt didn't accept the sign-in ({back.get('msg') or 'no reason given'})")
        user = back.get("user") or {}
        if user.get("id") is None:
            raise ConnectionError("Growatt signed in but sent no account")
        return str(user["id"])

    def _find(self, user_id: str) -> tuple[str, str]:
        """(serial, type) of the account's string inverter: the one asked for, else the first."""
        plants = ((self._json(self._url("PlantListAPI.do", {"userId": user_id})) or {}).get("back") or {}).get("data")
        for plant in plants or []:
            pid = plant.get("plantId")
            if pid is None:
                continue
            listed = self._json(
                self._url("newTwoPlantAPI.do", {"op": "getAllDeviceList", "plantId": pid, "language": 1})
            )
            for d in (listed or {}).get("deviceList") or []:
                sn, kind = str(d.get("deviceSn") or ""), str(d.get("deviceType") or "")
                if sn and kind in STRING_TYPES and (self.serial is None or sn == self.serial):
                    return sn, kind
        raise ConnectionError(
            f"No Growatt inverter {self.serial} in this account"
            if self.serial
            else "No Growatt inverter in this account"
        )

    def _fetch(self) -> Values:
        """Sign in when needed, find the inverter, and read its details. Signs in again once if the session lapsed."""
        for attempt in (0, 1):
            if self._opener is None or self._device is None or attempt:
                self._device = self._find(self._sign_in())
            sn, kind = self._device
            try:
                if kind == "tlx":
                    got = (self._json(self._url("newTlxApi.do", {"op": "getTlxDetailData", "id": sn})) or {}).get(
                        "data"
                    )
                else:
                    got = self._json(self._url("newInverterAPI.do", {"op": "getInverterDetailData", "inverterId": sn}))
            except SignInFailed:
                raise
            except ConnectionError:
                if attempt:
                    raise
                continue  # signed out (Growatt sends its sign-in page): sign in again and ask once more
            if isinstance(got, dict) and got:
                values: Values = {k: v for k, v in got.items() if k in KEEP and v is not None and v != ""}
                return {**values, "sn": sn, "type": kind, "fetched_at": int(time.time())}
        raise ConnectionError("Growatt sent no figures for the inverter")

    # -- the collector's side ---------------------------------------------------------------------------------------
    def probe(self) -> Values | None:
        """A reading, if the sign-in works and the account has a string inverter; else None."""
        try:
            with self._lock:
                return self._fetch()
        except ConnectionError:
            return None

    def read(self, include_info: bool) -> RawReading:
        """The inverter's figures: fetched when the last fetch is EVERY seconds old, else the last ones again."""
        with self._lock:
            now = time.time()
            if self._last is None or now - int(self._last["fetched_at"]) >= self.every:
                if now - self._failed_at < self.every:
                    raise ConnectionError("Waiting a few minutes before asking Growatt again")
                try:
                    self._last = self._fetch()
                except ConnectionError:
                    self._failed_at, self._last, self._device = now, None, None
                    raise
            return RawReading(input=dict(self._last))
