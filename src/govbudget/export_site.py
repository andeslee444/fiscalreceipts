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
  out_dir/json/program_details/{pe_bli}.json  (one per program page:
      dim_programs rows + trajectory-only feed programs, backlog #17)
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


def fact_id_narrative(document_sha256: str, pe_bli: str, kind: str, xml_path: str) -> str:
    """Canonical identity for a jbook_narrative citation.

    sha256 of 'jbook_narrative|{document_sha256}|{pe_bli}|{kind}|{xml_path}', hexdigest[:16].
    xml_path is the J-book XML locator (e.g. 'ProgramElement[5]/Narrative[0]');
    the combination of (document_sha256, pe_bli, kind, xml_path) is unique per
    narrative row in detail_narratives.
    """
    key = f"jbook_narrative|{document_sha256}|{pe_bli}|{kind}|{xml_path}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Human-readable fiscal-year pair label for the active trajectory columns
# (fy2526_* in fct_budget_trajectory). Single source for feed headline text —
# mirrors TRAJECTORY_FY_LABEL in site/src/lib/site.ts. Always the U+2192
# arrow ("→"), never ASCII "-->". Update both when the mart rolls forward.
# ---------------------------------------------------------------------------

_TRAJECTORY_FY_LABEL = "FY25→26"

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
#  usaspending rows cover fct_family_obligations_by_year, fct_district_programs;
#  lda_filings is the influence-stage parquet behind the /filing sidecars —
#  filing income/expenses amounts cite the filing-level kind='lda_filing'
#  rows minted by _build_filing_lda_citation_rows)
_CITED_DATASETS = {
    "jbook_details",
    "jbook_narratives",
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
    "lda_filings",
}


def _stage_parquet_path(duckdb_path, stage: str, filename: str):
    """Resolve a staged parquet (influence/oversight) next to the DuckDB file.

    Layouts probed in order:
      1. {duckdb_dir}/parquet/{stage}/{filename}            (test fixtures)
      2. {duckdb_dir}/../parquet/{stage}/{filename}         (live: data/duckdb + data/parquet)
      3. {duckdb_dir}/../data/parquet/{stage}/{filename}    (legacy fallback)

    Returns the first existing Path, or None.
    """
    base = Path(duckdb_path).parent
    candidates = [
        base / "parquet" / stage / filename,
        base.parent / "parquet" / stage / filename,
        base.parent / "data" / "parquet" / stage / filename,
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


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

        # Compute fact_id for each narrative row (jbook_narrative kind).
        # xml_path is the J-book XML locator and is required for uniqueness.
        # Rows with null xml_path cannot be uniquely identified and are skipped
        # for citation emission (they still appear in the parquet without fact_id).
        narr_rows_with_fid = []
        for pe_bli, pn, kind, title, body, xml_path, org, fy, sha in rows_narr:
            fid = fact_id_narrative(sha, pe_bli, kind, xml_path or "") if xml_path else None
            narr_rows_with_fid.append((
                fid, pe_bli, pn, kind, title, body, xml_path, org,
                int(fy) if fy is not None else None, sha,
            ))

        _write_typed_parquet(
            data_dir / "jbook_narratives.parquet",
            columns=[
                ("fact_id", "varchar"),
                ("pe_bli", "varchar"), ("project_number", "varchar"),
                ("kind", "varchar"), ("title", "varchar"),
                ("body", "varchar"), ("xml_path", "varchar"),
                ("org", "varchar"),
                ("fiscal_year", "integer"), ("document_sha256", "varchar"),
            ],
            rows=narr_rows_with_fid,
        )
        dataset_counts["jbook_narratives"] = len(narr_rows_with_fid)

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
                pe_bli,   # pe_bli (jbook_pdf only — enables pdf_page citation resolution)
                scenario, # scenario
                None,     # amount_type (jbook_pdf rows use scenario, not amount_type)
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
            pe_bli,      # pe_bli (workbook rows carry pe_bli too)
            None,        # scenario (not applicable for workbook)
            amount_type, # amount_type (workbook rows carry amount_type)
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
             formula, inputs, query_body, recorded_value,
             row_pe_bli, row_scenario, row_amount_type) = row
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
                row_pe_bli, row_scenario, row_amount_type,
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
            pe_bli, None, None,  # pe_bli, scenario, amount_type
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

    # --- 4h. jbook_narrative citations ---
    # One citation row per jbook_narratives row that has a non-null xml_path.
    # official_url = the document's source_url (dedup on sha256, lowest id wins).
    # retrieved_at = the document's downloaded_at.
    # All page/bbox/sheet fields are None; xml_path carries the locator.
    with psycopg.connect(dsn) as pg_narr:
        narr_doc_lookup = {
            r[0]: (r[1], r[2])
            for r in pg_narr.execute(
                """
                select distinct on (sha256) sha256, source_url, downloaded_at
                from jbook_documents
                where sha256 is not null
                order by sha256, id
                """
            ).fetchall()
        }

    for (fid, pe_bli, pn, kind, title, body, xml_path, org, fy, sha) in narr_rows_with_fid:
        if fid is None or not xml_path:
            continue  # skip rows without a resolvable xml_path
        src_url, dl_at = narr_doc_lookup.get(sha, (None, None))
        official_url = src_url or None
        ret_at = dl_at.isoformat() if dl_at else None
        citation_rows.append((
            fid, "jbook_narrative", None,  # fact_id, kind, units
            None, None, None, None, None, None, None, None,  # amount_text + bbox
            None,   # resolution
            None,   # sheet
            None,   # cells
            None,   # amount_thousands
            sha,    # sha256 (document fingerprint for integrity check)
            None,   # hosted_pdf_url
            official_url,  # official_url
            xml_path,      # xml_path (J-book XML locator)
            ret_at,        # retrieved_at
            None, None, None, None,  # formula, inputs, query_body, recorded_value
            pe_bli, None, None,  # pe_bli, scenario, amount_type
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
            # Derived-tier columns (nullable for all other kinds)
            ("formula", "varchar"), ("inputs", "varchar"),
            ("query_body", "varchar"), ("recorded_value", "varchar"),
            # pdf_page resolution columns (Task 5B-4): enable eval citation resolution
            ("pe_bli", "varchar"),       # populated for jbook_pdf + workbook + lda_filing kinds
            ("scenario", "varchar"),     # populated for jbook_pdf only
            ("amount_type", "varchar"),  # populated for workbook only
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
        "pdf_count": n_pdfs,
        "workbook_count": n_workbooks,
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
    """Build a 27-element citation row for kind='derived' (includes pe_bli/scenario/amount_type)."""
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
        None,   # pe_bli
        None,   # scenario
        None,   # amount_type
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
    # Detail rows only (title IS NOT NULL): budget_lines carries both detail
    # rows and R-1 rollup rows (title IS NULL) for the same
    # (pe_bli, org, amount_type); fct_budget_trajectory pivots detail rows only,
    # so including rollup fact_ids here would make sum(inputs) exceed the
    # recorded trajectory value and fail the derived-sum recompute gate.
    bl_key_to_fid: dict[tuple, list[str]] = {}
    for r in bl_rows:
        fid_bl, _, _, _, _, bl_org, _, _, bl_pe, bl_title, bl_amt_type, _, _, _, _, _ = r
        if bl_title is None:
            continue
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
        # These must match the dbt fct_budget_trajectory pivot exactly so that
        # sum(inputs) == recorded_value. The dbt model uses only fy_2025_total and
        # fy_2026_total (not enacted/request alternatives), so we follow suit here.
        _METRIC_TO_AMOUNT_TYPES: dict[str, list[str]] = {
            "fy2024_actuals": ["fy_2024_actuals"],
            "fy2025_total":   ["fy_2025_total"],
            "fy2026_total":   ["fy_2026_total"],
        }
        _METRIC_FORMULA: dict[str, str] = {
            "fy2024_actuals": "sum(budget_lines.amount_thousands where amount_type=fy_2024_actuals)",
            "fy2025_total":   "sum(budget_lines.amount_thousands where amount_type=fy_2025_total)",
            "fy2026_total":   "sum(budget_lines.amount_thousands where amount_type=fy_2026_total)",
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

        # ---- Agency FY26 sums ----
        # surface='agency', key=org, metric='fy2026_total_thousands'
        # Mirrors the agencies.json sidecar sum: per program, join trajectory
        # via (pe_bli, _workbook_org(org)) and sum fy2026_total.
        # inputs = the per-program trajectory fy2026_total DERIVED fact_ids
        # (peer fact_ids — each resolves in the citation set; recorded_values
        # of the inputs sum to this row's recorded_value).
        traj_fy26: dict[tuple, float] = {}
        for t_pe, t_org, _t24, _t25, t_fy26, _tchg in traj_rows:
            if t_fy26 is not None:
                traj_fy26[(t_pe, t_org)] = t_fy26

        org_fy26_total: dict[str, float] = {}
        org_fy26_inputs: dict[str, list[str]] = {}
        for pe_bli, org, _fy24_m in prog_rows_d:
            translated = _workbook_org(org)
            fy26_val = traj_fy26.get((pe_bli, translated))
            if fy26_val is None:
                continue
            org_fy26_total[org] = org_fy26_total.get(org, 0.0) + fy26_val
            org_fy26_inputs.setdefault(org, []).append(
                fact_id_derived("trajectory", f"{pe_bli}|{translated}", "fy2026_total")
            )

        for org, total26 in org_fy26_total.items():
            fid = fact_id_derived("agency", org, "fy2026_total_thousands")
            input_fids = list(dict.fromkeys(org_fy26_inputs.get(org, [])))
            formula_text = (
                f"sum(fct_budget_trajectory.fy2026_total) for org={org!r}"
                f" ({len(input_fids)} programs with trajectory rows)"
            )
            rows.append(_null_derived_row(
                fid, "derived", "USD thousands",
                formula_text,
                _json.dumps(input_fids),
                f"{total26:.3f}",
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
        oversight_pq = _stage_parquet_path(
            duckdb_path, "oversight", "improper_payments.parquet"
        )
        if oversight_pq is not None:
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
        lda_filings_pq = _stage_parquet_path(
            duckdb_path, "influence", "lda_filings.parquet"
        )
        if lda_filings_pq is not None:
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

        # ---- Feed event derived citations ----
        # yoy_swing and zeroed_fy2026 re-use trajectory fact_ids already emitted.
        # concentration_shift HHI cites fct_program_concentration derived fact_ids.
        # new_entrant has no figure citation (first_fy is a year label, not a dollar amount).
        # For concentration_shift: emit a per-pe_bli-year derived row for the HHI figure.
        # The mart uses (pe_bli, fiscal_year) tuples; the citation key mirrors that.
        # Live mart columns: headline_value carries the HHI, comparison_value
        # carries the matched dollars (there are NO hhi/matched_dollars columns
        # — a naive select against them throws and silently drops every feed
        # citation, leaving the /feed page in state C for a dataset that is
        # off the uncited ledger).
        try:
            feed_conc_rows = con.execute(
                "select pe_bli, fiscal_year, headline_value, comparison_value"
                " from fct_feed_events"
                " where event_type = 'concentration_shift'"
            ).fetchall()
        except Exception:
            feed_conc_rows = []

        _FEED_HHI_FORMULA = (
            "sum(share_pct * share_pct) over (pe_bli, fiscal_year) "
            "where share = family_obligation / sum(family_obligation) "
            "and obligation > 0 (feed HHI; positive-only shares)"
        )
        for fe_pe_bli, fe_fy, fe_hhi, fe_dollars in feed_conc_rows:
            if fe_hhi is None or fe_pe_bli is None or fe_fy is None:
                continue
            fid = fact_id_derived("feed", f"concentration_shift|{fe_pe_bli}|{fe_fy}", "hhi")
            rows.append(_null_derived_row(
                fid, "derived", "Herfindahl-Hirschman Index",
                _FEED_HHI_FORMULA,
                "[]",
                f"{fe_hhi:.3f}",
                built_at,
            ))
            if fe_dollars is not None:
                fid_d = fact_id_derived("feed", f"concentration_shift|{fe_pe_bli}|{fe_fy}", "matched_dollars")
                rows.append(_null_derived_row(
                    fid_d, "derived", "USD",
                    "sum(obligations) for high-confidence awards in feed concentration window",
                    "[]",
                    f"{fe_dollars:.3f}",
                    built_at,
                ))

        # new_entrant total dollars — surface='feed', key='new_entrant|{family_key}',
        # metric='total_obligation'.  Without this row the /feed card renders a
        # state-C dollar figure for a dataset that is off the uncited ledger.
        try:
            feed_ne_rows = con.execute(
                "select family_key, headline_value, comparison_value"
                " from fct_feed_events"
                " where event_type = 'new_entrant'"
            ).fetchall()
        except Exception:
            feed_ne_rows = []

        for ne_family, ne_total, ne_first_fy in feed_ne_rows:
            if ne_family is None or ne_total is None:
                continue
            fid_ne = fact_id_derived("feed", f"new_entrant|{ne_family}", "total_obligation")
            first_fy_str = str(int(ne_first_fy)) if ne_first_fy is not None else "?"
            rows.append(_null_derived_row(
                fid_ne, "derived", "USD",
                f"sum(fct_award_transactions.obligation) across family UEIs"
                f" via entity_xwalk (new entrant: first award FY{first_fy_str},"
                f" $1M floor)",
                "[]",
                f"{ne_total:.3f}",
                built_at,
                query_body=(
                    "select sum(t.obligation) from fct_award_transactions t"
                    " join entity_xwalk x on t.recipient_uei=x.recipient_uei"
                    f" where x.family_key='{ne_family}'"
                ),
            ))

    finally:
        con.close()

    return rows


# ---------------------------------------------------------------------------
# JSON sidecar emission (Phase 5B-2)
# ---------------------------------------------------------------------------


def _trajectory_only_feed_programs(con, existing_pe_blis: set) -> list[tuple]:
    """Synthesize dim_programs-shaped rows for feed PEs without a page (backlog #17).

    fct_feed_events references pe_blis that exist in fct_budget_trajectory but
    not in dim_programs (which requires R-2/P-40 J-book detail). Those feed
    cards used to dead-end. This helper returns rows in the EXACT shape of the
    dim_programs sidecar query so the sidecar writer can treat them uniformly:

        (pe_bli, org, exhibit_family, title, project_count,
         fy2024_actual_millions, fully_reconciled)

    Honesty contract:
    - title comes from dim_pe_titles (the single deterministic title mart);
      titleless pe_blis are SKIPPED loudly — a page without an h1 would be
      broken, and inventing a title violates cited-or-absent.
    - pe_blis without any fct_budget_trajectory row are skipped (no figures
      to render; the feed card stays linkless via the site's programs.json
      gate — honest degradation, not a dead link).
    - project_count=0, fy2024_actual_millions=None, fully_reconciled=False:
      there is NO J-book detail behind these pages. The page renders the
      trajectory figures (whose derived citations are already emitted for
      every trajectory row) and empty states everywhere else.
    - exhibit_family derived from fct_budget_lines exhibits for the pe_bli
      (majority P-* → 'procurement', else 'rdte' — mirrors dim_programs
      exhibit_family vocabulary).
    - Deterministic: one row per pe_bli (largest fy2026_total wins when a
      pe_bli spans orgs — none do as of FY2026; org ascending tiebreak),
      ordered by pe_bli.
    """
    try:
        rows = con.execute(
            """
            with feed_pes as (
                select distinct pe_bli from fct_feed_events
                where pe_bli is not null
            ),
            traj as (
                select t.pe_bli, t.organization,
                       row_number() over (
                           partition by t.pe_bli
                           order by t.fy2026_total desc nulls last,
                                    t.organization
                       ) as rn
                from fct_budget_trajectory t
                join feed_pes f on f.pe_bli = t.pe_bli
            ),
            fam as (
                select pe_bli,
                       case when sum(case when exhibit like 'P%' then 1 else 0 end)
                                 > sum(case when exhibit like 'R%' then 1 else 0 end)
                            then 'procurement' else 'rdte' end as exhibit_family
                from fct_budget_lines
                where pe_bli in (select pe_bli from feed_pes)
                group by pe_bli
            )
            select tr.pe_bli, tr.organization,
                   coalesce(fam.exhibit_family, 'rdte') as exhibit_family,
                   ttl.title
            from traj tr
            left join fam on fam.pe_bli = tr.pe_bli
            left join dim_pe_titles ttl on ttl.pe_bli = tr.pe_bli
            where tr.rn = 1
            order by tr.pe_bli
            """
        ).fetchall()
    except Exception as exc:
        # Loud, not silent: missing marts mean the feed sidecar itself would
        # be empty too — nothing to synthesize.
        print(f"trajectory-only programs: mart query failed ({exc}); skipping")
        return []

    synth: list[tuple] = []
    for pe_bli, org, exhibit_family, title in rows:
        if pe_bli in existing_pe_blis:
            continue
        if not title:
            print(
                f"trajectory-only programs: SKIP {pe_bli} — no dim_pe_titles row"
                " (page would have no title; cited-or-absent)"
            )
            continue
        synth.append((pe_bli, org, exhibit_family, title, 0, None, False))
    return synth


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

    # fy2024_xml_path index: pe_bli → xml_path for PriorYear root rows that
    # have NO citation row (zero_amount facts).  Lets the program headline
    # FY24 figure render honest Cite state B (xml-path chip) instead of
    # state C — required by the dataset-ledger render gate, since
    # jbook_details is a cited dataset and may no longer render ⁂.
    fy2024_xml_path: dict[str, str] = {}
    for row in detail_rows:
        (fid, pe_bli, project_number, project_title, scenario,
         _amount_millions, _units, xml_path, *rest) = row
        if project_number is None and scenario == "PriorYear":
            if (pe_bli not in fy2024_xml_path and fid not in _cited_fact_ids
                    and xml_path):
                fy2024_xml_path[pe_bli] = xml_path

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

    # Trajectory-only feed programs (backlog #17): feed events reference
    # pe_blis that live in fct_budget_trajectory but not dim_programs (no
    # R-2/P-40 J-book detail). Synthesize program rows for them so they get
    # pages: title from dim_pe_titles, figures from the trajectory mart
    # (derived trajectory citations are already emitted for every trajectory
    # row), honest absences everywhere else. These rows join programs.json /
    # program_details / search docs ONLY — agencies.json and the derived
    # agency-sum citation rows stay dim_programs-scoped by construction
    # (their orgs — A/N/F service workbook codes — have no agency pages).
    synth_prog_rows = _trajectory_only_feed_programs(
        con, {r[0] for r in prog_rows}
    )
    all_prog_rows = prog_rows + synth_prog_rows
    if synth_prog_rows:
        print(
            f"programs.json: +{len(synth_prog_rows)} trajectory-only feed programs"
            f" (total {len(all_prog_rows)})"
        )

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
        # Derived citation fact_ids (Task 3 flips) — only attached when the
        # citation row actually exists (caller guarantees factId resolves).
        hhi_fid = fact_id_derived("concentration", pe_bli, "hhi")
        dollars_fid = fact_id_derived("concentration", pe_bli, "program_dollars")
        hhi_by_pe[pe_bli] = {
            "hhi": hhi,
            "top_family": top_family,
            "family_count": family_count,
            "program_dollars": program_dollars,
            "hhi_fact_id": hhi_fid if (hhi is not None and hhi_fid in _cited_fact_ids) else None,
            "program_dollars_fact_id": (
                dollars_fid
                if (program_dollars is not None and dollars_fid in _cited_fact_ids)
                else None
            ),
        }

    # jbook_narratives — from detail_rows we don't have narratives;
    # we need to re-read from the written parquet or store them in memory.
    # Since narratives come from a separate Postgres query, we read the
    # already-written parquet file.
    # fact_id is included so that dossier bundles can cite narrative rows.
    narr_by_pe: dict[str, list] = defaultdict(list)
    narr_pq = out_dir / "data" / "jbook_narratives.parquet"
    if narr_pq.exists():
        import duckdb as _duckdb2
        narr_rows = _duckdb2.sql(
            f"select fact_id, pe_bli, kind, title, body, xml_path from read_parquet('{narr_pq}')"
        ).fetchall()
        for narr_fid, pe_bli, kind, title, body, xml_path in narr_rows:
            entry: dict = {"kind": kind, "title": title, "body": body, "xml_path": xml_path or ""}
            # Only attach fact_id when the citation row was emitted (xml_path non-null,
            # sha256 matched a document row). The _cited_fact_ids set is the authoritative
            # membership check — if fact_id resolves there, the model can cite it.
            if narr_fid and narr_fid in _cited_fact_ids:
                entry["fact_id"] = narr_fid
            narr_by_pe[pe_bli].append(entry)

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
    # dim_entities total per family_key — used to attach the entity derived
    # fact_id to influence rows' family_obligations_usd ONLY when the values
    # agree (they are computed from the same warehouse data; mismatch → no fid,
    # the page then omits the figure rather than render a dangling citation).
    entity_total_by_fk: dict[str, float] = {
        r[0]: r[3] for r in entity_rows if r[3] is not None
    }

    influence_by_fk: dict[str, list] = defaultdict(list)
    for r in influence_rows:
        (fk, filing_year, filings_count, lobbying_income_usd,
         lobbying_expense_usd, lobbying_total_usd, family_obligations_usd) = r
        infl_key = f"{fk}|{filing_year}"

        def _infl_fid(metric: str, value) -> str | None:
            if value is None:
                return None
            fid = fact_id_derived("influence", infl_key, metric)
            return fid if fid in _cited_fact_ids else None

        fam_obl_fid = None
        if family_obligations_usd is not None:
            ent_total = entity_total_by_fk.get(fk)
            if ent_total is not None and abs(ent_total - family_obligations_usd) <= 0.01:
                cand = fact_id_derived("entity", fk, "total_obligation")
                if cand in _cited_fact_ids:
                    fam_obl_fid = cand

        influence_by_fk[fk].append({
            "filing_year": filing_year,
            "filings_count": filings_count,
            "lobbying_income_usd": lobbying_income_usd,
            "lobbying_expense_usd": lobbying_expense_usd,
            "lobbying_total_usd": lobbying_total_usd,
            "family_obligations_usd": family_obligations_usd,
            "income_fact_id": _infl_fid("lobbying_income_usd", lobbying_income_usd),
            "expense_fact_id": _infl_fid("lobbying_expense_usd", lobbying_expense_usd),
            "total_fact_id": _infl_fid("lobbying_total_usd", lobbying_total_usd),
            "family_obligations_fact_id": fam_obl_fid,
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

    # Program-page title set for linked_programs / feed / district / filing
    # link resolution. Includes trajectory-only feed programs: membership in
    # this dict == "a /program/{pe_bli}/ page exists", the same contract the
    # site enforces via programs.json (G1 dead-link gate).
    prog_titles: dict[str, str] = {}
    for r in all_prog_rows:
        prog_titles[r[0]] = r[3]  # pe_bli → title

    # ------------------------------------------------------------------ #
    # 2. programs.json                                                    #
    # ------------------------------------------------------------------ #

    def _trajectory_fact_ids(pe_bli: str, translated_org: str, traj: dict | None) -> dict | None:
        """Derived trajectory fact_ids for a program (Task 3 flips).

        Mirrors _build_derived_citation_rows emission conditions exactly:
        a metric fid is attached only when the metric value is non-None
        (fy2526_change additionally requires both fy25 and fy26 non-None)
        AND the fid actually resolves in the citation set.
        NEVER recompute these hashes in TS — Python is the single source.
        """
        if traj is None:
            return None
        key_str = f"{pe_bli}|{translated_org}"
        out: dict[str, str | None] = {}
        for metric in ("fy2024_actuals", "fy2025_total", "fy2026_total"):
            fid = fact_id_derived("trajectory", key_str, metric)
            out[metric] = (
                fid if (traj.get(metric) is not None and fid in _cited_fact_ids) else None
            )
        chg_fid = fact_id_derived("trajectory", key_str, "fy2526_change")
        chg_ok = (
            traj.get("fy2526_change") is not None
            and traj.get("fy2025_total") is not None
            and traj.get("fy2026_total") is not None
            and chg_fid in _cited_fact_ids
        )
        out["fy2526_change"] = chg_fid if chg_ok else None
        return out

    programs_list = []
    for r in all_prog_rows:
        pe_bli, org, exhibit_family, title, project_count, fy2024_actual_millions, fully_reconciled = r
        translated = _workbook_org(org)
        traj = traj_index.get((pe_bli, translated))
        programs_list.append({
            "award_count": len(awards_by_pe.get(pe_bli, [])),
            "exhibit_family": exhibit_family,
            "fy2024_actual_millions": fy2024_actual_millions,
            "fy2024_fact_id": fy2024_fact_id.get(pe_bli),
            "fy2024_xml_path": (
                fy2024_xml_path.get(pe_bli)
                if pe_bli not in fy2024_fact_id
                else None
            ),
            "fully_reconciled": fully_reconciled,
            "hhi": hhi_by_pe.get(pe_bli),
            "narrative_count": len(narr_by_pe.get(pe_bli, [])),
            "org": org,
            "pe_bli": pe_bli,
            "project_count": project_count,
            "title": title,
            "trajectory": traj,
            "trajectory_fact_ids": _trajectory_fact_ids(pe_bli, translated, traj),
        })

    _write_json(json_dir / "programs.json", programs_list)
    n_files += 1

    # ------------------------------------------------------------------ #
    # 3. program_details/{pe_bli}.json  (one file per program)           #
    # ------------------------------------------------------------------ #

    det_dir = json_dir / "program_details"
    det_dir.mkdir(exist_ok=True)

    all_pe_blis = {r[0] for r in all_prog_rows}
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

    def _entity_total_fid(family_key: str, total_obligation) -> str | None:
        """Derived entity total_obligation fact_id (Task 3 flips) — only when
        the citation row exists in the citation set."""
        if total_obligation is None:
            return None
        fid = fact_id_derived("entity", family_key, "total_obligation")
        return fid if fid in _cited_fact_ids else None

    entities_list = []
    for r in entity_rows:
        family_key, display_name, uei_count, total_obligation, worst_confidence = r
        slug = family_key.lower().replace(" ", "-")
        entities_list.append({
            "display_name": display_name,
            "family_key": family_key,
            "slug": slug,
            "total_obligation": total_obligation,
            "total_obligation_fact_id": _entity_total_fid(family_key, total_obligation),
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
    # dim_programs rows ONLY (not the synthesized trajectory-only programs):
    # the derived agency-sum citation rows in _build_derived_citation_rows
    # iterate dim_programs, and these sidecar sums must recompute identically.
    # The synthesized programs' orgs (A/N/F service workbook codes) have no
    # agency pages — the site renders their org as plain text, not a link.
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
        fy24_fid = fact_id_derived("agency", org, "fy2024_total_millions")
        fy26_fid = fact_id_derived("agency", org, "fy2026_total_thousands")
        agencies_list.append({
            "fy2024_total_millions": org_fy2024_millions.get(org, 0.0),
            "fy2024_fact_id_derived": fy24_fid if fy24_fid in _cited_fact_ids else None,
            "fy2026_total_thousands": fy26,
            "fy2026_fact_id_derived": (
                fy26_fid if (fy26 is not None and fy26_fid in _cited_fact_ids) else None
            ),
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
    #                      formula, inputs, query_body, recorded_value,
    #                      pe_bli, scenario, amount_type)
    citations_dict: dict[str, dict] = {}
    for row in citation_rows:
        (fid, kind, units, amount_text, page_number, x0, x1,
         top_pt, bottom_pt, page_width, page_height, resolution,
         sheet, cells, amount_thousands, sha256, hosted_pdf_url,
         official_url, xml_path, retrieved_at,
         formula, inputs, query_body, recorded_value,
         row_pe_bli, row_scenario, row_amount_type) = row
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

    # Program docs (includes trajectory-only feed programs — every entry here
    # has a /program/{pe_bli}/ page because programs.json is the
    # generateStaticParams source)
    for r in all_prog_rows:
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
        {"id": "s:home", "kind": "static", "title": "Fiscal Receipts", "url": "/"},
        {"id": "s:programs", "kind": "static", "title": "Programs", "url": "/programs/"},
        {"id": "s:companies", "kind": "static", "title": "Companies", "url": "/companies/"},
        {"id": "s:data", "kind": "static", "title": "Data Explorer", "url": "/data/"},
        {"id": "s:downloads", "kind": "static", "title": "Downloads", "url": "/downloads/"},
        {"id": "s:methodology", "kind": "static", "title": "Methodology", "url": "/methodology/"},
        {"id": "s:about", "kind": "static", "title": "About", "url": "/about/"},
        {"id": "s:feed", "kind": "static", "title": "Anomaly Feed", "url": "/feed/"},
        {"id": "s:district", "kind": "page", "title": "Congressional Districts — defense spending by district", "url": "/district/"},
        {"id": "s:filings", "kind": "static", "title": "Lobbying Filings", "url": "/filings/"},
    ]
    search_docs.extend(static_pages)

    # Feed event docs — one search entry per distinct event-type
    _FEED_EVENT_LABELS: dict[str, str] = {
        "yoy_swing": "Year-over-year budget swing",
        "zeroed_fy2026": "FY2026 zeroed programs",
        "concentration_shift": "Award concentration shift",
        "new_entrant": "New defense contractors",
    }
    for etype, label in _FEED_EVENT_LABELS.items():
        search_docs.append({
            "id": f"feed:{etype}",
            "kind": "feed",
            "title": label,
            "url": f"/feed/#{etype}",
        })

    # District docs — one entry per distinct pop_district (from fct_district_programs)
    try:
        dist_keys_rows = con.execute(
            "select distinct pop_state, pop_district from fct_district_programs"
            " order by pop_state, pop_district"
        ).fetchall()
    except Exception:
        dist_keys_rows = []
    # Build state abbreviation → full name lookup for richer district titles
    _STATE_NAMES: dict[str, str] = {
        "AK": "Alaska", "AL": "Alabama", "AR": "Arkansas", "AZ": "Arizona",
        "CA": "California", "CO": "Colorado", "CT": "Connecticut",
        "DC": "District of Columbia", "DE": "Delaware", "FL": "Florida",
        "GA": "Georgia", "HI": "Hawaii", "IA": "Iowa", "ID": "Idaho",
        "IL": "Illinois", "IN": "Indiana", "KS": "Kansas", "KY": "Kentucky",
        "LA": "Louisiana", "MA": "Massachusetts", "MD": "Maryland",
        "ME": "Maine", "MI": "Michigan", "MN": "Minnesota", "MO": "Missouri",
        "MS": "Mississippi", "MT": "Montana", "NC": "North Carolina",
        "ND": "North Dakota", "NE": "Nebraska", "NH": "New Hampshire",
        "NJ": "New Jersey", "NM": "New Mexico", "NV": "Nevada",
        "NY": "New York", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
        "PA": "Pennsylvania", "PR": "Puerto Rico", "RI": "Rhode Island",
        "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
        "TX": "Texas", "UT": "Utah", "VA": "Virginia", "VT": "Vermont",
        "WA": "Washington", "WI": "Wisconsin", "WV": "West Virginia",
        "WY": "Wyoming",
    }
    for pop_state, pop_district in dist_keys_rows:
        if not pop_district:
            continue
        state_name = _STATE_NAMES.get(pop_state or "", pop_state or "")
        search_docs.append({
            "id": f"district:{pop_district}",
            "kind": "district",
            # pe_bli carries the district code so MiniSearch's pe_bli field
            # gives an exact-match boost (same field used for program codes).
            "pe_bli": pop_district,
            "org": state_name,
            "title": f"{pop_district} — {state_name} congressional district defense spending",
            "url": f"/district/{pop_district}/",
        })

    # Alias docs (Task 7a) — curated, cited nicknames/acronyms from
    # data-seeds/search_aliases.csv. Emitted as standalone quick docs
    # {kind:'alias', title: term, url: target_url}: the site's quick-search
    # groups every non-program/company/agency kind under "Pages"
    # (site/src/lib/search.ts), so no MiniSearch field-config change is
    # needed — the alias term is the doc title, which is already indexed.
    import csv as _csv

    from govbudget.config import ROOT as _ROOT

    aliases_csv = _ROOT / "data-seeds" / "search_aliases.csv"
    if aliases_csv.exists():
        with aliases_csv.open(newline="", encoding="utf-8") as _fh:
            for _row in _csv.DictReader(_fh):
                _term = (_row.get("term") or "").strip()
                _target = (_row.get("target_url") or "").strip()
                if not _term or not _target:
                    continue
                search_docs.append({
                    "id": f"alias:{_term.lower().replace(' ', '-')}",
                    "kind": "alias",
                    "title": _term,
                    "url": _target,
                })

    _write_json(json_dir / "search_quick.json", {"docs": search_docs})
    n_files += 1

    # ------------------------------------------------------------------ #
    # 9. site_meta.json                                                  #
    # ------------------------------------------------------------------ #

    # Compute counts for the meta file. counts.programs is the PAGE count
    # (programs.json length, incl. trajectory-only feed programs) — the home
    # stats band links it to /programs/, which lists exactly these entries.
    meta_counts = {
        "agencies": len(org_prog_count),
        "citations": len(citation_rows),
        "companies": len(entity_rows),
        "programs": len(programs_list),
    }

    site_meta = {
        "built_at": manifest.get("built_at"),
        "counts": meta_counts,
        # datasets dict from manifest — single source of truth for per-dataset row counts.
        # The site build reads this for data-driven download card descriptions.
        "datasets": manifest.get("datasets", {}),
        # pdf_count and workbook_count come from manifest so the site can render
        # accurate "34 PDFs / 3 workbooks" labels without hard-coded literals.
        "pdf_count": manifest.get("pdf_count", 0),
        "workbook_count": manifest.get("workbook_count", 0),
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

    # ------------------------------------------------------------------ #
    # 12. feed.json  (anomaly feed cards — Task 4)                       #
    # ------------------------------------------------------------------ #
    _emit_feed_sidecar(
        json_dir=json_dir,
        con=con,
        prog_titles=prog_titles,
        cited_fact_ids=_cited_fact_ids,
    )
    n_files += 1

    # ------------------------------------------------------------------ #
    # 13. districts/index.json + districts/{pop_district}.json (Task 5)  #
    # ------------------------------------------------------------------ #
    dist_dir = json_dir / "districts"
    dist_dir.mkdir(exist_ok=True)
    n_dist = _emit_district_sidecars(
        dist_dir=dist_dir,
        con=con,
        prog_titles=prog_titles,
        cited_fact_ids=_cited_fact_ids,
    )
    n_files += n_dist

    # ------------------------------------------------------------------ #
    # 14. filings/{uuid}.json + filings_index.json (Task 6a)             #
    # ------------------------------------------------------------------ #
    n_filings = _emit_filing_sidecars(
        json_dir=json_dir,
        duckdb_path=duckdb_path,
        lob_rows=lob_rows,
        prog_titles=prog_titles,
        cited_fact_ids=_cited_fact_ids,
    )
    n_files += n_filings

    # ------------------------------------------------------------------ #
    # 15. gao_overlays.json (Task 6b)                                     #
    # ------------------------------------------------------------------ #
    _emit_gao_overlays_sidecar(
        json_dir=json_dir,
        duckdb_path=duckdb_path,
        con=con,
        cited_fact_ids=_cited_fact_ids,
    )
    n_files += 1

    # ------------------------------------------------------------------ #
    # 16. categories.json (Task 8a — top-50 hero categories)              #
    # ------------------------------------------------------------------ #
    _emit_categories_sidecar(json_dir=json_dir)
    n_files += 1

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
    """Build a 27-element citation row for kind='usaspending' (includes pe_bli/scenario/amount_type)."""
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
        None,   # pe_bli
        None,   # scenario
        None,   # amount_type
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

    rows: list[tuple] = []

    # Find the lda_filings parquet (test + live layouts)
    lda_pq = _stage_parquet_path(duckdb_path, "influence", "lda_filings.parquet")
    if lda_pq is None:
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

        # Emit IFF the amount parses as a number — the same rule (_parse_usd)
        # the filings sidecar uses, so citation rows and sidecar amounts are
        # paired by construction (verify-phase5b1 lda set-invariant).
        # Income row
        if _parse_usd(income_usd) is not None:
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
                None,   # pe_bli
                None,   # scenario
                None,   # amount_type
            ))

        # Expenses row
        if _parse_usd(expenses_usd) is not None:
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
                None,   # pe_bli
                None,   # scenario
                None,   # amount_type
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
                None,   # pe_bli
                None,   # scenario
                None,   # amount_type
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
                None,   # pe_bli
                None,   # scenario
                None,   # amount_type
            ))

    return rows


def _emit_feed_sidecar(
    *,
    json_dir: Path,
    con,
    prog_titles: dict,
    cited_fact_ids: set,
) -> None:
    """Emit json/feed.json from fct_feed_events (Task 4).

    Each card: event_type, title (resolved program title, null when none),
    headline (text), figure, fact_id (cited if available), pe_bli (optional),
    program_url (optional), why_url (methodology anchor).

    Headline text is composed from the mart row fields and LEADS with the
    resolved program title (raw PE/BLI code only as honest fallback — the
    site demotes the code to the card's metadata line).
    yoy_swing / zeroed_fy2026 figures cite trajectory derived fact_ids.
    concentration_shift HHI cites feed-surface derived fact_ids.
    new_entrant figure has no citation (year label, not a dollar).

    junk pe_bli filter: pe_bli='9999999999' excluded upstream in fct_feed_events SQL.
    """
    import json as _json

    try:
        feed_rows = con.execute(
            "select event_type, pe_bli, organization, family_key,"
            "       headline_value, comparison_value, pct_change,"
            "       fiscal_year, units, detail_json"
            " from fct_feed_events"
            " order by event_type, pe_bli nulls last, family_key nulls last"
        ).fetchall()
    except Exception:
        feed_rows = []

    # Program-title fallback for pe_blis outside dim_programs (prog_titles).
    # yoy_swing / zeroed_fy2026 events come from fct_budget_trajectory, which
    # covers more pe_blis than dim_programs — those cards used to lead with
    # the raw PE code. Every trajectory row is built exclusively from TITLED
    # detail rows in fct_budget_lines (title IS NOT NULL), so a title is
    # resolvable for 100% of pe_bli feed events.
    # Resolution comes from the dim_pe_titles mart — the single source for
    # the deterministic largest-fy24-detail-row rule (alphabetical tiebreak);
    # see dbt/models/marts/dim_pe_titles.sql for the documented rule.
    # Title resolution ONLY affects display text — program_url stays emitted
    # as-is and the site keeps gating links on programs.json page existence
    # (G1 dead-link contract).
    try:
        bl_title_rows = con.execute(
            "select pe_bli, title from dim_pe_titles"
        ).fetchall()
    except Exception:
        bl_title_rows = []
    bl_titles: dict = {r[0]: r[1] for r in bl_title_rows}

    _WHY_BASE = "/methodology/#feed"

    cards = []
    for (event_type, pe_bli, organization, family_key,
         headline_value, comparison_value, pct_change,
         fiscal_year, units, detail_json) in feed_rows:

        # Compose headline text — dim_programs title first (matches the
        # program page heading when one exists), dim_pe_titles canonical
        # title as fallback for trajectory-only pe_blis.
        program_title = ""
        if pe_bli:
            program_title = prog_titles.get(pe_bli) or bl_titles.get(pe_bli, "")
        if event_type == "yoy_swing":
            direction = "increased" if (pct_change or 0) >= 0 else "decreased"
            pct_str = f"{abs(pct_change or 0):.0f}%"
            headline_text = f"{program_title or pe_bli} {direction} {pct_str} {_TRAJECTORY_FY_LABEL}"
            # figure: pct_change (rendered as %) — cite via trajectory derived fact_id
            figure_value = pct_change
            figure_units = "pct_change"
            figure_fact_id = None
            if pe_bli and organization:
                # Reuse trajectory key pattern: the sidecar key is pe_bli|org
                traj_key = f"{pe_bli}|{organization}"
                fid_cand = fact_id_derived("trajectory", traj_key, "fy2526_change")
                if fid_cand in cited_fact_ids:
                    figure_fact_id = fid_cand

        elif event_type == "zeroed_fy2026":
            headline_text = f"{program_title or pe_bli} zeroed out in FY2026 (had {_fmt_thousands(comparison_value)} in FY25)"
            figure_value = comparison_value  # last known (FY25)
            figure_units = "thousands_usd"
            figure_fact_id = None
            if pe_bli and organization:
                traj_key = f"{pe_bli}|{organization}"
                fid_cand = fact_id_derived("trajectory", traj_key, "fy2025_total")
                if fid_cand in cited_fact_ids:
                    figure_fact_id = fid_cand

        elif event_type == "concentration_shift":
            headline_text = f"{program_title or pe_bli} award concentration HHI={headline_value:.0f} ({fiscal_year})"
            figure_value = headline_value  # HHI
            figure_units = "hhi"
            figure_fact_id = None
            if pe_bli and fiscal_year is not None:
                fid_cand = fact_id_derived("feed", f"concentration_shift|{pe_bli}|{fiscal_year}", "hhi")
                if fid_cand in cited_fact_ids:
                    figure_fact_id = fid_cand

        elif event_type == "new_entrant":
            fk_display = family_key or "Unknown"
            fy_str = str(int(comparison_value)) if comparison_value else "recent"
            headline_text = f"{fk_display} new defense contractor (first award FY{fy_str}, {_fmt_dollars(headline_value)} total)"
            figure_value = headline_value  # total_obligation
            figure_units = "dollars"
            # Cited via the feed new_entrant derived row (total family
            # obligations) — the figure is a dollar amount and must not render
            # state C (fct_feed_events is off the uncited ledger).
            figure_fact_id = None
            if family_key:
                fid_cand = fact_id_derived("feed", f"new_entrant|{family_key}", "total_obligation")
                if fid_cand in cited_fact_ids:
                    figure_fact_id = fid_cand

        else:
            headline_text = f"{event_type}: {pe_bli or family_key}"
            figure_value = headline_value
            figure_units = units or "unknown"
            figure_fact_id = None

        card = {
            "event_type": event_type,
            "family_key": family_key,
            "figure_fact_id": figure_fact_id,
            "figure_units": figure_units,
            "figure_value": float(figure_value) if figure_value is not None else None,
            "fiscal_year": int(fiscal_year) if fiscal_year is not None else None,
            "headline": headline_text,
            "organization": organization,
            "pe_bli": pe_bli,
            "program_url": f"/program/{pe_bli}/" if pe_bli else None,
            # Resolved program title (null for family_key-based cards and
            # unresolvable pe_blis). The headline already leads with this
            # title — the field exists so the site can key on it without
            # re-parsing headline text.
            "title": program_title or None,
            "why_url": f"{_WHY_BASE}-{event_type}",
        }
        cards.append(card)

    _write_json(json_dir / "feed.json", {"cards": cards, "total": len(cards)})


def _fmt_thousands(v) -> str:
    """Quick compact formatter for thousands-USD (feed headline text only)."""
    if v is None:
        return "N/A"
    raw = float(v) * 1000
    if abs(raw) >= 1_000_000_000:
        return f"${raw / 1_000_000_000:.1f}B"
    if abs(raw) >= 1_000_000:
        return f"${raw / 1_000_000:.1f}M"
    if abs(raw) >= 1_000:
        return f"${raw / 1_000:.1f}K"
    return f"${raw:.0f}"


def _fmt_dollars(v) -> str:
    """Quick compact formatter for raw USD (feed headline text only)."""
    if v is None:
        return "N/A"
    raw = float(v)
    if abs(raw) >= 1_000_000_000:
        return f"${raw / 1_000_000_000:.1f}B"
    if abs(raw) >= 1_000_000:
        return f"${raw / 1_000_000:.1f}M"
    return f"${raw:.0f}"


def _emit_district_sidecars(
    *,
    dist_dir: Path,
    con,
    prog_titles: dict,
    cited_fact_ids: set,
) -> int:
    """Emit districts/index.json and districts/{pop_district}.json (Task 5).

    High grain: programs with dollars + their usaspending fact_ids.
    dim_geography grand total goes on the uncited ledger (state C, dataset='dim_geography').

    index.json: totals per district + dim_geography grand total (uncited).
    {pop_district}.json: per-district program list with cited dollars + counts.

    Returns number of files written.
    """
    import json as _json

    n_written = 0

    # ---- District program rows from fct_district_programs ----
    try:
        dp_rows = con.execute(
            "select pop_state, pop_district, pe_bli, program_title,"
            "       organization, transaction_count, award_count,"
            "       recipient_count, total_obligation"
            " from fct_district_programs"
            " order by pop_state, pop_district, total_obligation desc nulls last"
        ).fetchall()
    except Exception:
        dp_rows = []

    # ---- dim_geography grand total (stays state C) ----
    try:
        geo_total_row = con.execute(
            "select sum(total_obligation) from dim_geography"
            " where obligation_type = 'contract'"
        ).fetchone()
        geo_grand_total = float(geo_total_row[0]) if geo_total_row and geo_total_row[0] else None
    except Exception:
        geo_grand_total = None

    # Build district index: distinct (pop_state, pop_district) with aggregates
    district_index: dict[str, dict] = {}
    district_programs: dict[str, list] = {}

    for (pop_state, pop_district, pe_bli, program_title, organization,
         transaction_count, award_count, recipient_count, total_obligation) in dp_rows:
        if not pop_district:
            continue
        key = pop_district
        title = prog_titles.get(pe_bli, program_title or "")

        # Compute the usaspending fact_id for this (district, program)
        key_str = f"{pop_state}|{pop_district}|{pe_bli}"
        fid = fact_id_usaspending("district_program", key_str, "total_obligation")
        fact_id_for_program = fid if fid in cited_fact_ids else None

        # district-level aggregate
        if key not in district_index:
            district_index[key] = {
                "pop_district": pop_district,
                "pop_state": pop_state,
                "program_count": 0,
                "total_linkable_dollars": 0.0,
                # cited dollars: sum of dollars with a fact_id
                "total_cited_dollars": 0.0,
            }

        district_index[key]["program_count"] += 1
        district_index[key]["total_linkable_dollars"] += float(total_obligation or 0)
        if fact_id_for_program:
            district_index[key]["total_cited_dollars"] += float(total_obligation or 0)

        # per-district program list
        if key not in district_programs:
            district_programs[key] = []
        district_programs[key].append({
            "award_count": award_count,
            "fact_id": fact_id_for_program,
            "organization": organization,
            "pe_bli": pe_bli,
            "program_url": f"/program/{pe_bli}/",
            "recipient_count": recipient_count,
            "title": title,
            "total_obligation": float(total_obligation) if total_obligation is not None else None,
            "transaction_count": transaction_count,
        })

    # ---- Write per-district files ----
    for key, programs in district_programs.items():
        info = district_index[key]
        obj = {
            "pop_district": info["pop_district"],
            "pop_state": info["pop_state"],
            "program_count": info["program_count"],
            "programs": programs,
            "total_cited_dollars": info["total_cited_dollars"],
            "total_linkable_dollars": info["total_linkable_dollars"],
        }
        _write_json(dist_dir / f"{key}.json", obj)
        n_written += 1

    # ---- Write index file ----
    index_records = sorted(district_index.values(), key=lambda x: (x["pop_state"], x["pop_district"]))
    index_obj = {
        "districts": index_records,
        "geo_grand_total": geo_grand_total,
        "geo_grand_total_dataset": "dim_geography",
        "total_districts": len(index_records),
    }
    _write_json(dist_dir / "index.json", index_obj)
    n_written += 1

    return n_written


def _parse_usd(raw) -> float | None:
    """Parse an LDA amount varchar ('50000', '', None) to float, else None.

    Mirrors the truthy-string condition used by _build_filing_lda_citation_rows
    so a filing amount renders on-site IFF its citation row was emitted.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _emit_filing_sidecars(
    *,
    json_dir: Path,
    duckdb_path,
    lob_rows: list,
    prog_titles: dict,
    cited_fact_ids: set,
) -> int:
    """Emit filings/{uuid}.json (4,258) + filings_index.json (Task 6a).

    Per-filing file:
      {filing: {filing_uuid, url, client_name, registrant_name, filing_year,
                filing_period, filing_type, income_usd, expenses_usd,
                income_fact_id, expenses_fact_id},
       activities: [{issue_code, issue_display, description}],
       lobbyists:  [{name, covered_position}],
       mentions:   [{pe_bli, program_title, matched_term, description_snippet,
                     program_url}]}

    Index file: {filings: [{filing_uuid, client_name, registrant_name,
                            filing_year, filing_type, has_mentions,
                            mention_count}], total}

    Amount invariant (binding for the /filing page Cite contract): income_usd /
    expenses_usd are non-null IFF the corresponding fact_id_lda_filing row is
    in the citation set — the page renders state A for non-null amounts and a
    plain "not reported" (no data-amount span) for nulls.

    mentions.program_url links only when pe_bli has a program page
    (pe_bli in dim_programs); otherwise null (plain-text mention).

    Returns number of files written (0 when the lda parquets are absent).
    """
    import duckdb as _duckdb

    lda_pq = _stage_parquet_path(duckdb_path, "influence", "lda_filings.parquet")
    if lda_pq is None:
        return 0
    act_pq = _stage_parquet_path(duckdb_path, "influence", "lda_activities.parquet")
    lob_pq = _stage_parquet_path(duckdb_path, "influence", "lda_lobbyists.parquet")

    try:
        filing_rows = _duckdb.sql(
            f"select filing_uuid, url, client_name, registrant_name,"
            f" filing_year, filing_period, filing_type, income_usd, expenses_usd"
            f" from read_parquet('{lda_pq}')"
        ).fetchall()
    except Exception:
        return 0

    # Activities per filing_uuid
    activities_by_uuid: dict[str, list] = {}
    if act_pq is not None:
        try:
            for fu, issue_code, issue_display, description in _duckdb.sql(
                f"select filing_uuid, issue_code, issue_display, description"
                f" from read_parquet('{act_pq}')"
            ).fetchall():
                if not fu:
                    continue
                activities_by_uuid.setdefault(fu, []).append({
                    "description": description,
                    "issue_code": issue_code,
                    "issue_display": issue_display,
                })
        except Exception:
            pass

    # Lobbyists per filing_uuid (exact-duplicate rows collapsed, order kept)
    lobbyists_by_uuid: dict[str, list] = {}
    if lob_pq is not None:
        try:
            seen_lobbyists: set[tuple] = set()
            for fu, name, covered_position in _duckdb.sql(
                f"select filing_uuid, name, covered_position"
                f" from read_parquet('{lob_pq}')"
            ).fetchall():
                if not fu or not name:
                    continue
                key = (fu, name, covered_position or "")
                if key in seen_lobbyists:
                    continue
                seen_lobbyists.add(key)
                lobbyists_by_uuid.setdefault(fu, []).append({
                    "covered_position": covered_position,
                    "name": name,
                })
        except Exception:
            pass

    # Mentions per filing_uuid from the already-fetched fct_program_lobbying rows.
    # lob_rows cols: (filing_uuid, pe_bli, program_title, matched_term,
    #                 description_snippet, filing_url, client_name, family_key,
    #                 filing_year)
    mentions_by_uuid: dict[str, list] = {}
    for r in lob_rows:
        (filing_uuid, pe_bli, program_title, matched_term,
         description_snippet, _filing_url, _client_name, _family_key,
         _filing_year) = r
        if not filing_uuid or not pe_bli:
            continue
        mentions_by_uuid.setdefault(filing_uuid, []).append({
            "description_snippet": description_snippet,
            "matched_term": matched_term,
            "pe_bli": pe_bli,
            "program_title": prog_titles.get(pe_bli, program_title),
            "program_url": (
                f"/program/{pe_bli}/" if pe_bli in prog_titles else None
            ),
        })

    filings_dir = json_dir / "filings"
    filings_dir.mkdir(exist_ok=True)

    n_written = 0
    index_rows: list[dict] = []

    for (filing_uuid, url, client_name, registrant_name, filing_year,
         filing_period, filing_type, income_raw, expenses_raw) in filing_rows:
        if not filing_uuid:
            continue

        income_usd = _parse_usd(income_raw)
        expenses_usd = _parse_usd(expenses_raw)

        income_fid = fact_id_lda_filing(filing_uuid, "income")
        expenses_fid = fact_id_lda_filing(filing_uuid, "expenses")
        income_fact_id = (
            income_fid
            if (income_usd is not None and income_fid in cited_fact_ids)
            else None
        )
        expenses_fact_id = (
            expenses_fid
            if (expenses_usd is not None and expenses_fid in cited_fact_ids)
            else None
        )
        # Enforce the value⟺fact_id pairing (state A or "not reported", never C)
        if income_fact_id is None:
            income_usd = None
        if expenses_fact_id is None:
            expenses_usd = None

        mentions = mentions_by_uuid.get(filing_uuid, [])

        obj = {
            "activities": activities_by_uuid.get(filing_uuid, []),
            "filing": {
                "client_name": client_name,
                "expenses_fact_id": expenses_fact_id,
                "expenses_usd": expenses_usd,
                "filing_period": filing_period,
                "filing_type": filing_type,
                "filing_uuid": filing_uuid,
                "filing_year": filing_year,
                "income_fact_id": income_fact_id,
                "income_usd": income_usd,
                "registrant_name": registrant_name,
                "url": url or f"https://lda.senate.gov/api/v1/filings/{filing_uuid}/",
            },
            "lobbyists": lobbyists_by_uuid.get(filing_uuid, []),
            "mentions": mentions,
        }
        _write_json(filings_dir / f"{filing_uuid}.json", obj)
        n_written += 1

        index_rows.append({
            "client_name": client_name,
            "filing_type": filing_type,
            "filing_uuid": filing_uuid,
            "filing_year": filing_year,
            "has_mentions": len(mentions) > 0,
            "mention_count": len(mentions),
            "registrant_name": registrant_name,
        })

    # Deterministic index order: mentions-first, then year desc, then client
    index_rows.sort(
        key=lambda r: (
            not r["has_mentions"],
            -(int(r["filing_year"]) if str(r["filing_year"] or "").isdigit() else 0),
            (r["client_name"] or "").lower(),
            r["filing_uuid"],
        )
    )
    _write_json(json_dir / "filings_index.json", {
        "filings": index_rows,
        "total": len(index_rows),
    })
    n_written += 1

    return n_written


# Parent department for every org in the J-book corpus.  dim_programs.org
# values (DARPA, MDA, SOCOM, OSD, …) are all Department of Defense components
# — the corpus is DoD RDT&E budget justification books.  GAO high-risk areas
# and paymentaccuracy.gov improper-payment programs key on the department
# (canonical code 'DOD' per govbudget.agency_codes.canonical_agency).
_SITE_ORG_PARENT_AGENCY = "DOD"


def _emit_gao_overlays_sidecar(
    *,
    json_dir: Path,
    duckdb_path,
    con,
    cited_fact_ids: set,
) -> None:
    """Emit json/gao_overlays.json (Task 6b).

    Shape:
      {agency_code_by_org: {org: 'DOD', …},
       agencies: {DOD: {high_risk_areas: [{area_title, area_url, notes,
                                           source_url}],
                        improper: {agency_code, program_count,
                                   derived_improper_amount_usd,
                                   weighted_rate_pct, latest_fiscal_year,
                                   fact_id} | null}}}

    high_risk_areas come from the oversight module's joined output
    (high_risk.parquet — GAO area titles mapped to canonical agency codes via
    data-seeds/gao_high_risk_agency_map.csv); improper figures from
    fct_improper_exposure with the derived-tier fact_id attached only when it
    resolves in the citation set.
    """
    import duckdb as _duckdb

    # Site orgs → parent agency code
    try:
        orgs = [r[0] for r in con.execute(
            "select distinct org from dim_programs order by org"
        ).fetchall() if r[0]]
    except Exception:
        orgs = []

    agency_code_by_org = {org: _SITE_ORG_PARENT_AGENCY for org in orgs}
    referenced_codes = sorted(set(agency_code_by_org.values()))

    # High-risk areas (joined output of src/govbudget/oversight/high_risk.py)
    areas_by_code: dict[str, list] = {}
    hr_pq = _stage_parquet_path(duckdb_path, "oversight", "high_risk.parquet")
    if hr_pq is not None:
        try:
            # mapped is BOOLEAN since backlog #11; cast keeps legacy
            # varchar 'true'/'false' parquets working identically.
            for (area_title, area_url, agency_code, mapped, notes,
                 source_url) in _duckdb.sql(
                f"select area_title, area_url, agency_code,"
                f" cast(mapped as boolean) as mapped, notes,"
                f" source_url from read_parquet('{hr_pq}')"
            ).fetchall():
                if not mapped or not agency_code:
                    continue
                areas_by_code.setdefault(agency_code, []).append({
                    "area_title": area_title,
                    "area_url": area_url,
                    "notes": notes,
                    "source_url": source_url,
                })
        except Exception:
            pass

    # Improper-payment exposure per agency code
    improper_by_code: dict[str, dict] = {}
    try:
        improper_rows = con.execute(
            "select agency_code, program_count, derived_improper_amount_usd,"
            " weighted_rate_pct, latest_fiscal_year from fct_improper_exposure"
        ).fetchall()
    except Exception:
        improper_rows = []

    for (agency_code, program_count, derived_amount, rate,
         latest_fy) in improper_rows:
        if not agency_code or derived_amount is None:
            continue
        fid = fact_id_derived("improper", agency_code, "derived_improper_amount_usd")
        improper_by_code[agency_code] = {
            "agency_code": agency_code,
            "derived_improper_amount_usd": float(derived_amount),
            "fact_id": fid if fid in cited_fact_ids else None,
            "latest_fiscal_year": int(latest_fy) if latest_fy is not None else None,
            "program_count": int(program_count) if program_count is not None else None,
            "weighted_rate_pct": float(rate) if rate is not None else None,
        }

    agencies = {
        code: {
            "high_risk_areas": areas_by_code.get(code, []),
            "improper": improper_by_code.get(code),
        }
        for code in referenced_codes
    }

    _write_json(json_dir / "gao_overlays.json", {
        "agencies": agencies,
        "agency_code_by_org": agency_code_by_org,
    })


def _emit_categories_sidecar(*, json_dir: Path, categories_csv: Path | None = None) -> None:
    """Emit json/categories.json (Task 8a — category hero animations).

    A flat {pe_bli: category} mapping copied from the committed taxonomy seed
    data-seeds/program_categories.csv (authored in Task 7a; gated by
    dossier_gate's categories check). Membership in this mapping IS the
    site's top-50 test: program pages render a category hero background only
    for pe_blis present here ('default' rows get the static flow motif, no
    animation). Rationale/source_ref columns stay in the seed — the site only
    needs the category.

    Categories outside the gate enum are skipped defensively (the dossier
    gate is the loud enforcement point; the sidecar must never ship an
    unknown motif key to the site).
    """
    import csv as _csv

    from govbudget.dossiers.gate import CATEGORY_ENUM

    if categories_csv is None:
        from govbudget.config import ROOT as _ROOT

        categories_csv = _ROOT / "data-seeds" / "program_categories.csv"

    mapping: dict[str, str] = {}
    if categories_csv.exists():
        with categories_csv.open(newline="", encoding="utf-8") as fh:
            for row in _csv.DictReader(fh):
                pe_bli = (row.get("pe_bli") or "").strip()
                category = (row.get("category") or "").strip()
                if pe_bli and category in CATEGORY_ENUM:
                    mapping[pe_bli] = category

    _write_json(json_dir / "categories.json", mapping)


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
