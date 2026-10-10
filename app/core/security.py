"""
Security headers on every response.

The dashboard can't be shown inside another site's frame (it has battery controls, so a page that framed it could
trick someone into pressing them), browsers don't guess file types, and links out don't carry its addresses.

The Content Security Policy only lets the dashboard run its own scripts: the files it's built from, and the few small
scripts written into its page (the theme, display settings and router start-up), allowed by their hashes, which
`page_policy` reads from the built page. Styles may be inline (the charts set them), and fonts may come from Google
Fonts while the build still links them.
"""

from __future__ import annotations

import base64
import hashlib
import re
from collections.abc import Iterable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_POLICY = (
    "default-src 'self'; "
    "script-src 'self'{scripts}; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src 'self' data: blob:; "
    "connect-src 'self'; "
    "worker-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)
POLICY = _POLICY.format(scripts="")

# The API's own documentation (API_DOCS=1) loads its viewer from a CDN and starts it with an inline script.
DOCS_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src 'self' data: https:; "
    "worker-src 'self' blob:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'"
)

HEADERS = {
    b"x-frame-options": b"DENY",
    b"x-content-type-options": b"nosniff",
    b"referrer-policy": b"same-origin",
    b"content-security-policy": POLICY.encode(),
}

# A <script> without a src: its text, exactly as the browser hashes it.
_INLINE_SCRIPT = re.compile(r"<script\b(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script\s*>", re.DOTALL | re.IGNORECASE)


def inline_scripts(html: str) -> list[str]:
    """The text of each inline script, as the browser's HTML parser leaves it (and hashes it): line endings made \\n,
    and NUL characters (TanStack's router start-up has one) made U+FFFD."""
    html = html.replace("\r\n", "\n").replace("\r", "\n")
    return [s.replace("\0", "�") for s in _INLINE_SCRIPT.findall(html)]


def page_policy(scripts: Iterable[str]) -> str:
    """The policy for a page with these inline scripts, each allowed by its SHA-256."""
    hashes = sorted({base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() for s in scripts})
    return _POLICY.format(scripts="".join(f" 'sha256-{h}'" for h in hashes))


class SecurityHeadersMiddleware:
    """Adds HEADERS to every response, leaving any a route set itself (the page's own policy). Pure ASGI, so the
    event stream isn't buffered."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                headers += [(name, value) for name, value in HEADERS.items() if name not in present]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)
