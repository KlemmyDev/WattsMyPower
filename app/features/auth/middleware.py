"""Refuse /api requests that aren't signed in."""

from __future__ import annotations

import asyncio
import contextlib
import json
from http.cookies import SimpleCookie

from starlette.types import ASGIApp, Receive, Scope, Send

from app.features.auth.service import COOKIE, AuthService


class AuthMiddleware:
    """Refuse /api requests without a valid session (except sign-in itself). Pure ASGI, so the event stream isn't buffered.

    The AuthService is looked up per request from the app in the ASGI scope (Starlette puts it
    there), because middleware is constructed by `add_middleware` before services can be passed in.
    """

    OPEN = ("/api/auth/",)

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if scope["type"] != "http" or not path.startswith("/api/") or path.startswith(self.OPEN):
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
        body = json.dumps({"detail": "Sign in to continue."}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})
