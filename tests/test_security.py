"""Sign-in that fails closed, the set-up code, the sign-in throttle, security headers, the cross-site check on
changes, the API docs being off, and the database's files being private."""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import stat
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.__main__ import main as cli
from app.core.config import Config
from app.core.database import Database
from app.core.security import DOCS_POLICY, POLICY, inline_scripts
from app.core.spa import mount_spa
from app.core.version import VERSION
from app.features.auth.service import LoginThrottle
from app.main import create_app

ACCOUNT = {"username": "home", "password": "correct horse"}


@pytest.fixture
def secured(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(replace(config, auth=True), poll=False, serve_dashboard=False)) as c:
        yield c


@pytest.fixture
def open_client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def code_of(c: TestClient) -> str:
    return c.app.state.services.auth.code_path.read_text().strip()  # type: ignore[attr-defined]


def signed_in(c: TestClient) -> TestClient:
    assert c.post("/api/auth/setup", json={**ACCOUNT, "code": code_of(c)}).status_code == 200
    return c


# --- AUTH fails closed


@pytest.mark.parametrize(
    ("value", "on"),
    [
        (None, True),
        ("", True),
        ("true", True),
        ("enabled", True),
        ("flase", True),
        ("false", False),
        (" FALSE ", False),
        ("0", False),
        ("no", False),
        ("off", False),
    ],
)
def test_only_an_explicit_off_turns_sign_in_off(value: str | None, on: bool) -> None:
    assert Config.from_env({} if value is None else {"AUTH": value}).auth is on


def test_sign_in_being_off_is_warned_about(config: Config, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING), TestClient(create_app(config, poll=False, serve_dashboard=False)):
        pass
    assert any("Sign-in is turned off" in r.getMessage() for r in caplog.records)


# --- the set-up code


def test_creating_the_account_needs_the_set_up_code(secured: TestClient) -> None:
    code_file = Path(secured.app.state.services.auth.code_path)  # type: ignore[attr-defined]
    code = code_of(secured)
    assert len(code) == 9 and code[4] == "-"
    assert stat.S_IMODE(code_file.stat().st_mode) == 0o600

    for wrong in ("", "ABCD-EFGH"):
        r = secured.post("/api/auth/setup", json={**ACCOUNT, "code": wrong})
        assert r.status_code == 403 and "set-up code isn't right" in r.json()["detail"]
    assert secured.get("/api/auth/session").json()["setup_required"] is True

    # Typed in lower case, without the dash, is fine.
    r = secured.post("/api/auth/setup", json={**ACCOUNT, "code": code.replace("-", "").lower()})
    assert r.status_code == 200 and secured.get("/api/live").status_code == 200
    assert not code_file.exists()  # only needed once


def test_the_set_up_code_lasts_through_a_restart(config: Config) -> None:
    secured = replace(config, auth=True)
    with TestClient(create_app(secured, poll=False, serve_dashboard=False)) as c:
        first = code_of(c)
    with TestClient(create_app(secured, poll=False, serve_dashboard=False)) as c:
        assert code_of(c) == first


def test_guessing_the_set_up_code_is_paused(secured: TestClient) -> None:
    for _ in range(5):
        assert secured.post("/api/auth/setup", json={**ACCOUNT, "code": "WRONG-CODE"}).status_code == 403
    assert secured.post("/api/auth/setup", json={**ACCOUNT, "code": code_of(secured)}).status_code == 429


