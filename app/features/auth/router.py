"""Sign-in endpoints: /api/auth/*. These stay open; AuthMiddleware guards the rest of /api."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request, Response

from app.dependencies import JsonBody, ServicesDep
from app.features.auth.service import COOKIE, SESSION_DAYS

router = APIRouter(prefix="/api/auth")

# A required JSON object body (same as `= Body(...)`, in the form ruff's B008 accepts).


def _set_cookie(request: Request, response: Response, token: str) -> None:
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(
        COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/"
    )


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


@router.get("/session")
async def get_session(request: Request, svc: ServicesDep):
    """Whether this browser is signed in, and whether the dashboard still needs an account."""
    auth = svc.auth
    if not auth.enabled:
        return {"authenticated": True, "setup_required": False, "username": None, "auth_enabled": False}
    user = await asyncio.to_thread(auth.session_user, request.cookies.get(COOKIE))
    setup = not user and not await asyncio.to_thread(auth.has_account)
    return {
        "authenticated": bool(user),
        "setup_required": setup,
        "username": user.username if user else None,
        "auth_enabled": True,
    }


@router.post("/setup")
async def setup(request: Request, response: Response, svc: ServicesDep, body: JsonBody):
    """Create the household account (first run only) and sign in."""
    auth = svc.auth
    try:
        user_id = await asyncio.to_thread(auth.create_account, body.get("username", ""), body.get("password", ""))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except PermissionError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    _set_cookie(request, response, await asyncio.to_thread(auth.new_session, user_id))
    return {"ok": True}


@router.post("/login")
async def login(request: Request, response: Response, svc: ServicesDep, body: JsonBody):
    auth = svc.auth
    ip = _client_ip(request)
    wait = auth.throttle.wait(ip)
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {max(1, wait // 60)} min.")
    user_id = await asyncio.to_thread(auth.check_login, body.get("username", ""), body.get("password", ""))
    if user_id is None:
        auth.throttle.record_failure(ip)
        raise HTTPException(status_code=401, detail="That username and password don't match.")
    auth.throttle.clear(ip)
    _set_cookie(request, response, await asyncio.to_thread(auth.new_session, user_id))
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request, response: Response, svc: ServicesDep):
    await asyncio.to_thread(svc.auth.end_session, request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.put("/password")
async def put_password(request: Request, response: Response, svc: ServicesDep, body: JsonBody):
    """Change the password. Signs out every other browser."""
    auth = svc.auth
    user = await asyncio.to_thread(auth.session_user, request.cookies.get(COOKIE))
    if not user:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    try:
        await asyncio.to_thread(auth.change_password, user.id, body.get("current", ""), body.get("new", ""))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    await asyncio.to_thread(auth.end_session, None, user.id)
    _set_cookie(request, response, await asyncio.to_thread(auth.new_session, user.id))
    return {"ok": True}
