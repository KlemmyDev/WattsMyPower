"""The Overview's dashboards: kept whole, checked, and none until first saved."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.dashboards.service import DashboardError, DashboardService
from app.main import create_app


def widget(**kw: Any) -> dict[str, Any]:
    return {"id": "a", "type": "power-flow", "x": 0, "y": 0, "w": 12, "h": 7, "settings": {"style": "scene"}} | kw


def doc(*boards: dict[str, Any]) -> dict[str, Any]:
    return {"dashboards": list(boards)}


def board(**kw: Any) -> dict[str, Any]:
    return {"id": "now", "name": "Now", "layouts": {"computer": [widget()], "phone": None}} | kw


def test_there_are_none_until_saved_and_they_come_back_as_saved(db: Database) -> None:
    svc = DashboardService(db)
    assert svc.get() == {"v": 1, "dashboards": None}
    saved = svc.save(doc(board(name="  My   home "), board(id="money", name="Money")))
    assert [b["name"] for b in saved["dashboards"]] == ["My home", "Money"]
    assert svc.get() == saved
    assert svc.reset() == {"v": 1, "dashboards": None} == svc.get()


def test_a_phone_layout_is_its_own_on_four_columns(db: Database) -> None:
    svc = DashboardService(db)
    phone = [widget(w=4, h=3), widget(id="b", type="battery", x=2, y=3, w=2, h=2)]
    saved = svc.save(doc(board(layouts={"computer": [widget()], "phone": phone})))
    assert saved["dashboards"][0]["layouts"]["phone"][1]["x"] == 2
    with pytest.raises(DashboardError, match="width"):
        svc.save(doc(board(layouts={"computer": [widget()], "phone": [widget(w=12)]})))


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        (doc(), "1 to 12"),
        (doc(board(), board()), "id of its own"),
        (doc(board(name="")), "name"),
        (doc(board(layouts={"computer": [widget(), widget()]})), "id of its own"),
        (doc(board(layouts={"computer": [widget(type="<script>")]})), "type"),
        (doc(board(layouts={"computer": [widget(x=6, w=8)]})), "place across"),
        (doc(board(layouts={"computer": [widget(h=0)]})), "height"),
        (doc(board(layouts={"computer": [widget(y=True)]})), "place down"),
        (doc(board(layouts={"computer": [widget(settings={"x": "y" * 5000})]})), "settings"),
        (doc(board(layouts={})), "layout"),
        ({"dashboards": "all"}, "list"),
    ],
)
def test_what_cant_be_kept_is_refused_with_why(db: Database, bad: dict[str, Any], message: str) -> None:
    with pytest.raises(DashboardError, match=message):
        DashboardService(db).save(bad)


def test_a_saved_document_that_no_longer_fits_reads_as_none(db: Database) -> None:
    with db.writing() as conn:
        conn.execute("INSERT INTO kv (key, value) VALUES ('dashboards', '{\"dashboards\": 3}')")
    assert DashboardService(db).get()["dashboards"] is None


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def test_the_api_saves_and_refuses(client: TestClient) -> None:
    assert client.get("/api/dashboards").json()["dashboards"] is None
    r = client.put("/api/dashboards", json=doc(board()))
    assert r.status_code == 200 and r.json()["dashboards"][0]["id"] == "now"
    assert client.get("/api/dashboards").json() == r.json()
    bad = client.put("/api/dashboards", json=doc())
    assert bad.status_code == 422 and "dashboards" in bad.json()["detail"]
    assert client.delete("/api/dashboards").json()["dashboards"] is None
