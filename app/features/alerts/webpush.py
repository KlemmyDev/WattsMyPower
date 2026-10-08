"""
Browser notifications, through the Web Push protocol: alerts arrive as the browser's (or phone's) own
notifications, even with the dashboard closed, with no app or account needed.

How it fits together:
- A browser that turns notifications on (Manage → Alerts) subscribes with its push service (Google's for
  Chrome and Edge, Mozilla's for Firefox, Apple's for Safari) and sends us the subscription: an address at that
  service, and two keys only it can decrypt with. Each is a row of `push_subscriptions`.
- To notify, we encrypt the message for that browser (RFC 8291, the "aes128gcm" content coding of RFC 8188)
  and POST it to its address, signed with this server's own key (VAPID, RFC 8292) so the push service knows
  it's from the server the browser subscribed to. The push service can't read it; it only passes it on.
- The server's key pair is made the first time it's needed and kept in the kv table. The public half goes to
  each browser when it subscribes.

Only outgoing requests: nothing has to reach this server from outside. But browsers only allow push on a
secure page (https://, or localhost), so the dashboard must be opened over HTTPS for a browser to subscribe.

The crypto is pycryptodomex's (ECDH and ECDSA on P-256, HKDF-SHA256, AES-128-GCM), as the collector already uses.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
import urllib.error
import urllib.parse
from dataclasses import dataclass
from typing import Any

from Cryptodome.Cipher import AES
from Cryptodome.Hash import SHA256
from Cryptodome.Protocol.DH import key_agreement
from Cryptodome.Protocol.KDF import HKDF
from Cryptodome.PublicKey import ECC
from Cryptodome.Signature import DSS

from app.core.database import Database
from app.features.alerts.channels import DeliveryError, Message, Send

log = logging.getLogger(__name__)

KEYS = "webpush_vapid"  # kv: the server's key pair
# Who runs this server, for push services that want to get in touch about a misbehaving sender (Apple requires
# one). A self-hosted install has no address of its own, so it's the project's.
SUBJECT = "https://github.com/KlemmyDev/WattsMyPower"
RECORD = 4096  # the record size in the header: a message is one record
MAX_PAYLOAD = 3000  # bytes of JSON: push services take about 4 KB in all, encryption included
TTL = 24 * 3600  # how long a push service holds a message for a browser that's offline
MAX_NAME = 80


def b64(data: bytes) -> str:
    """URL-safe base64 without padding, as Web Push writes keys."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _point(raw: bytes) -> ECC.EccKey:
    """A P-256 public key from its uncompressed form (0x04, x, y). Raises ValueError if it isn't one."""
    if len(raw) != 65 or raw[0] != 4:
        raise ValueError("not an uncompressed P-256 point")
    return ECC.import_key(raw, curve_name="P-256")


def _hkdf(secret: bytes, length: int, salt: bytes, info: bytes) -> bytes:
    """HKDF-SHA256: extract with `salt`, expand with `info` to `length` bytes."""
    out = HKDF(secret, length, salt, SHA256, context=info)
    assert isinstance(out, bytes)  # one key asked for, so one comes back
    return out


def encrypt(
    plaintext: bytes, ua_public: bytes, auth: bytes, salt: bytes | None = None, as_key: ECC.EccKey | None = None
) -> bytes:
    """`plaintext` encrypted for the browser whose subscription keys are `ua_public` and `auth` (RFC 8291 §3), as
    one aes128gcm record with its header. The salt and our one-off key pair are random unless given (for tests)."""
    salt = salt or os.urandom(16)
    as_key = as_key or ECC.generate(curve="P-256")
    as_public = as_key.public_key().export_key(format="raw")
    ecdh = bytes(key_agreement(static_priv=as_key, static_pub=_point(ua_public), kdf=lambda z: z))
    ikm = _hkdf(ecdh, 32, auth, b"WebPush: info\x00" + ua_public + as_public)
    cek = _hkdf(ikm, 16, salt, b"Content-Encoding: aes128gcm\x00")
    nonce = _hkdf(ikm, 12, salt, b"Content-Encoding: nonce\x00")
    ciphertext, tag = AES.new(cek, AES.MODE_GCM, nonce=nonce).encrypt_and_digest(plaintext + b"\x02")  # last record
    header = salt + RECORD.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + ciphertext + tag


