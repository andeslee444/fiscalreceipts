"""Phase 5B-1: typed site artifact export.

export_site(dsn, duckdb_path, *, out_dir, pdf_base_url) → summary dict.

Produces:
  out_dir/data/{mart}.parquet      — 11 DuckDB mart tables, typed, zstd
  out_dir/data/jbook_details.parquet   — Postgres typed export w/ fact_id + resolution
  out_dir/data/jbook_narratives.parquet
  out_dir/data/budget_lines.parquet    — only rows with source_document_id
  out_dir/citations/citations.parquet  — one row per citable fact (jbook_pdf/workbook/lda_filing)
  out_dir/pdfs/{sha256}.pdf            — sha-named PDF copies
  out_dir/workbooks/{sha256}.xlsx      — sha-named XLSX copies
  out_dir/manifest.json

Canonical identity functions (fact_id_*) are defined here and imported by
verify_phase5b1 and tests — single source of truth.

No pandas; typed exports use duckdb create-table + executemany with native
Python values. DuckDB opened read_only=True for mart reads.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import shutil
from decimal import Decimal
from pathlib import Path


# ---------------------------------------------------------------------------
# Canonical identity (binding — imported by tests and verify_phase5b1)
# ---------------------------------------------------------------------------


def canonical_amount(amount) -> str:
    """Canonical 3-decimal string for identity hashing: '280.494', '-1.200', '0.000'."""
    return f"{Decimal(amount):.3f}"


def fact_id_jbook(document_sha256, pe_bli, project_number, scenario, amount) -> str:
    key = f"{document_sha256}|{pe_bli}|{project_number or ''}|{scenario}|{canonical_amount(amount)}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def fact_id_workbook(document_sha256, exhibit, fiscal_year, account, organization,
                     budget_activity, pe_bli, amount_type) -> str:
    key = (f"{document_sha256}|{exhibit}|{fiscal_year}|{account}|{organization}|"
           f"{budget_activity or ''}|{pe_bli}|{amount_type}")
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def fact_id_lda(filing_uuid, pe_bli, matched_term) -> str:
    return hashlib.sha256(f"{filing_uuid}|{pe_bli}|{matched_term}".encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# DuckDB mart names (11 required; fct_budget_lines comes from Postgres)
# ---------------------------------------------------------------------------

_MART_NAMES = [
    "dim_programs",
    "fct_budget_to_awards",
    "fct_budget_trajectory",
    "dim_entities",
    "fct_influence",
    "fct_program_lobbying",
    "dim_lobbyists",
    "fct_program_concentration",
    "fct_improper_exposure",
    "dim_geography",
    "fct_state_per_capita",
]

# Citation tiers — datasets that have a citation kind in this export
_CITED_DATASETS = {"jbook_details", "budget_lines", "fct_program_lobbying"}


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def export_site(
    dsn: str,
    duckdb_path,
    *,
    out_dir,
    pdf_base_url: str,
) -> dict:
    """Build the full site artifact bundle.

    Returns:
        {datasets, citations, pdfs, workbooks, skipped_unresolved, skipped_zero_amount}
    """
    import duckdb
    import psycopg

    out_dir = Path(out_dir)
    duckdb_path = Path(duckdb_path)
    data_dir = out_dir / "data"
    cit_dir = out_dir / "citations"
    pdfs_dir = out_dir / "pdfs"
    wb_dir = out_dir / "workbooks"
    for d in (data_dir, cit_dir, pdfs_dir, wb_dir):
        d.mkdir(parents=True, exist_ok=True)

    dataset_counts: dict[str, int] = {}

    # -----------------------------------------------------------------------
    # 1. DuckDB mart exports
    # -----------------------------------------------------------------------
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        # Verify all 11 marts exist before writing any output
        for name in _MART_NAMES:
            try:
                con.execute(f"select count(*) from {name}").fetchone()
            except duckdb.CatalogException:
                raise ValueError(f"required mart missing from duckdb: {name}")

        for name in _MART_NAMES:
            dest = data_dir / f"{name}.parquet"
            dest_str = str(dest).replace("'", "''")
            con.execute(
                f"COPY (select * from {name}) TO '{dest_str}'"
                " (format parquet, compression zstd)"
            )
            count = con.execute(f"select count(*) from '{dest_str}'").fetchone()[0]
            dataset_counts[name] = count
    finally:
        con.close()

    # -----------------------------------------------------------------------
    # 2. Postgres typed exports
    # -----------------------------------------------------------------------
    skipped_unresolved = 0
    skipped_zero_amount = 0

    with psycopg.connect(dsn) as pg:
        # ---- 2a. jbook_details.parquet ----
        rows_details = pg.execute(
            """
            select d.pe_bli, d.project_number, d.project_title, d.scenario,
                   d.amount_millions, d.xml_path, j.org, j.exhibit_family,
                   j.fiscal_year, j.sha256 as document_sha256,
                   coalesce(p.resolution, 'unresolved') as resolution
            from budget_line_details d
            join jbook_documents j on j.id = d.document_id
            left join provenance_pages p
                on  p.document_sha256 = j.sha256
                and p.pe_bli = d.pe_bli
                and p.scenario = d.scenario
                and p.project_number is not distinct from d.project_number
                and p.amount_millions = d.amount_millions
            where not d.superseded and j.sha256 is not null
            order by j.sha256, d.pe_bli, d.scenario
            """
        ).fetchall()

        detail_rows = []
        for (pe_bli, project_number, project_title, scenario,
             amount_millions, xml_path, org, exhibit_family,
             fiscal_year, document_sha256, resolution) in rows_details:
            fid = fact_id_jbook(document_sha256, pe_bli, project_number, scenario, amount_millions)
            detail_rows.append((
                fid, pe_bli, project_number, project_title, scenario,
                float(amount_millions) if amount_millions is not None else None,
                "USD millions", xml_path, org, exhibit_family,
                int(fiscal_year) if fiscal_year is not None else None,
                document_sha256, resolution,
            ))

        _write_typed_parquet(
            data_dir / "jbook_details.parquet",
            columns=[
                ("fact_id", "varchar"), ("pe_bli", "varchar"),
                ("project_number", "varchar"), ("project_title", "varchar"),
                ("scenario", "varchar"), ("amount_millions", "double"),
                ("units", "varchar"), ("xml_path", "varchar"),
                ("org", "varchar"), ("exhibit_family", "varchar"),
                ("fiscal_year", "integer"), ("document_sha256", "varchar"),
                ("resolution", "varchar"),
            ],
            rows=detail_rows,
        )
        dataset_counts["jbook_details"] = len(detail_rows)

        # ---- 2b. jbook_narratives.parquet ----
        rows_narr = pg.execute(
            """
            select n.pe_bli, n.project_number, n.kind, n.title, n.body, n.xml_path,
                   j.org, j.fiscal_year, j.sha256 as document_sha256
            from detail_narratives n
            join jbook_documents j on j.id = n.document_id
            where not n.superseded and j.sha256 is not null
            order by j.sha256, n.pe_bli
            """
        ).fetchall()

        _write_typed_parquet(
            data_dir / "jbook_narratives.parquet",
            columns=[
                ("pe_bli", "varchar"), ("project_number", "varchar"),
                ("kind", "varchar"), ("title", "varchar"),
                ("body", "varchar"), ("xml_path", "varchar"),
                ("org", "varchar"),
                ("fiscal_year", "integer"), ("document_sha256", "varchar"),
            ],
            rows=[
                (pe_bli, pn, kind, title, body, xml_path, org,
                 int(fy) if fy is not None else None, sha)
                for pe_bli, pn, kind, title, body, xml_path, org, fy, sha in rows_narr
            ],
        )
        dataset_counts["jbook_narratives"] = len(rows_narr)

        # ---- 2c. budget_lines.parquet (only rows with source_document_id) ----
        all_bl = pg.execute(
            """
            select bl.exhibit, bl.fiscal_year, bl.account, bl.account_title,
                   bl.organization, bl.budget_activity, bl.budget_activity_title,
                   bl.pe_bli, bl.title, bl.amount_type, bl.amount_thousands,
                   bl.source_document_id, j.sha256 as document_sha256,
                   bl.source_sheet,
                   coalesce(array_to_string(bl.source_cells, ','), '') as source_cells
            from budget_lines bl
            left join jbook_documents j on j.id = bl.source_document_id
            order by bl.exhibit, bl.pe_bli, bl.amount_type
            """
        ).fetchall()

        bl_rows = []
        bl_excluded = 0
        for row in all_bl:
            (exhibit, fiscal_year, account, account_title, organization,
             budget_activity, budget_activity_title, pe_bli, title,
             amount_type, amount_thousands, source_document_id,
             document_sha256, source_sheet, source_cells) = row
            if source_document_id is None:
                bl_excluded += 1
                continue
            if document_sha256 is None:
                bl_excluded += 1
                continue
            fid = fact_id_workbook(
                document_sha256, exhibit, fiscal_year, account,
                organization, budget_activity, pe_bli, amount_type,
            )
            bl_rows.append((
                fid, exhibit,
                int(fiscal_year) if fiscal_year is not None else None,
                account, account_title, organization, budget_activity,
                budget_activity_title, pe_bli, title, amount_type,
                float(amount_thousands) if amount_thousands is not None else None,
                "USD thousands", document_sha256, source_sheet, source_cells,
            ))

        if bl_excluded:
            print(f"budget_lines.parquet: excluded {bl_excluded} rows lacking source_document_id (pre-backfill)")

        _write_typed_parquet(
            data_dir / "budget_lines.parquet",
            columns=[
                ("fact_id", "varchar"), ("exhibit", "varchar"),
                ("fiscal_year", "integer"), ("account", "varchar"),
                ("account_title", "varchar"), ("organization", "varchar"),
                ("budget_activity", "varchar"), ("budget_activity_title", "varchar"),
                ("pe_bli", "varchar"), ("title", "varchar"),
                ("amount_type", "varchar"), ("amount_thousands", "double"),
                ("units", "varchar"), ("document_sha256", "varchar"),
                ("source_sheet", "varchar"), ("source_cells", "varchar"),
            ],
            rows=bl_rows,
        )
        dataset_counts["budget_lines"] = len(bl_rows)

        # -----------------------------------------------------------------------
        # 3. Documents: copy PDFs and workbooks
        # -----------------------------------------------------------------------
        doc_rows = pg.execute(
            """
            select sha256, file_path, source_url, downloaded_at
            from jbook_documents
            where status = 'downloaded' and sha256 is not null
            order by sha256
            """
        ).fetchall()

    n_pdfs = 0
    n_workbooks = 0
    for sha256, file_path, source_url, downloaded_at in doc_rows:
        src = Path(file_path)
        if not src.exists():
            raise FileNotFoundError(f"document {sha256} missing on disk: {src}")
        fp_lower = file_path.lower()
        if fp_lower.endswith(".pdf"):
            dest = pdfs_dir / f"{sha256}.pdf"
            if not dest.exists() or dest.stat().st_size != src.stat().st_size:
                shutil.copyfile(src, dest)
            n_pdfs += 1
        elif fp_lower.endswith(".xlsx"):
            dest = wb_dir / f"{sha256}.xlsx"
            if not dest.exists() or dest.stat().st_size != src.stat().st_size:
                shutil.copyfile(src, dest)
            n_workbooks += 1

    # -----------------------------------------------------------------------
    # 4. Citations parquet
    # -----------------------------------------------------------------------
    citation_rows: list[tuple] = []

    # --- 4a. jbook_pdf citations ---
    import duckdb as _duckdb
    details_pq = data_dir / "jbook_details.parquet"
    if details_pq.exists() and len(detail_rows) > 0:
        # Load provenance via duckdb over the just-written parquet + pg query
        with psycopg.connect(dsn) as pg2:
            prov_rows = pg2.execute(
                """
                select p.document_sha256, p.pe_bli, p.project_number,
                       p.scenario, p.amount_millions,
                       p.amount_text, p.page_number, p.x0, p.x1,
                       p.top_pt, p.bottom_pt, p.page_width, p.page_height,
                       p.resolution, p.candidate_pages,
                       j.source_url, j.downloaded_at
                from provenance_pages p
                join jbook_documents j on j.sha256 = p.document_sha256
                order by p.document_sha256, p.pe_bli, p.scenario
                """
            ).fetchall()

        for (doc_sha, pe_bli, project_number, scenario, amount_millions,
             amount_text, page_number, x0, x1, top_pt, bottom_pt,
             page_width, page_height, resolution, candidate_pages,
             source_url, downloaded_at) in prov_rows:
            if resolution == "zero_amount":
                skipped_zero_amount += 1
                continue
            if resolution == "unresolved":
                skipped_unresolved += 1
                continue
            # Only unique/ambiguous_first
            fid = fact_id_jbook(doc_sha, pe_bli, project_number, scenario, amount_millions)
            hosted = f"{pdf_base_url}/{doc_sha}.pdf#page={page_number}"
            official = f"{source_url}#page={page_number}"
            ret_at = downloaded_at.isoformat() if downloaded_at else None
            citation_rows.append((
                fid, "jbook_pdf", "USD millions",
                amount_text,
                int(page_number) if page_number is not None else None,
                float(x0) if x0 is not None else None,
                float(x1) if x1 is not None else None,
                float(top_pt) if top_pt is not None else None,
                float(bottom_pt) if bottom_pt is not None else None,
                float(page_width) if page_width is not None else None,
                float(page_height) if page_height is not None else None,
                resolution,
                None,  # sheet
                None,  # cells
                None,  # amount_thousands
                doc_sha,  # sha256
                hosted,   # hosted_pdf_url
                official, # official_url
                None,     # xml_path
                ret_at,   # retrieved_at
            ))

    # --- 4b. workbook citations ---
    for (fid, exhibit, fiscal_year, account, account_title, organization,
         budget_activity, budget_activity_title, pe_bli, title, amount_type,
         amount_thousands, units, document_sha256, source_sheet, source_cells) in bl_rows:
        if document_sha256 is None:
            continue
        # official_url: the source_url of the jbook document
        # We need to look up source_url from jbook_documents — fetch lazily
        citation_rows.append((
            fid, "workbook", "USD thousands",
            None,  # amount_text
            None, None, None, None, None, None, None,  # page bbox
            None,  # resolution
            source_sheet,
            source_cells,
            float(amount_thousands) if amount_thousands is not None else None,
            document_sha256,
            None,  # hosted_pdf_url
            None,  # official_url — populated below
            None,  # xml_path
            None,  # retrieved_at — populated below
        ))

    # Populate official_url and retrieved_at for workbook citations
    if citation_rows:
        with psycopg.connect(dsn) as pg3:
            doc_lookup = {
                r[0]: (r[1], r[2])
                for r in pg3.execute(
                    "select sha256, source_url, downloaded_at from jbook_documents"
                    " where sha256 is not null"
                ).fetchall()
            }
        # Rebuild citation_rows with populated workbook fields
        updated = []
        for row in citation_rows:
            (fid, kind, units, amount_text, page_number, x0, x1,
             top_pt, bottom_pt, page_width, page_height, resolution,
             sheet, cells, amount_thousands, sha256, hosted_pdf_url,
             official_url, xml_path, retrieved_at) = row
            if kind == "workbook" and sha256 in doc_lookup:
                src_url, dl_at = doc_lookup[sha256]
                official_url = src_url
                retrieved_at = dl_at.isoformat() if dl_at else None
            updated.append((
                fid, kind, units, amount_text, page_number, x0, x1,
                top_pt, bottom_pt, page_width, page_height, resolution,
                sheet, cells, amount_thousands, sha256, hosted_pdf_url,
                official_url, xml_path, retrieved_at,
            ))
        citation_rows = updated

    # --- 4c. LDA filing citations (from duckdb fct_program_lobbying) ---
    lda_con = _duckdb.connect(str(duckdb_path), read_only=True)
    try:
        lda_rows = lda_con.execute(
            "select filing_uuid, pe_bli, matched_term, filing_url"
            " from fct_program_lobbying"
        ).fetchall()
    except _duckdb.CatalogException:
        lda_rows = []
    finally:
        lda_con.close()

    for filing_uuid, pe_bli, matched_term, filing_url in lda_rows:
        if not filing_uuid or not pe_bli or not matched_term:
            continue
        fid = fact_id_lda(filing_uuid, pe_bli, matched_term)
        citation_rows.append((
            fid, "lda_filing", None,  # kind, units
            None, None, None, None, None, None, None, None,  # amount_text + bbox
            None,  # resolution
            None,  # sheet
            None,  # cells
            None,  # amount_thousands
            None,  # sha256
            None,  # hosted_pdf_url
            filing_url,  # official_url
            None,  # xml_path
            None,  # retrieved_at
        ))

    # Write citations.parquet
    _write_typed_parquet(
        cit_dir / "citations.parquet",
        columns=[
            ("fact_id", "varchar"), ("kind", "varchar"),
            ("units", "varchar"), ("amount_text", "varchar"),
            ("page_number", "integer"),
            ("x0", "double"), ("x1", "double"),
            ("top_pt", "double"), ("bottom_pt", "double"),
            ("page_width", "double"), ("page_height", "double"),
            ("resolution", "varchar"),
            ("sheet", "varchar"), ("cells", "varchar"),
            ("amount_thousands", "double"),
            ("sha256", "varchar"),
            ("hosted_pdf_url", "varchar"), ("official_url", "varchar"),
            ("xml_path", "varchar"), ("retrieved_at", "varchar"),
        ],
        rows=citation_rows,
    )
    dataset_counts["citations"] = len(citation_rows)

    # -----------------------------------------------------------------------
    # 5. Manifest
    # -----------------------------------------------------------------------
    # Compute uncited_datasets: all data/*.parquet names with no citation kind
    all_data_names = sorted(
        p.stem for p in data_dir.glob("*.parquet")
    )
    uncited = [n for n in all_data_names if n not in _CITED_DATASETS]

    # Count citations by kind
    cit_by_kind: dict[str, int] = {}
    for row in citation_rows:
        kind = row[1]
        cit_by_kind[kind] = cit_by_kind.get(kind, 0) + 1

    # Re-read actual rowcounts from written parquets
    import duckdb as _duckdb2
    final_counts: dict[str, int] = {}
    for pq_path in sorted(data_dir.glob("*.parquet")):
        name = pq_path.stem
        try:
            n = _duckdb2.sql(f"select count(*) from read_parquet('{pq_path}')").fetchone()[0]
            final_counts[name] = n
        except Exception:
            final_counts[name] = 0

    manifest = {
        "built_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "datasets": final_counts,
        "citations": cit_by_kind,
        "skipped_unresolved": skipped_unresolved,
        "skipped_zero_amount": skipped_zero_amount,
        "uncited_datasets": uncited,
        "pdf_base_url": pdf_base_url,
        "schema_version": 1,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True)
    )

    return {
        "datasets": len(final_counts),
        "citations": len(citation_rows),
        "pdfs": n_pdfs,
        "workbooks": n_workbooks,
        "skipped_unresolved": skipped_unresolved,
        "skipped_zero_amount": skipped_zero_amount,
    }


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------


def _write_typed_parquet(path: Path, columns: list[tuple[str, str]], rows: list) -> None:
    """Write rows to path using an in-memory DuckDB with explicit typed columns.

    columns: [(name, duckdb_type), ...]
    rows:    list of tuples; None values allowed (become NULL).

    No pandas, no pyarrow — plain duckdb executemany with native Python values.
    """
    import duckdb

    col_defs = ", ".join(f'"{name}" {dtype}' for name, dtype in columns)
    placeholders = ", ".join("?" for _ in columns)
    path_str = str(path).replace("'", "''")

    con = duckdb.connect()
    try:
        con.execute(f"create table _t ({col_defs})")
        if rows:
            con.executemany(f"insert into _t values ({placeholders})", rows)
        con.execute(f"COPY _t TO '{path_str}' (format parquet, compression zstd)")
    finally:
        con.close()
