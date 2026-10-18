"""The shared power summary: a secret link that opens the live power figures and nothing else, on the one page another
site may show in a frame."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.spa import mount_spa
from app.main import create_app
from tests.test_security import ACCOUNT, code_of


@pytest.fixture
def client(config: Config, tmp_path: Path) -> Iterator[TestClient]:
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "_shell.html").write_text("<html><head></head></html>")
    app = create_app(replace(config, auth=True), poll=False, serve_dashboard=False)
    mount_spa(app, web)
    with TestClient(app) as c:
        assert c.post("/api/auth/setup", json={**ACCOUNT, "code": code_of(c)}).status_code == 200
        yield c


def test_the_link_is_off_until_it_is_made_and_only_a_signed_in_browser_can_make_it(client: TestClient) -> None:
    assert client.get("/api/embed").json() == {"enabled": False, "token": None}
    token = client.post("/api/embed").json()["token"]
    assert len(token) >= 24 and client.get("/api/embed").json() == {"enabled": True, "token": token}
    client.cookies.clear()
    assert client.get("/api/embed").status_code == 401
    assert client.post("/api/embed").status_code == 401
    assert client.delete("/api/embed").status_code == 401


def test_the_token_opens_the_power_figures_and_a_wrong_one_finds_nothing(client: TestClient) -> None:
    assert client.get("/api/embed/public/power").status_code == 404  # sharing is off
    token = client.post("/api/embed").json()["token"]
    client.cookies.clear()  # as in another site's frame: no session
    got = client.get("/api/embed/public/power", params={"token": token})
    assert got.status_code == 200 and set(got.json()) == {
        "solar_w", "home_w", "grid_w", "battery_w", "battery_pct", "off_grid", "grid_healthy", "updated",
    }  # fmt: skip
    assert client.get("/api/embed/public/power", params={"token": token + "x"}).status_code == 404
    assert client.get("/api/embed/public/power").status_code == 404


def test_a_new_link_replaces_the_old_one_and_turning_it_off_closes_it(client: TestClient) -> None:
    old = client.post("/api/embed").json()["token"]
    new = client.post("/api/embed").json()["token"]
    assert old != new
    assert client.get("/api/embed/public/power", params={"token": old}).status_code == 404
    assert client.get("/api/embed/public/power", params={"token": new}).status_code == 200
    assert client.delete("/api/embed").json() == {"enabled": False, "token": None}
    assert client.get("/api/embed/public/power", params={"token": new}).status_code == 404


def test_only_the_shared_page_can_be_framed(client: TestClient) -> None:
    shared = client.get("/embed/power")
    assert "frame-ancestors *" in shared.headers["content-security-policy"]
    assert "x-frame-options" not in shared.headers
    for path in ("/", "/battery", "/embedded", "/api/embed"):
        r = client.get(path)
        assert r.headers["x-frame-options"] == "DENY", path
        assert r.headers["content-security-policy"].endswith("frame-ancestors 'none'"), path
