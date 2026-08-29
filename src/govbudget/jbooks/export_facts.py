"""Export live Postgres jbook facts to Parquet for the DuckDB mart layer.

Lake provenance invariant (Phase 5E Task 5): every exported budget_lines
row must trace to a source document (source_document_id is not null) — the
same document-join contract the details/detail_narratives exports already
enforce. A provenance-less row can never mint a citation (fact_id_workbook
needs the document sha256) and cannot be independently recomputed by the
verify-phase5e lake gates. Migration 005 made the invariant structural
(source_document_id NOT NULL, deleting the one legacy orphan — id 13541,
a title-NULL duplicate of the PB2026 0601101E fy_2024_actuals row from an
early 5C load); the filter here stays as belt-and-braces.
"""
from pathlib import Path

import duckdb
import psycopg

EXPORTS: dict[str, str] = {
    "budget_lines": (
        "select exhibit, fiscal_year, account, account_title, organization,"
        " budget_activity, budget_activity_title, pe_bli, title, amount_type,"
        " amount_thousands, source_document_id, source_sheet,"
        " coalesce(array_to_string(source_cells, ','), '') as source_cells from budget_lines"
        " where source_document_id is not null"
    ),
    "details": (
        # d.account is the P-40 AppropriationNumber the reconciler already
        # joins budget_lines.account on byte-for-byte. It was not exported,
        # so the detail side of the mart had no way to tell two programs
        # sharing a BLI code apart and summed them (ten PB2026 Navy keys —
        # '3010' is LPD Flight II in 1611N AND Shipboard Tactical
        # Communications in 1810N). NULL for R-1/RDT&E rows, which carry
        # no appropriation on the detail side.
        "select d.pe_bli, d.project_number, d.project_title, d.scenario,"
        " d.amount_millions, d.xml_path, d.reconciled, d.account, j.org,"
        " j.exhibit_family, j.fiscal_year, d.document_id,"
        " j.sha256 as document_sha256"
        " from budget_line_details d join jbook_documents j on j.id=d.document_id"
        " where not d.superseded"
    ),
    "detail_narratives": (
        "select n.pe_bli, n.project_number, n.kind, n.title, n.body, n.xml_path,"
        " j.org, j.fiscal_year, n.document_id"
        " from detail_narratives n join jbook_documents j on j.id=n.document_id"
        " where not n.superseded"
    ),
    "budget_line_awards": (
        "select pe_bli, exhibit, fiscal_year, organization, award_piid,"
        " recipient_name, recipient_uei, matched_obligation, method, confidence,"
        " score, rationale from budget_line_awards"
    ),
    "documents": (
        # rel_path relativizes the machine-specific absolute file_path
        "select id, org, exhibit_family, fiscal_year, title, source_url, sha256,"
        " bytes, downloaded_at,"
        " 'fy' || fiscal_year || '/' || lower(org) || '/' || title as rel_path"
        " from jbook_documents where status = 'downloaded' and sha256 is not null"
    ),
    "program_lineage": (
        "select from_pe_bli, to_pe_bli, fiscal_year, relation, portion_amount,"
        " confidence, evidence_fact_id, evidence_sentence, evidence_page, inference_basis"
        " from program_lineage"
    ),
    "program_family": "select pe_bli, family_id from program_family",
}


def export_facts(dsn: str, *, parquet_dir: Path) -> list[Path]:
    out_dir = parquet_dir / "jbooks"
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    con = duckdb.connect()
    try:
        with psycopg.connect(dsn) as pg:
            for name, sql in EXPORTS.items():
                cur = pg.execute(sql)
                cols = [d.name for d in cur.description]
                rows = cur.fetchall()
                out = out_dir / f"{name}.parquet"
                con.execute("drop table if exists _t")
                col_defs = ", ".join(f'"{c}" varchar' for c in cols)
                con.execute(f"create table _t ({col_defs})")
                if rows:
                    con.executemany(
                        f"insert into _t values ({', '.join(['?'] * len(cols))})",
                        [[None if v is None else str(v) for v in row] for row in rows],
                    )
                out_sql = str(out).replace("'", "''")
                con.execute(f"copy _t to '{out_sql}' (format parquet, compression zstd)")
                written.append(out)
    finally:
        con.close()
    return sorted(written)
