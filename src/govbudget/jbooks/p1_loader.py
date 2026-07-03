import re
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import psycopg
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from govbudget.jbooks.era_keys import era_procurement_key
from govbudget.jbooks.rollup_loader import norm_header

P1_ID_HEADERS = {
    "Account": "account",
    "Account Title": "account_title",
    "Organization": "organization",
    "Budget Activity": "budget_activity",
    "Budget Activity Title": "budget_activity_title",
    "Line Number": "line_number",
    "Budget Line Item": "pe_bli",
    "Budget Line Item (BLI) Title": "title",
    # PB2024 spelling (the R-1 header reused verbatim on P-1/P-1R; PB2025+
    # shortened it to 'Budget Line Item (BLI) Title' above — missing this
    # variant loaded PB2024's 4,585 P-1 rows title-NULL)
    "Program Element/Budget Line Item (BLI) Title": "title",
    # PB2017–PB2023 era spellings (no workbook carries both variants)
    "Line Item": "pe_bli",
    "Line Item Title": "title",
}
P1_REQUIRED = {"Account", "Organization"}
P1_BLI_HEADERS = ("Budget Line Item", "Line Item")


def _slug(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.lower()).strip("_")


def _str(v) -> str | None:
    return None if v is None else str(v)


def _find_header_row(ws) -> tuple[int, dict[int, str]]:
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=20, values_only=True), start=1):
        cells = {j: norm_header(v) for j, v in enumerate(row) if v is not None}
        vals = set(cells.values())
        if P1_REQUIRED <= vals and any(h in vals for h in P1_BLI_HEADERS):
            return i, cells
    raise ValueError(
        f"No header row with {P1_REQUIRED} + one of {P1_BLI_HEADERS}"
        " found in first 20 rows"
    )


def load_p1_rollup(
    dsn: str, xlsx_path: Path, *, exhibit: str, fiscal_year: int,
    source_document_id: int,
) -> int:
    """Melt a P-1/P-1R display workbook into BLI-grain budget_lines rows.

    source_document_id is REQUIRED (migration 005: budget_lines provenance
    is a structural invariant — every row must trace to a jbook_documents
    row, the same contract the lake export enforces).

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
    # PB2017–PB2023 P-1 workbooks key rows by 'Line Item' display codes the
    # era P-40 XML never carries; the era's shared identifier is the P-1 line
    # number (the XML's P1LineNumber), so pe_bli comes from 'Line Number' —
    # namespaced to '{account}-{org}-L{line}' via era_procurement_key
    # (Finding D: bare line numbers collide with modern BLI codes, span
    # orgs, and conflate programs; load_details keys the era XML side
    # identically so reconciliation still joins). Modern workbooks
    # ('Budget Line Item' BLI codes) are untouched; era P-1R has neither
    # 'Budget Line Item' nor 'Line Number' and keeps the 'Line Item' code
    # (P-1R is never reconciled against XML details).
    header_vals = set(headers.values())
    era_line_keying = (
        "Budget Line Item" not in header_vals and "Line Number" in header_vals
    )
    if era_line_keying:
        id_cols = {
            j: n for j, n in id_cols.items() if n not in ("pe_bli", "line_number")
        }
        id_cols[next(j for j, h in headers.items() if h == "Line Number")] = "pe_bli"
    # PB2017–PB2023 P-1R workbooks have no Add/Non-Add column: nothing to filter.
    add_col = next((j for j, h in headers.items() if h == "Add/Non-Add"), None)

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
        if add_col is not None and (
            add_col >= len(row) or str(row[add_col]).strip().lower() != "add"
        ):
            continue
        pe_bli = (
            era_procurement_key(
                str(ids.get("account")), str(ids.get("organization")),
                str(ids.get("pe_bli")),
            )
            if era_line_keying
            else str(ids.get("pe_bli")).strip()
        )
        key = (
            str(ids.get("account")), ids.get("account_title"),
            str(ids.get("organization")), _str(ids.get("budget_activity")),
            ids.get("budget_activity_title"),
            pe_bli,
            ids.get("title"),
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
