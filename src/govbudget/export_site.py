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


def fact_id_derived(surface: str, key: str, metric: str) -> str:
    """Canonical identity for a derived (computed) citation.

    sha256 of 'derived|{surface}|{key}|{metric}', hexdigest[:16].
    All three components must be non-empty strings.
    """
    return hashlib.sha256(f"derived|{surface}|{key}|{metric}".encode()).hexdigest()[:16]


def fact_id_usaspending(surface: str, key: str, metric: str) -> str:
    """Canonical identity for a USAspending citation.

    sha256 of 'usaspending|{surface}|{key}|{metric}', hexdigest[:16].
    surface: 'family_year' | 'district_program'
    key: '{family_key}|{fiscal_year}' or '{pop_state}|{pop_district}|{pe_bli}'
    metric: 'total_obligation'
    """
    return hashlib.sha256(f"usaspending|{surface}|{key}|{metric}".encode()).hexdigest()[:16]


def fact_id_lda_filing(filing_uuid: str, role: str) -> str:
    """Canonical identity for a filing-level LDA citation (income or expenses).

    sha256 of 'lda_filing|{filing_uuid}|{role}', hexdigest[:16].
    role: 'income' | 'expenses'
    This is distinct from fact_id_lda (which is for program-mention citations).
    """
    return hashlib.sha256(f"lda_filing_amount|{filing_uuid}|{role}".encode()).hexdigest()[:16]


def fact_id_state_soql(jurisdiction: str, comparable_category: str, fiscal_year: str) -> str:
    """Canonical identity for a state SoQL citation (CT Socrata aggregate).

    sha256 of 'state_soql|{jurisdiction}|{comparable_category}|{fiscal_year}', hexdigest[:16].
    """
    key = f"state_soql|{jurisdiction}|{comparable_category}|{fiscal_year}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def fact_id_state_file(jurisdiction: str, comparable_category: str, fiscal_year: str) -> str:
    """Canonical identity for a state file citation (CA pointer-page tier).

    sha256 of 'state_file|{jurisdiction}|{comparable_category}|{fiscal_year}', hexdigest[:16].
    """
    key = f"state_file|{jurisdiction}|{comparable_category}|{fiscal_year}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


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
# (derived rows cover fct_budget_trajectory, dim_programs, fct_program_concentration,
#  fct_improper_exposure, fct_state_per_capita, dim_entities, fct_influence;
#  usaspending rows cover fct_family_obligations_by_year, fct_district_programs)
_CITED_DATASETS = {
    "jbook_details",
    "budget_lines",
    "fct_program_lobbying",
    "fct_budget_trajectory",
    "dim_programs",
    "fct_program_concentration",
    "fct_improper_exposure",
    "fct_state_per_capita",
    "dim_entities",
    "fct_influence",
    "fct_family_obligations_by_year",
    "fct_district_programs",
}


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
                None, None, None, None,  # formula, inputs, query_body, recorded_value
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
            None, None, None, None,  # formula, inputs, query_body, recorded_value
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
             official_url, xml_path, retrieved_at,
             formula, inputs, query_body, recorded_value) = row
            if kind == "workbook" and sha256 in doc_lookup:
                src_url, dl_at = doc_lookup[sha256]
                official_url = src_url
                retrieved_at = dl_at.isoformat() if dl_at else None
            updated.append((
                fid, kind, units, amount_text, page_number, x0, x1,
                top_pt, bottom_pt, page_width, page_height, resolution,
                sheet, cells, amount_thousands, sha256, hosted_pdf_url,
                official_url, xml_path, retrieved_at,
                formula, inputs, query_body, recorded_value,
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
            None, None, None, None,  # formula, inputs, query_body, recorded_value
        ))

    # --- 4d. Derived citations (computed/formula figures on rendered surfaces) ---
    derived_rows = _build_derived_citation_rows(
        duckdb_path=duckdb_path,
        bl_rows=bl_rows,
        citation_rows=citation_rows,
    )
    citation_rows.extend(derived_rows)

    # --- 4e. USAspending citations (family-year obligations + district programs) ---
    usas_rows = _build_usaspending_citation_rows(duckdb_path=duckdb_path)
    citation_rows.extend(usas_rows)

    # --- 4f. Filing-level LDA amount citations ---
    filing_lda_rows = _build_filing_lda_citation_rows(duckdb_path=duckdb_path)
    citation_rows.extend(filing_lda_rows)

    # --- 4g. State citation tier (CT state_soql + CA state_file) ---
    state_citation_rows = _build_state_citation_rows(duckdb_path=duckdb_path)
    citation_rows.extend(state_citation_rows)

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
            # Derived-tier columns (nullable for all other kinds)
            ("formula", "varchar"), ("inputs", "varchar"),
            ("query_body", "varchar"), ("recorded_value", "varchar"),
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
# Derived citation tier (Phase 5B-3)
# ---------------------------------------------------------------------------

def _null_derived_row(fid: str, kind: str, units: str | None,
                      formula: str, inputs: str, recorded_value: str | None,
                      retrieved_at: str | None,
                      query_body: str | None = None) -> tuple:
    """Build a 24-element citation row for kind='derived'."""
    return (
        fid, kind, units,
        None,   # amount_text
        None, None, None, None, None, None, None,  # page bbox
        None,   # resolution
        None,   # sheet
        None,   # cells
        None,   # amount_thousands
        None,   # sha256
        None,   # hosted_pdf_url
        None,   # official_url
        None,   # xml_path
        retrieved_at,
        formula,
        inputs,
        query_body,
        recorded_value,
    )


