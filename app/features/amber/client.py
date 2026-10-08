"""
The Amber Electric public API (https://api.amber.com.au/v1; documented at app.amber.com.au/developers,
with the OpenAPI spec at github.com/amberelectric/public-api).

The household creates a personal API key in Amber's app and pastes it in Manage → Bills & rates; it's
sent as a Bearer token. Amber allows 50 requests per 5 minutes per account (shared with anything else
using the account, such as Home Assistant) and reports what's left in RateLimit-* headers, which are
kept here so the sync can stop early. Prices are fetched a day or more per request and kept in the
database (see service.py), so normal running costs one request every five minutes.

Endpoints used:
    GET /sites                                    the account's sites (one per meter)
    GET /sites/{id}/prices?startDate&endDate      every channel's prices for those NEM days: final
                                                  prices for the past, forecasts for the rest
    GET /sites/{id}/prices/current?previous&next  the interval under way, and some either side
"""

from __future__ import annotations

import datetime as dt
import re
import urllib.error
import urllib.parse
from collections.abc import Callable, Mapping
from typing import Any

from app.core.http import fetch_json

BASE = "https://api.amber.com.au/v1"
TIMEOUT = 30  # seconds; a week of 5-minute prices is a few MB
SITE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

Fetch = Callable[[str, dict[str, str], float], tuple[Any, Mapping[str, str]]]


class AmberError(Exception):
    """A request Amber refused or that didn't get through. `status` is Amber's HTTP status, if it answered."""

    def __init__(self, message: str, status: int | None = None, retry_after: int | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after  # seconds until requests are allowed again, when rate limited

    @property
    def bad_key(self) -> bool:
        return self.status in (401, 403)


def _int(v: Any) -> int | None:
    try:
        return int(str(v).split(",")[0].strip())
    except (TypeError, ValueError):
        return None


class AmberClient:
    def __init__(self, api_key: str, fetch: Fetch = fetch_json):
        self._key = api_key
        self._fetch = fetch
        self.remaining: int | None = None  # requests left in the current rate-limit window, as Amber last said

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
        url = f"{BASE}{path}{'?' + query if query else ''}"
        try:
            body, headers = self._fetch(url, {"Authorization": f"Bearer {self._key}"}, TIMEOUT)
        except urllib.error.HTTPError as e:
            self.remaining = _int(e.headers.get("RateLimit-Remaining")) if e.headers else None
            reset = _int(e.headers.get("RateLimit-Reset")) if e.headers else None
            raise AmberError(_message(e.code), e.code, reset if e.code == 429 else None) from e
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            raise AmberError("Amber could not be reached. Check the server's internet connection.") from e
        self.remaining = _int(headers.get("RateLimit-Remaining"))
        return body

    def sites(self) -> list[dict[str, Any]]:
        body = self._get("/sites")
        return [s for s in body if isinstance(s, dict) and s.get("id")] if isinstance(body, list) else []

    def prices(self, site_id: str, start: dt.date, end: dt.date, resolution: int | None = None) -> list[dict[str, Any]]:
        """Every channel's priced intervals for the NEM days start to end (both included)."""
        body = self._get(
            f"/sites/{_site(site_id)}/prices",
            {"startDate": start.isoformat(), "endDate": end.isoformat(), "resolution": resolution},
        )
        return body if isinstance(body, list) else []

    def current(
        self, site_id: str, previous: int = 0, next: int = 0, resolution: int | None = None
    ) -> list[dict[str, Any]]:
        """The interval under way on each channel, with `previous` final and `next` forecast intervals."""
        body = self._get(
            f"/sites/{_site(site_id)}/prices/current",
            {"previous": previous or None, "next": next or None, "resolution": resolution},
        )
        return body if isinstance(body, list) else []


def _site(site_id: str) -> str:
    if not SITE_ID.match(site_id or ""):
        raise AmberError("Invalid Amber site.")
    return site_id


def _message(status: int) -> str:
    if status in (401, 403):
        return "Amber didn't accept the API key. Check it was copied in full, or create a new one in the Amber app."
    if status == 404:
        return "Amber couldn't find that site on your account."
    if status == 429:
        return "Amber is limiting requests for now. Prices will update again in a few minutes."
    if status == 400:
        return "Amber couldn't answer that request."
    return f"Amber's service had a problem ({status}). Prices will update again in a few minutes."