@dataclass(frozen=True)
class Vapid:
    """The server's key pair, base64url: the private scalar, and the public key uncompressed."""

    private: str
    public: str

    @classmethod
    def generate(cls) -> Vapid:
        key = ECC.generate(curve="P-256")
        return cls(b64(int(key.d).to_bytes(32, "big")), b64(key.public_key().export_key(format="raw")))

    def authorization(self, endpoint: str, now: float) -> str:
        """The Authorization header for a push to `endpoint`: a JWT for its push service, signed with our key."""
        p = urllib.parse.urlsplit(endpoint)
        claims = {"aud": f"{p.scheme}://{p.netloc}", "exp": int(now) + 12 * 3600, "sub": SUBJECT}
        segments = [
            b64(json.dumps(x, separators=(",", ":")).encode()) for x in ({"typ": "JWT", "alg": "ES256"}, claims)
        ]
        signing = ".".join(segments).encode()
        key = ECC.construct(curve="P-256", d=int.from_bytes(unb64(self.private), "big"))
        signature = DSS.new(key, "fips-186-3").sign(SHA256.new(signing))  # r || s, as JWS wants
        return f"vapid t={signing.decode()}.{b64(signature)}, k={self.public}"


def device_id(endpoint: str) -> str:
    """A short id for a subscription, so its address (which works like a password) needn't go back to the page."""
    return hashlib.sha256(endpoint.encode()).hexdigest()[:16]


def payload(msg: Message, url: str) -> bytes:
    """What the service worker shows (web/public/sw.js): title, body, where a tap goes, and a tag so a newer
    notification from the same rule replaces the old one."""
    body = msg.body
    while True:
        data = {
            "title": msg.title,
            "body": body,
            "tag": msg.rule or msg.event,
            "event": msg.event,
            "url": url,
            "urgent": msg.urgent,
            "ts": msg.ts,
        }
        out = json.dumps(data, separators=(",", ":")).encode()
        if len(out) <= MAX_PAYLOAD or not body:
            return out
        body = body[: max(0, len(body) - (len(out) - MAX_PAYLOAD) - 2)].rstrip() + "…"


@dataclass
class Subscription:
    id: str
    endpoint: str
    p256dh: str
    auth: str
    name: str
    created_at: int
    last_sent: int | None
    last_error: str | None

    def view(self) -> dict[str, Any]:
        """As the page sees it: everything but the address and keys."""
        return {
            "id": self.id,
            "name": self.name,
            "service": urllib.parse.urlsplit(self.endpoint).netloc,
            "created_at": self.created_at,
            "last_sent": self.last_sent,
            "last_error": self.last_error,
        }


_COLUMNS = "id, endpoint, p256dh, auth, name, created_at, last_sent, last_error"


