"""
Sign-in for the dashboard.

One household account (username + password), created from the dashboard the first time
it's opened. Passwords are hashed with scrypt (PBKDF2 where Python lacks it); sign-ins get a random session token in an
HttpOnly cookie, and only its SHA-256 is stored. Every /api route except /api/auth/* needs
a valid session (see AuthMiddleware); /healthz and the app's static files stay open.

Forgot the password? From the install folder:
    docker compose exec wattsmypower python -m app.auth reset
removes the account and every session, so the dashboard asks for a new one.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import sys
import threading
import time
from contextlib import closing
from http.cookies import SimpleCookie

from fastapi import APIRouter, Body, HTTPException, Request, Response

from . import config, db

COOKIE = "wmp_session"
SESSION_DAYS = 30
MIN_PASSWORD = 8
# scrypt cost: ~50 ms and 16 MB per check on a small server.
_N, _R, _P = 2**14, 8, 1
_PBKDF2_ROUNDS = 600_000

_schema_ready = False
_lock = threading.Lock()


def _db():
    global _schema_ready
    conn = db.connect()
    if not _schema_ready:
        conn.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,"
                     " password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)")
        conn.execute("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,"
                     " created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)")
        conn.commit()
        _schema_ready = True
    return conn


# ---------------------------------------------------------------------------
# passwords and tokens
# ---------------------------------------------------------------------------

def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    if hasattr(hashlib, "scrypt"):
        key = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
        return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(key)}"
    # Python builds without scrypt (e.g. linked against LibreSSL): PBKDF2 at OWASP's recommended cost.
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, *params, salt, key = stored.split("$")
        if algo == "scrypt":
            n, r, p = map(int, params)
            got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=n, r=r, p=p, dklen=32)
        elif algo == "pbkdf2_sha256":
            got = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(params[0]))
        else:
            return False
    except (ValueError, TypeError, AttributeError):
        return False
    return hmac.compare_digest(got, base64.b64decode(key))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# Run a password check against a throwaway hash for unknown usernames, so a failed sign-in
# takes the same time whether or not the username exists.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


# ---------------------------------------------------------------------------
# accounts and sessions (blocking: call through asyncio.to_thread)
# ---------------------------------------------------------------------------

def has_account() -> bool:
    with closing(_db()) as conn:
        return conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None


def _validate(username: str, password: str) -> str:
    username = (username or "").strip()
    if not 1 <= len(username) <= 64:
        raise ValueError("Enter a username.")
    if len(password or "") < MIN_PASSWORD:
        raise ValueError(f"Use a password of at least {MIN_PASSWORD} characters.")
    if len(password) > 256:
        raise ValueError("That password is too long.")
    return username


def create_account(username: str, password: str) -> int:
    """Create the household account. Only allowed while there is none."""
    username = _validate(username, password)
    hashed = hash_password(password)
    with _lock, closing(_db()) as conn:
        if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            raise PermissionError("An account already exists. Sign in instead.")
        cur = conn.execute("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                           (username, hashed, int(time.time())))
        conn.commit()
        return cur.lastrowid


def check_login(username: str, password: str) -> int | None:
    with closing(_db()) as conn:
        row = conn.execute("SELECT id, password_hash FROM users WHERE username = ?", ((username or "").strip(),)).fetchone()
    if not row:
        verify_password(password or "", _DUMMY_HASH)
        return None
    return row[0] if verify_password(password or "", row[1]) else None


def change_password(user_id: int, current: str, new: str) -> None:
    with closing(_db()) as conn:
        row = conn.execute("SELECT username, password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or not verify_password(current or "", row[1]):
        raise PermissionError("Your current password isn't right.")
    _validate(row[0], new)
    with closing(_db()) as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new), user_id))
        conn.commit()


def new_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with closing(_db()) as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        conn.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                     (_token_hash(token), user_id, now, now + SESSION_DAYS * 86400))
        conn.commit()
    return token


def session_user(token: str | None) -> dict | None:
    """The signed-in user for a session token, or None. Extends sessions as they're used."""
    if not token:
        return None
    now = int(time.time())
    with closing(_db()) as conn:
        row = conn.execute("SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id"
                           " WHERE s.token_hash = ?", (_token_hash(token),)).fetchone()
        if not row or row[2] < now:
            return None
        # Sliding expiry, written at most once a day.
        if row[2] - now < (SESSION_DAYS - 1) * 86400:
            conn.execute("UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
                         (now + SESSION_DAYS * 86400, _token_hash(token)))
            conn.commit()
    return {"id": row[0], "username": row[1]}


