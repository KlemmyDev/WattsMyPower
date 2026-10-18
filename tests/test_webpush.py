"""Browser notifications (Web Push): the encryption against RFC 8291's example, the VAPID signature, keeping
subscriptions, and notifications reaching browsers. Every push goes to a fake that decrypts it as a browser would."""

from __future__ import annotations

import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from email.message import Message as Headers
from typing import Any

import pytest
from Cryptodome.Cipher import AES
from Cryptodome.Hash import SHA256
from Cryptodome.Protocol.DH import key_agreement
from Cryptodome.Protocol.KDF import HKDF
from Cryptodome.PublicKey import ECC
from Cryptodome.Signature import DSS

from app.core.database import Database
from app.features.notifications.channels import DeliveryError, Message
from app.features.notifications.webpush import MAX_PAYLOAD, PushService, Vapid, b64, encrypt, payload, unb64

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


def test_subscriptions_are_checked(db: Database, push: FakePush) -> None:
    service = PushService(db, push)
    good = Browser().subscription()
    for bad in (
        {},
        {"subscription": "nope"},
        {"subscription": {**good, "endpoint": "http://insecure.example/x"}},
        {"subscription": {**good, "keys": {"p256dh": "AAAA", "auth": good["keys"]["auth"]}}},
        {"subscription": {**good, "keys": {"p256dh": good["keys"]["p256dh"], "auth": "AAAA"}}},
    ):
        with pytest.raises(ValueError, match="push subscription"):
            service.subscribe(bad)


def test_a_browser_subscribing_again_replaces_itself(db: Database, push: FakePush) -> None:
    service = PushService(db, push)
    browser = Browser()
    first = service.subscribe({"subscription": browser.subscription(), "name": "Chrome on Mac"})
    assert first["name"] == "Chrome on Mac" and first["service"] == "fcm.googleapis.com"
    assert "endpoint" not in first and "keys" not in first  # the page never sees the address or keys
    service.subscribe({"subscription": browser.subscription(), "name": "  Chrome   on Mac (again) "})
    assert [s.name for s in service.subscriptions()] == ["Chrome on Mac (again)"]


def test_a_notification_reaches_a_browser_decrypted(db: Database, push: FakePush) -> None:
    service = PushService(db, push)
    browser = push.add(Browser())
    service.subscribe({"subscription": browser.subscription(), "name": "Phone"})
    service.send_all(Message("alert", "off_grid", "The grid's down", "Since 14:05.", int(T0), True), "/grid")
    [sent] = push.sent
    assert sent["data"]["title"] == "The grid's down" and sent["data"]["url"] == "/grid" and sent["data"]["urgent"]
    assert sent["headers"]["Urgency"] == "high" and sent["headers"]["Authorization"].startswith("vapid t=")
    assert service.subscriptions()[0].last_sent == int(T0)


def test_a_browser_that_unsubscribed_is_forgotten(db: Database, push: FakePush) -> None:
    service = PushService(db, push)
    browser = Browser()
    service.subscribe({"subscription": browser.subscription(), "name": "Old laptop"})
    push.fail[browser.endpoint] = gone(browser.endpoint)
    with pytest.raises(DeliveryError, match="turned notifications off"):
        service.send_all(Message("alert", "off_grid", "t", "b", int(T0)), "/")
    assert service.subscriptions() == []


def test_a_push_service_refusing_is_noted_on_the_device(db: Database, push: FakePush) -> None:
    service = PushService(db, push)
    browser = Browser()
    service.subscribe({"subscription": browser.subscription(), "name": "Phone"})
    push.fail[browser.endpoint] = gone(browser.endpoint, 429)
    with pytest.raises(DeliveryError, match="refused it"):
        service.send_all(Message("alert", "off_grid", "t", "b", int(T0)), "/")
    assert service.subscriptions()[0].last_error == "fcm.googleapis.com refused it (429)."