class PushService:
    """The browsers subscribed to notifications, and sending to them."""

    def __init__(self, db: Database, send: Send):
        self.db = db
        self.send = send
        self._keys: Vapid | None = None

    # -- the server's keys ------------------------------------------------------
    def keys(self) -> Vapid:
        """The key pair, made and stored the first time it's asked for."""
        if self._keys is None:
            with self.db.writing() as conn:
                new = Vapid.generate()
                conn.execute(
                    "INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)",
                    (KEYS, json.dumps({"private": new.private, "public": new.public})),
                )
                stored = json.loads(conn.execute("SELECT value FROM kv WHERE key = ?", (KEYS,)).fetchone()[0])
            self._keys = Vapid(stored["private"], stored["public"])
        return self._keys

    # -- subscriptions ----------------------------------------------------------
    def subscriptions(self) -> list[Subscription]:
        with self.db.reading() as conn:
            rows = conn.execute(f"SELECT {_COLUMNS} FROM push_subscriptions ORDER BY created_at").fetchall()
        return [Subscription(*r) for r in rows]

    def any(self) -> bool:
        with self.db.reading() as conn:
            return conn.execute("SELECT 1 FROM push_subscriptions LIMIT 1").fetchone() is not None

    def subscribe(self, body: dict[str, Any]) -> dict[str, Any]:
        """Store a browser's subscription (PushSubscription.toJSON(), and a name for it): a browser subscribing
        again replaces its old one. Raises ValueError, in words."""
        sub = body.get("subscription")
        if not isinstance(sub, dict):
            raise ValueError("Send the browser's push subscription.")
        endpoint = str(sub.get("endpoint") or "")
        p = urllib.parse.urlsplit(endpoint)
        if p.scheme != "https" or not p.netloc or len(endpoint) > 1000:
            raise ValueError("That push subscription's address isn't a secure web address.")
        keys = sub.get("keys")
        if not isinstance(keys, dict):
            raise ValueError("That push subscription's keys aren't valid.")
        try:
            p256dh, auth = unb64(str(keys["p256dh"])), unb64(str(keys["auth"]))
            _point(p256dh)
        except (KeyError, ValueError, TypeError):
            raise ValueError("That push subscription's keys aren't valid.") from None
        if len(auth) != 16:
            raise ValueError("That push subscription's keys aren't valid.")
        name = " ".join(str(body.get("name") or "").split())[:MAX_NAME] or "A browser"
        s = Subscription(device_id(endpoint), endpoint, b64(p256dh), b64(auth), name, int(time.time()), None, None)
        with self.db.writing() as conn:
            conn.execute(
                f"INSERT OR REPLACE INTO push_subscriptions ({_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (s.id, s.endpoint, s.p256dh, s.auth, s.name, s.created_at, None, None),
            )
        return s.view()

    def remove(self, sub_id: str) -> bool:
        with self.db.writing() as conn:
            return conn.execute("DELETE FROM push_subscriptions WHERE id = ?", (sub_id,)).rowcount > 0

    def _note(self, sub_id: str, now: int, error: str | None) -> None:
        with self.db.writing() as conn:
            if error is None:
                conn.execute(
                    "UPDATE push_subscriptions SET last_sent = ?, last_error = NULL WHERE id = ?", (now, sub_id)
                )
            else:
                conn.execute("UPDATE push_subscriptions SET last_error = ? WHERE id = ?", (error, sub_id))

    # -- sending ----------------------------------------------------------------
    def push(self, s: Subscription, msg: Message, url: str) -> None:
        """Send one notification to one browser. A browser that has unsubscribed (or whose subscription was made
        with other keys) is forgotten. Raises DeliveryError saying what went wrong."""
        keys = self.keys()
        body = encrypt(payload(msg, url), unb64(s.p256dh), unb64(s.auth))
        headers = {
            "TTL": str(TTL),
            "Content-Encoding": "aes128gcm",
            "Urgency": "high" if msg.urgent else "normal",
            "Topic": (msg.rule or msg.event)[:32],
            "Authorization": keys.authorization(s.endpoint, time.time()),
        }
        host = urllib.parse.urlsplit(s.endpoint).netloc
        try:
            self.send(s.endpoint, body, "application/octet-stream", headers)
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                self.remove(s.id)  # unsubscribed, or the subscription expired
                raise DeliveryError(f"{s.name} has turned notifications off, so it was removed.") from e
            error = f"{host} refused it ({e.code})."
            self._note(s.id, msg.ts, error)
            raise DeliveryError(error) from e
        except (urllib.error.URLError, OSError) as e:
            error = f"Couldn't reach {host}."
            self._note(s.id, msg.ts, error)
            raise DeliveryError(error) from e
        self._note(s.id, msg.ts, None)

    def send_all(self, msg: Message, url: str, only: str | None = None) -> None:
        """Send to every subscribed browser (or the one with id `only`). Raises DeliveryError if none got it."""
        subs = [s for s in self.subscriptions() if only is None or s.id == only]
        if not subs:
            raise DeliveryError("No browser has notifications turned on.")
        errors = []
        for s in subs:
            try:
                self.push(s, msg, url)
            except DeliveryError as e:
                errors.append(f"{s.name}: {e}")
        if len(errors) == len(subs):
            raise DeliveryError("; ".join(errors))
        if errors:
            log.warning("Browser notification %r not delivered everywhere: %s", msg.title, "; ".join(errors))
