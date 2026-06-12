"""Phase 5B-1/5B-2: typed site artifact export.

export_site(dsn, duckdb_path, *, out_dir, pdf_base_url) → summary dict.

Produces (5B-1):
  out_dir/data/{mart}.parquet      — 11 DuckDB mart tables, typed, zstd
  out_dir/data/jbook_details.parquet   — Postgres typed export w/ fact_id + resolution
  out_dir/data/jbook_narratives.parquet
  out_dir/data/budget_lines.parquet    — only rows with source_document_id
  out_dir/citations/citations.parquet  — one row per citable fact (jbook_pdf/workbook/lda_filing)
  out_dir/pdfs/{sha256}.pdf            — sha-named PDF copies
  out_dir/workbooks/{sha256}.xlsx      — sha-named XLSX copies
  out_dir/manifest.json

Produces (5B-2 sidecars):
  out_dir/json/programs.json
  out_dir/json/program_details/{pe_bli}.json  (326 files)
  out_dir/json/entities_top.json
  out_dir/json/entity_details/{slug}.json     (top-200 entities)
  out_dir/json/agencies.json
  out_dir/json/citations.json
  out_dir/json/search_quick.json
  out_dir/json/site_meta.json

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
    if amount is None:
        raise ValueError("canonical_amount: amount is None")
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

        # Compute skip counters from the same resolution values written to the parquet.
        # This ensures manifest and parquet agree by construction (the integrity gate
        # catches post-export tampering). resolution is the last element (index 12).
        skipped_unresolved = sum(1 for r in detail_rows if r[12] == "unresolved")
        skipped_zero_amount = sum(1 for r in detail_rows if r[12] == "zero_amount")

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
        bl_excluded_null_amount = 0
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
            if amount_thousands is None:
                bl_excluded_null_amount += 1
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
                float(amount_thousands),
                "USD thousands", document_sha256, source_sheet, source_cells,
            ))

        if bl_excluded:
            print(f"budget_lines.parquet: excluded {bl_excluded} rows lacking source_document_id (pre-backfill)")
        if bl_excluded_null_amount:
            print(f"budget_lines.parquet: excluded {bl_excluded_null_amount} rows with NULL amount_thousands")

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
            _copy_if_needed(src, dest, sha256)
            n_pdfs += 1
        elif fp_lower.endswith(".xlsx"):
            dest = wb_dir / f"{sha256}.xlsx"
            _copy_if_needed(src, dest, sha256)
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
                -- Deduplicate jbook_documents on sha256 before joining: the same PDF
                -- may appear under two source_urls (e.g. a document re-hosted at a new
                -- URL without changing content). A straight join on sha256 would fan-out
                -- provenance_pages rows and produce duplicate citations. We select the
                -- row with the lowest id to make the choice deterministic and stable.
                join (
                    select distinct on (sha256) sha256, source_url, downloaded_at
                    from jbook_documents
                    where sha256 is not null
                    order by sha256, id
                ) j on j.sha256 = p.document_sha256
                order by p.document_sha256, p.pe_bli, p.scenario
                """
            ).fetchall()

        for (doc_sha, pe_bli, project_number, scenario, amount_millions,
             amount_text, page_number, x0, x1, top_pt, bottom_pt,
             page_width, page_height, resolution, candidate_pages,
             source_url, downloaded_at) in prov_rows:
            if resolution in ("zero_amount", "unresolved"):
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
            float(amount_thousands),
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

    # -----------------------------------------------------------------------
    # 6. JSON sidecars (Phase 5B-2)
    # -----------------------------------------------------------------------
    n_json = _emit_json_sidecars(
        out_dir=out_dir,
        duckdb_path=duckdb_path,
        detail_rows=detail_rows,
        bl_rows=bl_rows,
        citation_rows=citation_rows,
        manifest=manifest,
    )

    # Update manifest with json_sidecars count
    manifest["json_sidecars"] = n_json
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
        "json_files": n_json,
    }


# ---------------------------------------------------------------------------
# Org translation
# ---------------------------------------------------------------------------

from govbudget.jbooks.orgs import workbook_org as _workbook_org


# ---------------------------------------------------------------------------
# JSON sidecar emission (Phase 5B-2)
# ---------------------------------------------------------------------------


