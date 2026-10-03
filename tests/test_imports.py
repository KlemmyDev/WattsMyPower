"""Importing history from iSolarCloud exports: reading the files, the 5-minute buckets, and writing them."""

from __future__ import annotations

import io
import time
import zipfile
from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.core.config import Config
from app.core.database import Database
from app.features.imports.files import UnreadableFile
from app.features.imports.isolarcloud import NotACurve, describe, parse
from app.features.imports.service import ImportService
from app.features.readings.repository import ReadingsRepository
from app.main import create_app


def local(y: int, mo: int, d: int, h: int = 0, mi: int = 0) -> int:
    return int(time.mktime((y, mo, d, h, mi, 0, 0, 0, -1)))


def day_chart(day: str = "2025/04/21", steps: int = 288, sep: str = ",") -> bytes:
    """The plant's day chart export: a reading every 5 minutes, in W."""
    lines = [sep.join(["Time", "PV(W)", "Battery Charge(W)", "Battery Discharge(W)", "Purchased Energy(W)", "Feed-in(W)", "Load(W)"])]  # fmt: skip
    for k in range(steps):
        h, m = divmod(k * 5, 60)
        sunny = 8 <= h < 16
        pv, charge, discharge = (3000, 1000, 0) if sunny else (0, 0, 400)
        imp, exp = (0, 1500) if sunny else (100, 0)
        load = pv - charge + discharge + imp - exp
        pv_cell = str(pv) if sunny else "--"
        lines.append(sep.join([f"{day} {h:02d}:{m:02d}", pv_cell, str(charge), str(discharge), str(imp), str(exp), str(load)]))  # fmt: skip
    return "\n".join(lines).encode()


def xlsx(rows: list[list[object]]) -> bytes:
    """A minimal workbook, with text as shared strings the way Excel writes it."""
    strings: list[str] = []
    cells = []
    for r, row in enumerate(rows, 1):
        out = []
        for c, v in enumerate(row):
            ref = f"{chr(65 + c)}{r}"
            if isinstance(v, str):
                strings.append(v)
                out.append(f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>')
            elif v is not None:
                out.append(f'<c r="{ref}"><v>{v}</v></c>')
        cells.append(f'<row r="{r}">{"".join(out)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} {rel}><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>')  # fmt: skip
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        )
        z.writestr("xl/sharedStrings.xml", f"<sst {ns}>{''.join(f'<si><t>{s}</t></si>' for s in strings)}</sst>")
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}><sheetData>{''.join(cells)}</sheetData></worksheet>")
    return buf.getvalue()


@pytest.fixture
def imports(db: Database) -> ImportService:
    return ImportService(db)


# ---------------------------------------------------------------------------------------- columns


def test_columns_are_matched_by_name() -> None:
    assert describe("PV(W)").field == "pv"
    assert describe("Battery Discharge(W)").field == "discharge"
    assert describe("Battery Charge(W)").field == "charge"
    assert describe("Purchased Energy(W)").field == "import"
    assert describe("Feed-in(W)").field == "export"
    assert describe("Load(W)").field == "load"
    assert describe("Battery Level (SOC)(%)").field == "soc"
    c = describe("SH5.0RS_001(123456)/Total DC Power(kW)")
    assert (c.device, c.point, c.unit, c.field) == ("SH5.0RS_001(123456)", "total dc power", "kw", "pv")
    assert describe("Daily Yield(kWh)").field is None  # energy, not the power curve


# ---------------------------------------------------------------------------------------- parsing


def test_a_day_chart_becomes_5_minute_buckets_with_daily_counters() -> None:
    curve = parse("plant.csv", day_chart())
    assert curve.interval == 300 and len(curve.buckets) == 288
    noon = curve.buckets[local(2025, 4, 21, 12)]
    assert noon["pv_power"] == 3000 and noon["battery_power"] == -1000 and noon["grid_power"] == -1500
    assert noon["load_power"] == 500
    night = curve.buckets[local(2025, 4, 21, 2)]
    assert (
        night["pv_power"] == 0 and night["battery_power"] == 400 and night["grid_power"] == 100
    )  # "--" after dark is 0
    last = curve.buckets[local(2025, 4, 21, 23, 55)]
    assert last["daily_pv"] == pytest.approx(24.0)  # 3 kW for 8 hours
    assert last["daily_export"] == pytest.approx(12.0)
    assert last["daily_charge"] == pytest.approx(8.0)
    assert last["daily_import"] == pytest.approx(1.6)  # 100 W for 16 hours


