"""Export live Postgres jbook facts to Parquet for the DuckDB mart layer."""
from pathlib import Path

import duckdb
import psycopg

EXPORTS: dict[str, str] = {
    "budget_lines": (
        "select exhibit, fiscal_year, account, account_title, organization,"
        " budget_activity, budget_activity_title, pe_bli, title, amount_type,"
        " amount_thousands from budget_lines"
    ),
    "details": (
        "select d.pe_bli, d.project_number, d.project_title, d.scenario,"
        " d.amount_millions, d.xml_path, d.reconciled, j.org, j.exhibit_family,"
        " j.fiscal_year, d.document_id"
        " from budget_line_details d join jbook_documents j on j.id=d.document_id"
        " where not d.superseded"
    ),
    "detail_narratives": (
        "select n.pe_bli, n.project_number, n.kind, n.title, n.body, n.xml_path,"
        " j.org, j.fiscal_year"
        " from detail_narratives n join jbook_documents j on j.id=n.document_id"
        " where not n.superseded"
    ),
    "budget_line_awards": (
        "select pe_bli, exhibit, fiscal_year, organization, award_piid,"
        " recipient_name, recipient_uei, matched_obligation, method, confidence,"
        " score, rationale from budget_line_awards"
    ),
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
                con.execute(f"copy _t to '{out}' (format parquet, compression zstd)")
                written.append(out)
    finally:
        con.close()
    return sorted(written)