def end_session(token: str | None, everywhere_for: int | None = None) -> None:
    with closing(_db()) as conn:
        if everywhere_for is not None:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (everywhere_for,))
        elif token:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
        conn.commit()


def reset() -> None:
    """Remove the account and every session (the dashboard then asks for a new account)."""
    with closing(_db()) as conn:
        conn.execute("DELETE FROM sessions")
        conn.execute("DELETE FROM users")
        conn.commit()


# ---------------------------------------------------------------------------
# brute-force protection: a few failed sign-ins per address, then a pause
# ---------------------------------------------------------------------------

_FAIL_WINDOW, _FAIL_LIMIT = 15 * 60, 5
_failures: dict[str, list[float]] = {}


def _throttled(ip: str) -> int:
    """Seconds this address must wait before trying again (0 = go ahead)."""
    now = time.time()
    recent = [t for t in _failures.get(ip, []) if now - t < _FAIL_WINDOW]
    _failures[ip] = recent
    return int(_FAIL_WINDOW - (now - recent[0])) + 1 if len(recent) >= _FAIL_LIMIT else 0


def _record_failure(ip: str) -> None:
    _failures.setdefault(ip, []).append(time.time())


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/auth")


def _set_cookie(request: Request, response: Response, token: str) -> None:
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


@router.get("/session")
async def get_session(request: Request):
    """Whether this browser is signed in, and whether the dashboard still needs an account."""
    if not config.AUTH:
        return {"authenticated": True, "setup_required": False, "username": None, "auth_enabled": False}
    user = await asyncio.to_thread(session_user, request.cookies.get(COOKIE))
    setup = not user and not await asyncio.to_thread(has_account)
    return {"authenticated": bool(user), "setup_required": setup, "username": user and user["username"], "auth_enabled": True}


@router.post("/setup")
async def setup(request: Request, response: Response, body: dict = Body(...)):
    """Create the household account (first run only) and sign in."""
    try:
        user_id = await asyncio.to_thread(create_account, body.get("username", ""), body.get("password", ""))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    _set_cookie(request, response, await asyncio.to_thread(new_session, user_id))
    return {"ok": True}


@router.post("/login")
async def login(request: Request, response: Response, body: dict = Body(...)):
    ip = _client_ip(request)
    wait = _throttled(ip)
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {max(1, wait // 60)} min.")
    user_id = await asyncio.to_thread(check_login, body.get("username", ""), body.get("password", ""))
    if user_id is None:
        _record_failure(ip)
        raise HTTPException(status_code=401, detail="That username and password don't match.")
    _failures.pop(ip, None)
    _set_cookie(request, response, await asyncio.to_thread(new_session, user_id))
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request, response: Response):
    await asyncio.to_thread(end_session, request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.put("/password")
async def put_password(request: Request, response: Response, body: dict = Body(...)):
    """Change the password. Signs out every other browser."""
    user = await asyncio.to_thread(session_user, request.cookies.get(COOKIE))
    if not user:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    try:
        await asyncio.to_thread(change_password, user["id"], body.get("current", ""), body.get("new", ""))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    await asyncio.to_thread(end_session, None, user["id"])
    _set_cookie(request, response, await asyncio.to_thread(new_session, user["id"]))
    return {"ok": True}


class AuthMiddleware:
    """Refuse /api requests without a valid session (except sign-in itself). Pure ASGI, so the event stream isn't buffered."""

    OPEN = ("/api/auth/",)

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if (not config.AUTH or scope["type"] != "http" or not path.startswith("/api/")
                or path.startswith(self.OPEN)):
            return await self.app(scope, receive, send)
        cookie = SimpleCookie()
        for name, value in scope.get("headers", []):
            if name == b"cookie":
                try:
                    cookie.load(value.decode("latin-1"))
                except Exception:  # a malformed cookie header just means no session
                    pass
        token = cookie[COOKIE].value if COOKIE in cookie else None
        if await asyncio.to_thread(session_user, token):
            return await self.app(scope, receive, send)
        body = json.dumps({"detail": "Sign in to continue."}).encode()
        await send({"type": "http.response.start", "status": 401,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


if __name__ == "__main__":
    if sys.argv[1:] == ["reset"]:
        reset()
        print("Account and sessions removed. Open the dashboard to create a new account.")
    else:
        print("Usage: python -m app.auth reset")
        sys.exit(2)