def test_semicolons_and_day_first_dates() -> None:
    curve = parse("plant.csv", day_chart(day="21/04/2025", sep=";"))
    assert min(curve.buckets) == local(2025, 4, 21)


def test_times_alone_take_the_date_from_the_file_name() -> None:
    data = b"Time,PV(W),Load(W)\n" + b"\n".join(f"{h:02d}:00,{h * 10},500".encode() for h in range(24))
    curve = parse("Plant-20250421.csv", data)
    assert min(curve.buckets) == local(2025, 4, 21)
    assert curve.buckets[local(2025, 4, 21, 13)]["pv_power"] == 130
    assert curve.warnings  # says where the date came from
    with pytest.raises(NotACurve, match="which day"):
        parse("plant.csv", data)


def test_an_hourly_export_fills_each_hour() -> None:
    data = b"Time,PV(W),Load(W),Purchased Energy(W),Feed-in(W)\n" + b"\n".join(
        f"2025-04-21 {h:02d}:00,1000,500,0,500".encode() for h in range(24)
    )
    curve = parse("plant.csv", data)
    assert curve.interval == 3600 and len(curve.buckets) == 288
    assert curve.buckets[local(2025, 4, 21, 23, 55)]["daily_pv"] == pytest.approx(24.0)


def test_a_curve_export_sums_both_inverters_and_reads_kw_and_excel_dates() -> None:
    excel_noon = (datetime(2025, 4, 21, 12) - datetime(1899, 12, 30)).total_seconds() / 86400  # an Excel serial date
    rows: list[list[object]] = [
        ["Plant-2025-04-21To2025-04-21Report"],
        [
            "Time",
            "SH5.0RS_001(1)/Total DC Power(kW)",
            "SG5K-D_001(2)/Total DC Power(kW)",
            "SH5.0RS_001(1)/Battery Level (SOC)(%)",
        ],
        [excel_noon, 2.5, 3.0, 0.8],
        [excel_noon + 300 / 86400, 2.6, 3.1, 0.81],
    ]
    curve = parse("curve.xlsx", xlsx(rows))
    assert len(curve.mapping["pv"]) == 2
    noon = curve.buckets[local(2025, 4, 21, 12)]
    assert noon["pv_power"] == 5500 and noon["battery_soc"] == 80


def test_columns_can_be_chosen_by_hand() -> None:
    curve = parse("plant.csv", day_chart(), {"load": [], "export": ["Feed-in(W)"]})
    assert "load" not in curve.mapping
    noon = curve.buckets[local(2025, 4, 21, 12)]
    assert noon["load_power"] == 500  # still follows from solar, grid and battery


def test_reports_that_arent_a_power_curve_say_so() -> None:
    daily = b"Time,PV Yield(W)\n2025-04-01,20\n2025-04-02,21\n2025-04-03,19\n"
    with pytest.raises(NotACurve, match="totals"):
        parse("month.csv", daily)
    with pytest.raises(NotACurve, match="doesn't have columns"):
        parse("other.csv", b"Name,Address\nHome,Somewhere\n")
    with pytest.raises(UnreadableFile, match=r"\.xls"):
        parse("old.xls", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 100)


def test_an_html_table_saved_as_xls() -> None:
    html = (
        b"<html><table><tr><th>Time</th><th>PV(W)</th><th>Load(W)</th></tr>"
        + b"".join(f"<tr><td>2025-04-21 {h:02d}:00</td><td>100</td><td>200</td></tr>".encode() for h in range(3))
        + b"</table></html>"
    )
    assert len(parse("export.xls", html).buckets) == 36


# ---------------------------------------------------------------------------------------- writing


