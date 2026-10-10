"""Refuse /api requests that aren't signed in, and changes asked for by another site."""

from __future__ import annotations

import asyncio
import contextlib
import json
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

from starlette.types import ASGIApp, Receive, Scope, Send

from app.features.auth.service import COOKIE, AuthService

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _host(netloc: str) -> str:
    """A host[:port] to compare, without the port a browser leaves out (80, 443) or letter case."""
    netloc = netloc.strip().lower()
    for default in (":80", ":443"):
        netloc = netloc.removesuffix(default)
    return netloc


def same_origin(headers: dict[bytes, bytes]) -> bool:
    """Whether a request that changes something came from the dashboard's own pages (a second line against
    cross-site request forgery, behind the session cookie's SameSite=Lax).

    Browsers send Origin with every request that isn't a GET or HEAD (as "null" when a page hides where it's from),
    so it's compared with the address the request was sent to: Host, or X-Forwarded-Host from a reverse proxy that
    rewrites Host (another site's page can't set that header). Referer stands in where Origin is missing. With
    neither, the request didn't come from a web page (curl, a script, Home Assistant), which is no forgery risk:
    it still needs a session cookie like anything else.
    """
    source = headers.get(b"origin") or headers.get(b"referer")
    if not source:
        return True
    origin = urlsplit(source.decode("latin-1").strip())
    if not origin.netloc:  # "null", or something that isn't an address
        return False
    allowed = {_host(headers.get(b"host", b"").decode("latin-1"))}
    if forwarded := headers.get(b"x-forwarded-host"):
        allowed.add(_host(forwarded.decode("latin-1").split(",")[0]))
    return _host(origin.netloc) in allowed - {""}


async def _refuse(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})


class AuthMiddleware:
    """Refuse /api requests without a valid session (except sign-in itself), and any request that changes something
    from another site's page, signed in or not (see same_origin). Pure ASGI, so the event stream isn't buffered.

    The AuthService is looked up per request from the app in the ASGI scope (Starlette puts it
    there), because middleware is constructed by `add_middleware` before services can be passed in.
    """

    OPEN = ("/api/auth/",)

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        # Before anything else, and even with sign-in turned off: a page elsewhere mustn't be able to press the
        # dashboard's buttons (stop the battery, install an update) in a browser that can reach it.
        if scope.get("method", "GET") not in SAFE_METHODS and not same_origin(dict(scope.get("headers", []))):
            return await _refuse(send, 403, "This came from another website, so it was refused.")
        path = scope.get("path", "")
        if not path.startswith("/api/") or path.startswith(self.OPEN):
            return await self.app(scope, receive, send)
        auth: AuthService = scope["app"].state.services.auth
        if not auth.enabled:
            return await self.app(scope, receive, send)
        cookie: SimpleCookie = SimpleCookie()
        for name, value in scope.get("headers", []):
            if name == b"cookie":
                # A malformed cookie header just means no session.
                with contextlib.suppress(Exception):
                    cookie.load(value.decode("latin-1"))
        token = cookie[COOKIE].value if COOKIE in cookie else None
        if await asyncio.to_thread(auth.session_user, token):
            return await self.app(scope, receive, send)
        await _refuse(send, 401, "Sign in to continue.")
