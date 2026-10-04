"""
Where alerts are sent: an ntfy topic, Pushover, or any webhook. One of each at most.

Each is a plain HTTP POST (app.core.http), so there's nothing to install. The secrets that go with
them (access tokens, Pushover keys, and webhook addresses, which often carry a token themselves)
are stored in the database and only ever shown masked, e.g. "••••x9Qa". A masked value sent back
from the page means "keep what's stored", so a form can be saved without retyping its secrets.
"""

from __future__ import annotations

import base64
import json
import re
import socket
import urllib.error
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.core.http import post

MASK = "••••"
MAX_LENGTH = 500

# The transport: (url, body, content type, headers) -> HTTP status. app.core.http.post, or a fake in tests.
Send = Callable[[str, bytes, str, dict[str, str]], int]
Config = dict[str, str]


@dataclass(frozen=True)
class Message:
    """One notification. `event` is alert, resolved, notice (good news), summary or test."""

    event: str
    rule: str | None
    title: str
    body: str
    ts: int
    urgent: bool = False


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    required: bool = True
    secret: bool = False


@dataclass(frozen=True)
class Kind:
    kind: str
    label: str
    fields: tuple[Field, ...]


KINDS: dict[str, Kind] = {
    "ntfy": Kind("ntfy", "ntfy", (Field("url", "Topic address"), Field("token", "Access token", False, True))),
    "pushover": Kind(
        "pushover",
        "Pushover",
        (Field("user_key", "User key", secret=True), Field("app_token", "App token", secret=True)),
    ),
    "webhook": Kind(
        "webhook", "Webhook", (Field("url", "Address", secret=True), Field("token", "Bearer token", False, True))
    ),
}

NTFY_TOPIC = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PUSHOVER_KEY = re.compile(r"^[A-Za-z0-9]{20,40}$")
PUSHOVER_URL = "https://api.pushover.net/1/messages.json"


class DeliveryError(Exception):
    """A notification that didn't go through, said in words fit to show on the page."""


def mask(value: str, url: bool = False) -> str:
    """A secret as "••••" and its last four characters (just "••••" if it's short). An address keeps
    its scheme and host, so it's still recognisable: "https://hooks.example.com/••••f00d"."""
    if not value:
        return ""
    tail = value[-4:] if len(value) >= 12 else ""
    if url:
        p = urllib.parse.urlsplit(value)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}/{MASK}{tail}"
    return MASK + tail


def masked(kind: str, config: Config) -> Config:
    """A channel's settings as the page may see them: secrets masked."""
    out = {}
    for f in KINDS[kind].fields:
        value = config.get(f.key, "")
        out[f.key] = mask(value, url=f.key == "url") if f.secret else value
    return out


def _http_url(value: str, what: str) -> urllib.parse.SplitResult:
    p = urllib.parse.urlsplit(value)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise ValueError(f"{what} must be a web address starting with https:// (or http://).")
    return p


def clean(kind: str, raw: dict[str, Any], stored: Config | None = None) -> Config:
    """A channel's settings, checked. Masked values keep the stored secret. Raises ValueError, in words."""
    if kind not in KINDS:
        raise ValueError(f"There's no alert channel called {kind!r}.")
    out: Config = {}
    for f in KINDS[kind].fields:
        value = raw.get(f.key)
        value = "" if value is None else str(value).strip()
        if f.secret and MASK in value:
            value = (stored or {}).get(f.key, "")
        if len(value) > MAX_LENGTH:
            raise ValueError(f"{f.label} is too long.")
        if f.required and not value:
            raise ValueError(f"Enter the {f.label.lower()}.")
        out[f.key] = value
    if kind == "ntfy":
        p = _http_url(out["url"], "The topic address")
        if not NTFY_TOPIC.match(p.path.rstrip("/").rsplit("/", 1)[-1]):
            raise ValueError(
                "End the topic address with a topic name (letters, numbers, - and _), e.g. https://ntfy.sh/my-solar."
            )
    elif kind == "webhook":
        _http_url(out["url"], "The address")
    elif kind == "pushover":
        for key in ("user_key", "app_token"):
            if not PUSHOVER_KEY.match(out[key]):
                label = next(f.label for f in KINDS[kind].fields if f.key == key)
                raise ValueError(f"That {label.lower()} doesn't look right: Pushover's are 30 letters and numbers.")
    return out


