"""Tests for PM-review Sprint 2 Task 4 (§P1-9): workbook cell-preview sidecars.

The workbook tier of the citation drawer used to name a sheet and a list of
cell refs and stop there — no cell values, no arithmetic, no way to see the
source short of downloading the .xlsx. §P1-9 requires the drawer to render the
cited cells (plus surrounding rows) as a small table, and to show the
per-cell arithmetic when a fact sums more than one cell.

The data for that table is built HERE, at export time, by reading the same
workbook files the loaders read and the 5B-1 gate re-derives against. The
payload contract:

  {sheet, col, col_header, units, total, rows: [{r, code, title, note, flag,
   v, cited}]}

Invariants this module enforces (loudly — a violation raises, it never ships
a preview that disagrees with the citation):
  - every cited cell resolves to a real row + column in the named sheet
  - sum(cited row values) == the citation's amount_thousands, Decimal-exact
    (the same comparison verify_phase5b1._verify_workbook makes)
  - every cell ref in the citation's `cells` string appears as a cited row
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from openpyxl import Workbook

from govbudget.workbook_cells import (
    CONTEXT_ROWS,
    build_workbook_previews,
    column_letters_to_index,
    parse_cell_ref,
    shard_workbook_previews,
)


# ---------------------------------------------------------------------------
# Fixture builder — a miniature P-1 display workbook
# ---------------------------------------------------------------------------

P1_HEADERS = [
    "Account",
    "Account Title",
    "Organization",
    "Budget Activity",
    "Budget Activity Title",
    "Line Number",
    "BSA",
    "Budget SubActivity (BSA) Title",
    "Budget Line Item",
    "Budget Line Item (BLI) Title",
    "Cost Type",
    "Cost Type Title",
    "Add/Non-Add",
    "FY 2024 Actuals Quantity",
    "FY 2024 Actuals Amount",
]

# Body rows mirror the real FY2026 p1_display.xlsx neighbourhood of the PM's
# repro (rows 836-842 there): a B-21 memo row, the three cited F-35 rows
# (weapon system cost, a NEGATIVE prior-year advance-procurement credit, and
# the current-year advance procurement), then a Non-Add memo row.
P1_BODY = [
    # code,    title,         cost type title,                add/non-add, amount
    ("B02100", "B-21 Raider", "C (FY 2024 for FY 2025) (M)", "Non-Add", 708000),
    ("B02100", "B-21 Raider", "C (FY 2025 for FY 2026) (M)", "Non-Add", None),
    ("B02100", "B-21 Raider", "C (FY 2026 for FY 2027) (M)", "Non-Add", None),
    ("ATA000", "F-35", "Weapon System Cost", "Add", 5493772),
    ("ATA000", "F-35", "Less: Advance Procurement (PY)", "Add", -246702),
    ("ATA000", "F-35", "Advance Procurement (CY)", "Add", 318585),
    ("ATA000", "F-35", "C (FY 2024 for FY 2025) (M)", "Non-Add", 318585),
    ("ATA000", "F-35", "C (FY 2025 for FY 2026) (M)", "Non-Add", None),
]


def _write_p1(path: Path) -> None:
    """Write a P-1 workbook whose header sits on row 2 (like the real ones)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Exhibit P-1"
    ws.append(["", "", "", "", "", "", "", "", "", "", "Total of Displayed Rows"])
    ws.append(P1_HEADERS)
    for code, title, note, flag, amount in P1_BODY:
        ws.append(
            [
                "3010F", "Aircraft Procurement, Air Force", "F", "01",
                "Aircraft", "3", "03", "Tactical", code, title, "A", note,
                flag, "", amount if amount is not None else "",
            ]
        )
    wb.save(path)