def _emit_json_sidecars(
    *,
    out_dir: Path,
    duckdb_path: Path,
    detail_rows: list,
    bl_rows: list,
    citation_rows: list,
    manifest: dict,
) -> int:
    """Emit all JSON sidecars to out_dir/json/.

    Reads DuckDB mart tables (read-only) and uses the already-computed
    detail_rows / bl_rows / citation_rows from the main export pass.

    Returns:
        Number of JSON files written (feeds into manifest["json_sidecars"]).
    """
    import duckdb as _duckdb

    json_dir = out_dir / "json"
    json_dir.mkdir(parents=True, exist_ok=True)

    # -- Open DuckDB for mart reads ------------------------------------------
    con = _duckdb.connect(str(duckdb_path), read_only=True)
    try:
        return _write_all_sidecars(
            json_dir=json_dir,
            out_dir=out_dir,
            con=con,
            detail_rows=detail_rows,
            bl_rows=bl_rows,
            citation_rows=citation_rows,
            manifest=manifest,
        )
    finally:
        con.close()


def _write_all_sidecars(
    *,
    json_dir: Path,
    out_dir: Path,
    con,  # duckdb connection (read-only mart)
    detail_rows: list,
    bl_rows: list,
    citation_rows: list,
    manifest: dict,
) -> int:
    """Core sidecar writer; called from _emit_json_sidecars."""

    n_files = 0

    # ------------------------------------------------------------------ #
    # 0. Build in-memory indexes from already-fetched data                #
    # ------------------------------------------------------------------ #

    # jbook_details index: pe_bli → list of detail dicts
    # detail_rows cols: (fact_id, pe_bli, project_number, project_title, scenario,
    #                    amount_millions, units, xml_path, org, exhibit_family,
    #                    fiscal_year, document_sha256, resolution)
    from collections import defaultdict

    details_by_pe: dict[str, list] = defaultdict(list)
    for row in detail_rows:
        (fid, pe_bli, project_number, project_title, scenario,
         amount_millions, units, xml_path, org, exhibit_family,
         fiscal_year, document_sha256, resolution) = row
        details_by_pe[pe_bli].append({
            "fact_id": fid,
            "project_number": project_number,
            "project_title": project_title,
            "scenario": scenario,
            "amount_millions": amount_millions,
            "units": units,
            "resolution": resolution,
            "xml_path": xml_path,
        })

    # fy2024_fact_id index: pe_bli → fact_id (jbook_details WHERE
    # project_number IS NULL AND scenario='PriorYear'; nullable if absent)
    fy2024_fact_id: dict[str, str] = {}
    for row in detail_rows:
        (fid, pe_bli, project_number, project_title, scenario, *rest) = row
        if project_number is None and scenario == "PriorYear":
            if pe_bli not in fy2024_fact_id:
                fy2024_fact_id[pe_bli] = fid

    # budget_lines index: pe_bli → list of bl dicts
    # bl_rows cols: (fact_id, exhibit, fiscal_year, account, account_title,
    #                organization, budget_activity, budget_activity_title,
    #                pe_bli, title, amount_type, amount_thousands, units,
    #                document_sha256, source_sheet, source_cells)
    bl_by_pe: dict[str, list] = defaultdict(list)
    for row in bl_rows:
        (fid, exhibit, fiscal_year, account, account_title,
         organization, budget_activity, budget_activity_title,
         pe_bli, title, amount_type, amount_thousands, units,
         document_sha256, source_sheet, source_cells) = row
        bl_by_pe[pe_bli].append({
            "fact_id": fid,
            "exhibit": exhibit,
            "amount_type": amount_type,
            "amount_thousands": amount_thousands,
            "units": units,
            "account_title": account_title,
            "organization": organization,
            "source_sheet": source_sheet,
            "source_cells": source_cells,
        })

    # ------------------------------------------------------------------ #
    # 1. Load mart tables from DuckDB                                     #
    # ------------------------------------------------------------------ #

    # dim_programs
    prog_rows = con.execute(
        "select pe_bli, org, exhibit_family, title, project_count,"
        " fy2024_actual_millions, fully_reconciled from dim_programs"
    ).fetchall()

    # fct_budget_trajectory → keyed by (pe_bli, organization)
    traj_rows = con.execute(
        "select pe_bli, organization, fy2024_actuals, fy2025_total,"
        " fy2026_total, fy2526_change, fy2526_pct_change"
        " from fct_budget_trajectory"
    ).fetchall()
    traj_index: dict[tuple, dict] = {}
    for r in traj_rows:
        traj_index[(r[0], r[1])] = {
            "fy2024_actuals": r[2],
            "fy2025_total": r[3],
            "fy2026_total": r[4],
            "fy2526_change": r[5],
            "fy2526_pct_change": r[6],
        }

    # fct_program_lobbying — narratives / mentions
    lob_rows = con.execute(
        "select filing_uuid, pe_bli, program_title, matched_term,"
        " description_snippet, filing_url, client_name, family_key, filing_year"
        " from fct_program_lobbying"
    ).fetchall()
    mentions_by_pe: dict[str, list] = defaultdict(list)
    for r in lob_rows:
        (filing_uuid, pe_bli, program_title, matched_term,
         description_snippet, filing_url, client_name, family_key, filing_year) = r
        if not filing_uuid or not pe_bli:
            continue
        mentions_by_pe[pe_bli].append({
            "filing_uuid": filing_uuid,
            "matched_term": matched_term,
            "description_snippet": description_snippet,
            "filing_url": filing_url,
            "client_name": client_name,
            "family_key": family_key,
            "filing_year": filing_year,
        })

    # fct_budget_to_awards
    awards_rows = con.execute(
        "select pe_bli, award_piid, recipient_name, confidence"
        " from fct_budget_to_awards"
    ).fetchall()
    awards_by_pe: dict[str, list] = defaultdict(list)
    for r in awards_rows:
        pe_bli, award_piid, recipient_name, confidence = r
        awards_by_pe[pe_bli].append({
            "recipient_name": recipient_name,
            "award_piid": award_piid,
            "confidence": confidence,
        })

    # fct_program_concentration — HHI keyed by pe_bli
    conc_rows = con.execute(
        "select pe_bli, hhi, top_family, family_count, program_dollars"
        " from fct_program_concentration"
    ).fetchall()
    hhi_by_pe: dict[str, dict] = {}
    for r in conc_rows:
        pe_bli, hhi, top_family, family_count, program_dollars = r
        hhi_by_pe[pe_bli] = {
            "hhi": hhi,
            "top_family": top_family,
            "family_count": family_count,
            "program_dollars": program_dollars,
        }

    # jbook_narratives — from detail_rows we don't have narratives;
    # we need to re-read from the written parquet or store them in memory.
    # Since narratives come from a separate Postgres query, we read the
    # already-written parquet file.
    narr_by_pe: dict[str, list] = defaultdict(list)
    narr_pq = out_dir / "data" / "jbook_narratives.parquet"
    if narr_pq.exists():
        import duckdb as _duckdb2
        narr_rows = _duckdb2.sql(
            f"select pe_bli, kind, title, body from read_parquet('{narr_pq}')"
        ).fetchall()
        for pe_bli, kind, title, body in narr_rows:
            narr_by_pe[pe_bli].append({"kind": kind, "title": title, "body": body})

    # dim_entities top-200 (ordered by total_obligation desc)
    entity_rows = con.execute(
        "select family_key, display_name, uei_count, total_obligation, worst_confidence"
        " from dim_entities order by total_obligation desc limit 200"
    ).fetchall()

    # Build set of top-200 family_keys for mention link resolution
    top200_family_keys: set[str] = {r[0] for r in entity_rows}

    # fct_influence keyed by family_key
    influence_rows = con.execute(
        "select family_key, filing_year, filings_count, lobbying_income_usd,"
        " lobbying_expense_usd, lobbying_total_usd, family_obligations_usd"
        " from fct_influence"
    ).fetchall()
    influence_by_fk: dict[str, list] = defaultdict(list)
    for r in influence_rows:
        (fk, filing_year, filings_count, lobbying_income_usd,
         lobbying_expense_usd, lobbying_total_usd, family_obligations_usd) = r
        influence_by_fk[fk].append({
            "filing_year": filing_year,
            "filings_count": filings_count,
            "lobbying_income_usd": lobbying_income_usd,
            "lobbying_expense_usd": lobbying_expense_usd,
            "lobbying_total_usd": lobbying_total_usd,
            "family_obligations_usd": family_obligations_usd,
            "nonAdditive": True,
        })

    # fct_program_lobbying keyed by family_key (for entity_details/mentions)
    mentions_by_fk: dict[str, list] = defaultdict(list)
    for r in lob_rows:
        (filing_uuid, pe_bli, program_title, matched_term,
         description_snippet, filing_url, client_name, family_key, filing_year) = r
        if not family_key or not pe_bli:
            continue
        mentions_by_fk[family_key].append({
            "filing_uuid": filing_uuid,
            "pe_bli": pe_bli,
            "program_title": program_title,
            "matched_term": matched_term,
            "filing_year": filing_year,
            "filing_url": filing_url,
        })

    # awards by display_name (for entity_details; exact match only)
    awards_by_display: dict[str, list] = defaultdict(list)
    for r in awards_rows:
        pe_bli, award_piid, recipient_name, confidence = r
        if recipient_name:
            awards_by_display[recipient_name].append({
                "pe_bli": pe_bli,
                "award_piid": award_piid,
                "confidence": confidence,
            })

    # dim_programs set for linked_programs computation
    prog_titles: dict[str, str] = {}
    for r in prog_rows:
        prog_titles[r[0]] = r[3]  # pe_bli → title

    # ------------------------------------------------------------------ #
    # 2. programs.json                                                    #
    # ------------------------------------------------------------------ #

    programs_list = []
    for r in prog_rows:
        pe_bli, org, exhibit_family, title, project_count, fy2024_actual_millions, fully_reconciled = r
        translated = _workbook_org(org)
        traj = traj_index.get((pe_bli, translated))
        programs_list.append({
            "award_count": len(awards_by_pe.get(pe_bli, [])),
            "exhibit_family": exhibit_family,
            "fy2024_actual_millions": fy2024_actual_millions,
            "fy2024_fact_id": fy2024_fact_id.get(pe_bli),
            "fully_reconciled": fully_reconciled,
            "hhi": hhi_by_pe.get(pe_bli),
            "narrative_count": len(narr_by_pe.get(pe_bli, [])),
            "org": org,
            "pe_bli": pe_bli,
            "project_count": project_count,
            "title": title,
            "trajectory": traj,
        })

    _write_json(json_dir / "programs.json", programs_list)
    n_files += 1

    # ------------------------------------------------------------------ #
    # 3. program_details/{pe_bli}.json  (one file per program)           #
    # ------------------------------------------------------------------ #

    det_dir = json_dir / "program_details"
    det_dir.mkdir(exist_ok=True)

    all_pe_blis = {r[0] for r in prog_rows}
    for pe_bli in all_pe_blis:
        obj = {
            "awards": awards_by_pe.get(pe_bli, []),
            "budget_lines": bl_by_pe.get(pe_bli, []),
            "details": details_by_pe.get(pe_bli, []),
            "mentions": _build_mentions(
                mentions_by_pe.get(pe_bli, []),
                top200_family_keys,
            ),
            "narratives": narr_by_pe.get(pe_bli, []),
        }
        _write_json(det_dir / f"{pe_bli}.json", obj)
        n_files += 1

    # ------------------------------------------------------------------ #
    # 4. entities_top.json                                               #
    # ------------------------------------------------------------------ #

    entities_list = []
    for r in entity_rows:
        family_key, display_name, uei_count, total_obligation, worst_confidence = r
        slug = family_key.lower().replace(" ", "-")
        entities_list.append({
            "display_name": display_name,
            "family_key": family_key,
            "slug": slug,
            "total_obligation": total_obligation,
            "uei_count": uei_count,
            "worst_confidence": worst_confidence,
        })

    _write_json(json_dir / "entities_top.json", entities_list)
    n_files += 1

    # ------------------------------------------------------------------ #
    # 5. entity_details/{slug}.json  (one file per top-200 entity)       #
    # ------------------------------------------------------------------ #

    ent_dir = json_dir / "entity_details"
    ent_dir.mkdir(exist_ok=True)

    for r in entity_rows:
        family_key, display_name, uei_count, total_obligation, worst_confidence = r
        slug = family_key.lower().replace(" ", "-")

        # awards: recipient_name == display_name exact match
        entity_awards = awards_by_display.get(display_name, [])

        # mentions from fct_program_lobbying by family_key
        ent_mentions = mentions_by_fk.get(family_key, [])

        # linked_programs: distinct pe_bli from mentions that are in dim_programs
        linked: list[dict] = []
        seen_pe: set[str] = set()
        for m in ent_mentions:
            p = m["pe_bli"]
            if p in prog_titles and p not in seen_pe:
                linked.append({"pe_bli": p, "title": prog_titles[p]})
                seen_pe.add(p)

        obj = {
            "awards": entity_awards,
            "influence": influence_by_fk.get(family_key, []),
            "linked_programs": linked,
            "mentions": ent_mentions,
        }
        _write_json(ent_dir / f"{slug}.json", obj)
        n_files += 1

    # ------------------------------------------------------------------ #
    # 6. agencies.json                                                   #
    # ------------------------------------------------------------------ #

    # Compute per-org: program_count, fy2024 total, fy2026 sum
    from collections import Counter
    org_prog_count: Counter = Counter()
    org_fy2024_millions: dict[str, float] = {}
    org_fy2026_thousands: dict[str, float] = {}

    for r in prog_rows:
        pe_bli, org, exhibit_family, title, project_count, fy2024_actual_millions, fully_reconciled = r
        org_prog_count[org] += 1
        cur = org_fy2024_millions.get(org, 0.0)
        org_fy2024_millions[org] = cur + (fy2024_actual_millions or 0.0)
        # Sum trajectory fy2026_total for this program (using forward-translated org)
        translated = _workbook_org(org)
        traj = traj_index.get((pe_bli, translated))
        if traj and traj["fy2026_total"] is not None:
            org_fy2026_thousands[org] = (
                org_fy2026_thousands.get(org, 0.0) + traj["fy2026_total"]
            )

    agencies_list = []
    for org in sorted(org_prog_count.keys()):
        fy26 = org_fy2026_thousands.get(org)  # None if no trajectories
        agencies_list.append({
            "fy2024_total_millions": org_fy2024_millions.get(org, 0.0),
            "fy2026_total_thousands": fy26,
            "org": org,
            "program_count": org_prog_count[org],
        })

    _write_json(json_dir / "agencies.json", agencies_list)
    n_files += 1

    # ------------------------------------------------------------------ #
    # 7. citations.json  (keyed by fact_id)                              #
    # ------------------------------------------------------------------ #

    # citation_rows cols: (fact_id, kind, units, amount_text, page_number,
    #                      x0, x1, top_pt, bottom_pt, page_width, page_height,
    #                      resolution, sheet, cells, amount_thousands, sha256,
    #                      hosted_pdf_url, official_url, xml_path, retrieved_at)
    citations_dict: dict[str, dict] = {}
    for row in citation_rows:
        (fid, kind, units, amount_text, page_number, x0, x1,
         top_pt, bottom_pt, page_width, page_height, resolution,
         sheet, cells, amount_thousands, sha256, hosted_pdf_url,
         official_url, xml_path, retrieved_at) = row
        citations_dict[fid] = {
            "amount_text": amount_text,
            "amount_thousands": amount_thousands,
            "bottom_pt": bottom_pt,
            "cells": cells,
            "hosted_pdf_url": hosted_pdf_url,
            "kind": kind,
            "official_url": official_url,
            "page_height": page_height,
            "page_number": page_number,
            "page_width": page_width,
            "resolution": resolution,
            "retrieved_at": retrieved_at,
            "sha256": sha256,
            "sheet": sheet,
            "top_pt": top_pt,
            "units": units,
            "x0": x0,
            "x1": x1,
            "xml_path": xml_path,
        }

    _write_json(json_dir / "citations.json", citations_dict)
    n_files += 1

    # ------------------------------------------------------------------ #
    # 8. search_quick.json                                               #
    # ------------------------------------------------------------------ #

    search_docs: list[dict] = []

    # Program docs
    for r in prog_rows:
        pe_bli, org, exhibit_family, title, project_count, fy2024_actual_millions, fully_reconciled = r
        translated = _workbook_org(org)
        traj = traj_index.get((pe_bli, translated))
        # dollars: fy2026_total (already thousands) ?? fy2024_actual_millions * 1000
        dollars = None
        if traj and traj["fy2026_total"] is not None:
            dollars = traj["fy2026_total"]
        elif fy2024_actual_millions is not None:
            dollars = fy2024_actual_millions * 1000.0
        search_docs.append({
            "dollars": dollars,
            "id": f"p:{pe_bli}",
            "kind": "program",
            "org": org,
            "pe_bli": pe_bli,
            "title": title,
            "url": f"/program/{pe_bli}/",
        })

    # Entity (company) docs — top-200
    for r in entity_rows:
        family_key, display_name, uei_count, total_obligation, worst_confidence = r
        slug = family_key.lower().replace(" ", "-")
        search_docs.append({
            "id": f"c:{slug}",
            "kind": "company",
            "title": display_name,
            "url": f"/company/{slug}/",
        })

    # Agency docs
    for org in sorted(org_prog_count.keys()):
        search_docs.append({
            "id": f"a:{org}",
            "kind": "agency",
            "title": org,
            "url": f"/agency/{org}/",
        })

    # Static pages
    static_pages = [
        {"id": "s:home", "kind": "static", "title": "GovBudget", "url": "/"},
        {"id": "s:programs", "kind": "static", "title": "Programs", "url": "/programs/"},
        {"id": "s:companies", "kind": "static", "title": "Companies", "url": "/companies/"},
        {"id": "s:data", "kind": "static", "title": "Data Explorer", "url": "/data/"},
        {"id": "s:downloads", "kind": "static", "title": "Downloads", "url": "/downloads/"},
        {"id": "s:methodology", "kind": "static", "title": "Methodology", "url": "/methodology/"},
        {"id": "s:about", "kind": "static", "title": "About", "url": "/about/"},
    ]
    search_docs.extend(static_pages)

    _write_json(json_dir / "search_quick.json", {"docs": search_docs})
    n_files += 1

    # ------------------------------------------------------------------ #
    # 9. site_meta.json                                                  #
    # ------------------------------------------------------------------ #

    # Compute counts for the meta file
    meta_counts = {
        "agencies": len(org_prog_count),
        "citations": len(citation_rows),
        "companies": len(entity_rows),
        "programs": len(prog_rows),
    }

    site_meta = {
        "built_at": manifest.get("built_at"),
        "counts": meta_counts,
        "pdf_base_url": manifest.get("pdf_base_url"),
        "schema_version": manifest.get("schema_version", 1),
        "skipped_unresolved": manifest.get("skipped_unresolved", 0),
        "skipped_zero_amount": manifest.get("skipped_zero_amount", 0),
        "uncited_datasets": manifest.get("uncited_datasets", []),
    }

    _write_json(json_dir / "site_meta.json", site_meta)
    n_files += 1

    return n_files