# -- delivery ---------------------------------------------------------------------
def _ntfy(config: Config, msg: Message) -> tuple[str, bytes, str, dict[str, str]]:
    """ntfy takes JSON at its root (rather than headers on the topic URL), so titles can use any characters."""
    p = urllib.parse.urlsplit(config["url"].rstrip("/"))
    base, topic = p.path.rsplit("/", 1)
    url = urllib.parse.urlunsplit((p.scheme, p.netloc, base or "/", "", ""))
    tags = {
        "alert": ["warning"],
        "resolved": ["white_check_mark"],
        "notice": ["bulb"],
        "summary": ["sunny"],
        "test": ["wave"],
    }
    body = {
        "topic": topic,
        "title": msg.title,
        "message": msg.body,
        "priority": 4 if msg.urgent else 3,
        "tags": tags.get(msg.event, []),
    }
    headers = {}
    token = config.get("token", "")
    if ":" in token:  # a username and password
        headers["Authorization"] = "Basic " + base64.b64encode(token.encode()).decode()
    elif token:
        headers["Authorization"] = f"Bearer {token}"
    return url, json.dumps(body).encode(), "application/json", headers


def _pushover(config: Config, msg: Message) -> tuple[str, bytes, str, dict[str, str]]:
    form = {
        "token": config["app_token"],
        "user": config["user_key"],
        "title": msg.title,
        "message": msg.body,
        "priority": "1" if msg.urgent else "0",
        "timestamp": str(msg.ts),
    }
    return PUSHOVER_URL, urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded", {}


def _webhook(config: Config, msg: Message) -> tuple[str, bytes, str, dict[str, str]]:
    body = {
        "source": "wattsmypower",
        "event": msg.event,
        "rule": msg.rule,
        "title": msg.title,
        "message": msg.body,
        "ts": msg.ts,
        "urgent": msg.urgent,
    }
    token = config.get("token", "")
    return (
        config["url"],
        json.dumps(body).encode(),
        "application/json",
        ({"Authorization": f"Bearer {token}"} if token else {}),
    )


REQUESTS = {"ntfy": _ntfy, "pushover": _pushover, "webhook": _webhook}


def _detail(e: urllib.error.HTTPError) -> str:
    """What the service said about a refused request: ntfy and Pushover explain in JSON."""
    try:
        text = e.read(2000).decode("utf-8", "replace").strip()
    except Exception:
        return ""
    try:
        body = json.loads(text)
    except ValueError:
        return text[:160] if text and not text.startswith("<") else ""
    if isinstance(body, dict):
        if isinstance(body.get("error"), str):
            return str(body["error"])
        errors = body.get("errors")
        if isinstance(errors, list) and errors:
            return "; ".join(str(x) for x in errors)
    return ""


def deliver(kind: str, config: Config, msg: Message, send: Send = post) -> None:
    """Send one notification through a channel. Raises DeliveryError saying what went wrong."""
    url, body, content_type, headers = REQUESTS[kind](config, msg)
    host = urllib.parse.urlsplit(url).netloc
    try:
        send(url, body, content_type, headers)
    except urllib.error.HTTPError as e:
        detail = _detail(e)
        hint = " Check the token or keys." if e.code in (401, 403) else ""
        raise DeliveryError(f"{host} refused it ({e.code}{': ' + detail if detail else ''}).{hint}") from e
    except urllib.error.URLError as e:
        if isinstance(e.reason, TimeoutError):
            raise DeliveryError(f"{host} didn't answer in time.") from e
        reason = e.reason if isinstance(e.reason, str) else type(e.reason).__name__
        if isinstance(e.reason, socket.gaierror):
            reason = "address not found"
        raise DeliveryError(f"Couldn't reach {host} ({reason}).") from e
    except TimeoutError as e:
        raise DeliveryError(f"{host} didn't answer in time.") from e
    except OSError as e:
        raise DeliveryError(f"Couldn't reach {host} ({type(e).__name__}).") from e
