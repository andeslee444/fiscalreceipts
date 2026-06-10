from decimal import Decimal

import psycopg
from openpyxl import Workbook

from govbudget.jbooks.p1_loader import load_p1_rollup

P1_HEADERS = [
    "Account", "Account Title", "Organization", "Budget Activity",
    "Budget Activity Title", "Line Number", "BSA", "Budget SubActivity (BSA) Title",
    "Budget Line Item", "Budget Line Item (BLI) Title", "Cost Type",
    "Cost Type Title", "Add/Non-Add",
    "FY 2024 Actuals Quantity", "FY 2024 Actuals Amount",
    "FY 2025 Enacted Quantity", "FY 2025 Enacted Amount",
    "FY 2026 Disc Request Quantity", "FY 2026 Disc Request Amount",
    "Classification",
]


def make_p1_xlsx(tmp_path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Exhibit P-1"
    ws.append(["Total of Displayed Rows"])  # banner
    ws.append(P1_HEADERS)
    # same BLI, two Add cost-type rows + one Non-Add row (must be excluded)
    ws.append(["0300D", "Procurement, Defense-Wide", "CBDP", "03", "Chem/Bio Defense",
               "120", "1", "CBDP", "7001SA1000", "CB Situational Awareness",
               "A", "Weapon System Cost", "Add", 2, 100000, 1, 150000, "", 200051])
    ws.append(["0300D", "Procurement, Defense-Wide", "CBDP", "03", "Chem/Bio Defense",
               "120", "1", "CBDP", "7001SA1000", "CB Situational Awareness",
               "B", "Advance Procurement", "Add", "", 48640, "", 36841, "", 8000])
    ws.append(["0300D", "Procurement, Defense-Wide", "CBDP", "03", "Chem/Bio Defense",
               "120", "1", "CBDP", "7001SA1000", "CB Situational Awareness",
               "Z", "Non-add memo", "Non-Add", "", 999999, "", 999999, "", 999999])
    p = tmp_path / "p1_display.xlsx"
    wb.save(p)
    return p


def test_p1_loader_aggregates_to_bli(pg_dsn, tmp_path):
    n = load_p1_rollup(pg_dsn, make_p1_xlsx(tmp_path), exhibit="P-1", fiscal_year=2026)
    assert n == 3  # one BLI x three FY amount columns
    with psycopg.connect(pg_dsn) as con:
        rows = dict(con.execute(
            "select amount_type, amount_thousands from budget_lines"
            " where exhibit='P-1' and pe_bli='7001SA1000'"
        ).fetchall())
    assert rows["fy_2024_actuals"] == Decimal("148640")  # 100000 + 48640, Non-Add excluded
    assert rows["fy_2025_enacted"] == Decimal("186841")
    assert rows["fy_2026_disc_request"] == Decimal("208051")


def test_p1_loader_is_idempotent(pg_dsn, tmp_path):
    p = make_p1_xlsx(tmp_path)
    load_p1_rollup(pg_dsn, p, exhibit="P-1", fiscal_year=2026)
    load_p1_rollup(pg_dsn, p, exhibit="P-1", fiscal_year=2026)
    with psycopg.connect(pg_dsn) as con:
        total = con.execute(
            "select count(*) from budget_lines where exhibit='P-1'"
        ).fetchone()[0]
    assert total == 3
