"""
Error responses the dashboard can show as they are: every error's `detail` is a sentence.

FastAPI's own 422 has `detail` as a list of what was wrong with each field, and an unhandled exception is a plain-text
"Internal Server Error". Here a 422 says what was wrong in words (keeping the list as `errors`, for tools), and an
unhandled exception is a JSON 500 that says something went wrong. Starlette still raises the exception after
answering, so the server's log has its traceback as before.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)

# Where a value was looked for, which the field's name says well enough on its own.
PLACES = {"body", "query", "path", "header", "cookie"}
# How many fields' problems to name; more are counted.
SHOWN = 3


def validation_message(errors: Sequence[Any]) -> str:
    """What was wrong with a request, in a sentence: "latitude: Input should be a valid number." """
    parts: list[str] = []
    for err in errors[:SHOWN]:
        if err.get("type") == "json_invalid":
            parts.append("The request isn't valid JSON")
            continue
        loc = [str(p) for p in err.get("loc", ())]
        field = ".".join(loc[1:] if loc and loc[0] in PLACES and len(loc) > 1 else loc)
        msg = str(err.get("msg", "isn't valid")).removeprefix("Value error, ").rstrip(".")
        parts.append(f"{field}: {msg}" if field else msg)
    more = len(errors) - SHOWN
    if more > 0:
        parts.append(f"and {more} more {'problem' if more == 1 else 'problems'}")
    return ("; ".join(parts) or "The request isn't valid") + "."


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = exc.errors()
    return JSONResponse(
        status_code=422, content={"detail": validation_message(errors), "errors": jsonable_encoder(errors)}
    )


async def _server_error(request: Request, exc: Exception) -> JSONResponse:
    # The traceback follows from uvicorn, once Starlette raises the exception again; this says which request it was.
    log.error("%s %s failed: %s: %s", request.method, request.url.path, type(exc).__name__, exc)
    return JSONResponse(
        status_code=500, content={"detail": "Something went wrong on the server (500). Its log says what happened."}
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _server_error)
