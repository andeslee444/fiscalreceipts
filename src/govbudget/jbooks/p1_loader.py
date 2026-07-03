import re
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import psycopg
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

P1_ID_HEADERS = {
    "Account": "account",
    "Account Title": "account_title",
    "Organization": "organization",
    "Budget Activity": "budget_activity",
    "Budget Activity Title": "budget_activity_title",
    "Line Number": "line_number",
    "Budget Line Item": "pe_bli",
    "Budget Line Item (BLI) Title": "title",
}
P1_REQUIRED = {"Account", "Organization", "Budget Line Item", "Add/Non-Add"}


def _slug(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.lower()).strip("_")


def _str(v) -> str | None:
    return None if v is None else str(v)


def _find_header_row(ws) -> tuple[int, dict[int, str]]:
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=20, values_only=True), start=1):
        cells = {j: str(v).strip() for j, v in enumerate(row) if v is not None}
        if P1_REQUIRED <= set(cells.values()):
            return i, cells
    raise ValueError(f"No header row with {P1_REQUIRED} found in first 20 rows")


def load_p1_rollup(
    dsn: str, xlsx_path: Path, *, exhibit: str, fiscal_year: int,
    source_document_id: int | None = None,
) -> int:
    """Melt a P-1/P-1R display workbook into BLI-grain budget_lines rows.

    P-1 rows are (BLI x cost type x BSA) grain with Add/Non-Add memo rows;
    this loader keeps 'Add' rows only, melts the per-FY '... Amount' columns
    (slug drops the suffix so amount_types align with reconcile.scenario_map: fy_2024_actuals etc.),
    and sums to (account, organization, budget activity, BLI) grain. Returns upserts.
    """
    wb = load_workbook(xlsx_path, read_only=True, data_only=True)
    sheet = wb[f"Exhibit {exhibit}"] if f"Exhibit {exhibit}" in wb.sheetnames else wb[wb.sheetnames[0]]
    header_row, headers = _find_header_row(sheet)
    # PB2025 suffixes footnoted columns with '*' ('FY 2024 PB Request with CR
    # Adjustments Amount*') — strip footnote markers before the suffix check.
    clean = {j: h.rstrip("*").strip() for j, h in headers.items()}
    amount_cols = {
        j: _slug(clean[j][: -len(" Amount")])
        for j, h in headers.items()
        if h.upper().startswith("FY ") and clean[j].endswith(" Amount")
    }
    id_cols = {j: P1_ID_HEADERS[h] for j, h in headers.items() if h in P1_ID_HEADERS}
    add_col = next(j for j, h in headers.items() if h == "Add/Non-Add")

    # key matches the DB unique constraint grain:
    # (account, account_title, organization, ba, ba_title, bli, title)
    # line_number is intentionally excluded so all cost-type sub-rows for the same
    # BLI aggregate into a single bucket before insert (avoiding last-write-wins collision).
    sums: dict[tuple, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    cells: dict[tuple, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for row_idx, row in enumerate(
        sheet.iter_rows(min_row=header_row + 1, values_only=True),
        start=header_row + 1,
    ):
        ids = {name: row[j] for j, name in id_cols.items() if j < len(row)}
        if not ids.get("pe_bli"):
            continue
        if add_col >= len(row) or str(row[add_col]).strip().lower() != "add":
            continue
        key = (
            str(ids.get("account")), ids.get("account_title"),
            str(ids.get("organization")), _str(ids.get("budget_activity")),
            ids.get("budget_activity_title"),
            str(ids.get("pe_bli")), ids.get("title"),
        )
        for j, amount_type in amount_cols.items():
            if j >= len(row) or row[j] is None or str(row[j]).strip() == "":
                continue
            try:
                amount = Decimal(str(row[j]))
            except ArithmeticError:
                continue
            if amount.is_nan():
                continue
            sums[key][amount_type] += amount
            cells[key][amount_type].append(f"{get_column_letter(j + 1)}{row_idx}")

    upserted = 0
    with psycopg.connect(dsn) as con:
        for key, amounts in sums.items():
            (account, account_title, organization, ba, ba_title,
             pe_bli, title) = key
            for amount_type, amount in amounts.items():
                con.execute(
                    """
                    insert into budget_lines
                      (exhibit, fiscal_year, account, account_title, organization,
                       budget_activity, budget_activity_title, pe_bli,
                       title, amount_type, amount_thousands, source_document_id,
                       source_sheet, source_cells)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (exhibit, fiscal_year, account, organization, budget_activity, pe_bli, amount_type)
                    do update set amount_thousands = excluded.amount_thousands,
                                  title = excluded.title,
                                  source_document_id = excluded.source_document_id,
                                  source_sheet = excluded.source_sheet,
                                  source_cells = excluded.source_cells
                    """,
                    (exhibit, fiscal_year, account, account_title, organization,
                     ba, ba_title, pe_bli, title, amount_type, amount,
                     source_document_id, sheet.title, cells[key][amount_type]),
                )
                upserted += 1
    return upserted