def _build_derived_citation_rows(
    *,
    duckdb_path,
    bl_rows: list,
    citation_rows: list,
) -> list[tuple]:
    """Build derived citation rows for all rendered surfaces.

    Derived rows cover figures that are computed from warehouse data (trajectory
    totals, agency sums, HHI, improper exposure, per-capita, entity obligations,
    influence dollars) rather than directly extracted from a source document.

    Key design decisions (documented):
    - trajectory / program headline figures share the SAME fact_ids.  Program
      page FY25/FY26 headline figures are rendered from the same trajectory mart
      rows, so they do not produce separate citations — the page simply references
      the trajectory-surface fact_id.  This avoids fact_id duplication.
    - Inputs for trajectory metrics are the budget_lines.parquet fact_ids joined
      by (pe_bli, workbook_org(org), amount_type).  Naive pe_bli-only joins
      silently miss rows where the workbook org differs from the program org.
      We use _workbook_org to translate before joining.
    - HHI formula explicitly states the positive-only-shares bias (warehouse query
      filters obligation > 0; negative/recoupment obligations are excluded).
    - Influence inputs: constituent LDA filing API URLs from lda_filings parquet,
      joined by family_key + filing_year.  If lda_filings is not available,
      inputs = [] and the formula is self-describing.
    - Entity total_obligation: inputs = [] (too many UEIs to enumerate; formula
      states the query).  Scoped to top-200 entities only.
    - Per-capita: inputs = [spend_source_url, pop_source_url] already stored in
      fct_state_per_capita.

    Scope guard: derived rows total ≈ a few thousand.  Do NOT emit one row per
    transaction or per UEI.
    """
    import datetime
    import duckdb as _duckdb
    import json as _json

    rows: list[tuple] = []
    built_at = datetime.datetime.now(datetime.UTC).isoformat()

    # Build a fast lookup: (pe_bli, org_translated, amount_type) → fact_id
    # from the already-built bl_rows.
    # bl_rows cols: (fact_id, exhibit, fiscal_year, account, account_title,
    #   organization, budget_activity, budget_activity_title, pe_bli, title,
    #   amount_type, amount_thousands, units, document_sha256, source_sheet, source_cells)
    bl_key_to_fid: dict[tuple, list[str]] = {}
    for r in bl_rows:
        fid_bl, _, _, _, _, bl_org, _, _, bl_pe, _, bl_amt_type, _, _, _, _, _ = r
        k = (bl_pe, bl_org, bl_amt_type)
        bl_key_to_fid.setdefault(k, []).append(fid_bl)

    con = _duckdb.connect(str(duckdb_path), read_only=True)
    try:
        # ---- Trajectory figures ----
        # surface='trajectory', key='{pe_bli}|{org}',
        # metrics: fy2024_actuals, fy2025_total, fy2026_total, fy2526_change
        #
        # Inputs for each metric = budget_lines fact_ids matched via
        # (pe_bli, workbook_org(org), amount_type).
        # We use a simple mapping from trajectory metric to workbook amount_type:
        #   fy2024_actuals  → fy_2024_actuals
        #   fy2025_total    → fy_2025_total  (may also be fy_2025_enacted; both appended)
        #   fy2026_total    → fy_2026_total  (may also be fy_2026_request)
        #   fy2526_change   → derived difference; inputs = union of fy2025/fy2026 inputs
        _METRIC_TO_AMOUNT_TYPES: dict[str, list[str]] = {
            "fy2024_actuals": ["fy_2024_actuals"],
            "fy2025_total":   ["fy_2025_total", "fy_2025_enacted"],
            "fy2026_total":   ["fy_2026_total", "fy_2026_request"],
        }
        _METRIC_FORMULA: dict[str, str] = {
            "fy2024_actuals": "sum(budget_lines.amount_thousands where amount_type=fy_2024_actuals)",
            "fy2025_total":   "sum(budget_lines.amount_thousands where amount_type in (fy_2025_total, fy_2025_enacted))",
            "fy2026_total":   "sum(budget_lines.amount_thousands where amount_type in (fy_2026_total, fy_2026_request))",
            "fy2526_change":  "fy2026_total - fy2025_total",
        }
        # Formula used when no budget_lines inputs can be joined (org/type mismatch):
        # honest shape-check row, not a fake sum.
        _PIVOT_FORMULA = "trajectory pivot of budget_lines (inputs unavailable for this org/type)"

        try:
            traj_rows = con.execute(
                "select pe_bli, organization, fy2024_actuals, fy2025_total,"
                " fy2026_total, fy2526_change from fct_budget_trajectory"
            ).fetchall()
        except Exception:
            traj_rows = []

        for pe_bli, org, fy24, fy25, fy26, chg in traj_rows:
            translated_org = _workbook_org(org)
            key_str = f"{pe_bli}|{org}"

            # For each plain metric, collect inputs
            fy25_input_fids: list[str] = []
            fy26_input_fids: list[str] = []

            for metric, value in [
                ("fy2024_actuals", fy24),
                ("fy2025_total",   fy25),
                ("fy2026_total",   fy26),
            ]:
                if value is None:
                    continue
                fid = fact_id_derived("trajectory", key_str, metric)
                # Collect budget_lines fact_ids as inputs
                amt_types = _METRIC_TO_AMOUNT_TYPES[metric]
                input_fids: list[str] = []
                for at in amt_types:
                    input_fids.extend(bl_key_to_fid.get((pe_bli, translated_org, at), []))
                # Deduplicate while preserving order
                seen: set[str] = set()
                unique_inputs: list[str] = []
                for f in input_fids:
                    if f not in seen:
                        seen.add(f)
                        unique_inputs.append(f)
                inputs_json = _json.dumps(unique_inputs)
                recorded = f"{value:.3f}"
                if metric == "fy2025_total":
                    fy25_input_fids = unique_inputs
                elif metric == "fy2026_total":
                    fy26_input_fids = unique_inputs
                # Use pivot formula when no budget_lines inputs found — avoids a
                # fake sum formula with empty inputs that _verify_derived would reject.
                formula = (
                    _METRIC_FORMULA[metric] if unique_inputs
                    else _PIVOT_FORMULA
                )
                rows.append(_null_derived_row(
                    fid, "derived", "USD thousands",
                    formula,
                    inputs_json,
                    recorded,
                    built_at,
                ))

            # fy2526_change = fy2026_total - fy2025_total
            # Inputs are the TWO peer derived fact_ids so _verify_derived rule 4b can
            # genuinely recompute the difference from peer recorded_values.
            # Only emit when BOTH peers exist (fy25 and fy26 are non-None).
            if chg is not None and fy25 is not None and fy26 is not None:
                fid = fact_id_derived("trajectory", key_str, "fy2526_change")
                fy26_peer_fid = fact_id_derived("trajectory", key_str, "fy2026_total")
                fy25_peer_fid = fact_id_derived("trajectory", key_str, "fy2025_total")
                change_inputs = [fy26_peer_fid, fy25_peer_fid]
                inputs_json = _json.dumps(change_inputs)
                rows.append(_null_derived_row(
                    fid, "derived", "USD thousands",
                    _METRIC_FORMULA["fy2526_change"],
                    inputs_json,
                    f"{chg:.3f}",
                    built_at,
                ))

        # NOTE: program FY25/FY26 headline figures reuse trajectory fact_ids.
        # Program pages render state using surface='trajectory', same key and metric.
        # No separate emission here — document this once to avoid duplication.

        # ---- Agency sums ----
        # surface='agency', key=org, metric='fy2024_total_millions'
        # inputs = fact_ids from jbook_details (fy2024 PriorYear resolution != unresolved)
        # recon §I: cited jbook detail fact_ids only — use the already-emitted citation_rows
        jbook_fids_by_pe: dict[str, str] = {}
        for row in citation_rows:
            if row[1] == "jbook_pdf":
                r_fid = row[0]
                # We need pe_bli from jbook_details — not directly in citation_rows.
                # We store a local map during emission.  Defer to after the trajectory loop.
                pass
        # Re-build from citation_rows using the fact_id → pe_bli mapping
        # (we iterate citation_rows which has jbook_pdf rows by fact_id; the detail rows
        # already built in the main export pass are not passed here, so we use a heuristic:
        # the already-built citation_rows for kind=jbook_pdf are the cited jbook facts,
        # but we have no pe_bli in the citation row itself.  Instead we use bl_rows
        # which are per-pe_bli and are guaranteed cited.)
        # Practical approach: for agency sums, inputs = workbook fact_ids for
        # fy_2024_actuals per program under this org.
        try:
            prog_rows_d = con.execute(
                "select pe_bli, org, fy2024_actual_millions from dim_programs"
            ).fetchall()
        except Exception:
            prog_rows_d = []

        org_to_fids: dict[str, list[str]] = {}
        # n_cited_programs: count of programs with ≥1 cited budget_line (not total lines)
        org_to_cited_programs: dict[str, int] = {}
        org_to_total: dict[str, float] = {}
        for pe_bli, org, fy24_m in prog_rows_d:
            translated = _workbook_org(org)
            # workbook fact_ids for fy_2024_actuals for this program
            fids_24 = bl_key_to_fid.get((pe_bli, translated, "fy_2024_actuals"), [])
            org_to_fids.setdefault(org, []).extend(fids_24)
            if fy24_m is not None:
                org_to_total[org] = org_to_total.get(org, 0.0) + fy24_m
            # Count this program only if it has ≥1 cited budget_line
            if fids_24:
                org_to_cited_programs[org] = org_to_cited_programs.get(org, 0) + 1

        for org, total in org_to_total.items():
            fid = fact_id_derived("agency", org, "fy2024_total_millions")
            input_fids = list(dict.fromkeys(org_to_fids.get(org, [])))
            n_cited = org_to_cited_programs.get(org, 0)
            n_programs = sum(1 for _, o, _ in prog_rows_d if o == org)
            n_uncited = n_programs - n_cited
            formula_text = (
                f"sum(dim_programs.fy2024_actual_millions) for org={org!r}"
                f" ({n_cited} programs cited via workbook; {n_uncited} uncited)"
            )
            rows.append(_null_derived_row(
                fid, "derived", "USD millions",
                formula_text,
                _json.dumps(input_fids),
                f"{total:.3f}",
                built_at,
            ))

        # ---- HHI ----
        # surface='concentration', key=pe_bli, metrics hhi + program_dollars
        # Positive-only shares: obligation > 0 (recoupment/negative flows excluded)
        try:
            conc_rows = con.execute(
                "select pe_bli, hhi, program_dollars from fct_program_concentration"
            ).fetchall()
        except Exception:
            conc_rows = []

        _HHI_FORMULA = (
            "sum(share_pct * share_pct) over (partition by pe_bli) "
            "where share = family_obligation / sum(family_obligation) "
            "and obligation > 0 (positive-only shares; negative obligations excluded)"
        )
        _DOLLARS_FORMULA = (
            "sum(fct_award_transactions.obligation) for this pe_bli "
            "via fct_budget_to_awards high-confidence join, obligation > 0"
        )
        for pe_bli, hhi, prog_dollars in conc_rows:
            if hhi is not None:
                fid = fact_id_derived("concentration", pe_bli, "hhi")
                rows.append(_null_derived_row(
                    fid, "derived", "Herfindahl-Hirschman Index",
                    _HHI_FORMULA,
                    "[]",
                    f"{hhi:.3f}",
                    built_at,
                    query_body=_HHI_FORMULA,
                ))
            if prog_dollars is not None:
                fid = fact_id_derived("concentration", pe_bli, "program_dollars")
                rows.append(_null_derived_row(
                    fid, "derived", "USD",
                    _DOLLARS_FORMULA,
                    "[]",
                    f"{prog_dollars:.3f}",
                    built_at,
                    query_body=_DOLLARS_FORMULA,
                ))

        # ---- Improper exposure ----
        # surface='improper', key=agency_code,
        # metric='derived_improper_amount_usd'
        # formula = 'outlays_usd * improper_rate / 100'
        # inputs = [paymentaccuracy source_url from oversight parquet]
        try:
            improper_rows = con.execute(
                "select agency_code, derived_improper_amount_usd, weighted_rate_pct"
                " from fct_improper_exposure"
            ).fetchall()
        except Exception:
            improper_rows = []

        # Probe oversight parquet for paymentaccuracy source URLs
        oversight_urls: dict[str, str] = {}
        oversight_pq = duckdb_path.parent / "parquet" / "oversight" / "improper_payments.parquet"
        if not oversight_pq.exists():
            # Try alternative location
            oversight_pq = duckdb_path.parent.parent / "data" / "parquet" / "oversight" / "improper_payments.parquet"
        if oversight_pq.exists():
            try:
                url_rows = _duckdb.sql(
                    f"select agency_code, source_url from read_parquet('{oversight_pq}')"
                    " where source_url is not null"
                ).fetchall()
                for ac, su in url_rows:
                    if ac and su:
                        oversight_urls[ac] = su
            except Exception:
                pass

        for agency_code, derived_amount, rate in improper_rows:
            if derived_amount is None:
                continue
            fid = fact_id_derived("improper", agency_code, "derived_improper_amount_usd")
            source_url = oversight_urls.get(agency_code)
            inputs = [source_url] if source_url else []
            formula = (
                f"outlays_usd * improper_rate / 100"
                f" (rate={rate:.4f}% from paymentaccuracy.gov)"
            )
            rows.append(_null_derived_row(
                fid, "derived", "USD",
                formula,
                _json.dumps(inputs),
                f"{derived_amount:.3f}",
                built_at,
            ))

        # ---- State per-capita ----
        # surface='state_per_capita', key='{jurisdiction}|{category}',
        # metric='amount_per_capita'
        # inputs = state citation fact_ids (state_soql for CT, state_file for CA)
        #          + pop_source_url (Census population URL)
        # This rework (Task 2c) chains the DERIVED row through the state citation
        # fact_ids so the input chain is properly ordered: state tier → derived tier.
        try:
            spc_rows = con.execute(
                "select jurisdiction, comparable_category, amount_per_capita,"
                " spend_source_url, pop_source_url, total_amount_usd,"
                " fiscal_year"
                " from fct_state_per_capita"
            ).fetchall()
        except Exception:
            # Fallback: try without fiscal_year column (older schema)
            try:
                spc_rows_nfy = con.execute(
                    "select jurisdiction, comparable_category, amount_per_capita,"
                    " spend_source_url, pop_source_url, total_amount_usd"
                    " from fct_state_per_capita"
                ).fetchall()
                spc_rows = [(j, c, pc, su, pu, total, None) for j, c, pc, su, pu, total in spc_rows_nfy]
            except Exception:
                spc_rows = []

        # Build a fiscal_year map from fct_state_per_capita (best-guess: 2025 default)
        for spc_row in spc_rows:
            if len(spc_row) == 7:
                jurisdiction, category, per_cap, spend_url, pop_url, total_usd, fiscal_year = spc_row
            else:
                jurisdiction, category, per_cap, spend_url, pop_url = spc_row[:5]
                total_usd = spc_row[5] if len(spc_row) > 5 else None
                fiscal_year = None

            if per_cap is None:
                continue
            key_str = f"{jurisdiction}|{category}"
            fid = fact_id_derived("state_per_capita", key_str, "amount_per_capita")

            # Build inputs: use state citation fact_id + pop URL
            # CT → state_soql fact_id; CA → state_file fact_id
            # fiscal_year for citation identity: default 'FY 2025'
            fy_str = str(fiscal_year) if fiscal_year else "FY 2025"
            inputs_list: list[str] = []
            if jurisdiction == "CT":
                state_fid = fact_id_state_soql(jurisdiction, category, fy_str)
                inputs_list.append(state_fid)
            elif jurisdiction == "CA":
                state_fid = fact_id_state_file(jurisdiction, category, fy_str)
                inputs_list.append(state_fid)
            elif spend_url:
                # Fallback for other jurisdictions: use raw URL
                inputs_list.append(spend_url)

            if pop_url:
                inputs_list.append(pop_url)

            formula = (
                f"total_amount_usd / population"
                f" (jurisdiction={jurisdiction!r}, category={category!r})"
            )
            rows.append(_null_derived_row(
                fid, "derived", "USD per capita",
                formula,
                _json.dumps(inputs_list),
                f"{per_cap:.6f}",
                built_at,
            ))

        # ---- Entity total obligation (top-200 only) ----
        # surface='entity', key=family_key, metric='total_obligation'
        # formula = 'sum of obligations across N UEIs FY2017-2026'
        # inputs = []  (too many UEIs to enumerate; query is self-describing)
        try:
            entity_rows = con.execute(
                "select family_key, total_obligation, uei_count"
                " from dim_entities"
                " order by total_obligation desc nulls last"
                " limit 200"
            ).fetchall()
        except Exception:
            entity_rows = []

        for family_key, total_obl, uei_count in entity_rows:
            if total_obl is None:
                continue
            fid = fact_id_derived("entity", family_key, "total_obligation")
            formula = (
                f"sum(fct_award_transactions.obligation) across {uei_count or '?'} UEIs"
                f" via entity_xwalk, FY2017-2026"
            )
            rows.append(_null_derived_row(
                fid, "derived", "USD",
                formula,
                "[]",
                f"{total_obl:.3f}",
                built_at,
                query_body=(
                    "select sum(t.obligation) from fct_award_transactions t"
                    " join entity_xwalk x on t.recipient_uei=x.recipient_uei"
                    f" where x.family_key='{family_key}'"
                ),
            ))

        # ---- Influence dollars ----
        # surface='influence', key='{family_key}|{filing_year}',
        # metrics: lobbying_income_usd / lobbying_expense_usd / lobbying_total_usd
        # inputs = constituent filing API URLs (lda_filings by family_key+filing_year)
        try:
            influence_rows = con.execute(
                "select family_key, filing_year, lobbying_income_usd,"
                " lobbying_expense_usd, lobbying_total_usd"
                " from fct_influence"
            ).fetchall()
        except Exception:
            influence_rows = []

        # Probe lda_filings parquet for filing API URLs grouped by family_key + filing_year
        lda_urls_index: dict[tuple, list[str]] = {}
        lda_filings_pq = duckdb_path.parent / "parquet" / "influence" / "lda_filings.parquet"
        if not lda_filings_pq.exists():
            lda_filings_pq = duckdb_path.parent.parent / "data" / "parquet" / "influence" / "lda_filings.parquet"
        if lda_filings_pq.exists():
            try:
                # Check if family_key column exists
                cols_check = _duckdb.sql(
                    f"select * from read_parquet('{lda_filings_pq}') limit 0"
                ).columns
                if "family_key" in cols_check and "filing_year" in cols_check:
                    url_col = "filing_url" if "filing_url" in cols_check else None
                    if url_col:
                        url_rows_lda = _duckdb.sql(
                            f"select family_key, filing_year, {url_col}"
                            f" from read_parquet('{lda_filings_pq}')"
                            f" where {url_col} is not null"
                        ).fetchall()
                        for fk, fy, fu in url_rows_lda:
                            if fk and fy and fu:
                                lda_urls_index.setdefault((fk, str(fy)), []).append(fu)
            except Exception:
                pass

        for family_key, filing_year, income, expense, total in influence_rows:
            key_str = f"{family_key}|{filing_year}"
            filing_urls = lda_urls_index.get((family_key, str(filing_year)), [])
            inputs_json = _json.dumps(filing_urls[:20])  # cap to avoid huge inputs

            for metric, value, formula_txt in [
                ("lobbying_income_usd",   income,  "sum(income) from LDA filings for this registrant-year"),
                ("lobbying_expense_usd",  expense, "sum(expenses) from LDA filings for this registrant-year"),
                ("lobbying_total_usd",    total,   "lobbying_income_usd + lobbying_expense_usd (or max where only one reported)"),
            ]:
                if value is None:
                    continue
                fid = fact_id_derived("influence", key_str, metric)
                rows.append(_null_derived_row(
                    fid, "derived", "USD",
                    formula_txt,
                    inputs_json,
                    f"{value:.3f}",
                    built_at,
                ))

    finally:
        con.close()

    return rows


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
            duckdb_path=duckdb_path,
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
    duckdb_path: Path,
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

    # Set of fact_ids that have a valid citation row (resolution unique/ambiguous_first)
    # Only these are safe to emit as data-fact-id (gate 2 Cite state A contract).
    _cited_fact_ids: set[str] = {row[0] for row in citation_rows}

    # fy2024_fact_id index: pe_bli → fact_id (jbook_details WHERE
    # project_number IS NULL AND scenario='PriorYear'; nullable if absent).
    # ONLY populated when that fact_id exists in _cited_fact_ids; otherwise
    # null so the page renders honest Cite state C (data-uncited) instead of
    # emitting a dangling data-fact-id that citations.json cannot resolve.
    fy2024_fact_id: dict[str, str] = {}
    for row in detail_rows:
        (fid, pe_bli, project_number, project_title, scenario, *rest) = row
        if project_number is None and scenario == "PriorYear":
            if pe_bli not in fy2024_fact_id and fid in _cited_fact_ids:
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
    #                      hosted_pdf_url, official_url, xml_path, retrieved_at,
    #                      formula, inputs, query_body, recorded_value)
    citations_dict: dict[str, dict] = {}
    for row in citation_rows:
        (fid, kind, units, amount_text, page_number, x0, x1,
         top_pt, bottom_pt, page_width, page_height, resolution,
         sheet, cells, amount_thousands, sha256, hosted_pdf_url,
         official_url, xml_path, retrieved_at,
         formula, inputs, query_body, recorded_value) = row
        citations_dict[fid] = {
            "amount_text": amount_text,
            "amount_thousands": amount_thousands,
            "bottom_pt": bottom_pt,
            "cells": cells,
            "formula": formula,
            "hosted_pdf_url": hosted_pdf_url,
            "inputs": inputs,
            "kind": kind,
            "official_url": official_url,
            "page_height": page_height,
            "page_number": page_number,
            "page_width": page_width,
            "query_body": query_body,
            "recorded_value": recorded_value,
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

    # ------------------------------------------------------------------ #
    # 10. entity_ueis.json  (family → parent-UEI sidecar)                #
    # ------------------------------------------------------------------ #
    entity_ueis = _build_entity_ueis_sidecar(duckdb_path=duckdb_path, con=con)
    _write_json(json_dir / "entity_ueis.json", entity_ueis)
    n_files += 1

    # ------------------------------------------------------------------ #
    # 11. flows/{pe_bli}.json  (17 crosswalked programs)                 #
    # ------------------------------------------------------------------ #
    flows_dir = json_dir / "flows"
    flows_dir.mkdir(exist_ok=True)
    n_flows = _emit_flows_sidecars(flows_dir=flows_dir, con=con)
    n_files += n_flows

    return n_files


# ---------------------------------------------------------------------------
# USAspending citation tier (Phase 5B-3)
# ---------------------------------------------------------------------------

# Durable USAspending v2 endpoint (v1 is dead; v2 verified live 2026-06-12)
_USASPENDING_FILTER_ENDPOINT = "api/v2/references/filter/"
_USASPENDING_BASE = "https://api.usaspending.gov/"

# Polite delay between USAspending API calls (seconds)
_USAS_POLITE_DELAY = 0.5

# Allowlisted USAspending endpoints for verify gates
USASPENDING_ENDPOINT_ALLOWLIST = {
    "api/v2/references/filter/",
    "api/v2/recipient/",
}


def _null_usaspending_row(fid: str, query_body: str, recorded_value: str,
                          units: str | None,
                          official_url: str | None = None) -> tuple:
    """Build a 24-element citation row for kind='usaspending'."""
    return (
        fid, "usaspending", units,
        None,   # amount_text
        None, None, None, None, None, None, None,  # page bbox
        None,   # resolution
        None,   # sheet
        None,   # cells
        None,   # amount_thousands
        None,   # sha256
        None,   # hosted_pdf_url
        official_url,
        None,   # xml_path
        None,   # retrieved_at
        None,   # formula
        None,   # inputs
        query_body,
        recorded_value,
    )


def _build_usaspending_citation_rows(*, duckdb_path) -> list[tuple]:
    """Build USAspending citation rows for family-year obligations and district programs.

    kind='usaspending': durable artifact = {endpoint, query_body}.
    query_body is the JSON-serializable filter dict for api/v2/references/filter/.

    Scope:
    - Family-year: top-200 families (by total_obligation) × all years from
      fct_family_obligations_by_year — one citation per (family_key, fiscal_year).
      query_body = {'filters': {'recipient_search_text': [UEIs], 'time_period': [...]}}.
    - District programs: all 267 rows from fct_district_programs — one citation
      per (pop_state, pop_district, pe_bli).
      query_body = {'filters': {'place_of_performance_locations': [...], 'award_ids': [...]}}.

    Never fails export: network errors or missing data → skip silently.
    """
    import datetime
    import json as _json

    import duckdb as _duckdb

    rows: list[tuple] = []

    con = _duckdb.connect(str(duckdb_path), read_only=True)
    try:
        # ---- Family-year: top-200 families from dim_entities ----
        # Get the top-200 family_keys ordered by total_obligation
        try:
            top200 = con.execute(
                "select family_key, total_obligation from dim_entities"
                " order by total_obligation desc nulls last limit 200"
            ).fetchall()
        except Exception:
            top200 = []

        top200_keys = {r[0] for r in top200}

        # Get all UEIs per family (from entity_xwalk) for query_body construction
        try:
            uei_rows = con.execute(
                "select family_key, recipient_uei from entity_xwalk"
                " where family_key is not null"
            ).fetchall()
        except Exception:
            uei_rows = []

        family_ueis: dict[str, list[str]] = {}
        for fk, uei in uei_rows:
            if uei:
                family_ueis.setdefault(fk, []).append(uei)

        # Get family-year obligations (only for top-200 families)
        try:
            foy_rows = con.execute(
                "select family_key, fiscal_year, total_obligation"
                " from fct_family_obligations_by_year"
            ).fetchall()
        except Exception:
            foy_rows = []

        for family_key, fiscal_year, total_obl in foy_rows:
            if family_key not in top200_keys:
                continue
            if total_obl is None:
                continue

            ueis = family_ueis.get(family_key, [])
            # Cap UEIs to avoid excessively large query_body
            capped_ueis = sorted(ueis)[:50]

            query_body = _json.dumps({
                "filters": {
                    "recipient_search_text": capped_ueis,
                    "time_period": [{"start_date": f"{fiscal_year - 1}-10-01",
                                     "end_date": f"{fiscal_year}-09-30"}],
                },
                "version": "2020-06-01",
            }, sort_keys=True)

            key_str = f"{family_key}|{fiscal_year}"
            fid = fact_id_usaspending("family_year", key_str, "total_obligation")
            rows.append(_null_usaspending_row(
                fid, query_body, f"{total_obl:.3f}", "USD",
                official_url=f"{_USASPENDING_BASE}{_USASPENDING_FILTER_ENDPOINT}",
            ))

        # ---- District programs: all 267 rows from fct_district_programs ----
        try:
            dp_rows = con.execute(
                "select pop_state, pop_district, pe_bli, total_obligation"
                " from fct_district_programs"
            ).fetchall()
        except Exception:
            dp_rows = []

        for pop_state, pop_district, pe_bli, total_obl in dp_rows:
            if total_obl is None:
                continue

            # Get top award PIIDs for this (district, program) to anchor the filter
            try:
                piids = con.execute(
                    "select distinct t.award_id_piid"
                    " from fct_award_transactions t"
                    " join (select distinct award_piid from fct_budget_to_awards"
                    "       where confidence='high' and pe_bli=?) b"
                    "   on t.award_id_piid = b.award_piid"
                    " where t.pop_state=? and t.pop_district=?"
                    " limit 25",
                    [pe_bli, pop_state, pop_district],
                ).fetchall()
                piid_list = [r[0] for r in piids if r[0]]
            except Exception:
                piid_list = []

            query_body = _json.dumps({
                "filters": {
                    "place_of_performance_locations": [
                        {"country": "USA", "state": pop_state,
                         "district_original": pop_district}
                    ],
                    "award_ids": piid_list[:25],
                },
                "version": "2020-06-01",
            }, sort_keys=True)

            key_str = f"{pop_state}|{pop_district}|{pe_bli}"
            fid = fact_id_usaspending("district_program", key_str, "total_obligation")
            rows.append(_null_usaspending_row(
                fid, query_body, f"{total_obl:.3f}", "USD",
                official_url=f"{_USASPENDING_BASE}{_USASPENDING_FILTER_ENDPOINT}",
            ))

    finally:
        con.close()

    return rows


def _build_filing_lda_citation_rows(*, duckdb_path) -> list[tuple]:
    """Build filing-level LDA citation rows for /filing pages.

    Emits kind='lda_filing' rows with:
      - fact_id = fact_id_lda_filing(filing_uuid, 'income' | 'expenses')
      - official_url = filing API URL (https://lda.senate.gov/api/v1/filings/{uuid}/)
      - recorded_value = the amount (income_usd or expenses_usd)

    Only emits when the amount is non-null and non-empty (truthy string).
    Covers the 4,258 LDA filings so /filing pages render state A for amounts.
    """
    import duckdb as _duckdb
    from pathlib import Path as _Path

    rows: list[tuple] = []

    # Find the lda_filings parquet
    duckdb_path = _Path(duckdb_path)
    lda_pq = duckdb_path.parent / "parquet" / "influence" / "lda_filings.parquet"
    if not lda_pq.exists():
        lda_pq = duckdb_path.parent.parent / "data" / "parquet" / "influence" / "lda_filings.parquet"
    if not lda_pq.exists():
        return rows

    try:
        lda_filings = _duckdb.sql(
            f"select filing_uuid, url, income_usd, expenses_usd"
            f" from read_parquet('{lda_pq}')"
        ).fetchall()
    except Exception:
        return rows

    for filing_uuid, url, income_usd, expenses_usd in lda_filings:
        if not filing_uuid:
            continue
        # official_url: the filing API URL (starts with https://lda.senate.gov/)
        official_url = url or f"https://lda.senate.gov/api/v1/filings/{filing_uuid}/"

        # Income row
        if income_usd and str(income_usd).strip():
            fid = fact_id_lda_filing(filing_uuid, "income")
            rows.append((
                fid, "lda_filing", "USD",
                None,   # amount_text
                None, None, None, None, None, None, None,  # page bbox
                None,   # resolution
                None,   # sheet
                None,   # cells
                None,   # amount_thousands
                None,   # sha256
                None,   # hosted_pdf_url
                official_url,
                None,   # xml_path
                None,   # retrieved_at
                None,   # formula
                None,   # inputs
                None,   # query_body
                str(income_usd).strip(),  # recorded_value
            ))

        # Expenses row
        if expenses_usd and str(expenses_usd).strip():
            fid = fact_id_lda_filing(filing_uuid, "expenses")
            rows.append((
                fid, "lda_filing", "USD",
                None,
                None, None, None, None, None, None, None,
                None,
                None,
                None,
                None,
                None,
                None,
                official_url,
                None,
                None,
                None,
                None,
                None,
                str(expenses_usd).strip(),
            ))

    return rows


def _build_state_citation_rows(*, duckdb_path) -> list[tuple]:
    """Build state citation rows for CT (state_soql) and CA (state_file).

    CT tier (state_soql):
      For each (jurisdiction='CT', comparable_category, fiscal_year) row in
      fct_state_per_capita: emit kind='state_soql' with:
        - official_url = the SoQL URL from build_figure_soql_url(comparable_category, fiscal_year)
        - recorded_value = total_amount_usd from fct_state_per_capita
        - retrieved_at = present ISO timestamp (the data was captured at export time)

    CA tier (state_file):
      For each (jurisdiction='CA', comparable_category, fiscal_year) row in
      fct_state_per_capita: emit kind='state_file' with:
        - official_url = the Open Fi$Cal pointer page URL (clean, no pointer note suffix)
        - recorded_value = total_amount_usd
        - formula = the pointer note explaining the source

    Never fails export: missing tables or import errors → return empty list.
    """
    import datetime as _dt
    import duckdb as _duckdb
    from pathlib import Path as _Path

    rows: list[tuple] = []
    retrieved_at = _dt.datetime.now(_dt.UTC).isoformat()

    try:
        con = _duckdb.connect(str(duckdb_path), read_only=True)
        try:
            spc_rows = con.execute(
                "select jurisdiction, comparable_category, total_amount_usd,"
                " spend_source_url, fiscal_year"
                " from fct_state_per_capita"
            ).fetchall()
        except Exception:
            try:
                # Fallback: without fiscal_year column
                spc_rows_nfy = con.execute(
                    "select jurisdiction, comparable_category, total_amount_usd,"
                    " spend_source_url"
                    " from fct_state_per_capita"
                ).fetchall()
                spc_rows = [(j, c, t, s, None) for j, c, t, s in spc_rows_nfy]
            except Exception:
                spc_rows = []
        finally:
            con.close()
    except Exception:
        return rows

    # CA pointer page URL (clean version, no pointer note suffix)
    # From states/california.py: POINTER_SOURCE has " (pointer: ...)" appended — strip it.
    _CA_POINTER_PAGE_URL = "https://open.fiscal.ca.gov/dept_spending_transaction.html"
    _CA_POINTER_NOTE = (
        "Aggregate of CA Open Fi$Cal per-department CSV files;"
        " pointer manifest: DepartmentSpendingTransactionPointer.csv"
    )

    for spc_row in spc_rows:
        if len(spc_row) == 5:
            jurisdiction, category, total_usd, spend_url, fiscal_year = spc_row
        else:
            jurisdiction, category, total_usd = spc_row[:3]
            spend_url = spc_row[3] if len(spc_row) > 3 else None
            fiscal_year = None

        if total_usd is None:
            continue

        recorded_value = f"{float(total_usd):.3f}"
        fy_str = str(fiscal_year) if fiscal_year else "FY 2025"

        if jurisdiction == "CT":
            # Build per-figure SoQL URL
            try:
                from govbudget.states.connecticut import build_figure_soql_url as _build_ct_url
                official_url = _build_ct_url(category, fy_str)
            except Exception:
                official_url = spend_url or ""

            fid = fact_id_state_soql(jurisdiction, category, fy_str)
            rows.append((
                fid, "state_soql", "USD",
                None,   # amount_text
                None, None, None, None, None, None, None,  # page bbox
                None,   # resolution
                None,   # sheet
                None,   # cells
                None,   # amount_thousands
                None,   # sha256
                None,   # hosted_pdf_url
                official_url,
                None,   # xml_path
                retrieved_at,
                None,   # formula
                None,   # inputs
                None,   # query_body
                recorded_value,
            ))

        elif jurisdiction == "CA":
            fid = fact_id_state_file(jurisdiction, category, fy_str)
            rows.append((
                fid, "state_file", "USD",
                None,
                None, None, None, None, None, None, None,
                None,
                None,
                None,
                None,
                None,
                None,
                _CA_POINTER_PAGE_URL,
                None,
                retrieved_at,
                _CA_POINTER_NOTE,  # formula field carries the pointer note
                None,   # inputs
                None,   # query_body
                recorded_value,
            ))

    return rows


def _build_entity_ueis_sidecar(*, duckdb_path, con=None) -> dict:
    """Build the family→parent-UEI sidecar (entity_ueis.json).

    Deterministic parent-UEI rule (recon §E):
      For each family_key: choose the parent_uei from the member row with the
      maximum total_obligation among rows where parent_uei IS NOT NULL.
      Families where all members have null parent_uei → parent_uei: null.

    Returns: {family_key: {parent_uei: str|null, profile_id: str|null}}
    profile_id is loaded from the usaspending_recipient_ids.json cache if present.
    """
    import duckdb as _duckdb
    from pathlib import Path as _Path

    duckdb_path = _Path(duckdb_path)
    result: dict = {}

    should_close = con is None
    if con is None:
        con = _duckdb.connect(str(duckdb_path), read_only=True)

    try:
        # Deterministic rule: max total_obligation member with non-null parent_uei
        try:
            xwalk_rows = con.execute(
                "select family_key, parent_uei, total_obligation from entity_xwalk"
                " where family_key is not null"
            ).fetchall()
        except Exception:
            xwalk_rows = []

        # Build: family_key → list of (parent_uei, total_obligation)
        family_candidates: dict[str, list] = {}
        all_family_keys: set = set()
        for fk, puei, tobl in xwalk_rows:
            all_family_keys.add(fk)
            if puei and tobl is not None:
                family_candidates.setdefault(fk, []).append((puei, float(tobl)))

        # Choose max-obligation parent_uei per family
        family_parent_uei: dict[str, str | None] = {}
        for fk in all_family_keys:
            candidates = family_candidates.get(fk, [])
            if candidates:
                # Pick parent_uei of the highest-obligation member
                best = max(candidates, key=lambda x: x[1])
                family_parent_uei[fk] = best[0]
            else:
                family_parent_uei[fk] = None

    finally:
        if should_close:
            con.close()

    # Load recipient profile IDs from cache (via config.RESEARCH_DIR, not CWD-relative)
    from govbudget.config import RESEARCH_DIR as _RESEARCH_DIR
    cache_path = _RESEARCH_DIR / "usaspending_recipient_ids.json"
    profile_cache: dict = {}
    if cache_path.exists():
        try:
            import json as _json
            profile_cache = _json.loads(cache_path.read_text())
        except Exception:
            pass

    # Build result
    for fk, parent_uei in family_parent_uei.items():
        profile_id = profile_cache.get(parent_uei) if parent_uei else None
        result[fk] = {
            "parent_uei": parent_uei,
            "profile_id": profile_id,
        }

    return result


def _emit_flows_sidecars(*, flows_dir, con) -> int:
    """Emit flows/{pe_bli}.json for the 17 crosswalked programs.

    Each file: {header: {pe_bli, title, org, fy2026_total},
                awards: [{piid, recipient_name, family_slug, district, dollars}] (top-12)}

    Only confidence='high' awards, only rows with non-null pop_district.
    family_slug is derived with the lower/hyphen slugify rule.
    """
    from pathlib import Path as _Path
    import json as _json

    flows_dir = _Path(flows_dir)
    n_written = 0

    # Get program metadata
    try:
        prog_meta = {
            r[0]: {"title": r[1], "org": r[2]}
            for r in con.execute(
                "select pe_bli, title, org from dim_programs"
            ).fetchall()
        }
    except Exception:
        prog_meta = {}

    # Get fy2026_total per pe_bli from trajectory
    try:
        traj_fy26 = {}
        for r in con.execute(
            "select t.pe_bli, t.fy2026_total from fct_budget_trajectory t"
            " join dim_programs p on p.pe_bli = t.pe_bli"
            "  and t.organization = p.org"
        ).fetchall():
            traj_fy26[r[0]] = r[1]
    except Exception:
        traj_fy26 = {}

    # Get distinct programs in fct_district_programs (the 17 crosswalked programs)
    try:
        crosswalked_pe_blis = [
            r[0] for r in con.execute(
                "select distinct pe_bli from fct_district_programs order by pe_bli"
            ).fetchall()
        ]
    except Exception:
        crosswalked_pe_blis = []

    for pe_bli in crosswalked_pe_blis:
        # Get top-12 high-confidence awards for this program with non-null district
        try:
            award_rows = con.execute(
                """
                select
                    t.award_id_piid as piid,
                    t.recipient_uei,
                    t.pop_state,
                    t.pop_district,
                    coalesce(x.family_key, t.recipient_uei) as family_key,
                    sum(t.obligation) as dollars
                from fct_award_transactions t
                join (
                    select distinct award_piid
                    from fct_budget_to_awards
                    where confidence='high' and pe_bli=?
                ) b on t.award_id_piid = b.award_piid
                left join entity_xwalk x on t.recipient_uei = x.recipient_uei
                where t.pop_district is not null and t.obligation > 0
                group by 1,2,3,4,5
                order by dollars desc
                limit 12
                """,
                [pe_bli],
            ).fetchall()
        except Exception:
            award_rows = []

        # Build recipient_name lookup: UEI → name
        try:
            uei_names = {
                r[0]: r[1] for r in con.execute(
                    "select recipient_uei, recipient_name from entity_xwalk"
                    " where recipient_uei is not null"
                ).fetchall()
            }
        except Exception:
            uei_names = {}

        awards = []
        for piid, uei, pop_state, pop_district, family_key, dollars in award_rows:
            recipient_name = uei_names.get(uei, uei or "Unknown")
            family_slug = _slugify(family_key or recipient_name or "unknown")
            # pop_district already carries the state prefix (e.g. 'CO-05');
            # do NOT re-prepend pop_state to avoid double-prefix 'CO-CO-05'.
            district = pop_district if pop_district else None
            awards.append({
                "piid": piid,
                "recipient_name": recipient_name,
                "family_slug": family_slug,
                "district": district,
                "dollars": float(dollars) if dollars is not None else None,
                "confidence": "high",
            })

        meta = prog_meta.get(pe_bli, {})
        header = {
            "pe_bli": pe_bli,
            "title": meta.get("title"),
            "org": meta.get("org"),
            "fy2026_total": traj_fy26.get(pe_bli),
        }

        obj = {"header": header, "awards": awards}
        _write_json(flows_dir / f"{pe_bli}.json", obj)
        n_written += 1

    return n_written


def _slugify(s: str) -> str:
    """Slugify: lowercase, replace spaces/special chars with hyphens, collapse."""
    import re
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s


# ---------------------------------------------------------------------------
# USAspending recipient ID cache + lookup
# ---------------------------------------------------------------------------


def refresh_usaspending_ids(
    *,
    duckdb_path,
    cache_path=None,
    polite_delay: float = _USAS_POLITE_DELAY,
) -> dict:
    """Refresh the USAspending recipient ID cache.

    For each unique parent_uei found via the entity_xwalk deterministic rule,
    POST to api/v2/recipient/ with the UEI as keyword.
    Picks the row with level='P' (parent) or the first result if no P-level.

    Network-fail → null id for that UEI (never fail the whole run).
    Polite: {polite_delay}s between calls.
    Uses skip-if-cached: already-resolved UEIs (including null values) are skipped.

    Returns: updated cache dict {uei: profile_id|null}.
    """
    import json as _json
    import time
    from pathlib import Path as _Path

    import duckdb as _duckdb

    if cache_path is None:
        from govbudget.config import RESEARCH_DIR as _RESEARCH_DIR
        cache_path = _RESEARCH_DIR / "usaspending_recipient_ids.json"
    cache_path = _Path(cache_path)
    cache: dict = {}
    if cache_path.exists():
        try:
            cache = _json.loads(cache_path.read_text())
        except Exception:
            cache = {}

    # Collect all parent_ueis from entity_xwalk
    duckdb_path = _Path(duckdb_path)
    try:
        con = _duckdb.connect(str(duckdb_path), read_only=True)
        uei_rows = con.execute(
            "select distinct parent_uei from entity_xwalk where parent_uei is not null"
        ).fetchall()
        con.close()
        all_parent_ueis = {r[0] for r in uei_rows if r[0]}
    except Exception:
        all_parent_ueis = set()

    # Skip already-cached (including null values — sentinel key present in cache)
    to_lookup = [u for u in sorted(all_parent_ueis) if u not in cache]
    print(f"USAspending recipient ID refresh: {len(to_lookup)} UEIs to look up "
          f"({len(all_parent_ueis) - len(to_lookup)} already cached)")

    if not to_lookup:
        return cache

    try:
        import urllib.request
        import urllib.parse
    except ImportError:
        print("urllib not available — skipping network lookup")
        return cache

    for uei in to_lookup:
        try:
            body = _json.dumps({"keyword": uei}).encode()
            req = urllib.request.Request(
                f"{_USASPENDING_BASE}api/v2/recipient/",
                data=body,
                method="POST",
                headers={"Content-Type": "application/json",
                         "User-Agent": "govbudget-cite/1.0"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = _json.loads(resp.read())
            results = data.get("results", [])
            # Prefer P (parent) level
            p_level = next((r for r in results if r.get("recipient_level") == "P"), None)
            chosen = p_level or (results[0] if results else None)
            profile_id = chosen.get("id") if chosen else None
            cache[uei] = profile_id
        except Exception:
            cache[uei] = None
        time.sleep(polite_delay)

    # Persist cache
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(_json.dumps(cache, sort_keys=True, indent=2))
    return cache


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
