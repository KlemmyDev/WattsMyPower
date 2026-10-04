"""Browser notifications (Web Push): the encryption against RFC 8291's example, the VAPID signature, keeping
subscriptions, and alerts reaching browsers. Every push goes to a fake that decrypts it as a browser would."""

from __future__ import annotations

import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from email.message import Message as Headers
from typing import Any

import pytest
from Cryptodome.Cipher import AES
from Cryptodome.Hash import SHA256
from Cryptodome.Protocol.DH import key_agreement
from Cryptodome.Protocol.KDF import HKDF
from Cryptodome.PublicKey import ECC
from Cryptodome.Signature import DSS
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.alerts.channels import DeliveryError, Message
from app.features.alerts.service import AlertsService
from app.features.alerts.webpush import MAX_PAYLOAD, PushService, Vapid, b64, encrypt, payload, unb64
from app.main import create_app
from tests.test_alerts import facts, make_service

T0 = time.mktime((2026, 10, 2, 11, 0, 0, 0, 0, -1))
ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("a test tried to reach the network")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)


class Browser:
    """A browser's side of a subscription: its keys, and decrypting what arrives."""

    def __init__(self, endpoint: str = ENDPOINT):
        self.endpoint = endpoint
        self.key = ECC.generate(curve="P-256")
        self.auth = b"0123456789abcdef"

    def subscription(self) -> dict[str, Any]:
        public = self.key.public_key().export_key(format="raw")
        return {"endpoint": self.endpoint, "keys": {"p256dh": b64(public), "auth": b64(self.auth)}}

    def decrypt(self, body: bytes) -> dict[str, Any]:
        salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
        as_public, data = body[21 : 21 + idlen], body[21 + idlen :]
        assert rs == 4096 and len(data) <= rs
        ua_public = self.key.public_key().export_key(format="raw")
        ecdh = key_agreement(
            static_priv=self.key, static_pub=ECC.import_key(as_public, curve_name="P-256"), kdf=lambda z: z
        )
        ikm = HKDF(ecdh, 32, self.auth, SHA256, context=b"WebPush: info\x00" + ua_public + as_public)
        cek = HKDF(ikm, 16, salt, SHA256, context=b"Content-Encoding: aes128gcm\x00")
        nonce = HKDF(ikm, 12, salt, SHA256, context=b"Content-Encoding: nonce\x00")
        plain = AES.new(cek, AES.MODE_GCM, nonce=nonce).decrypt_and_verify(data[:-16], data[-16:])
        assert plain.endswith(b"\x02")
        return json.loads(plain[:-1])


class FakePush:
    """Stands in for app.core.http.post at the push services: decrypts with the browser's keys, and fails on cue."""

    def __init__(self) -> None:
        self.browsers: dict[str, Browser] = {}
        self.sent: list[dict[str, Any]] = []
        self.fail: dict[str, Exception] = {}  # endpoint -> what to raise

    def __call__(self, url: str, body: bytes, content_type: str, headers: dict[str, str]) -> int:
        if url in self.fail:
            raise self.fail[url]
        if url not in self.browsers:  # another channel (ntfy): not under test here
            self.sent.append({"url": url, "headers": headers})
            return 200
        assert content_type == "application/octet-stream" and headers["Content-Encoding"] == "aes128gcm"
        self.sent.append({"url": url, "headers": headers, "data": self.browsers[url].decrypt(body)})
        return 201

    def add(self, browser: Browser) -> Browser:
        self.browsers[browser.endpoint] = browser
        return browser


def gone(url: str, code: int = 410) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(url, code, "gone", Headers(), io.BytesIO(b""))


@pytest.fixture
def push() -> FakePush:
    return FakePush()


@pytest.fixture
def alerts(db: Database, config: Config, push: FakePush) -> AlertsService:
    return make_service(db, config, push)  # type: ignore[arg-type]


