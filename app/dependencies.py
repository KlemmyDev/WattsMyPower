"""FastAPI dependencies shared by every router."""

from __future__ import annotations

import time
from typing import Annotated, Any

from fastapi import Body, Depends, Request

from app.container import Services


def get_services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


ServicesDep = Annotated[Services, Depends(get_services)]
# A required JSON object body, validated by the feature itself (so errors keep their readable messages).
JsonBody = Annotated[dict[str, Any], Body()]


def time_range(start: int | None, end: int | None, default_span: int) -> tuple[int, int]:
    """A [start, end) range in unix seconds: `end` defaults to now, `start` to `default_span` before it."""
    end = end or int(time.time()) + 1
    start = start if start is not None else end - default_span
    return start, end