def _write_r1(path: Path) -> None:
    """R-1 rollup shape: no Cost Type column, wrapped multi-line headers."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Exhibit R-1"
    ws.append(["", "", "", "", "", "", "Total of Displayed Rows"])
    ws.append([
        "Account", "Account Title", "Organization", "Budget\nActivity",
        "Budget Activity Title", "Line\nNumber", "PE / BLI",
        "Program Element / Budget Line Item (BLI) Title", "Include\nin\nTOA",
        "FY 2019\n(Base + OCO)",
    ])
    for pe, title, amount in [
        ("0601101A", "In-House Laboratory Independent Research", 11391),
        ("0601102A", "Defense Research Sciences", 306347),
        ("0601103A", "University Research Initiatives", 84512),
    ]:
        ws.append([
            "2040A", "Research, Development, Test & Eval, Army", "ARMY", "01",
            "Basic Research", "1", pe, title, "Y", amount,
        ])
    wb.save(path)


SHA_P1 = "a" * 64
SHA_R1 = "b" * 64


@pytest.fixture()
def wb_dir(tmp_path: Path) -> Path:
    d = tmp_path / "workbooks"
    d.mkdir()
    _write_p1(d / f"{SHA_P1}.xlsx")
    _write_r1(d / f"{SHA_R1}.xlsx")
    return d


def _citation(**over) -> dict:
    base = {
        "kind": "workbook",
        "sheet": "Exhibit P-1",
        "cells": "O6,O7,O8",
        "sha256": SHA_P1,
        "amount_thousands": 5565655.0,
        "units": "USD thousands",
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# Cell-ref helpers
# ---------------------------------------------------------------------------


def test_parse_cell_ref_splits_column_and_row():
    assert parse_cell_ref("O839") == ("O", 839)
    assert parse_cell_ref(" AB12 ") == ("AB", 12)


def test_parse_cell_ref_rejects_garbage():
    for bad in ("", "839", "O", "O0", "$O$839"):
        with pytest.raises(ValueError):
            parse_cell_ref(bad)


def test_column_letters_to_index_is_one_based():
    assert column_letters_to_index("A") == 1
    assert column_letters_to_index("O") == 15
    assert column_letters_to_index("AA") == 27


# ---------------------------------------------------------------------------
# Preview construction
# ---------------------------------------------------------------------------


def test_multi_cell_preview_carries_per_cell_values_and_context(wb_dir: Path):
    previews = build_workbook_previews(
        workbook_dir=wb_dir, citations={"f0": _citation()}
    )
    p = previews["f0"]

    assert p["sheet"] == "Exhibit P-1"
    assert p["col"] == "O"
    assert p["col_header"] == "FY 2024 Actuals Amount"
    assert p["units"] == "USD thousands"
    assert p["total"] == 5565655.0

    cited = [r for r in p["rows"] if r.get("cited")]
    assert [r["r"] for r in cited] == [6, 7, 8]
    assert [r["v"] for r in cited] == [5493772.0, -246702.0, 318585.0]
    # the values the drawer's arithmetic line renders must sum to the total
    assert sum(r["v"] for r in cited) == p["total"]

    # labels come from the workbook's own identifying columns
    assert [r["note"] for r in cited] == [
        "Weapon System Cost",
        "Less: Advance Procurement (PY)",
        "Advance Procurement (CY)",
    ]
    assert all(r["code"] == "ATA000" and r["title"] == "F-35" for r in cited)

    # surrounding rows are present, in row order, and NOT marked cited
    assert [r["r"] for r in p["rows"]] == [4, 5, 6, 7, 8, 9, 10]
    assert not any(r.get("cited") for r in p["rows"] if r["r"] not in (6, 7, 8))
    b21 = next(r for r in p["rows"] if r["r"] == 5)
    assert b21["code"] == "B02100" and b21["flag"] == "Non-Add"


def test_context_window_is_symmetric_and_clamped(wb_dir: Path):
    """A cited row near the top of the body cannot walk above the header."""
    previews = build_workbook_previews(
        workbook_dir=wb_dir,
        citations={
            "f0": _citation(cells="O3", amount_thousands=708000.0),
        },
    )
    rows = previews["f0"]["rows"]
    assert rows[0]["r"] == 3  # header is row 2 — no row 1/2 leaks in
    assert [r["r"] for r in rows] == [3, 4, 5]
    assert CONTEXT_ROWS == 2


def test_blank_cell_renders_as_null_not_zero(wb_dir: Path):
    previews = build_workbook_previews(
        workbook_dir=wb_dir, citations={"f0": _citation()}
    )
    blank = next(r for r in previews["f0"]["rows"] if r["r"] == 10)
    assert "v" not in blank or blank["v"] is None


def test_r1_single_cell_preview_uses_pe_bli_columns(wb_dir: Path):
    previews = build_workbook_previews(
        workbook_dir=wb_dir,
        citations={
            "f1": _citation(
                sheet="Exhibit R-1",
                sha256=SHA_R1,
                cells="J4",
                amount_thousands=306347.0,
            )
        },
    )
    p = previews["f1"]
    assert p["col"] == "J"
    # multi-line workbook headers normalize to one line
    assert p["col_header"] == "FY 2019 (Base + OCO)"
    cited = [r for r in p["rows"] if r.get("cited")]
    assert len(cited) == 1
    assert cited[0]["code"] == "0601102A"
    assert cited[0]["title"] == "Defense Research Sciences"
    assert cited[0]["v"] == 306347.0
    assert "note" not in cited[0]  # R-1 has no Cost Type column — omitted, not faked


def test_non_workbook_citations_are_skipped(wb_dir: Path):
    previews = build_workbook_previews(
        workbook_dir=wb_dir,
        citations={
            "f0": _citation(),
            "f9": {"kind": "jbook_pdf", "sha256": SHA_P1, "cells": None},
        },
    )
    assert set(previews) == {"f0"}


# ---------------------------------------------------------------------------
# Loud failures — the preview never ships disagreeing with the citation
# ---------------------------------------------------------------------------


def test_sum_mismatch_raises(wb_dir: Path):
    with pytest.raises(ValueError, match="cell sum mismatch"):
        build_workbook_previews(
            workbook_dir=wb_dir,
            citations={"f0": _citation(amount_thousands=999.0)},
        )


def test_missing_workbook_raises(wb_dir: Path):
    with pytest.raises(FileNotFoundError):
        build_workbook_previews(
            workbook_dir=wb_dir, citations={"f0": _citation(sha256="c" * 64)}
        )


def test_missing_workbook_is_collected_when_the_caller_opts_in(wb_dir: Path):
    """The one tolerated gap: a document that was never exported.

    It is NOT a preview defect — verify_phase5b1 fails with "workbook not
    found" for the citation, and gate 4 leg 3a fails for the previewless
    fact. The exporter opts into tolerance so it can report the count instead
    of dying; every OTHER inconsistency still raises.
    """
    missing: set[str] = set()
    previews = build_workbook_previews(
        workbook_dir=wb_dir,
        citations={"f0": _citation(sha256="c" * 64), "f1": _citation()},
        missing_workbooks=missing,
    )
    assert missing == {"c" * 64}
    assert set(previews) == {"f1"}  # the resolvable one is still built


def test_opting_into_tolerance_does_not_soften_the_sum_check(wb_dir: Path):
    with pytest.raises(ValueError, match="cell sum mismatch"):
        build_workbook_previews(
            workbook_dir=wb_dir,
            citations={"f0": _citation(amount_thousands=999.0)},
            missing_workbooks=set(),
        )


def test_missing_sheet_raises(wb_dir: Path):
    with pytest.raises(ValueError, match="sheet"):
        build_workbook_previews(
            workbook_dir=wb_dir, citations={"f0": _citation(sheet="Exhibit Z-9")}
        )


def test_cell_beyond_sheet_raises(wb_dir: Path):
    with pytest.raises(ValueError, match="row 9999"):
        build_workbook_previews(
            workbook_dir=wb_dir, citations={"f0": _citation(cells="O9999")}
        )


# ---------------------------------------------------------------------------
# Sharding (the sidecar route — see the size measurement in the task report)
# ---------------------------------------------------------------------------


def test_shard_workbook_previews_writes_two_hex_prefix_files(
    wb_dir: Path, tmp_path: Path
):
    previews = build_workbook_previews(
        workbook_dir=wb_dir,
        citations={
            "5b532c52d3ebb4c2": _citation(),
            "5bff0000deadbeef": _citation(cells="O3", amount_thousands=708000.0),
            "a100000000000000": _citation(cells="O3", amount_thousands=708000.0),
        },
    )
    out = tmp_path / "json" / "workbook-cells"
    n = shard_workbook_previews(previews, out)

    assert n == 2
    assert sorted(p.name for p in out.iterdir()) == ["5b.json", "a1.json"]
    shard = json.loads((out / "5b.json").read_text())
    assert set(shard) == {"5b532c52d3ebb4c2", "5bff0000deadbeef"}
    assert shard["5b532c52d3ebb4c2"]["total"] == 5565655.0