def test_encryption_matches_the_rfc_example() -> None:
    """RFC 8291 §5 and Appendix A: the same keys and salt give the same message, byte for byte."""
    as_key = ECC.construct(curve="P-256", d=int.from_bytes(unb64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"))
    out = encrypt(
        b"When I grow up, I want to be a watermelon",
        unb64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
        unb64("BTBZMqHH6r4Tts7J_aSIgg"),
        salt=unb64("DGv6ra1nlYgDCS1FRnbzlw"),
        as_key=as_key,
    )
    assert b64(out) == (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
        "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
        "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    )


def test_the_vapid_header_is_a_signed_jwt_for_the_push_service() -> None:
    keys = Vapid.generate()
    header = keys.authorization(ENDPOINT, T0)
    assert header.startswith("vapid t=") and header.endswith(f", k={keys.public}")
    token = header.removeprefix("vapid t=").split(",")[0]
    head, claims, signature = token.split(".")
    assert json.loads(unb64(head)) == {"typ": "JWT", "alg": "ES256"}
    assert json.loads(unb64(claims)) == {
        "aud": "https://fcm.googleapis.com",
        "exp": int(T0) + 12 * 3600,
        "sub": "https://github.com/KlemmyDev/WattsMyPower",
    }
    public = ECC.import_key(unb64(keys.public), curve_name="P-256")
    DSS.new(public, "fips-186-3").verify(SHA256.new(f"{head}.{claims}".encode()), unb64(signature))


def test_the_keys_are_made_once_and_kept(db: Database, push: FakePush) -> None:
    first = PushService(db, push).keys()
    assert PushService(db, push).keys() == first
    assert len(unb64(first.public)) == 65


def test_a_long_message_is_cut_to_fit() -> None:
    msg = Message("summary", "daily_summary", "Yesterday", "x" * 10_000, int(T0))
    data = payload(msg, "/history")
    assert len(data) <= MAX_PAYLOAD and json.loads(data)["body"].endswith("…")


def test_subscriptions_are_checked(alerts: AlertsService) -> None:
    good = Browser().subscription()
    for bad, message in [
        ({}, "Send the browser's push subscription."),
        ({"subscription": {**good, "endpoint": "http://example.com/x"}}, "isn't a secure web address"),
        ({"subscription": {**good, "keys": {"p256dh": "AAAA", "auth": good["keys"]["auth"]}}}, "keys aren't valid"),
        ({"subscription": {**good, "keys": {"p256dh": good["keys"]["p256dh"], "auth": "AAAA"}}}, "keys aren't valid"),
    ]:
        with pytest.raises(ValueError, match=message):
            alerts.subscribe(bad)


def test_a_browser_subscribing_again_replaces_itself(alerts: AlertsService) -> None:
    browser = Browser()
    first = alerts.subscribe({"subscription": browser.subscription(), "name": "Chrome on Mac"})
    assert first["name"] == "Chrome on Mac" and first["service"] == "fcm.googleapis.com"
    assert "endpoint" not in first and "keys" not in first
    alerts.subscribe({"subscription": browser.subscription(), "name": "  Chrome   on Mac (again) "})
    devices = alerts.push_overview()["devices"]
    assert [d["name"] for d in devices] == ["Chrome on Mac (again)"]


def test_a_browser_alone_turns_alerts_on_and_gets_them(alerts: AlertsService, push: FakePush) -> None:
    browser = push.add(Browser())
    alerts.evaluate(facts(T0, snapshot={"ts": T0, "battery_soc": 3.0}))
    assert push.sent == []  # nowhere to send: alerts are off
    alerts.subscribe({"subscription": browser.subscription(), "name": "Phone"})
    assert alerts.overview()["enabled"] is True
    alerts.evaluate(facts(T0, snapshot={"ts": T0, "battery_soc": 3.0}))
    alerts.evaluate(facts(T0 + 6 * 60, snapshot={"ts": T0 + 6 * 60, "battery_soc": 3.0}))
    [sent] = push.sent
    assert sent["data"]["title"] == "Battery down to 3%" and sent["data"]["url"] == "/health"
    assert sent["data"]["tag"] == "battery_low" and sent["data"]["event"] == "alert"
    assert sent["headers"]["Topic"] == "battery_low" and sent["headers"]["Urgency"] == "normal"
    assert sent["headers"]["Authorization"].startswith("vapid t=")
    [device] = alerts.push_overview()["devices"]
    assert device["last_sent"] == int(T0 + 6 * 60) and device["last_error"] is None
    assert alerts.history()[0]["status"] == "sent"


def test_a_browser_that_unsubscribed_is_forgotten(alerts: AlertsService, push: FakePush) -> None:
    alerts.save_channel("ntfy", {"url": "https://ntfy.sh/klemm-solar", "token": ""})
    browser = push.add(Browser())
    alerts.subscribe({"subscription": browser.subscription(), "name": "Old laptop"})
    push.fail[ENDPOINT] = gone(ENDPOINT)
    alerts.evaluate(facts(T0, snapshot={"ts": T0, "battery_soc": 3.0}))
    alerts.evaluate(facts(T0 + 6 * 60, snapshot={"ts": T0 + 6 * 60, "battery_soc": 3.0}))
    assert alerts.push_overview()["devices"] == []
    event = alerts.history()[0]
    assert event["status"] == "partial" and "Old laptop has turned notifications off" in event["error"]


def test_a_push_service_refusing_is_noted_on_the_device(alerts: AlertsService, push: FakePush) -> None:
    browser = push.add(Browser())
    [device] = [alerts.subscribe({"subscription": browser.subscription(), "name": "Phone"})]
    push.fail[ENDPOINT] = gone(ENDPOINT, 429)
    with pytest.raises(DeliveryError, match=r"fcm.googleapis.com refused it \(429\)"):
        alerts.test_push({"device": device["id"]})
    assert alerts.push_overview()["devices"][0]["last_error"] == "fcm.googleapis.com refused it (429)."


def test_good_news_goes_out_as_a_notice_and_clears_quietly(alerts: AlertsService, push: FakePush) -> None:
    browser = push.add(Browser())
    alerts.subscribe({"subscription": browser.subscription(), "name": "Phone"})
    alerts.save_rule("solar_output", {"enabled": True, "settings": {"watts": 4000, "minutes": 10}})
    sunny = {"ts": T0, "pv_power": 5200.0, "battery_soc": 80.0, "grid_power": 0.0}
    for m in (0, 5, 11):
        alerts.evaluate(facts(T0 + m * 60, snapshot={**sunny, "ts": T0 + m * 60}))
    alerts.evaluate(facts(T0 + 20 * 60, snapshot={**sunny, "ts": T0 + 20 * 60, "pv_power": 1000.0}))
    [sent] = push.sent
    assert sent["data"]["title"] == "Solar at 5.2 kW" and sent["data"]["event"] == "notice"
    assert sent["data"]["url"] == "/"
    assert [e["kind"] for e in alerts.history()] == ["notice"]


@pytest.fixture
def client(config: Config, push: FakePush) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        c.app.state.services.alerts.push.send = push  # type: ignore[attr-defined]
        yield c


def test_the_push_api(client: TestClient, push: FakePush) -> None:
    key = client.get("/api/alerts/push").json()["public_key"]
    assert len(unb64(key)) == 65 and client.get("/api/alerts").json()["push"]["public_key"] == key
    browser = push.add(Browser())
    r = client.post("/api/alerts/push/devices", json={"subscription": browser.subscription(), "name": "Firefox"})
    device = r.json()["id"]
    assert client.post("/api/alerts/push/test", json={"device": device}).json() == {"ok": True}
    assert push.sent[-1]["data"]["title"] == "WattsMyPower test"
    assert client.post("/api/alerts/push/test", json={"device": "nope"}).status_code == 404
    assert client.post("/api/alerts/push/devices", json={}).status_code == 422
    assert client.delete(f"/api/alerts/push/devices/{device}").json() == {"removed": True}
    r = client.post("/api/alerts/push/test", json={})
    assert r.status_code == 502 and "No browser has notifications turned on" in r.json()["detail"]