def _build_mentions(raw_mentions: list, top200_family_keys: set) -> list:
    """Enrich mention dicts with filing_url derived from filing_uuid.

    The filing_url stored in fct_program_lobbying is the API URL; it's
    passed through as-is. The human LDA URL (for display) is derived
    as: https://lda.senate.gov/filings/public/filing/{uuid}/print/
    This lives in the site layer — sidecars store the API URL.
    """
    result = []
    for m in raw_mentions:
        result.append({
            "client_name": m.get("client_name"),
            "description_snippet": m.get("description_snippet"),
            "family_key": m.get("family_key"),
            "filing_url": m.get("filing_url"),
            "filing_uuid": m.get("filing_uuid"),
            "filing_year": m.get("filing_year"),
            "matched_term": m.get("matched_term"),
        })
    return result


def _write_json(path: Path, obj) -> None:
    """Write obj as JSON with sort_keys=True."""
    # single-line on purpose: citations.json is ~10MB; sidecars are machine-read only
    path.write_text(json.dumps(obj, sort_keys=True))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _copy_if_needed(src: Path, dest: Path, expected_sha256: str) -> None:
    """Copy src to dest unless dest already exists with matching size AND sha256.

    Size is checked first (cheap). If sizes match, sha256 of dest is verified
    against the DB-stored expected_sha256; a content mismatch forces a re-copy.
    """
    if dest.exists():
        if dest.stat().st_size != src.stat().st_size:
            shutil.copyfile(src, dest)
        else:
            # Same size — verify content integrity via sha256
            actual_sha = hashlib.sha256(dest.read_bytes()).hexdigest()
            if actual_sha != expected_sha256:
                shutil.copyfile(src, dest)
    else:
        shutil.copyfile(src, dest)


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