def test_reset_account_gives_a_new_set_up_code(
    secured: TestClient, config: Config, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    signed_in(secured)
    monkeypatch.setenv("DB_PATH", config.db_path)
    assert cli(["reset-account"]) == 0
    assert "Account and sessions removed." in capsys.readouterr().out
    code = code_of(secured)  # the running dashboard takes the new one
    secured.post("/api/auth/logout")
    assert secured.post("/api/auth/setup", json={**ACCOUNT, "code": code}).status_code == 200


def test_without_sign_in_there_is_no_account_or_code(open_client: TestClient) -> None:
    assert not open_client.app.state.services.auth.code_path.exists()  # type: ignore[attr-defined]
    assert open_client.post("/api/auth/setup", json={**ACCOUNT, "code": ""}).status_code == 409


# --- the sign-in throttle


def test_wrong_passwords_for_one_username_dont_lock_out_another(secured: TestClient) -> None:
    signed_in(secured).post("/api/auth/logout")
    for _ in range(5):
        assert secured.post("/api/auth/login", json={"username": "guess", "password": "nope nope"}).status_code == 401
    assert secured.post("/api/auth/login", json={"username": "guess", "password": "nope nope"}).status_code == 429
    # Behind a reverse proxy everyone shares an address: the owner can still sign in.
    assert secured.post("/api/auth/login", json=ACCOUNT).status_code == 200


def test_one_address_has_a_looser_limit_across_usernames(secured: TestClient) -> None:
    signed_in(secured).post("/api/auth/logout")
    for n in range(20):
        r = secured.post("/api/auth/login", json={"username": f"guess{n}", "password": "nope nope"})
        assert r.status_code == 401
    assert secured.post("/api/auth/login", json=ACCOUNT).status_code == 429


def test_the_throttle_forgets_what_has_expired(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [1_000_000.0]
    monkeypatch.setattr("app.features.auth.service.time.time", lambda: now[0])
    throttle = LoginThrottle()
    assert throttle.wait("never failed", 5) == 0 and len(throttle) == 0
    for n in range(50):
        throttle.record_failure(f"key {n}")
    assert len(throttle) == 50
    now[0] += LoginThrottle.WINDOW + 1
    assert throttle.wait("key 0", 5) == 0 and len(throttle) == 49
    throttle.record_failure("new")  # sweeps the rest
    assert len(throttle) == 1


# --- headers


def test_every_response_has_the_security_headers(secured: TestClient) -> None:
    for r in (secured.get("/healthz"), secured.get("/api/live"), secured.get("/api/nope")):
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["referrer-policy"] == "same-origin"
        assert r.headers["content-security-policy"] == POLICY
        assert "frame-ancestors 'none'" in POLICY


def test_the_page_allows_exactly_its_own_inline_scripts(config: Config, tmp_path: Path) -> None:
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    theme = "document.documentElement.dataset.theme = 'dark';"
    (web / "_shell.html").write_text(
        f'<html><head><script>{theme}</script><script type="module" src="/assets/a.js"></script></head></html>'
    )
    app = create_app(config, poll=False, serve_dashboard=False)
    mount_spa(app, web)
    with TestClient(app) as c:
        policy = c.get("/battery").headers["content-security-policy"]
    digest = base64.b64encode(hashlib.sha256(theme.encode()).digest()).decode()
    assert f"script-src 'self' 'sha256-{digest}';" in policy
    assert policy.count("sha256-") == 1  # not the module script, which is loaded from 'self'


def test_inline_scripts_are_hashed_as_the_browser_parses_them() -> None:
    # The HTML parser turns NUL into U+FFFD (TanStack's router start-up script has one) and CRLF into LF, and it's
    # that text the browser hashes.
    assert inline_scripts('<script>a("\0")\r\nb()</script>') == ['a("�")\nb()']
    assert inline_scripts('<script async src="/a.js"></script><SCRIPT type="module">c()</SCRIPT >') == ["c()"]


# --- changes from another site


def test_changes_from_another_site_are_refused(secured: TestClient) -> None:
    signed_in(secured)
    stop = "/api/auth/logout"
    for headers in (
        {"Origin": "http://evil.example"},
        {"Origin": "null"},
        {"Referer": "http://evil.example/page"},
        {"Origin": "http://testserver.evil.example"},
    ):
        r = secured.post(stop, headers=headers)
        assert r.status_code == 403 and r.json()["detail"] == "This came from another website, so it was refused."
        assert r.headers["x-frame-options"] == "DENY"
    assert secured.get("/api/auth/session").json()["authenticated"] is True  # still signed in
    # Reading is fine from anywhere (the session cookie still decides).
    assert secured.get("/api/live", headers={"Origin": "http://evil.example"}).status_code == 200


@pytest.mark.parametrize(
    "headers",
    [
        {},  # not a browser (curl, a script)
        {"Origin": "http://testserver"},
        {"Origin": "http://TestServer:80"},
        {"Referer": "http://testserver/manage/system"},
        {"Origin": "https://solar.example.com", "X-Forwarded-Host": "solar.example.com"},
    ],
)
def test_changes_from_the_dashboard_itself_go_through(secured: TestClient, headers: dict[str, str]) -> None:
    signed_in(secured)
    assert secured.post("/api/auth/logout", headers=headers).status_code == 200


def test_changes_from_another_site_are_refused_with_sign_in_off_too(open_client: TestClient) -> None:
    r = open_client.put("/api/settings", json={"bill_months": 1}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    assert open_client.put("/api/settings", json={"bill_months": 1}).status_code == 200


# --- API docs


def test_the_api_docs_are_off_unless_asked_for(open_client: TestClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json", "/api/docs", "/api/openapi.json"):
        assert open_client.get(path).status_code == 404


def test_the_api_docs_need_signing_in(config: Config) -> None:
    assert Config.from_env({"API_DOCS": "1"}).api_docs is True
    with TestClient(create_app(replace(config, auth=True, api_docs=True), poll=False, serve_dashboard=False)) as c:
        assert c.get("/api/openapi.json").status_code == 401
        assert c.get("/api/docs").status_code == 401
        signed_in(c)
        assert c.get("/api/openapi.json").json()["info"]["version"] == VERSION
        docs = c.get("/api/docs")
        assert docs.status_code == 200 and docs.headers["content-security-policy"] == DOCS_POLICY
        assert c.get("/api/redoc").status_code == 200


# --- private files


def test_the_database_files_are_made_private(config: Config) -> None:
    db = Database(config.db_path)
    db.migrate()
    backups = Path(config.db_path).parent / "backups"
    backups.mkdir()
    (backups / "wattsmypower-1.db").write_bytes(b"")
    for path in (config.db_path, backups / "wattsmypower-1.db"):
        os.chmod(path, 0o644)
    with TestClient(create_app(config, poll=False, serve_dashboard=False)):
        pass
    for path in (config.db_path, backups / "wattsmypower-1.db"):
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