def test_import_fills_only_time_without_real_readings(
    imports: ImportService, readings: ReadingsRepository, db: Database
) -> None:
    # The dashboard recorded 18:00 onward itself.
    with db.writing() as conn:
        for k in range(12):
            readings.insert(conn, local(2025, 4, 21, 18) + k * 60, {"pv_power": 0, "load_power": 999})
    preview = imports.preview("plant.csv", day_chart())
    assert preview["buckets"] == 288 and preview["recorded"] == 3 and preview["new"] == 285
    assert preview["days"][0]["pv_kwh"] == 24.0

    result = imports.run("plant.csv", day_chart(), label="April")
    assert result["written"] == 285
    series = readings.history(local(2025, 4, 21), local(2025, 4, 22), 288, ["load_power"])["series"]
    at = dict(zip(series["t"], series["load_power"], strict=True))
    assert at[local(2025, 4, 21, 18)] == 999 and at[local(2025, 4, 21, 12)] == 500
    day = readings.daily(local(2025, 4, 21), local(2025, 4, 22))[0]
    assert day["daily_pv"] == pytest.approx(24.0) and day["daily_export"] == pytest.approx(12.0)

    [listed] = imports.list()
    assert listed["label"] == "April" and listed["days"] == 1 and listed["buckets"] == 285

    # Importing the day again replaces the earlier import, which then disappears.
    again = imports.run("plant.csv", day_chart())
    assert again["replaces"] == 285
    assert [i["id"] for i in imports.list()] == [again["import_id"]]

    # Removing it leaves what the dashboard recorded.
    assert imports.remove(again["import_id"]) == 285
    assert imports.list() == []
    series = readings.history(local(2025, 4, 21), local(2025, 4, 22), 288, ["load_power"])["series"]
    assert [v for v in series["load_power"] if v is not None] == [999.0] * 3


def test_files_can_be_added_to_one_import(imports: ImportService) -> None:
    first = imports.run("a.csv", day_chart("2025/04/21"), label="Two days")
    imports.run("b.csv", day_chart("2025/04/22"), into=first["import_id"])
    [listed] = imports.list()
    assert listed["files"] == 2 and listed["days"] == 2


def test_a_live_rollup_replaces_an_imported_bucket(
    imports: ImportService, readings: ReadingsRepository, db: Database
) -> None:
    imports.run("plant.csv", day_chart())
    with db.writing() as conn:
        readings.insert(conn, local(2025, 4, 21, 12, 1), {"load_power": 777})
        readings.heal_rollups(conn)
    assert imports.list()[0]["buckets"] == 287
    imports.remove(imports.list()[0]["id"])
    series = readings.history(local(2025, 4, 21), local(2025, 4, 22), 288, ["load_power"])["series"]
    assert [v for v in series["load_power"] if v is not None] == [777.0]


# ---------------------------------------------------------------------------------------- api


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    with TestClient(create_app(config, poll=False, serve_dashboard=False)) as c:
        yield c


def test_the_api_previews_imports_lists_and_removes(client: TestClient) -> None:
    body = day_chart()
    preview = client.post("/api/imports/preview?name=plant.csv", content=body).json()
    assert preview["new"] == 288 and preview["mapping"]["pv"] == ["PV(W)"]
    assert client.get("/api/imports").json() == []

    done = client.post("/api/imports?name=plant.csv&label=April", content=body).json()
    assert done["written"] == 288
    [listed] = client.get("/api/imports").json()
    assert listed["id"] == done["import_id"]
    assert client.get(f"/api/daily?start={local(2025, 4, 21)}&end={local(2025, 4, 22)}").json()[0]["daily_pv"] == 24.0

    assert client.delete(f"/api/imports/{listed['id']}").json() == {"removed": 288}
    assert client.get("/api/imports").json() == []


def test_the_api_explains_files_it_cant_import(client: TestClient) -> None:
    r = client.post("/api/imports/preview?name=notes.csv", content=b"Name,Address\nHome,Somewhere\n")
    assert r.status_code == 422 and "iSolarCloud" in r.json()["detail"]
    r = client.post('/api/imports/preview?name=plant.csv&columns={"pv":["PV(W)"]', content=day_chart())
    assert r.status_code == 422
