"""
Reading an uploaded spreadsheet into rows of cells, with the standard library only.

iSolarCloud hands out .xlsx workbooks and .csv files depending on where the export comes from,
and some portals save an HTML table with an .xls name. Old binary .xls workbooks can't be read
without a library, so those ask for the file to be saved as .xlsx or .csv instead.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

Cell = str | float | None
Table = list[list[Cell]]

MAX_UNZIPPED = 200 * 1024 * 1024  # a year of 5-minute rows is ~30 MB of sheet XML


class UnreadableFile(ValueError):
    """The upload isn't a spreadsheet this can read; the message says what to do instead."""


def read_tables(name: str, data: bytes) -> list[Table]:
    """Every sheet in the file (one for CSV and HTML), as rows of cells."""
    if data[:4] == b"PK\x03\x04":
        return _xlsx(data)
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise UnreadableFile(
            f"{name} is an older Excel workbook (.xls). Open it in Excel or Numbers and save it as .xlsx or .csv, then upload that."
        )
    text = _decode(data)
    if re.search(r"<table", text[:20000], re.IGNORECASE):
        return [_html(text)]
    return [_csv(text)]


def _decode(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _csv(text: str) -> Table:
    sample = text[:20000]
    try:
        dialect: type[csv.Dialect] | csv.Dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel_tab if sample.count("\t") > sample.count(",") else csv.excel
    return [[c.strip() or None for c in row] for row in csv.reader(io.StringIO(text), dialect)]


# ---------------------------------------------------------------------------------------- xlsx


def _local(tag: str) -> str:
    """An XML tag without its namespace (workbooks use either of two main namespaces)."""
    return tag.rsplit("}", 1)[-1]


def _children(el: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in el if _local(c.tag) == name]


def _text(el: ET.Element) -> str:
    """All the text runs under an element (a shared or inline string)."""
    return "".join(t.text or "" for t in el.iter() if _local(t.tag) == "t")


def _column(ref: str) -> int:
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + ord(ch.upper()) - 64
    return n - 1


def _sheet_paths(z: zipfile.ZipFile) -> list[str]:
    """The worksheets in workbook order, falling back to their file names."""
    names = set(z.namelist())
    try:
        rels = {
            r.get("Id"): r.get("Target", "")
            for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
            if _local(r.tag) == "Relationship"
        }
        out = []
        for sheet in ET.fromstring(z.read("xl/workbook.xml")).iter():
            if _local(sheet.tag) != "sheet":
                continue
            rid = next((v for k, v in sheet.attrib.items() if _local(k) == "id"), None)
            target = rels.get(rid, "")
            path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            if path in names:
                out.append(path)
        if out:
            return out
    except (KeyError, ET.ParseError):
        pass
    found = [n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)]
    return sorted(found, key=lambda n: int(re.sub(r"\D", "", n)))


def _xlsx(data: bytes) -> list[Table]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise UnreadableFile("This file looks like a damaged Excel workbook. Export it again and retry.") from e
    with z:
        if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
            raise UnreadableFile("This workbook is too large to import. Export a shorter date range.")
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = [_text(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")) if _local(si.tag) == "si"]
        tables = []
        for path in _sheet_paths(z):
            table: Table = []
            for row in ET.fromstring(z.read(path)).iter():
                if _local(row.tag) != "row":
                    continue
                cells: list[Cell] = []
                for c in _children(row, "c"):
                    ref, kind = c.get("r"), c.get("t")
                    at = _column(ref) if ref else len(cells)
                    v = next(iter(_children(c, "v")), None)
                    raw = v.text if v is not None else None
                    value: Cell
                    if kind == "s" and raw is not None:
                        value = shared[int(raw)] if int(raw) < len(shared) else None
                    elif kind == "inlineStr":
                        value = _text(c)
                    elif kind in ("str", "e", "b"):
                        value = raw
                    else:
                        try:
                            value = float(raw) if raw is not None else None
                        except ValueError:
                            value = raw
                    if isinstance(value, str):
                        value = value.strip() or None
                    if at >= len(cells):
                        cells.extend([None] * (at - len(cells) + 1))
                    cells[at] = value
                table.append(cells)
            tables.append(table)
        return tables


# ---------------------------------------------------------------------------------------- html


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: Table = []
        self._row: list[Cell] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append("".join(self._cell).strip() or None)
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def _html(text: str) -> Table:
    p = _TableParser()
    p.feed(text)
    return p.rows
