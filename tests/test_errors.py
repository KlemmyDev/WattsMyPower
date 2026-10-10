"""Error responses: a sentence in `detail` for a request FastAPI rejects, and JSON for one that fails."""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.errors import validation_message
from app.main import create_app


@pytest.fixture
def app(config: Config) -> FastAPI:
    app = create_app(config, poll=False, serve_dashboard=False)

    @app.get("/api/boom")
    async def boom() -> None:
        raise KeyError("missing")

    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    # As a browser would see it: the 500, not the exception the test client raises again by default.
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_a_rejected_request_says_what_was_wrong(client: TestClient) -> None:
    r = client.get("/api/history", params={"start": "yesterday", "points": 5})
    assert r.status_code == 422
    body = r.json()
    assert body["detail"] == (
        "start: Input should be a valid integer, unable to parse string as an integer; "
        "points: Input should be greater than or equal to 10."
    )
    # FastAPI's list is still there, for tools.
    assert [e["loc"] for e in body["errors"]] == [["query", "start"], ["query", "points"]]


def test_a_bad_or_missing_body_is_named(client: TestClient) -> None:
    r = client.put("/api/tariff", content=b"not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["detail"] == "The request isn't valid JSON."
    assert client.put("/api/tariff").json()["detail"] == "body: Field required."


def test_validation_message_counts_what_it_leaves_out() -> None:
    errors = [{"loc": ("body", f"f{i}"), "msg": "Field required"} for i in range(5)]
    assert validation_message(errors) == (
        "f0: Field required; f1: Field required; f2: Field required; and 2 more problems."
    )
    assert validation_message([{"loc": ("body", "reserve"), "msg": "Value error, Keep 5% to 50%."}]) == (
        "reserve: Keep 5% to 50%."
    )
    assert validation_message([{"loc": ("body",), "msg": "Field required"}]) == "body: Field required."
    assert validation_message([]) == "The request isn't valid."


def test_a_failure_is_json_and_logged(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.ERROR, logger="app.core.errors"):
        r = client.get("/api/boom")
    assert r.status_code == 500
    assert r.json() == {"detail": "Something went wrong on the server (500). Its log says what happened."}
    assert "GET /api/boom failed: KeyError" in caplog.text


def test_http_errors_keep_their_detail(client: TestClient) -> None:
    r = client.get("/api/nothing-here")
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
