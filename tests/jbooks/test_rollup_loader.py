from decimal import Decimal

import psycopg
from openpyxl import Workbook

from govbudget.jbooks.rollup_loader import load_rollup

HEADERS = [
    "Account", "Account Title", "Organization", "Budget Activity",
    "Budget Activity Title", "Line Number", "PE/BLI",
    "Program Element/Budget Line Item (BLI) Title", "Include In TOA",
    "FY 2024 Actuals", "FY 2025 Enacted", "FY 2025 Total", "FY 2026 Disc Request",
]
ROW1 = ["0400", "RDT&E Defense-Wide", "DARPA", "01", "Basic Research", "2",
        "0601101E", "DEFENSE RESEARCH SCIENCES", "Y",
        280494, 293145, 293145, 0]
ROW2 = ["0400", "RDT&E Defense-Wide", "DARPA", "02", "Applied Research", "14",
        "0602303E", "INFORMATION & COMMUNICATIONS TECHNOLOGY", "Y",
        413000, 400000, None, 350000]


def make_xlsx(tmp_path, with_preamble_rows=True):
    wb = Workbook()
    ws = wb.active
    ws.title = "Exhibit R-1"
    if with_preamble_rows:
        ws.append(["Exhibit R-1, RDT&E Programs"])  # banner rows above the header
        ws.append([])
    ws.append(HEADERS)
    ws.append(ROW1)
    ws.append(ROW2)
    p = tmp_path / "r1_display.xlsx"
    wb.save(p)
    return p


def test_load_rollup_melts_fy_columns(pg_dsn, tmp_path):
    n = load_rollup(pg_dsn, make_xlsx(tmp_path), exhibit="R-1", fiscal_year=2026)
    assert n == 7  # ROW1: 4 amounts, ROW2: 3 amounts (None skipped)
    with psycopg.connect(pg_dsn) as con:
        val = con.execute(
            "select amount_thousands from budget_lines "
            "where pe_bli='0601101E' and amount_type='fy_2024_actuals'"
        ).fetchone()[0]
        assert val == Decimal("280494")
        types = {r[0] for r in con.execute(
            "select distinct amount_type from budget_lines where pe_bli='0602303E'")}
    assert types == {"fy_2024_actuals", "fy_2025_enacted", "fy_2026_disc_request"}


def test_load_rollup_is_idempotent_upsert(pg_dsn, tmp_path):
    p = make_xlsx(tmp_path)
    load_rollup(pg_dsn, p, exhibit="R-1", fiscal_year=2026)
    n2 = load_rollup(pg_dsn, p, exhibit="R-1", fiscal_year=2026)
    assert n2 == 7  # upserts same rows
    with psycopg.connect(pg_dsn) as con:
        total = con.execute("select count(*) from budget_lines").fetchone()[0]
    assert total == 7


def test_split_ba_programs_keep_both_rows(pg_dsn, tmp_path):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Exhibit R-1"
    ws.append(HEADERS)
    ws.append(["0400", "RDT&E AF", "F", "03", "Advanced Dev", "104",
               "0604776F", "DEPLOYMENT & DISTRIBUTION", "Y",
               19441, 19441, None, 20000])
    ws.append(["0400", "RDT&E AF", "F", "04", "Adv Component Dev", "131",
               "0604776F", "DEPLOYMENT & DISTRIBUTION", "Y",
               4840, 4840, None, 5000])
    p = tmp_path / "r1_split.xlsx"
    wb.save(p)

    load_rollup(pg_dsn, p, exhibit="R-1", fiscal_year=2026)
    with psycopg.connect(pg_dsn) as con:
        rows = con.execute(
            "select budget_activity, amount_thousands from budget_lines "
            "where pe_bli='0604776F' and amount_type='fy_2025_enacted' order by 1"
        ).fetchall()
        total = con.execute(
            "select sum(amount_thousands) from budget_lines "
            "where pe_bli='0604776F' and amount_type='fy_2025_enacted'"
        ).fetchone()[0]
    assert len(rows) == 2
    assert total == Decimal("24281")
