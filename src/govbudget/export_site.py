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
import re
import shutil
from decimal import Decimal, InvalidOperation
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


def fact_id_lda_lobbyist(filing_uuid: str, name: str) -> str:
    """Canonical identity for a lobbyist-grain LDA citation (dim_lobbyists rows).

    sha256 of 'lda_lobbyist|{filing_uuid}|{name}', hexdigest[:16].
    filing_uuid is the DISCLOSING filing — the deterministic LDA filing whose
    lobbyist block discloses this person (covered_position match preferred,
    lowest filing_uuid tiebreak; see _export_dim_lobbyists).
    Distinct from fact_id_lda (mention grain) and fact_id_lda_filing
    (filing-amount grain) by prefix.
    """
    return hashlib.sha256(f"lda_lobbyist|{filing_uuid}|{name}".encode()).hexdigest()[:16]


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
# Basis vocabulary (PM-review Sprint 1 Task 2, spec §P0-1 — locked design):
# every emitted figure payload carries basis / fy / measure / edition so the
# site can render data-basis / data-fy / data-measure and gate 23
# (site/scripts/gates/basis.mjs) can enforce one-label-one-basis.
#
#   basis   'toa'          — R-1/P-1 display-workbook facts (Total Obligation
#                            Authority, USD thousands): budget_lines rows,
#                            decade grains, trajectory pivots.
#           'jbook-detail' — R-2/P-40 J-book detail rows (USD millions).
#   measure 'actuals' | 'enacted' | 'request' | 'total' | 'change' for the
#           headline pots; component pots that legitimately differ from a
#           headline value on the SAME page get their own honest tokens so
#           the gate never groups them into a false collision
#           ('disc-request', 'reconciliation-request', 'supplemental',
#           'base-request', 'all-prior-years').
#   edition PB edition year (int) the figure was published in.
#
# Canonical basis for KPI cards / homepage hero / OG cards / feed = 'toa'
# (PM call: "it is what Congress provides"); jbook-detail values render in a
# reconciliation strip when they differ (P0-1 fix 2/3).
# ---------------------------------------------------------------------------

_BASIS_TOA = "toa"
_BASIS_DETAIL = "jbook-detail"

# P0-5 corpus scope qualifier — hero / OG / feed superlatives must carry it.
# n_lines is the programs.json corpus count (dynamic, never a hardcoded
# literal that rots when the corpus grows).
_SCOPE_QUALIFIER_TEMPLATE = (
    "largest single R&D or procurement program element in our corpus"
    " ({n_lines} lines; excludes personnel, O&M, and appropriations not"
    " covered by the R-1/P-1 rollups)"
)


def scope_qualifier(n_lines: int) -> str:
    """The P0-5 scope-qualifier string with a live corpus count."""
    return _SCOPE_QUALIFIER_TEMPLATE.format(n_lines=f"{n_lines:,}")


def _amount_type_meta(amount_type: str, edition: int) -> tuple[int | None, str | None]:
    """(fy, measure) for a workbook amount_type slug within one PB edition.

    Slug → measure decisions (verified against the PB2026 slug inventory:
    fy_2024_actuals / fy_2025_enacted / fy_2025_supplemental / fy_2025_total /
    fy_2026_disc_request / fy_2026_reconciliation_request / fy_2026_request /
    fy_2026_total):

      * 'actual*'                → actuals
      * '*enact*'                → enacted (enacted, total_enacted, enactment…)
      * 'reconciliation_request' → reconciliation-request (component pot —
        157 live grains differ from fy_2026_total; mapping it to 'request'
        would mint a same-basis collision the reconciliation strip cannot
        explain)
      * 'disc_request'           → disc-request (discretionary component,
        same rationale)
      * 'request'                → request
      * 'supplemental'           → supplemental (component)
      * 'total'                  → 'request' when fy == edition (a PB book's
        own-year total IS the request total — the slug fct_decade_series
        picks for the request series and fct_budget_trajectory pivots into
        fy2026_total); 'total' otherwise (e.g. fy_2025_total in PB2026 =
        enacted + supplemental).
      * anything else            → the slug suffix with '_'→'-' (honest
        token; era slugs like base_oco never reach the PB2026 sidecar
        tables, decade points map through their grain's chosen slug).

    Returns (None, None) when the slug doesn't parse.
    """
    m = re.match(r"^fy_(\d{4})_(.+)$", amount_type or "")
    if not m:
        return None, None
    fy = int(m.group(1))
    rest = m.group(2)
    if "actual" in rest:
        return fy, "actuals"
    if "enact" in rest:
        return fy, "enacted"
    if rest == "reconciliation_request":
        return fy, "reconciliation-request"
    if rest == "disc_request":
        return fy, "disc-request"
    if "request" in rest:
        return fy, "request"
    if "supplemental" in rest:
        return fy, "supplemental"
    if rest == "total":
        return fy, ("request" if fy == edition else "total")
    return fy, rest.replace("_", "-")


def _scenario_meta(scenario: str, edition: int) -> tuple[int | None, str | None]:
    """(fy, measure) for a J-book detail scenario within one PB edition.

    Scenario names are edition-RELATIVE (the year-shift rule): for edition N,
    PriorYear = FY(N-2) actuals, CurrentYear = FY(N-1) enacted,
    BudgetYearOne = FY(N) request. BudgetYearOneBase is the base component of
    the request (44 live grains differ from BudgetYearOne — own token, same
    false-collision rationale as disc-request). AllPriorYears is cumulative:
    no single fiscal year (fy None), honest 'all-prior-years' token.
    """
    return {
        "PriorYear": (edition - 2, "actuals"),
        "CurrentYear": (edition - 1, "enacted"),
        "BudgetYearOne": (edition, "request"),
        "BudgetYearOneBase": (edition, "base-request"),
        "AllPriorYears": (None, "all-prior-years"),
    }.get(scenario, (None, None))


# Trajectory metric → (fy, measure) under PB2026 semantics — the single
# payload-level source for the trajectory block's basis attributes (site_meta
# 'trajectory_measures'; the spark/card components must never re-derive).
# fy2026_total maps to 'request' for the same reason fy_2026_total does above.
_TRAJECTORY_METRIC_META = {
    "fy2024_actuals": {"fy": 2024, "measure": "actuals"},
    "fy2025_total": {"fy": 2025, "measure": "total"},
    "fy2026_total": {"fy": 2026, "measure": "request"},
    "fy2526_change": {"fy": 2026, "measure": "change"},
}


def _display_values_agree(a_dollars: float, b_dollars: float) -> bool:
    """Two figures "agree" iff they round to the same 3-significant-digit
    display — the exact rule gate 23 uses (basis.mjs valuesAgree):
    |a−b| ≤ 0.5·10^(floor(log10(max))−2). $5.25B vs $5,247.07M agree;
    $5.25B vs $5.57B do not. Inputs in DOLLARS (callers convert units)."""
    import math

    if a_dollars == b_dollars:
        return True
    mag = max(abs(a_dollars), abs(b_dollars))
    if mag == 0:
        return True
    granularity = 0.5 * 10 ** (math.floor(math.log10(mag)) - 2)
    return abs(a_dollars - b_dollars) <= granularity


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
#
# Three datasets are cited CONDITIONALLY (added to the cited set at export
# time only when their citation rows were actually emitted — a degenerate
# export with missing marts/parquets keeps them on the uncited ledger
# honestly rather than declaring a tier that has no rows behind it):
#   dim_geography         — derived rows (USAspending place-of-performance
#                           aggregation; _build_geography_citation_rows)
#   fct_budget_to_awards  — derived rows (crosswalk link provenance;
#                           _build_budget_to_awards_citation_rows)
#   dim_lobbyists         — lda_filing rows (disclosing filing per lobbyist;
#                           _build_lobbyist_citation_rows)
_CITED_DATASETS = {
    "jbook_details",
    "jbook_narratives",
    "budget_lines",
    "budget_lines_decade",  # Phase 5E — every row carries a workbook citation
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
            if name == "dim_lobbyists":
                # Enriched export: adds disclosing_filing_uuid /
                # disclosing_filing_url / fact_id columns so lobbyist rows
                # carry their own provenance (the lda_filing citation tier)
                # and the integrity gate can re-derive lobbyist fact_ids
                # hermetically from the site bundle.
                continue
            dest = data_dir / f"{name}.parquet"
            dest_str = str(dest).replace("'", "''")
            con.execute(
                f"COPY (select * from {name}) TO '{dest_str}'"
                " (format parquet, compression zstd)"
            )
            count = con.execute(f"select count(*) from '{dest_str}'").fetchone()[0]
            dataset_counts[name] = count

        # dim_lobbyists — enriched typed export (see _export_dim_lobbyists)
        lobbyist_rows = _export_dim_lobbyists(
            con=con, duckdb_path=duckdb_path, data_dir=data_dir
        )
        dataset_counts["dim_lobbyists"] = len(lobbyist_rows)
    finally:
        con.close()

    # -----------------------------------------------------------------------
    # 2. Postgres typed exports
    # -----------------------------------------------------------------------
    # PB2026 EDITION FENCE (BINDING, adversarial review Finding A): the
    # typed exports below feed surfaces that render scenario names and
    # amount types with PB2026 semantics and NO edition label — program-page
    # details/narratives/budget-line tables, the fy2024_* sidecar indexes,
    # _emit_years_matrix project cells, and _emit_breakdowns PriorYear
    # roots. Scenario names are edition-RELATIVE (PriorYear = FY2022
    # actuals in PB2024, FY2023 in PB2025, FY2024 in PB2026), so every one
    # of these queries filters fiscal_year = 2026 — never merge editions
    # silently (spec §2 rule 1). The PB2017–PB2025 editions ship through
    # the edition-aware 5E Task 5 marts, which supersede this fence.
    # The lineage layer shares this fence via the single constant
    # govbudget.lineage.model.CITED_NARRATIVE_FY (= 2026), imported by
    # lineage/load.py (stated-edge extraction) and verify_lineage.py (leg a's
    # narrative index) — keep this filter and that constant in lockstep.
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
              and j.fiscal_year = 2026
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
              and j.fiscal_year = 2026
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
            where bl.fiscal_year = 2026
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
                -- PB2026 EDITION FENCE (Finding A follow-up): the Phase 5E era
                -- backfills populate provenance_pages for EVERY edition
                -- (PB2017–PB2025), but jbook_details.parquet above is fenced
                -- to fiscal_year = 2026 — so this join must be too, or every
                -- cross-edition provenance row becomes an orphan jbook_pdf
                -- citation and verify_phase5b1's jbook_no_orphan_citations
                -- gate fails. (Every fenced detail's document has
                -- fiscal_year = 2026, so no PB2026 fact loses its citation.)
                join (
                    select distinct on (sha256) sha256, source_url, downloaded_at
                    from jbook_documents
                    where sha256 is not null and fiscal_year = 2026
                    order by sha256, id
                ) j on j.sha256 = p.document_sha256
                -- Amount rows only: narrative rows (target_kind='narrative',
                -- Phase 5F §2b) carry NULL scenario/amount_millions and are
                -- exported by the jbook_narrative pass (4h), not here.
                where p.target_kind = 'amount'
                order by p.document_sha256, p.pe_bli, p.scenario
                """
            ).fetchall()

        # Exact fence: the SQL fiscal_year filter above cannot separate
        # editions that SHARE a sha256 (the same PDF re-shipped across PB
        # editions, or superseded details whose provenance rows persist at
        # the (sha, pe_bli, project, scenario, amount) grain). fact_id_jbook
        # keys on that same grain, so intersecting with the fenced detail
        # fact_id set makes citations ⊆ jbook_details BY CONSTRUCTION —
        # the invariant jbook_no_orphan_citations checks.
        detail_fids = {r[0] for r in detail_rows}
        for (doc_sha, pe_bli, project_number, scenario, amount_millions,
             amount_text, page_number, x0, x1, top_pt, bottom_pt,
             page_width, page_height, resolution, candidate_pages,
             source_url, downloaded_at) in prov_rows:
            if resolution in ("zero_amount", "unresolved"):
                continue
            # Only unique/ambiguous_first
            fid = fact_id_jbook(doc_sha, pe_bli, project_number, scenario, amount_millions)
            if fid not in detail_fids:
                continue  # cross-edition or superseded provenance — fenced out
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

    # --- 4b2. Decade citation tier (Phase 5E Task 6) ---
    # Old-edition (PB2017–PB2025) workbook facts + derived decade sums +
    # book-diff facts, built from the Task 5 marts and the jbooks lake.
    # Ships in data/budget_lines_decade.parquet (a SIBLING of the fenced
    # budget_lines.parquet — the PB2026 fence above stays intact; editions
    # never merge silently, spec §2 rule 1).
    (decade_bl_rows, decade_cit_rows, decade_grains,
     decade_side_meta) = _build_decade_citation_rows(
        duckdb_path=duckdb_path,
        existing_fids={r[0] for r in citation_rows},
        scope_pes={r[8] for r in bl_rows},
    )
    citation_rows.extend(decade_cit_rows)
    if decade_bl_rows:
        _write_typed_parquet(
            data_dir / "budget_lines_decade.parquet",
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
            rows=decade_bl_rows,
        )
        dataset_counts["budget_lines_decade"] = len(decade_bl_rows)

    # --- 4b3. Summary-card union (PM-review Sprint 1 Task 2, §P0-1/§P0-2) ---
    # Per-PE answer-strip/Budget-Figures cards from the union of workbook
    # (toa) + detail facts, the reconciliation payload, and the minted
    # union-change derived facts (must join citation_rows BEFORE
    # citations.parquet is written).
    summary_by_pe, summary_cit_rows = _build_summary_blocks(
        duckdb_path=duckdb_path,
        detail_rows=detail_rows,
        bl_rows=bl_rows,
        decade_grains=decade_grains,
    )
    citation_rows.extend(summary_cit_rows)

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

    # --- 4d2. Geography derived citations (dim_geography + district aggregates) ---
    geography_rows = _build_geography_citation_rows(duckdb_path=duckdb_path)
    citation_rows.extend(geography_rows)

    # --- 4d3. Budget-to-awards crosswalk link citations ---
    b2a_rows = _build_budget_to_awards_citation_rows(
        duckdb_path=duckdb_path, bl_rows=bl_rows
    )
    citation_rows.extend(b2a_rows)

    # --- 4e. USAspending citations (family-year obligations + district programs) ---
    usas_rows = _build_usaspending_citation_rows(duckdb_path=duckdb_path)
    citation_rows.extend(usas_rows)

    # --- 4f. Filing-level LDA amount citations ---
    filing_lda_rows = _build_filing_lda_citation_rows(duckdb_path=duckdb_path)
    citation_rows.extend(filing_lda_rows)

    # --- 4f2. Lobbyist-grain LDA citations (dim_lobbyists disclosing filings) ---
    lobbyist_cit_rows = _build_lobbyist_citation_rows(lobbyist_rows=lobbyist_rows)
    citation_rows.extend(lobbyist_cit_rows)

    # --- 4g. State citation tier (CT state_soql + CA state_file) ---
    state_citation_rows = _build_state_citation_rows(duckdb_path=duckdb_path)
    citation_rows.extend(state_citation_rows)

    # --- 4h. jbook_narrative citations ---
    # One citation row per jbook_narratives row that has a non-null xml_path.
    # official_url = the document's source_url (dedup on sha256, lowest id wins).
    # retrieved_at = the document's downloaded_at.
    # Phase 5F §2b: narratives located by the provenance builder
    # (provenance_pages target_kind='narrative', keyed like fact_id_narrative)
    # carry page + bbox of the paragraph opening, a #page=N anchor on both
    # URLs and their resolution. Unresolved narratives keep the pre-5F
    # pageless shape — the ambiguity flag, never a fake location.
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
        narr_prov: dict[tuple, tuple] = {}
        for (p_sha, p_pe, p_kind, p_xml, page_number, x0, x1, top_pt,
             bottom_pt, page_width, page_height, resolution) in pg_narr.execute(
            """
            select document_sha256, pe_bli, narrative_kind, xml_path,
                   page_number, x0, x1, top_pt, bottom_pt,
                   page_width, page_height, resolution
            from provenance_pages
            where target_kind = 'narrative'
            """
        ).fetchall():
            if resolution in ("unique", "ambiguous_first") and page_number is not None:
                narr_prov[(p_sha, p_pe, p_kind, p_xml)] = (
                    int(page_number),
                    float(x0), float(x1), float(top_pt), float(bottom_pt),
                    float(page_width), float(page_height), resolution,
                )

    for (fid, pe_bli, pn, kind, title, body, xml_path, org, fy, sha) in narr_rows_with_fid:
        if fid is None or not xml_path:
            continue  # skip rows without a resolvable xml_path
        src_url, dl_at = narr_doc_lookup.get(sha, (None, None))
        official_url = src_url or None
        ret_at = dl_at.isoformat() if dl_at else None
        hit = narr_prov.get((sha, pe_bli, kind, xml_path))
        if hit is not None:
            (page_number, x0, x1, top_pt, bottom_pt,
             page_width, page_height, resolution) = hit
            hosted_pdf_url = f"{pdf_base_url}/{sha}.pdf#page={page_number}"
            if official_url:
                official_url = f"{official_url}#page={page_number}"
        else:
            page_number = x0 = x1 = top_pt = bottom_pt = None
            page_width = page_height = resolution = None
            hosted_pdf_url = None
        citation_rows.append((
            fid, "jbook_narrative", None,  # fact_id, kind, units
            None,          # amount_text (narrative locations are prose, not amounts)
            page_number, x0, x1, top_pt, bottom_pt, page_width, page_height,
            resolution,    # 'unique' | 'ambiguous_first' | None (pageless)
            None,   # sheet
            None,   # cells
            None,   # amount_thousands
            sha,    # sha256 (document fingerprint for integrity check)
            hosted_pdf_url,
            official_url,  # official_url (#page=N when located)
            xml_path,      # xml_path (J-book XML locator)
            ret_at,        # retrieved_at
            None, None, None, None,  # formula, inputs, query_body, recorded_value
            pe_bli, None, None,  # pe_bli, scenario, amount_type
        ))

    # --- 4i. Flowdown chart citations + payload (Phase 5H) ---
    # Minted BEFORE citations.parquet so flow node/edge facts ship in the
    # same parquet/json/shards as every other tier. The payload itself is
    # written as a JSON sidecar in step 19 of _write_all_sidecars.
    from govbudget.flow_chart import build_flow_chart

    flow_payload, flow_cit_rows = build_flow_chart(
        duckdb_path=duckdb_path, bl_rows=bl_rows
    )
    citation_rows.extend(flow_cit_rows)

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
    # Compute uncited_datasets: all data/*.parquet names with no citation kind.
    # The three conditionally-cited datasets join the cited set ONLY when
    # their citation rows were actually emitted this run — a degenerate export
    # (missing marts/parquets) keeps them on the ledger honestly.
    all_data_names = sorted(
        p.stem for p in data_dir.glob("*.parquet")
    )
    cited_datasets = set(_CITED_DATASETS)
    if geography_rows:
        cited_datasets.add("dim_geography")
    if b2a_rows:
        cited_datasets.add("fct_budget_to_awards")
    if lobbyist_cit_rows:
        cited_datasets.add("dim_lobbyists")
    uncited = [n for n in all_data_names if n not in cited_datasets]

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

    # Data-derived ingested-service-org set (single source of truth for the
    # site's rollup-note wording). Computed here where the Postgres dsn is in
    # scope, then threaded to the sidecar writer via manifest (that function
    # only holds a duckdb connection). See _ingested_service_orgs.
    with psycopg.connect(dsn) as pg_orgs:
        ingested_service_orgs = _ingested_service_orgs(pg_orgs)

    manifest = {
        "built_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "datasets": final_counts,
        "citations": cit_by_kind,
        "ingested_service_orgs": ingested_service_orgs,
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
        flow_payload=flow_payload,
        decade_bl_rows=decade_bl_rows,
        decade_grains=decade_grains,
        decade_side_meta=decade_side_meta,
        summary_by_pe=summary_by_pe,
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


def _ingested_service_orgs(pg) -> list[str]:
    """Sorted service_org codes whose FY2026 J-book IS loaded.

    Single source of truth for the site's rollup-note wording: a rollup page
    whose service_org is in this set is NOT "awaiting ingestion" — its book is
    loaded, the PE simply carries no matching R-2/P-40 narrative. Emitted into
    site_meta.json; program-tier.ts reads it (replacing a hardcoded A/N/F set
    that lied for the ~24 defense-wide agency books — OSD, DCSA, MDA, …).

    CRITICAL — code-space match: the site keys the note off
    details.service_org, which is a budget_lines.organization code (the WORKBOOK
    org). jbook_documents.org is the DOCUMENT org, so each is translated through
    workbook_org() (CYBERCOM→CYBER, CHIPS/DPAP→OSD) before entering the set —
    otherwise CYBERCOM's page never matches. Orgs with no loaded book (DHA,
    DEFW, IG) are absent by construction and keep the honest "not yet ingested"
    wording.
    """
    rows = pg.execute(
        "select distinct org from jbook_documents"
        " where fiscal_year = 2026 and status = 'downloaded'"
    ).fetchall()
    return sorted({_workbook_org(r[0]) for r in rows})


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
# Decade citation tier (Phase 5E Task 6)
# ---------------------------------------------------------------------------

# How many globally-largest request-vs-actuals gaps stay mintable even when
# their PE has no PB2026 page (the /feed/ "largest gaps" surface must not be
# silently truncated to the page universe).
_DECADE_TOP_RVA = 100

# How many request_vs_actuals_gap events the /feed/ surfaces (Task 7).
# MUST stay ≤ _DECADE_TOP_RVA — the top-N claim is only globally honest
# while every candidate diff in the ranking window is minted.
_FEED_RVA_TOP = 15


def _build_decade_citation_rows(
    *,
    duckdb_path,
    existing_fids: set,
    scope_pes: set,
) -> tuple[list, list, list, dict]:
    """Build the Phase 5E decade fact space from fct_decade_series +
    fct_book_diff (Task 5 marts) and the jbooks parquet lake.

    Returns (decade_bl_rows, decade_cit_rows, decade_grains, decade_side_meta):
      decade_bl_rows   — budget_lines_decade.parquet rows (16-tuple, same
                         shape as bl_rows; fiscal_year == edition_year); ALL
                         source rows behind in-scope grains, every edition.
      decade_cit_rows  — citation rows: kind='workbook' for source rows not
                         already cited (edition-2026 rows dedupe against the
                         main pass), kind='derived' decade sums for
                         multi-source grains (surface='decade',
                         key='{pe}|{edition}', metric=amount_type slug,
                         formula 'sum(budget_lines…' → rule-4c recompute),
                         and kind='derived' book-diff facts
                         (surface='book_diff', key='{pe}|{from}|{to}',
                         metric=diff_kind, formula '… - …' with inputs
                         [to_fid, from_fid] → rule-4b recompute).
      decade_grains    — (pe_bli, fy, edition_year, amount_type_kind,
                         amount_thousands, fid, amount_type) per in-scope
                         grain; fid is the grain's citable identity (workbook
                         fact for single-source, derived decade sum
                         otherwise); amount_type is the grain's chosen slug
                         (consumers derive slug-accurate `measure` from it).
      decade_side_meta — fid → (label, pe_bli) for _emit_breakdowns
                         difference-row labels ('PB2024 FY2022 actuals').

    Scope (stated Task 6 decision): grains/diffs are minted for PEs in
    scope_pes (the PB2026 page universe — every PE with a program page of
    either tier) PLUS the PEs of the top-{_DECADE_TOP_RVA} global
    request-vs-actuals gaps (3 PEs beyond the universe at build time), so
    the Task 7 feed's "largest gaps" claim stays globally honest. Diffs for
    dead PEs beyond that have no rendering surface and are NOT minted —
    fct_book_diff remains the queryable source of truth.

    Consistency contract (STOP conditions, per the Task 5 handoff): the
    lake rows joined per grain must count exactly n_source_rows, and a
    single-source grain's recomputed workbook fact_id must equal the mart's
    source_fact_id — any drift raises ValueError (mart/lake disagreement is
    a data bug, never papered over).
    """
    import datetime
    import duckdb as _duckdb
    import json as _json

    empty: tuple[list, list, list, dict] = ([], [], [], {})

    con = _duckdb.connect(str(duckdb_path), read_only=True)
    try:
        try:
            series = con.execute(
                "select pe_bli, fy, edition_year, amount_type_kind, amount,"
                " amount_type, n_source_rows, source_fact_id"
                " from fct_decade_series"
            ).fetchall()
        except _duckdb.CatalogException:
            print("decade: fct_decade_series not in warehouse — decade tier skipped")
            return empty
        try:
            diffs = con.execute(
                "select pe_bli, from_edition, to_edition, diff_kind,"
                " from_fy, to_fy, from_value, to_value, delta,"
                " from_amount_type, to_amount_type"
                " from fct_book_diff"
            ).fetchall()
        except _duckdb.CatalogException:
            diffs = []
    finally:
        con.close()

    if not series:
        return empty

    bl_lake = _stage_parquet_path(duckdb_path, "jbooks", "budget_lines.parquet")
    doc_lake = _stage_parquet_path(duckdb_path, "jbooks", "documents.parquet")
    if bl_lake is None or doc_lake is None:
        raise ValueError(
            "decade: fct_decade_series exists but the jbooks lake parquets"
            " (budget_lines.parquet / documents.parquet) are missing next to"
            f" {duckdb_path} — run export-facts first (the decade citation"
            " tier must be built from the same lake the marts read)"
        )

    bl_lake_s = str(bl_lake).replace("'", "''")
    doc_lake_s = str(doc_lake).replace("'", "''")
    src_rows = _duckdb.sql(
        f"""
        select b.exhibit, cast(b.fiscal_year as integer) as edition_year,
               b.account, b.account_title, b.organization,
               b.budget_activity, b.budget_activity_title, b.pe_bli, b.title,
               b.amount_type,
               try_cast(b.amount_thousands as double) as amount_thousands,
               d.sha256, b.source_sheet, b.source_cells,
               d.source_url, d.downloaded_at
        from read_parquet('{bl_lake_s}') b
        join read_parquet('{doc_lake_s}') d on d.id = b.source_document_id
        where b.exhibit in ('R-1', 'P-1')
          and b.pe_bli <> '9999999999'
          and d.sha256 is not null
        """
    ).fetchall()

    src_by_key: dict[tuple, list] = {}
    for r in src_rows:
        src_by_key.setdefault((r[7], r[1], r[9]), []).append(r)

    # ---- scope: page universe + top-N global request-vs-actuals PEs --------
    rva = sorted(
        (d for d in diffs if d[3] == "request_vs_actuals" and d[8] is not None),
        key=lambda d: -abs(d[8]),
    )
    top_rva_pes = {d[0] for d in rva[:_DECADE_TOP_RVA]}
    pes = set(scope_pes) | top_rva_pes

    built_at = datetime.datetime.now(datetime.UTC).isoformat()
    decade_bl_rows: list[tuple] = []
    decade_cit_rows: list[tuple] = []
    decade_grains: list[tuple] = []
    decade_side_meta: dict[str, tuple] = {}
    grain_fid_by_key: dict[tuple, str] = {}
    minted_fids: set[str] = set(existing_fids)

    n_wb_new = 0
    n_wb_dedup = 0
    n_derived_sum = 0

    for pe_bli, fy, edition, kind, amount, at, n_src, src_fid in series:
        if pe_bli not in pes:
            continue
        key_rows = src_by_key.get((pe_bli, edition, at), [])
        if len(key_rows) != n_src:
            raise ValueError(
                f"decade: grain ({pe_bli}, PB{edition}, {at}) has"
                f" {len(key_rows)} lake source rows but fct_decade_series"
                f" says n_source_rows={n_src} — mart/lake drift; refusing"
                " to mint (rebuild the marts against the current lake)"
            )

        input_fids: list[str] = []
        # deterministic breakdown order: largest row first, fid tiebreak
        for r in sorted(key_rows, key=lambda r: (-(r[10] or 0.0), r[11])):
            (exhibit, ed_year, account, account_title, organization,
             budget_activity, ba_title, _pe, title, _at, amount_thousands,
             sha256, source_sheet, source_cells, source_url,
             downloaded_at) = r
            if amount_thousands is None:
                raise ValueError(
                    f"decade: NULL amount_thousands source row for grain"
                    f" ({pe_bli}, PB{edition}, {at}) — unmintable input"
                )
            w_fid = fact_id_workbook(
                sha256, exhibit, ed_year, account, organization,
                budget_activity, pe_bli, at,
            )
            input_fids.append(w_fid)
            decade_bl_rows.append((
                w_fid, exhibit, int(ed_year), account, account_title,
                organization, budget_activity, ba_title, pe_bli, title, at,
                float(amount_thousands), "USD thousands", sha256,
                source_sheet, source_cells,
            ))
            if w_fid in minted_fids:
                n_wb_dedup += 1
            else:
                minted_fids.add(w_fid)
                n_wb_new += 1
                ret_at = (
                    str(downloaded_at).replace(" ", "T", 1)
                    if downloaded_at else None
                )
                decade_cit_rows.append((
                    w_fid, "workbook", "USD thousands",
                    None,  # amount_text
                    None, None, None, None, None, None, None,  # page bbox
                    None,  # resolution
                    source_sheet,
                    source_cells,
                    float(amount_thousands),
                    sha256,
                    None,       # hosted_pdf_url
                    source_url,  # official_url
                    None,       # xml_path
                    ret_at,     # retrieved_at
                    None, None, None, None,  # formula/inputs/query_body/recorded
                    pe_bli,  # pe_bli
                    None,    # scenario
                    at,      # amount_type
                ))

        if n_src == 1:
            grain_fid = input_fids[0]
            if src_fid is not None and grain_fid != src_fid:
                raise ValueError(
                    f"decade: fact-id derivation mismatch for grain"
                    f" ({pe_bli}, PB{edition}, {at}) — exporter computed"
                    f" {grain_fid} but fct_decade_series.source_fact_id is"
                    f" {src_fid}; the mart's sha256 derivation and"
                    " fact_id_workbook disagree (STOP: fix the derivation,"
                    " never ship mismatched identities)"
                )
        else:
            grain_fid = fact_id_derived("decade", f"{pe_bli}|{edition}", at)
            if grain_fid not in minted_fids:
                minted_fids.add(grain_fid)
                n_derived_sum += 1
                decade_cit_rows.append(_null_derived_row(
                    grain_fid, "derived", "USD thousands",
                    f"sum(budget_lines.amount_thousands where"
                    f" amount_type={at} and edition={edition})",
                    _json.dumps(input_fids),
                    f"{amount:.3f}",
                    built_at,
                ))

        grain_fid_by_key[(pe_bli, edition, at)] = grain_fid
        # 7-tuple: the trailing amount_type is the grain's CHOSEN slug —
        # consumers derive the point's `measure` from it (slug-accurate:
        # a CurrentYear grain built from fy_2025_total is measure 'total',
        # matching the P-1 table row it must agree with; one built from
        # fy_2025_enacted is 'enacted').
        decade_grains.append(
            (pe_bli, int(fy), int(edition), kind, float(amount), grain_fid, at)
        )
        decade_side_meta[grain_fid] = (f"PB{edition} FY{fy} {kind}", pe_bli)

    # ---- book-diff derived facts -------------------------------------------
    n_diffs = 0
    for (pe_bli, from_ed, to_ed, diff_kind, from_fy, to_fy,
         _from_val, _to_val, delta, from_at, to_at) in diffs:
        if pe_bli not in pes or delta is None:
            continue
        from_fid = grain_fid_by_key.get((pe_bli, from_ed, from_at))
        to_fid = grain_fid_by_key.get((pe_bli, to_ed, to_at))
        if from_fid is None or to_fid is None:
            raise ValueError(
                f"decade: fct_book_diff row ({pe_bli}, PB{from_ed}→PB{to_ed},"
                f" {diff_kind}) references a side grain missing from"
                " fct_decade_series — join completeness violated"
            )
        diff_fid = fact_id_derived(
            "book_diff", f"{pe_bli}|{from_ed}|{to_ed}", diff_kind,
        )
        if diff_fid in minted_fids:
            continue
        minted_fids.add(diff_fid)
        n_diffs += 1
        to_kind = "actuals" if diff_kind == "request_vs_actuals" else "request"
        decade_cit_rows.append(_null_derived_row(
            diff_fid, "derived", "USD thousands",
            f"PB{to_ed} FY{to_fy} {to_kind} - PB{from_ed} FY{from_fy} request"
            f" (fct_book_diff {diff_kind})",
            _json.dumps([to_fid, from_fid]),
            f"{delta:.3f}",
            built_at,
        ))

    print(
        f"decade: {len(decade_grains)} grains for {len(pes & {g[0] for g in decade_grains})}"
        f" in-scope PEs → {len(decade_bl_rows)} source rows"
        f" ({n_wb_new} new workbook citations, {n_wb_dedup} deduped),"
        f" {n_derived_sum} derived decade sums, {n_diffs} book-diff facts"
    )
    return decade_bl_rows, decade_cit_rows, decade_grains, decade_side_meta


# ---------------------------------------------------------------------------
# Summary-card union (PM-review Sprint 1 Task 2 — §P0-1 / §P0-2)
# ---------------------------------------------------------------------------

# Card-slot defaults: (fy, measure) rendered on an ABSENT card so gate 23's
# leg-b2 permanent contract ([data-absence][data-fy][data-measure]) always
# has attributes to match on.
_SUMMARY_SLOTS = (
    ("fy2024", 2024, "actuals"),
    ("fy2025", 2025, "enacted"),
    ("fy2026", 2026, "request"),
)

# Ordered budget_lines slug fallback per slot (used only when neither a
# decade grain nor a trajectory value covers the slot — e.g. withheld decade
# grains). Order mirrors reconcile.scenario_map's candidate priority.
_SLOT_BL_SLUGS = {
    "fy2024": ("fy_2024_actuals",),
    "fy2025": ("fy_2025_total", "fy_2025_enacted"),
    "fy2026": ("fy_2026_total", "fy_2026_request", "fy_2026_disc_request"),
}

# Detail scenario whose value reconciles against each slot's toa figure —
# paired ONLY when the slot's measure equals the scenario's mapped measure
# (a 'total' card vs an 'enacted' detail row is a different pot, not a
# two-basis restatement).
_SLOT_DETAIL_SCENARIO = {
    "fy2024": "PriorYear",
    "fy2025": "CurrentYear",
    "fy2026": "BudgetYearOne",
}

_SUMMARY_EDITION = 2026  # the PB2026 fence — same constant the sidecars use


def _summary_card(key, fy, measure, *, value=None, units=None, basis=None,
                  fid=None, xml_path=None, dataset=None, absence=None,
                  pct=None) -> dict:
    """One summary-card payload (shared by the union builder and the
    absence-only fallback block — single source for the field set)."""
    card = {
        "key": key,
        "fy": fy,
        "measure": measure,
        "basis": basis,
        "value": value,
        "units": units,
        "fid": fid,
        "public_id": fid[:8] if fid else None,
        "dataset": dataset,
        "edition": _SUMMARY_EDITION,
        "absence_reason": absence,
    }
    if xml_path:
        card["xml_path"] = xml_path  # Cite state B (zero/unlocated rows)
    if pct is not None:
        card["pct"] = pct
    return card


def _summary_absence_block() -> dict:
    """All-absent summary block — the belt-and-braces fallback for a sidecar
    PE outside every union source (should be unreachable by construction:
    the union universe spans bl_rows ∪ details ∪ trajectory ∪ decade)."""
    cards = [
        _summary_card(key, fy, measure, absence="not-published")
        for key, fy, measure in _SUMMARY_SLOTS
    ]
    cards.append(_summary_card("change", 2026, "change", absence="no-comparison"))
    return {
        "edition": _SUMMARY_EDITION,
        "basis_preference": _BASIS_TOA,
        "cards": cards,
        "reconciliation": [],
    }


def _build_summary_blocks(
    *,
    duckdb_path,
    detail_rows: list,
    bl_rows: list,
    decade_grains: list | None,
) -> tuple[dict, list[tuple]]:
    """Compute the per-PE summary block: answer-strip/Budget-Figures cards
    from the UNION of workbook (toa) + J-book detail facts, preferring toa
    (§P0-2 fix 1), plus the per-(fy, measure) reconciliation payload where
    the two bases disagree beyond display rounding (§P0-1 fix 2).

    Returns (summary_by_pe, union_change_citation_rows).

    Card slot resolution (deterministic, documented):
      1. PB2026 decade grain (pe-scoped, document-backed, and BY CONSTRUCTION
         the value the decade table renders — card/table agreement, gate 23
         leg b1). fy2024 ← kind 'actuals'; fy2025 ← 'enacted'; fy2026 ←
         'request'. measure = the grain's chosen slug, mapped.
      2. fct_budget_trajectory metric (derived toa fact) for the PE's primary
         org (largest fy2026_total, org-ascending tiebreak — the
         _rollup_service_org rule).
      3. A SINGLE PB2026 budget_lines row for the slot's slug list (its
         workbook fact cites directly; multi-row grains are already covered
         by 1's derived decade sums, so no uncitable ad-hoc sums are minted).
      4. Deduped PE-root J-book detail row (jbook-detail basis, USD
         millions) — used and labeled, per the union rule.
      5. Absent — with a reason enum, never a bare null (§P0-2 fix 2):
         'not-published' (the FY2026 books we ingested carry no such row —
         the only value-card absence the exporter can honestly derive: every
         program page exists BECAUSE its org's R-1/P-1 workbook is ingested,
         so 'not-ingested' is unreachable for these slots, and 'classified'
         is not derivable from the lake at all — classified lines simply
         never appear; both documented rather than fabricated) /
         'no-comparison' (change card missing an endpoint or endpoints on
         mixed bases).

    The FY25→26 change card reuses the trajectory change fact when the mart
    has one; otherwise, when BOTH endpoint cards resolved on the toa basis
    with citable fids, a derived union-change fact is minted
    (surface='summary', metric='fy2526_change_union', formula 'a - b' with
    the two endpoint fids as inputs → verify rule-4b recomputes it). Change
    across bases (toa vs detail) is never computed — 'no-comparison'.

    ONE public id (§P0-4 groundwork): every emitted fid is the full 16-hex
    citation fact id — the id the drawer resolves — and `public_id` is its
    FIRST 8 hex chars (the /fact/{id8} permalink id). The live chip/drawer
    mismatch (#8b2746cb vs #bb54b165) was two different truncations of ONE
    id: cite.tsx sliced the LAST 8, panel.tsx the FIRST 8. Components must
    render public_id verbatim and never re-slice.
    """
    import duckdb as _duckdb
    import json as _json

    built_at = datetime.datetime.now(datetime.UTC).isoformat()
    ed = _SUMMARY_EDITION

    # ---- source indexes ----------------------------------------------------
    # decade: pe → {kind: (value, fid, measure)} for the PB2026 edition
    decade_slot: dict[str, dict] = {}
    for d_pe, _d_fy, d_edition, d_kind, d_amount, d_fid, d_at in (decade_grains or []):
        if d_edition != ed or d_fid is None or d_amount is None:
            continue
        _, measure = _amount_type_meta(d_at, d_edition)
        decade_slot.setdefault(d_pe, {})[d_kind] = (d_amount, d_fid, measure or d_kind)

    # trajectory: pe → primary-org metrics (largest fy2026_total, org asc)
    con = _duckdb.connect(str(duckdb_path), read_only=True)
    try:
        traj_rows = con.execute(
            "select pe_bli, organization, fy2024_actuals, fy2025_total,"
            " fy2026_total, fy2526_change, fy2526_pct_change"
            " from fct_budget_trajectory"
        ).fetchall()
    except _duckdb.CatalogException:
        traj_rows = []
    finally:
        con.close()
    traj_primary: dict[str, tuple] = {}
    for row in sorted(
        traj_rows, key=lambda r: (r[0], r[4] is None, -(r[4] or 0.0), r[1])
    ):
        traj_primary.setdefault(row[0], row)

    # budget_lines: (pe, amount_type) → [(fid, amount)] (titled AND rollup
    # rows both render on the P-1 table; slot fallback 3 requires exactly one)
    bl_by_key: dict[tuple, list] = {}
    for r in bl_rows:
        bl_by_key.setdefault((r[8], r[10]), []).append((r[0], r[11]))

    # detail roots: pe → {scenario: {"v", "fid", "xml_path"}} — deduped by
    # DISTINCT (amount, xml_path) tuple (the dual-volume rule: identical
    # tuples under 2+ documents are ONE fact; the first document in sha
    # order supplies the citing fid). >1 DISTINCT amount → ambiguous → slot
    # skipped (never sum project rows onto one member's fact).
    detail_root: dict[str, dict] = {}
    _root_seen: dict[tuple, set] = {}
    for (fid, pe_bli, project_number, _pt, scenario, amount_millions,
         _units, xml_path, _org, _ef, fiscal_year, _sha, resolution) in detail_rows:
        if fiscal_year != ed or project_number is not None:
            continue
        if scenario not in ("PriorYear", "CurrentYear", "BudgetYearOne"):
            continue
        if amount_millions is None:
            continue
        tup = (pe_bli, scenario)
        seen = _root_seen.setdefault(tup, set())
        key = (amount_millions, xml_path)
        if key in seen:
            continue  # dual-volume duplicate of an already-kept row
        seen.add(key)
        slot = detail_root.setdefault(pe_bli, {})
        if scenario in slot:
            slot[scenario] = None  # ≥2 distinct root values → ambiguous
            continue
        slot[scenario] = {
            "v": float(amount_millions),
            "fid": fid if resolution in ("unique", "ambiguous_first") else None,
            "xml_path": xml_path,
        }

    universe = (
        set(decade_slot)
        | set(traj_primary)
        | set(detail_root)
        | {r[8] for r in bl_rows}
    )

    _TRAJ_METRIC_BY_SLOT = {
        "fy2024": "fy2024_actuals",
        "fy2025": "fy2025_total",
        "fy2026": "fy2026_total",
    }
    _DECADE_KIND_BY_SLOT = {
        "fy2024": "actuals",
        "fy2025": "enacted",
        "fy2026": "request",
    }

    _card = _summary_card

    summary_by_pe: dict[str, dict] = {}
    union_cit_rows: list[tuple] = []

    for pe in sorted(universe):
        traj = traj_primary.get(pe)
        cards = []
        slot_cards: dict[str, dict] = {}

        for key, default_fy, default_measure in _SUMMARY_SLOTS:
            # 1. decade grain
            grain = decade_slot.get(pe, {}).get(_DECADE_KIND_BY_SLOT[key])
            if grain is not None:
                v, fid, measure = grain
                slot_cards[key] = _card(
                    key, default_fy, measure, value=v, units="USD thousands",
                    basis=_BASIS_TOA, fid=fid, dataset="fct_decade_series",
                )
                continue
            # 2. trajectory metric
            metric = _TRAJ_METRIC_BY_SLOT[key]
            t_val = None
            if traj is not None:
                t_val = {"fy2024_actuals": traj[2], "fy2025_total": traj[3],
                         "fy2026_total": traj[4]}[metric]
            if t_val is not None:
                meta = _TRAJECTORY_METRIC_META[metric]
                slot_cards[key] = _card(
                    key, meta["fy"], meta["measure"], value=t_val,
                    units="USD thousands", basis=_BASIS_TOA,
                    fid=fact_id_derived("trajectory", f"{pe}|{traj[1]}", metric),
                    dataset="fct_budget_trajectory",
                )
                continue
            # 3. single budget_lines row
            bl_hit = None
            for slug in _SLOT_BL_SLUGS[key]:
                rows_for = bl_by_key.get((pe, slug), [])
                if len(rows_for) == 1 and rows_for[0][1] is not None:
                    bl_hit = (slug, rows_for[0])
                    break
            if bl_hit is not None:
                slug, (fid, amount) = bl_hit
                fy, measure = _amount_type_meta(slug, ed)
                slot_cards[key] = _card(
                    key, fy, measure, value=float(amount),
                    units="USD thousands", basis=_BASIS_TOA, fid=fid,
                    dataset="budget_lines",
                )
                continue
            # 4. detail root row (jbook-detail basis — used and labeled)
            root = detail_root.get(pe, {}).get(_SLOT_DETAIL_SCENARIO[key])
            if root is not None:
                fy, measure = _scenario_meta(_SLOT_DETAIL_SCENARIO[key], ed)
                slot_cards[key] = _card(
                    key, fy, measure, value=root["v"], units="USD millions",
                    basis=_BASIS_DETAIL, fid=root["fid"],
                    xml_path=None if root["fid"] else root["xml_path"],
                    dataset="jbook_details",
                )
                continue
            # 5. honest absence
            slot_cards[key] = _card(
                key, default_fy, default_measure, absence="not-published"
            )

        cards.extend(slot_cards[k] for k, _, _ in _SUMMARY_SLOTS)

        # ---- FY25→26 change card ----
        fy25, fy26 = slot_cards["fy2025"], slot_cards["fy2026"]
        chg = traj[5] if traj is not None else None
        if chg is not None and traj[3] is not None and traj[4] is not None:
            cards.append(_card(
                "change", 2026, "change", value=chg, units="USD thousands",
                basis=_BASIS_TOA,
                fid=fact_id_derived("trajectory", f"{pe}|{traj[1]}", "fy2526_change"),
                dataset="fct_budget_trajectory", pct=traj[6],
            ))
        elif (
            fy25["basis"] == _BASIS_TOA and fy26["basis"] == _BASIS_TOA
            and fy25["fid"] and fy26["fid"]
        ):
            value = round(fy26["value"] - fy25["value"], 3)
            pct = (
                round(value / fy25["value"] * 100.0, 2)
                if fy25["value"] else None
            )
            fid = fact_id_derived("summary", pe, "fy2526_change_union")
            union_cit_rows.append(_null_derived_row(
                fid, "derived", "USD thousands",
                f"FY2026 {fy26['measure']} - FY2025 {fy25['measure']}"
                " (P-1/R-1 workbook toa basis, USD thousands; summary union)",
                _json.dumps([fy26["fid"], fy25["fid"]]),
                f"{value:.3f}",
                built_at,
            ))
            cards.append(_card(
                "change", 2026, "change", value=value, units="USD thousands",
                basis=_BASIS_TOA, fid=fid,
                dataset=fy26["dataset"], pct=pct,
            ))
        else:
            cards.append(_card("change", 2026, "change", absence="no-comparison"))

        # ---- reconciliation payload (§P0-1) ----
        reconciliation = []
        for key, _fy, _m in _SUMMARY_SLOTS:
            card = slot_cards[key]
            if card["basis"] != _BASIS_TOA or card["value"] is None:
                continue
            scenario = _SLOT_DETAIL_SCENARIO[key]
            root = detail_root.get(pe, {}).get(scenario)
            if root is None or root["fid"] is None:
                continue  # no citable single detail fact — never fabricate a side
            fy, measure = _scenario_meta(scenario, ed)
            if measure != card["measure"] or fy != card["fy"]:
                continue  # different pot, not a two-basis restatement
            toa_dollars = card["value"] * 1_000.0
            detail_dollars = root["v"] * 1_000_000.0
            if _display_values_agree(toa_dollars, detail_dollars):
                continue
            reconciliation.append({
                "fy": fy,
                "measure": measure,
                "toa": {
                    "v": card["value"], "units": "USD thousands",
                    "fid": card["fid"], "public_id": card["public_id"],
                    "dataset": card["dataset"],
                },
                "detail": {
                    "v": root["v"], "units": "USD millions",
                    "fid": root["fid"], "public_id": root["fid"][:8],
                    "dataset": "jbook_details", "scenario": scenario,
                },
                "delta_thousands": round((toa_dollars - detail_dollars) / 1_000.0, 3),
            })

        summary_by_pe[pe] = {
            "edition": ed,
            "basis_preference": _BASIS_TOA,
            "cards": cards,
            "reconciliation": reconciliation,
        }

    if union_cit_rows:
        print(
            f"summary union: {len(summary_by_pe)} PE blocks,"
            f" {len(union_cit_rows)} union-change derived facts minted"
        )
    return summary_by_pe, union_cit_rows


def _build_named_primes(
    *,
    json_dir: Path,
    entity_rows: list,
    hhi_by_pe: dict,
    cited_fact_ids: set,
) -> dict[str, list]:
    """WHO-GETS-IT fallback (§P0-2 fix 3): when the budget→award crosswalk
    has no high-confidence linkage for a program (no fct_program_concentration
    row with a citable program_dollars fact — exactly the condition under
    which the answer strip renders "No award linkage at high confidence"),
    but the program has a GATED dossier whose key-players claims name a
    known contractor family, emit named_primes: [{name, family_key, fact_id,
    public_id}] so the card can say "Named in the J-book: … — uncrosswalked".

    Matching is DETERMINISTIC lexicon matching — the same
    word-boundary-substring discipline fct_program_lobbying uses — against
    dim_entities' top-200 family_key and display_name strings
    (case-insensitive). No NLP, no extraction beyond the site's own entity
    lexicon; a dossier that names no known family honestly emits nothing
    (the live F-35 dossier's players claims name only USAF/Navy authority —
    named_primes stays empty there).

    fact_id = the naming CLAIM's citation fact id (dossier claims are
    fact-cited by the dossier gate); claims whose fid does not resolve in
    the citation set are skipped — never a dangling citation.
    """
    import json as _json

    dossier_dir = json_dir / "dossiers"
    if not dossier_dir.is_dir():
        return {}

    # (family_key, display_name, compiled word-boundary patterns)
    lexicon = []
    for r in entity_rows:
        family_key, display_name = r[0], r[1]
        pats = []
        for term in {family_key, display_name}:
            if term and len(term) >= 4:  # guard degenerate short keys
                pats.append(re.compile(
                    r"(?<![A-Za-z0-9])" + re.escape(term) + r"(?![A-Za-z0-9])",
                    re.IGNORECASE,
                ))
        if pats:
            lexicon.append((family_key, display_name, pats))

    out: dict[str, list] = {}
    for path in sorted(dossier_dir.glob("*.json")):
        pe_bli = path.stem
        hhi = hhi_by_pe.get(pe_bli)
        if hhi is not None and hhi.get("program_dollars_fact_id"):
            continue  # crosswalk answers WHO-GETS-IT — no fallback needed
        try:
            dossier = _json.loads(path.read_text()).get("dossier", {})
        except Exception:
            continue  # unreadable dossier — gate territory, not ours
        claims = (dossier.get("players") or {}).get("claims", [])
        primes: list[dict] = []
        seen_fk: set[str] = set()
        for claim in claims:
            text = claim.get("text") or ""
            fid = (claim.get("citation") or {}).get("fact_id")
            if not fid or fid not in cited_fact_ids:
                continue
            for family_key, display_name, pats in lexicon:
                if family_key in seen_fk:
                    continue
                if any(p.search(text) for p in pats):
                    seen_fk.add(family_key)
                    primes.append({
                        "name": display_name,
                        "family_key": family_key,
                        "fact_id": fid,
                        "public_id": fid[:8],
                    })
        if primes:
            out[pe_bli] = primes
    return out


# ---------------------------------------------------------------------------
# Geography citation tier (uncited-ledger clearance)
# ---------------------------------------------------------------------------


def _build_geography_citation_rows(*, duckdb_path) -> list[tuple]:
    """Build derived citation rows for dim_geography and district aggregates.

    Three surfaces (all kind='derived'):

    1. surface='geography', key='{pop_state}|{pop_district}', metric='total_obligation'
       — one row per dim_geography mart row (USAspending place-of-performance
       aggregation over fct_award_transactions, contracts + assistance).
       inputs = [USAspending filter API endpoint]; query_body = the
       place-of-performance filter JSON that scopes the aggregation.

    2. surface='geography', key='grand_total', metric='total_obligation'
       — the all-district total rendered on /district/. recorded_value is
       computed with the same SQL the district sidecar uses
       (select sum(total_obligation) from dim_geography) so sidecar and
       citation agree by construction. inputs=[]; query_body carries the SQL.

    3. surface='district', key='{pop_district}',
       metrics 'total_linkable_dollars' + 'total_cited_dollars'
       — the per-district header/table sums over fct_district_programs.
       inputs = the district's per-program USAspending citation fact_ids
       (fact_id_usaspending district_program rows — emitted for every
       fct_district_programs row with a non-null total_obligation), so the
       derived row chains to the USAspending tier and integrity rule 4a can
       resolve every input. Aggregation mirrors _emit_district_sidecars
       exactly (same query ORDER BY, same float accumulation).

    Never fails export: missing marts → skip that surface silently.
    """
    import datetime
    import json as _json

    import duckdb as _duckdb

    rows: list[tuple] = []
    built_at = datetime.datetime.now(datetime.UTC).isoformat()

    con = _duckdb.connect(str(duckdb_path), read_only=True)
    try:
        # ---- 1. Per-row dim_geography citations ----
        try:
            geo_rows = con.execute(
                "select pop_state, pop_district, transaction_count,"
                " total_obligation from dim_geography"
            ).fetchall()
        except Exception:
            geo_rows = []

        for pop_state, pop_district, txn_count, total_obl in geo_rows:
            if total_obl is None or not pop_district:
                continue
            key_str = f"{pop_state}|{pop_district}"
            fid = fact_id_derived("geography", key_str, "total_obligation")
            query_body = _json.dumps({
                "filters": {
                    "place_of_performance_locations": [
                        {"country": "USA", "state": pop_state,
                         "district_original": pop_district}
                    ],
                },
                "version": "2020-06-01",
            }, sort_keys=True)
            formula = (
                f"sum(fct_award_transactions.obligation) where"
                f" pop_state={pop_state!r} and pop_district={pop_district!r}"
                f" (USAspending place-of-performance aggregation,"
                f" contracts + assistance, {txn_count or '?'} transactions)"
            )
            rows.append(_null_derived_row(
                fid, "derived", "USD",
                formula,
                _json.dumps([f"{_USASPENDING_BASE}{_USASPENDING_FILTER_ENDPOINT}"]),
                f"{total_obl:.3f}",
                built_at,
                query_body=query_body,
            ))

        # ---- 2. Geography grand total (the /district/ index figure) ----
        # Same SQL as _emit_district_sidecars so the sidecar value and the
        # recorded_value agree by construction.
        _GEO_GRAND_TOTAL_SQL = "select sum(total_obligation) from dim_geography"
        try:
            gt_row = con.execute(_GEO_GRAND_TOTAL_SQL).fetchone()
            geo_grand_total = float(gt_row[0]) if gt_row and gt_row[0] else None
        except Exception:
            geo_grand_total = None

        if geo_grand_total is not None and geo_rows:
            fid = fact_id_derived("geography", "grand_total", "total_obligation")
            rows.append(_null_derived_row(
                fid, "derived", "USD",
                f"sum(dim_geography.total_obligation) across {len(geo_rows)}"
                f" (state, district) rows (USAspending place-of-performance"
                f" aggregation, contracts + assistance)",
                "[]",
                f"{geo_grand_total:.3f}",
                built_at,
                query_body=_GEO_GRAND_TOTAL_SQL,
            ))

        # ---- 3. District aggregate citations (linkable + cited sums) ----
        # MUST mirror _emit_district_sidecars: same query ORDER BY, same
        # float accumulation, same fact-id attach rule (usaspending rows are
        # emitted for every non-null total_obligation — see
        # _build_usaspending_citation_rows).
        try:
            dp_rows = con.execute(
                "select pop_state, pop_district, pe_bli, total_obligation"
                " from fct_district_programs"
                " order by pop_state, pop_district, total_obligation desc nulls last"
            ).fetchall()
        except Exception:
            dp_rows = []

        dist_linkable: dict[str, float] = {}
        dist_cited: dict[str, float] = {}
        dist_inputs: dict[str, list[str]] = {}
        dist_prog_count: dict[str, int] = {}
        for pop_state, pop_district, pe_bli, total_obl in dp_rows:
            if not pop_district:
                continue
            dist_prog_count[pop_district] = dist_prog_count.get(pop_district, 0) + 1
            dist_linkable[pop_district] = (
                dist_linkable.get(pop_district, 0.0) + float(total_obl or 0)
            )
            if total_obl is not None:
                usas_fid = fact_id_usaspending(
                    "district_program",
                    f"{pop_state}|{pop_district}|{pe_bli}",
                    "total_obligation",
                )
                dist_cited[pop_district] = (
                    dist_cited.get(pop_district, 0.0) + float(total_obl)
                )
                dist_inputs.setdefault(pop_district, []).append(usas_fid)

        for pop_district in dist_linkable:
            input_fids = list(dict.fromkeys(dist_inputs.get(pop_district, [])))
            inputs_json = _json.dumps(input_fids)
            n_progs = dist_prog_count.get(pop_district, 0)
            for metric, value, formula in [
                (
                    "total_linkable_dollars",
                    dist_linkable[pop_district],
                    f"sum(fct_district_programs.total_obligation) for"
                    f" pop_district={pop_district!r} ({n_progs} crosswalked"
                    f" programs; null obligations contribute 0)",
                ),
                (
                    "total_cited_dollars",
                    dist_cited.get(pop_district, 0.0),
                    f"sum(fct_district_programs.total_obligation) for"
                    f" pop_district={pop_district!r} over programs with a"
                    f" USAspending citation ({len(input_fids)} of {n_progs})",
                ),
            ]:
                fid = fact_id_derived("district", pop_district, metric)
                rows.append(_null_derived_row(
                    fid, "derived", "USD",
                    formula,
                    inputs_json,
                    f"{value:.3f}",
                    built_at,
                ))
    finally:
        con.close()

    return rows


# ---------------------------------------------------------------------------
# Budget-to-awards crosswalk link citation tier (uncited-ledger clearance)
# ---------------------------------------------------------------------------


def _build_budget_to_awards_citation_rows(*, duckdb_path, bl_rows: list) -> list[tuple]:
    """Build derived citation rows for fct_budget_to_awards link rows.

    One kind='derived' row per distinct (pe_bli, award_piid) link:
      surface='budget_to_awards', key='{pe_bli}|{award_piid}', metric='link'.

    The cited fact is the LINK itself — pe_bli matched to an award PIID via
    the crosswalk. Provenance:
      - formula: the crosswalk method + confidence (self-describing; the link
        carries no dollar amount — dollars live at award grain in
        fct_award_transactions).
      - inputs: budget-side workbook fact_ids for (pe_bli, workbook org) —
        every budget_lines fact_id has a workbook citation (set equality
        invariant), so integrity rule 4a resolves all inputs. Capped at 8.
      - query_body: the USAspending award-lookup filter JSON for the PIID
        (the award-side durable artifact).
      - recorded_value: the confidence tier ('high' | 'medium') — the
        assessed strength of the link.

    Formula text deliberately contains no ' - ' token: _verify_derived
    rule 4b treats a difference formula with exactly two fact_id inputs as a
    recomputable subtraction, which a link row is not.

    Deterministic: rows ordered by (pe_bli, award_piid); duplicate
    (pe_bli, award_piid) mart rows collapse to the first occurrence
    (citation_distinctness invariant).

    Never fails export: missing mart → [].
    """
    import datetime
    import json as _json

    import duckdb as _duckdb

    rows: list[tuple] = []
    built_at = datetime.datetime.now(datetime.UTC).isoformat()

    con = _duckdb.connect(str(duckdb_path), read_only=True)
    try:
        try:
            link_rows = con.execute(
                "select pe_bli, award_piid, organization, method, confidence"
                " from fct_budget_to_awards"
                " order by pe_bli, award_piid"
            ).fetchall()
        except Exception:
            link_rows = []
    finally:
        con.close()

    if not link_rows:
        return rows

    # Budget-side inputs: (pe_bli, workbook org) → budget_lines fact_ids.
    # bl_rows cols: (fact_id, exhibit, fiscal_year, account, account_title,
    #   organization, budget_activity, budget_activity_title, pe_bli, title,
    #   amount_type, amount_thousands, units, document_sha256, source_sheet,
    #   source_cells)
    bl_pe_org_to_fids: dict[tuple, list[str]] = {}
    for r in bl_rows:
        fid_bl, _, _, _, _, bl_org, _, _, bl_pe, *_rest = r
        bl_pe_org_to_fids.setdefault((bl_pe, bl_org), []).append(fid_bl)

    _MAX_BUDGET_INPUTS = 8
    seen_links: set[tuple] = set()

    for pe_bli, award_piid, organization, method, confidence in link_rows:
        if not pe_bli or not award_piid:
            continue
        link_key = (pe_bli, award_piid)
        if link_key in seen_links:
            continue
        seen_links.add(link_key)

        translated_org = _workbook_org(organization) if organization else organization
        input_fids = list(dict.fromkeys(
            bl_pe_org_to_fids.get((pe_bli, translated_org), [])
        ))[:_MAX_BUDGET_INPUTS]

        query_body = _json.dumps({
            "filters": {"award_ids": [award_piid]},
            "version": "2020-06-01",
        }, sort_keys=True)

        formula = (
            f"crosswalk link: pe_bli={pe_bli} matched to award PIID"
            f" {award_piid} via method={method!r}, confidence={confidence!r}"
            f" (dollars live at award grain in fct_award_transactions)"
        )

        fid = fact_id_derived("budget_to_awards", f"{pe_bli}|{award_piid}", "link")
        rows.append(_null_derived_row(
            fid, "derived", None,
            formula,
            _json.dumps(input_fids),
            str(confidence or "unknown"),
            built_at,
            query_body=query_body,
        ))

    return rows


# ---------------------------------------------------------------------------
# Lobbyist citation tier (uncited-ledger clearance)
# ---------------------------------------------------------------------------


def _export_dim_lobbyists(*, con, duckdb_path, data_dir: Path) -> list[tuple]:
    """Write data/dim_lobbyists.parquet enriched with disclosing-filing provenance.

    Reads the dim_lobbyists mart (via the already-open read-only con) and the
    influence-stage lda_lobbyists/lda_filings parquets, then writes a typed
    parquet with three extra columns:

      disclosing_filing_uuid — the deterministic LDA filing whose lobbyist
        block discloses this person. Rule: among lda_lobbyists rows with the
        same name, prefer rows whose covered_position equals the mart row's
        covered_position (the statutory disclosure the revolving_door flag is
        based on); tiebreak = lowest filing_uuid. When the mart
        covered_position is empty/N/A (no disclosed position), lowest
        filing_uuid across all of the name's rows.
      disclosing_filing_url  — the filing's LDA API URL.
      fact_id                — fact_id_lda_lobbyist(disclosing_filing_uuid, name).

    When the influence parquets are unavailable (degenerate/test exports) the
    three columns are NULL and no citations can be minted — dim_lobbyists then
    stays on the uncited ledger (see export_site ledger computation).

    Returns the exported row tuples:
      (name, covered_position, filings_count, revolving_door,
       disclosing_filing_uuid, disclosing_filing_url, fact_id)
    """
    import duckdb as _duckdb

    try:
        mart_rows = con.execute(
            "select name, covered_position, filings_count, revolving_door"
            " from dim_lobbyists order by name"
        ).fetchall()
    except Exception:
        mart_rows = []

    # name → [(covered_position, filing_uuid)] from the raw lobbyist rows
    lob_pq = _stage_parquet_path(duckdb_path, "influence", "lda_lobbyists.parquet")
    by_name: dict[str, list[tuple]] = {}
    if lob_pq is not None:
        try:
            for fu, name, cp in _duckdb.sql(
                f"select filing_uuid, name, covered_position"
                f" from read_parquet('{lob_pq}')"
                f" where filing_uuid is not null and filing_uuid <> ''"
                f"   and name is not null and name <> ''"
            ).fetchall():
                by_name.setdefault(name, []).append((cp or "", fu))
        except Exception:
            by_name = {}

    # filing_uuid → API URL from lda_filings
    filing_urls: dict[str, str] = {}
    lda_pq = _stage_parquet_path(duckdb_path, "influence", "lda_filings.parquet")
    if lda_pq is not None:
        try:
            for fu, url in _duckdb.sql(
                f"select filing_uuid, url from read_parquet('{lda_pq}')"
                f" where filing_uuid is not null"
            ).fetchall():
                if fu and url:
                    filing_urls[fu] = url
        except Exception:
            pass

    export_rows: list[tuple] = []
    for name, covered_position, filings_count, revolving_door in mart_rows:
        disclosing_uuid = None
        candidates = by_name.get(name, [])
        if candidates:
            cp = (covered_position or "").strip()
            if cp and cp.upper() != "N/A":
                matching = sorted(fu for c, fu in candidates if c == covered_position)
                if matching:
                    disclosing_uuid = matching[0]
            if disclosing_uuid is None:
                disclosing_uuid = sorted(fu for _c, fu in candidates)[0]

        disclosing_url = None
        fid = None
        if disclosing_uuid:
            disclosing_url = filing_urls.get(
                disclosing_uuid,
                f"https://lda.senate.gov/api/v1/filings/{disclosing_uuid}/",
            )
            fid = fact_id_lda_lobbyist(disclosing_uuid, name)

        export_rows.append((
            name, covered_position,
            int(filings_count) if filings_count is not None else None,
            bool(revolving_door) if revolving_door is not None else None,
            disclosing_uuid, disclosing_url, fid,
        ))

    _write_typed_parquet(
        data_dir / "dim_lobbyists.parquet",
        columns=[
            ("name", "varchar"), ("covered_position", "varchar"),
            ("filings_count", "bigint"), ("revolving_door", "boolean"),
            ("disclosing_filing_uuid", "varchar"),
            ("disclosing_filing_url", "varchar"),
            ("fact_id", "varchar"),
        ],
        rows=export_rows,
    )
    return export_rows


def _build_lobbyist_citation_rows(*, lobbyist_rows: list) -> list[tuple]:
    """Build kind='lda_filing' citation rows for dim_lobbyists rows.

    One citation per lobbyist row that has a disclosing filing:
      fact_id     = fact_id_lda_lobbyist(disclosing_filing_uuid, name)
      official_url = the disclosing filing's LDA API URL (starts with
                     https://lda.senate.gov/ and embeds the uuid — the same
                     shape contract _verify_lda re-derives).

    lobbyist_rows is the return value of _export_dim_lobbyists, so citations
    and the exported parquet agree by construction (integrity gate re-derives
    lobbyist fact_ids from the parquet's name + disclosing_filing_uuid).
    """
    rows: list[tuple] = []
    for (name, _cp, _count, _rev, disclosing_uuid, disclosing_url, fid) in lobbyist_rows:
        if not fid or not disclosing_uuid:
            continue
        rows.append((
            fid, "lda_filing", None,  # fact_id, kind, units
            None, None, None, None, None, None, None, None,  # amount_text + bbox
            None,   # resolution
            None,   # sheet
            None,   # cells
            None,   # amount_thousands
            None,   # sha256
            None,   # hosted_pdf_url
            disclosing_url,  # official_url
            None,   # xml_path
            None,   # retrieved_at
            None, None, None, None,  # formula, inputs, query_body, recorded_value
            None, None, None,  # pe_bli, scenario, amount_type
        ))
    return rows


# ---------------------------------------------------------------------------
# Prose-amount links (Phase 5F §2c) — deterministic only
# ---------------------------------------------------------------------------

# A canonicalizable in-prose dollar token: '$15.750 million', '$3 billion',
# '$1,234.5 thousand'. Unit-less tokens ('$15.750') are NOT matched — without
# the unit word the dollar value cannot be derived deterministically, and a
# wrong receipt is worse than none.
_PROSE_DOLLAR_RE = re.compile(
    r"\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand)\b",
    re.IGNORECASE,
)
_PROSE_DOLLAR_MULT = {"thousand": 10**3, "million": 10**6, "billion": 10**9}


def _narrative_amount_links(
    body: str,
    scoped_amounts: dict,
    cited_fact_ids: set,
) -> list[dict]:
    """Link in-prose dollar tokens to facts of the same PE — exact match only.

    scoped_amounts: canonical Decimal dollars → set of fact_ids for EVERY fact
    in the PE's scope (details / budget_lines / trajectory), cited or not —
    ambiguity is counted over all of them. A token links IFF its canonical
    value matches exactly ONE fact AND that fact's citation exists (state-A
    Cite contract: data-fact-id must resolve). Ambiguous, unmatched, or
    uncited tokens stay plain prose.
    """
    links: list[dict] = []
    for m in _PROSE_DOLLAR_RE.finditer(body):
        try:
            value = (
                Decimal(m.group(1).replace(",", ""))
                * _PROSE_DOLLAR_MULT[m.group(2).lower()]
            )
        except InvalidOperation:
            continue
        fids = scoped_amounts.get(value)
        if fids is None or len(fids) != 1:
            continue  # unmatched or multiple candidates → NO link
        (fid,) = tuple(fids)
        if fid not in cited_fact_ids:
            continue  # link must resolve — never a dangling data-fact-id
        links.append({
            "end": m.end(),
            "fact_id": fid,
            "start": m.start(),
            "token": m.group(0),
        })
    return links


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


def _lineage_ba(pe_bli: str) -> str | None:
    """Best-effort budget-activity for a rail entry's OTHER PE.

    RDT&E R-2 convention ONLY: PE = ``06<x><BA>...``; the 4th char of a
    ``06``-prefixed PE is the BA digit (e.g. 0604818A → '4'). Returns None
    otherwise — the site then omits the BA chip rather than guess.

    (2026-07-28: a bl_by_pe budget_activity branch was removed as confirmed
    dead — the bl_by_pe row dicts built in export_site never carry a
    "budget_activity" key, so this convention was always the sole live path.)
    """
    if len(pe_bli) >= 4 and pe_bli[:2] == "06" and pe_bli[3].isdigit():
        return pe_bli[3]
    return None


def _emit_lineage(
    *,
    edges: list,
    families: dict[str, int],
    all_pe_blis: set[str],
    rollup_pes: set[str],
    titles_by_pe: dict[str, str],
    decade_series_by_pe: dict[str, dict],
    cited_fact_ids: set[str],
) -> dict[str, dict]:
    """Build the per-program ``lineage`` sidecar block (program-lineage Task 6).

    Pure function (no DB) so it is unit-testable in isolation. Returns
    ``{pe_bli: lineage_block}`` for every PE that has ≥1 edge OR is in a family.

    Block shape (spec §):
      rail.predecessors / rail.successors — one entry per edge touching THIS pe,
        entry.pe = the OTHER PE. resolved = (pe in the page universe). STATED
        edges carry evidence {fact_id,page,sentence}; a stated edge whose
        fact_id is NOT in cited_fact_ids RAISES (2026-07-28 — with the
        narrative fence aligned end-to-end via CITED_NARRATIVE_FY this is
        unreachable, so it fails the export loudly rather than silently
        shipping an uncited stated edge); INFERRED edges carry evidence: None
        (the honesty contract — inferred edges are NEVER cited).
      family — only when THIS pe is in a family. chain = one_to_one_chain from
        the family ROOT (stated in-degree 0; lexicographically-smallest member
        if the family is cyclic). funding_line (Defect 2, 2026-07-28) emits one
        entry PER (fy, chain member) with a cited request fact — {fy, pe, v,
        fid} where v is EXACTLY that member's fact value. NOTHING is ever
        summed: an fy where two chain members coexist yields two labeled
        entries (the renderer shows the handoff), because a summed number would
        display a value its single citation does not back. Sorted by
        (fy, chain position); a non-chain family member is excluded.
        has_split = "this family branches": any split/merge edge, OR any
        stated node with out-degree > 1 (fan-out), OR any stated node with
        in-degree > 1 (fan-in / merge).
      Per-family chain/funding_line/has_split are computed ONCE (cached by
      family_id), not per-PE.
    """
    from collections import defaultdict

    from govbudget.lineage.family import one_to_one_chain

    universe = all_pe_blis | rollup_pes

    def _rail_entry(other_pe: str, e) -> dict:
        # evidence: stated → {fact_id,page,sentence};
        #           inferred → None (never cited — the honesty contract).
        evidence = None
        if e.confidence == "stated":
            fid = e.evidence_fact_id
            if fid is not None and fid not in cited_fact_ids:
                # HARD ERROR (2026-07-28): with the narrative fence aligned
                # end-to-end (CITED_NARRATIVE_FY in lineage/model.py governs
                # load.py, verify-lineage leg a, AND this file's cite-shard
                # pass) a stated edge citing an out-of-universe fact is
                # unreachable — if it happens the pipeline is broken, and the
                # export must FAIL LOUDLY rather than silently shipping a
                # stated edge stripped of its citation (the print-and-null
                # degrade this replaced).
                raise ValueError(
                    f"lineage: stated edge {e.from_pe_bli}->{e.to_pe_bli} cites"
                    f" fact_id {fid} which is not in the cite-shard universe —"
                    " the CITED_NARRATIVE_FY fence is broken (rebuild lineage"
                    " against the current narratives); refusing to export a"
                    " stated edge without a resolvable citation"
                )
            evidence = {
                "fact_id": fid,
                "page": e.evidence_page,
                "sentence": e.evidence_sentence,
            }
        return {
            "pe": other_pe,
            "title": titles_by_pe.get(other_pe),
            "ba": _lineage_ba(other_pe),
            "fy": e.fiscal_year,
            "relation": e.relation,
            "confidence": e.confidence,
            "resolved": other_pe in universe,
            "evidence": evidence,
        }

    # -- rail: index edges by the PE they touch ---------------------------- #
    preds_by_pe: dict[str, list] = defaultdict(list)
    succs_by_pe: dict[str, list] = defaultdict(list)
    for e in edges:
        # from_pe_bli's OUT-edge → a successor of from; an IN-edge of to.
        succs_by_pe[e.from_pe_bli].append(_rail_entry(e.to_pe_bli, e))
        preds_by_pe[e.to_pe_bli].append(_rail_entry(e.from_pe_bli, e))

    # -- family: group members, compute chain/funding_line/has_split once -- #
    members_by_family: dict[int, list[str]] = defaultdict(list)
    for pe_bli, fam_id in families.items():
        members_by_family[fam_id].append(pe_bli)

    # stated edges per family (chain + has_split both need only stated edges)
    stated_by_family: dict[int, list] = defaultdict(list)
    for e in edges:
        if e.confidence != "stated":
            continue
        fam_id = families.get(e.from_pe_bli)
        if fam_id is None:
            fam_id = families.get(e.to_pe_bli)
        if fam_id is not None:
            stated_by_family[fam_id].append(e)

    family_cache: dict[int, dict] = {}
    for fam_id, members in members_by_family.items():
        fam_edges = stated_by_family.get(fam_id, [])
        member_set = set(members)

        # ROOT = the member with stated in-degree 0 (over this family's stated
        # edges). If the family is cyclic (no in-degree-0 member — carried from
        # Task 3's review), fall back to the lexicographically smallest member
        # so the chain walk is deterministic and doesn't under-attribute.
        in_deg: dict[str, int] = defaultdict(int)
        out_deg: dict[str, int] = defaultdict(int)
        for e in fam_edges:
            in_deg[e.to_pe_bli] += 1
            out_deg[e.from_pe_bli] += 1
        roots = sorted(m for m in members if in_deg[m] == 0)
        root = roots[0] if roots else min(members)

        chain = one_to_one_chain(root, fam_edges)

        # funding_line (Defect 2, 2026-07-28): one entry PER (fy, chain member)
        # with a cited request fact — v is EXACTLY that member's fact value and
        # fid is that fact's id, so every displayed number equals the fact its
        # citation backs. NOTHING is summed: when two chain members coexist on
        # an fy (realigned pairs coexist for whole decades — the "overlap is
        # rare" premise behind the old summed point was false), BOTH members'
        # points ship, labeled per member, and the renderer shows the handoff.
        # Sorted by (fy, chain position) so an overlap fy lists the
        # predecessor's point before the successor's.
        chain_pos = {member: i for i, member in enumerate(chain)}
        funding_entries: list[dict] = []
        for member in chain:
            for pt in decade_series_by_pe.get(member, {}).get("request", []):
                fid = pt.get("fid")
                if fid is None or fid not in cited_fact_ids:
                    continue  # only resolving fids (they already are — belt & braces)
                funding_entries.append(
                    {"fy": pt["fy"], "pe": member, "v": pt["v"], "fid": fid}
                )
        funding_entries.sort(key=lambda p: (p["fy"], chain_pos[p["pe"]]))
        funding_line = funding_entries

        # has_split ("this family branches"): any split/merge edge, OR any
        # stated node fanning OUT (stated out-degree > 1 — a one-to-many
        # hand-off), OR any stated node fanning IN (stated in-degree > 1 —
        # a many-to-one MERGE, e.g. the 5-source fan-in into 0303005F). All
        # three mean the funding line above is the 1:1 chain only, with branch
        # arms not summed in — so all three must raise the branch note.
        has_split = (
            any(e.relation in ("split", "merged") for e in fam_edges)
            or any(out_deg[m] > 1 for m in member_set)
            or any(in_deg[m] > 1 for m in member_set)
        )

        # chain_head_title: the short title of the chain HEAD (chain[0], the
        # family root). Lets the /years/-linked family funding line label its
        # summed line self-descriptively ("FUNDING CHAIN: 0203728A — Joint …")
        # instead of forcing a bare-id cross-reference. None when the head has
        # no title in titles_by_pe (renderer falls back to the id alone).
        chain_head_title = titles_by_pe.get(chain[0]) if chain else None

        family_cache[fam_id] = {
            "family_id": fam_id,
            "funding_line": funding_line,
            "chain": chain,
            "chain_head_title": chain_head_title,
            "has_split": has_split,
        }

    # -- assemble per-PE blocks ------------------------------------------- #
    pes: set[str] = set(preds_by_pe) | set(succs_by_pe) | set(families)
    out: dict[str, dict] = {}
    for pe_bli in pes:
        block: dict = {
            "rail": {
                "predecessors": preds_by_pe.get(pe_bli, []),
                "successors": succs_by_pe.get(pe_bli, []),
            }
        }
        fam_id = families.get(pe_bli)
        if fam_id is not None:
            block["family"] = family_cache[fam_id]
        out[pe_bli] = block
    return out


def _load_lineage_for_export(duckdb_path) -> tuple[list, dict[str, int]]:
    """Read program_lineage + program_family from the jbooks parquet lake and
    return (edges, families).

    The sidecar writer only has the DuckDB mart connection in scope; the lineage
    tables live in Postgres and are staged to parquet alongside the other jbooks
    lake tables (same access pattern as budget_lines/documents at
    ``_stage_parquet_path(duckdb_path, "jbooks", …)``). All lake columns are
    VARCHAR, so numeric fields are parsed here into the LineageEdge types.
    """
    from govbudget.lineage.model import LineageEdge

    lin_pq = _stage_parquet_path(duckdb_path, "jbooks", "program_lineage.parquet")
    fam_pq = _stage_parquet_path(duckdb_path, "jbooks", "program_family.parquet")
    if lin_pq is None or fam_pq is None:
        return [], {}

    import duckdb as _duckdb_lin

    con = _duckdb_lin.connect()
    try:
        lin_s = str(lin_pq).replace("'", "''")
        fam_s = str(fam_pq).replace("'", "''")
        lin_rows = con.execute(
            "select from_pe_bli, to_pe_bli, fiscal_year, relation, confidence,"
            " evidence_fact_id, evidence_sentence, evidence_page, portion_amount,"
            f" inference_basis from read_parquet('{lin_s}')"
        ).fetchall()
        fam_rows = con.execute(
            f"select pe_bli, family_id from read_parquet('{fam_s}')"
        ).fetchall()
    finally:
        con.close()

    def _int(v):
        try:
            return int(v) if v is not None and str(v) != "" else None
        except (TypeError, ValueError):
            return None

    def _float(v):
        try:
            return float(v) if v is not None and str(v) != "" else None
        except (TypeError, ValueError):
            return None

    edges = [
        LineageEdge(
            from_pe_bli=r[0],
            to_pe_bli=r[1],
            fiscal_year=_int(r[2]) or 0,
            relation=r[3],
            confidence=r[4],
            evidence_fact_id=r[5],
            evidence_sentence=r[6],
            evidence_page=_int(r[7]),
            portion_amount=_float(r[8]),
            inference_basis=r[9],
        )
        for r in lin_rows
    ]
    families = {r[0]: _int(r[1]) for r in fam_rows if _int(r[1]) is not None}
    return edges, families


def _emit_json_sidecars(
    *,
    out_dir: Path,
    duckdb_path: Path,
    detail_rows: list,
    bl_rows: list,
    citation_rows: list,
    manifest: dict,
    flow_payload: dict | None = None,
    decade_bl_rows: list | None = None,
    decade_grains: list | None = None,
    decade_side_meta: dict | None = None,
    summary_by_pe: dict | None = None,
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
            flow_payload=flow_payload,
            decade_bl_rows=decade_bl_rows,
            decade_grains=decade_grains,
            decade_side_meta=decade_side_meta,
            summary_by_pe=summary_by_pe,
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
    flow_payload: dict | None = None,
    decade_bl_rows: list | None = None,
    decade_grains: list | None = None,
    decade_side_meta: dict | None = None,
    summary_by_pe: dict | None = None,
) -> int:
    """Core sidecar writer; called from _emit_json_sidecars."""

    n_files = 0
    summary_by_pe = summary_by_pe or {}

    # ------------------------------------------------------------------ #
    # 0. Build in-memory indexes from already-fetched data                #
    # ------------------------------------------------------------------ #

    # jbook_details index: pe_bli → list of detail dicts
    # detail_rows cols: (fact_id, pe_bli, project_number, project_title, scenario,
    #                    amount_millions, units, xml_path, org, exhibit_family,
    #                    fiscal_year, document_sha256, resolution)
    from collections import Counter, defaultdict

    details_by_pe: dict[str, list] = defaultdict(list)
    for row in detail_rows:
        (fid, pe_bli, project_number, project_title, scenario,
         amount_millions, units, xml_path, org, exhibit_family,
         fiscal_year, document_sha256, resolution) = row
        # Basis threading (PM Sprint 1): every detail figure is a J-book
        # R-2/P-40 row → basis 'jbook-detail'; (fy, measure) from the
        # edition-relative scenario map. `entity` scopes gate-23 grouping:
        # the PE-root row (project_number null) IS the program's (fy,
        # measure) value; project rows are components and must never be
        # grouped against the cards ('{pe}/{project}').
        d_fy, d_measure = _scenario_meta(scenario, 2026)
        details_by_pe[pe_bli].append({
            "fact_id": fid,
            "project_number": project_number,
            "project_title": project_title,
            "scenario": scenario,
            "amount_millions": amount_millions,
            "units": units,
            "resolution": resolution,
            "xml_path": xml_path,
            "basis": _BASIS_DETAIL,
            "fy": d_fy,
            "measure": d_measure,
            "edition": 2026,
            "entity": (
                pe_bli if project_number is None
                else f"{pe_bli}/{project_number}"
            ),
        })

    # Set of fact_ids that have a valid citation row (resolution unique/ambiguous_first)
    # Only these are safe to emit as data-fact-id (gate 2 Cite state A contract).
    _cited_fact_ids: set[str] = {row[0] for row in citation_rows}

    # Decade series index (Phase 5E): pe_bli → {amount_type_kind: [entry…]}.
    # Entries are {fy, v, fid, edition, basis, measure} sorted by fy; absent
    # editions are GAPS (no entry), never zeros; uncited grains never render
    # (honesty — every emitted fid resolves in the citation set).
    # basis/measure (PM Sprint 1): every point is a workbook grain → 'toa';
    # measure comes from the grain's CHOSEN slug (slug-accurate — see the
    # decade_grains 7-tuple comment), never blindly from the series kind.
    decade_series_by_pe: dict[str, dict] = {}
    for d_pe, d_fy, d_edition, d_kind, d_amount, d_fid, d_at in (decade_grains or []):
        if d_fid is None or d_fid not in _cited_fact_ids or d_amount is None:
            continue
        _, d_measure = _amount_type_meta(d_at, d_edition)
        decade_series_by_pe.setdefault(d_pe, {}).setdefault(d_kind, []).append({
            "fy": d_fy, "v": d_amount, "fid": d_fid, "edition": d_edition,
            "basis": _BASIS_TOA, "measure": d_measure or d_kind,
        })
    for _pe, kinds in decade_series_by_pe.items():
        for _kind, entries in kinds.items():
            entries.sort(key=lambda e: e["fy"])

    # fy2024_fact_id index: pe_bli → fact_id (jbook_details WHERE
    # project_number IS NULL AND scenario='PriorYear'; nullable if absent).
    # ONLY populated when that fact_id exists in _cited_fact_ids; otherwise
    # null so the page renders honest Cite state C (data-uncited) instead of
    # emitting a dangling data-fact-id that citations.json cannot resolve.
    # PB2026 fence (Finding A): 'PriorYear' means FY2024 actuals ONLY in the
    # PB2026 edition — the fiscal_year == 2026 check makes that explicit
    # even though detail_rows is already fenced at the export query
    # (a first-PriorYear-in-sha-order pick across editions would be an
    # arbitrary edition's figure under an FY2024 label).
    fy2024_fact_id: dict[str, str] = {}
    for row in detail_rows:
        (fid, pe_bli, project_number, project_title, scenario, *rest) = row
        if row[10] != 2026:
            continue
        if project_number is None and scenario == "PriorYear":
            if pe_bli not in fy2024_fact_id and fid in _cited_fact_ids:
                fy2024_fact_id[pe_bli] = fid

    # fy2024_xml_path index: pe_bli → xml_path for PriorYear root rows that
    # have NO citation row (zero_amount facts).  Lets the program headline
    # FY24 figure render honest Cite state B (xml-path chip) instead of
    # state C — required by the dataset-ledger render gate, since
    # jbook_details is a cited dataset and may no longer render ⁂.
    # Same PB2026 fence as fy2024_fact_id above.
    fy2024_xml_path: dict[str, str] = {}
    for row in detail_rows:
        (fid, pe_bli, project_number, project_title, scenario,
         _amount_millions, _units, xml_path, *rest) = row
        if row[10] != 2026:
            continue
        if project_number is None and scenario == "PriorYear":
            if (pe_bli not in fy2024_xml_path and fid not in _cited_fact_ids
                    and xml_path):
                fy2024_xml_path[pe_bli] = xml_path

    # budget_lines index: pe_bli → list of bl dicts
    # bl_rows cols: (fact_id, exhibit, fiscal_year, account, account_title,
    #                organization, budget_activity, budget_activity_title,
    #                pe_bli, title, amount_type, amount_thousands, units,
    #                document_sha256, source_sheet, source_cells)
    # Per-(pe, amount_type) row counts: a PE whose slug has exactly ONE row
    # renders the program-level value (entity = pe, groups with the cards);
    # multi-account/org splits are components ('{pe}/{org}/{account}' —
    # legitimately different values must never collide in gate 23).
    _bl_key_counts: Counter = Counter((r[8], r[10]) for r in bl_rows)

    bl_by_pe: dict[str, list] = defaultdict(list)
    for row in bl_rows:
        (fid, exhibit, fiscal_year, account, account_title,
         organization, budget_activity, budget_activity_title,
         pe_bli, title, amount_type, amount_thousands, units,
         document_sha256, source_sheet, source_cells) = row
        # Basis threading (PM Sprint 1): every workbook row is R-1/P-1 TOA.
        b_fy, b_measure = _amount_type_meta(amount_type, 2026)
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
            "basis": _BASIS_TOA,
            "fy": b_fy,
            "measure": b_measure,
            "edition": 2026,
            "entity": (
                pe_bli if _bl_key_counts[(pe_bli, amount_type)] == 1
                else f"{pe_bli}/{organization}/{account}"
            ),
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
    # 3. program_details/{pe_bli}.json  (one file per distinct PE)       #
    # ------------------------------------------------------------------ #

    det_dir = json_dir / "program_details"
    det_dir.mkdir(exist_ok=True)

    # trajectory rows regrouped per PE — used by the §2c scoped-amount index
    # and the §2a rollup service_org rule.
    traj_by_pe: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for (t_pe, t_org), t_metrics in traj_index.items():
        traj_by_pe[t_pe].append((t_org, t_metrics))

    def _scoped_amounts(pe_bli: str) -> dict:
        """Canonical Decimal dollars → fact_ids for every fact of this PE
        (details, budget_lines, trajectory — cited or not; §2c ambiguity is
        counted over the full scope)."""
        idx: dict = {}

        def _add(value, fid):
            idx.setdefault(value, set()).add(fid)

        for d in details_by_pe.get(pe_bli, []):
            if d["amount_millions"] is not None:
                _add(Decimal(str(d["amount_millions"])) * 1_000_000, d["fact_id"])
        for b in bl_by_pe.get(pe_bli, []):
            if b["amount_thousands"] is not None:
                _add(Decimal(str(b["amount_thousands"])) * 1_000, b["fact_id"])
        for t_org, t_metrics in traj_by_pe.get(pe_bli, []):
            for metric in ("fy2024_actuals", "fy2025_total",
                           "fy2026_total", "fy2526_change"):
                v = t_metrics.get(metric)
                if v is not None:
                    _add(Decimal(str(v)) * 1_000,
                         fact_id_derived("trajectory", f"{pe_bli}|{t_org}", metric))
        return idx

    def _narratives_with_links(pe_bli: str) -> list[dict]:
        """Narrative entries, each gaining 'amount_links' ONLY when at least
        one prose dollar token deterministically matched (§2c) — entries
        without matches keep their exact prior shape (byte-stability)."""
        entries = narr_by_pe.get(pe_bli, [])
        if not entries:
            return entries
        scoped = _scoped_amounts(pe_bli)
        out: list[dict] = []
        for e in entries:
            links = _narrative_amount_links(
                e.get("body") or "", scoped, _cited_fact_ids
            )
            out.append({**e, "amount_links": links} if links else e)
        return out

    # Largest cited request-vs-actuals gap per PE (Phase 5E Task 7) — the
    # program page's "asked vs spent" line. Only attached where the sidecar
    # also carries decade_series: the UI resolves the two side values (and
    # their fids) from those grains, so a book_diff without its series would
    # render an uncitable claim.
    rva_by_pe = _rva_gap_index(con, _cited_fact_ids)

    # WHO-GETS-IT named-primes fallback (PM Sprint 1, §P0-2 fix 3) — needs
    # the dossier sidecars (written by the dossier CLI before export), the
    # entity lexicon, and the crosswalk coverage in hhi_by_pe.
    named_primes_by_pe = _build_named_primes(
        json_dir=json_dir,
        entity_rows=entity_rows,
        hhi_by_pe=hhi_by_pe,
        cited_fact_ids=_cited_fact_ids,
    )

    def _summary_block(pe_bli: str) -> dict:
        """The sidecar's summary payload: union block + named_primes (always
        a list — honest empty when no dossier names a known family)."""
        block = dict(summary_by_pe.get(pe_bli) or _summary_absence_block())
        block["named_primes"] = named_primes_by_pe.get(pe_bli, [])
        return block

    all_pe_blis = {r[0] for r in all_prog_rows}

    # -- Program-lineage universe + titles (hoisted above the full-tier loop
    #    because _emit_lineage needs the FULL page universe — full-tier PLUS
    #    rollup-tier — to set each rail entry's `resolved` flag, and the
    #    full-tier sidecars attach the lineage block too. The rollup section
    #    below reuses these same objects.) --------------------------------- #
    titles_by_pe: dict[str, str] = {}
    try:
        titles_by_pe = dict(
            con.execute("select pe_bli, title from dim_pe_titles").fetchall()
        )
    except Exception as exc:
        print(
            f"program_details rollup: dim_pe_titles unavailable ({exc});"
            " rollup titles will be null"
        )

    # Route-safety filter (used for both the rollup universe and the lineage
    # `resolved` check): a program page is a Next.js static route, so the pe_bli
    # must round-trip through a URL path segment.
    def _is_route_safe_pe(pe_bli: str) -> bool:
        return not (set(pe_bli) & set("&#/?%") or any(c.isspace() for c in pe_bli))

    rollup_pes_raw = sorted({row[8] for row in bl_rows} - all_pe_blis)
    dropped_unsafe = [p for p in rollup_pes_raw if not _is_route_safe_pe(p)]
    rollup_pes = [p for p in rollup_pes_raw if _is_route_safe_pe(p)]

    # program-lineage sidecar blocks (Task 6): read edges+families from the
    # jbooks parquet lake (the writer only holds the DuckDB mart connection; the
    # lineage tables are Postgres, staged to the lake). Emit once — chain /
    # funding_line / has_split are cached per family inside _emit_lineage.
    _lin_edges, _lin_families = _load_lineage_for_export(duckdb_path)
    lineage_by_pe = _emit_lineage(
        edges=_lin_edges,
        families=_lin_families,
        all_pe_blis=all_pe_blis,
        rollup_pes=set(rollup_pes),
        titles_by_pe=titles_by_pe,
        decade_series_by_pe=decade_series_by_pe,
        cited_fact_ids=_cited_fact_ids,
    )

    for pe_bli in all_pe_blis:
        obj = {
            "awards": awards_by_pe.get(pe_bli, []),
            "budget_lines": bl_by_pe.get(pe_bli, []),
            "details": details_by_pe.get(pe_bli, []),
            "mentions": _build_mentions(
                mentions_by_pe.get(pe_bli, []),
                top200_family_keys,
            ),
            "narratives": _narratives_with_links(pe_bli),
            "summary": _summary_block(pe_bli),
        }
        if pe_bli in decade_series_by_pe:
            obj["decade_series"] = decade_series_by_pe[pe_bli]
            if pe_bli in rva_by_pe:
                obj["book_diff"] = rva_by_pe[pe_bli]
        if pe_bli in lineage_by_pe:
            obj["lineage"] = lineage_by_pe[pe_bli]
        _write_json(det_dir / f"{pe_bli}.json", obj)
        n_files += 1

    # -- Rollup-tier sidecars (Phase 5F §2a) ---------------------------- #
    # Every distinct PE in budget_lines gets a sidecar. PEs outside
    # programs.json have R-1/P-1 numbers but no ingested narrative J-book —
    # the sidecar carries an explicit tier + service_org (so the site can say
    # honestly where the detailed justification lives), the dim_pe_titles
    # title, the workbook rows and the cited trajectory. programs.json,
    # agencies.json and years_matrix.json stay programs.json-scoped by
    # construction — growing the /years/ matrix to all PEs is a site-batch
    # decision, not made here.
    # (titles_by_pe + rollup_pes + _is_route_safe_pe are computed above the
    # full-tier loop so _emit_lineage can share the same page universe.)

    bl_org_counts: dict[str, Counter] = defaultdict(Counter)
    for row in bl_rows:
        bl_org_counts[row[8]][row[5]] += 1     # pe_bli → org row counts

    def _rollup_service_org(pe_bli: str) -> str | None:
        """Deterministic primary org: the trajectory org with the largest
        fy2026_total (org ascending tiebreak — the _trajectory_only_feed_
        programs rule); falls back to the modal budget_lines org."""
        entries = traj_by_pe.get(pe_bli)
        if entries:
            ranked = sorted(
                entries,
                key=lambda e: (
                    e[1]["fy2026_total"] is None,
                    -(e[1]["fy2026_total"] or 0.0),
                    e[0],
                ),
            )
            return ranked[0][0]
        counts = bl_org_counts.get(pe_bli)
        if counts:
            return min(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
        return None

    # Route-safety filter + rollup universe are computed above the full-tier
    # loop (so _emit_lineage shares the same page universe). A handful of Army
    # R-1/P-1 workbook lines mis-parse the appropriation label ("RDT&E", "O&M")
    # into the pe_bli slot — the '&' breaks static routing and the page renders
    # as 404, so those are dropped from the page universe. Report the drops here.
    if dropped_unsafe:
        print(
            f"program_details: dropped {len(dropped_unsafe)} route-unsafe "
            f"mis-parsed pe_bli(s) from the page universe: "
            f"{', '.join(dropped_unsafe)}"
        )
    for pe_bli in rollup_pes:
        service_org = _rollup_service_org(pe_bli)
        traj = traj_index.get((pe_bli, service_org)) if service_org else None
        obj = {
            "awards": awards_by_pe.get(pe_bli, []),
            "budget_lines": bl_by_pe.get(pe_bli, []),
            "details": details_by_pe.get(pe_bli, []),
            "mentions": _build_mentions(
                mentions_by_pe.get(pe_bli, []),
                top200_family_keys,
            ),
            "narratives": _narratives_with_links(pe_bli),
            "summary": _summary_block(pe_bli),
            "service_org": service_org,
            "tier": "rollup",
            "title": titles_by_pe.get(pe_bli),
            "trajectory": traj,
            "trajectory_fact_ids": (
                _trajectory_fact_ids(pe_bli, service_org, traj)
                if service_org else None
            ),
        }
        if pe_bli in decade_series_by_pe:
            obj["decade_series"] = decade_series_by_pe[pe_bli]
            if pe_bli in rva_by_pe:
                obj["book_diff"] = rva_by_pe[pe_bli]
        if pe_bli in lineage_by_pe:
            obj["lineage"] = lineage_by_pe[pe_bli]
        _write_json(det_dir / f"{pe_bli}.json", obj)
        n_files += 1
    if rollup_pes:
        print(
            f"program_details: +{len(rollup_pes)} rollup-tier sidecars"
            f" (total {len(all_pe_blis) + len(rollup_pes)})"
        )

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
    # 7b. cite-shards/{fact_id[:2]}.json (Phase 5D — lazy resolution)     #
    # ------------------------------------------------------------------ #
    # Same citations_dict objects as citations.json — one serializer, so
    # the panel resolves an identical row whether embedded or fetched.
    n_files += _emit_cite_shards(json_dir=json_dir, citations_dict=citations_dict)

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

    # ---- Canonical-TOA hero (PM Sprint 1, §P0-5) -------------------------
    # The homepage superlative: the LARGEST FY2024-actuals figure in the
    # programs.json corpus, computed on the toa basis (the canonical basis
    # for hero/OG/feed) from the same union cards the program pages render —
    # by construction the hero value equals the program page's FY24 card.
    # Live: F-35 (ATA000) 5,565,655 USD thousands, its P-1 workbook fact.
    _corpus_qualifier = scope_qualifier(len(programs_list))
    hero = None
    for p in programs_list:
        block = summary_by_pe.get(p["pe_bli"])
        if not block:
            continue
        fy24 = next(
            (c for c in block["cards"] if c["key"] == "fy2024"), None
        )
        if (
            fy24 is None or fy24["basis"] != _BASIS_TOA
            or fy24["value"] is None or not fy24["fid"]
            or fy24["fid"] not in _cited_fact_ids
        ):
            continue
        if hero is None or fy24["value"] > hero["value"] or (
            fy24["value"] == hero["value"] and p["pe_bli"] < hero["pe_bli"]
        ):
            hero = {
                "pe_bli": p["pe_bli"],
                "title": p["title"],
                "org": p["org"],
                "value": fy24["value"],
                "units": fy24["units"],
                "basis": fy24["basis"],
                "fy": fy24["fy"],
                "measure": fy24["measure"],
                "edition": fy24["edition"],
                "fid": fy24["fid"],
                "public_id": fy24["public_id"],
                "dataset": fy24["dataset"],
                "scope_qualifier": _corpus_qualifier,
            }

    site_meta = {
        "built_at": manifest.get("built_at"),
        "counts": meta_counts,
        # PM Sprint 1 (P0-5): the canonical-toa hero figure + the corpus
        # scope qualifier every hero/OG/feed superlative must carry, and the
        # static trajectory-metric → (fy, measure) map (single payload-level
        # source for the trajectory block's basis attributes — components
        # must never re-derive it).
        "hero": hero,
        "scope_qualifier": _corpus_qualifier,
        "trajectory_measures": {
            metric: {**meta, "basis": _BASIS_TOA, "edition": 2026}
            for metric, meta in _TRAJECTORY_METRIC_META.items()
        },
        # Data-derived ingested-service-org set (single source of truth for the
        # rollup-note wording — replaces a hardcoded A/N/F set in
        # program-tier.ts that lied for every defense-wide agency book).
        # Computed in export_site (Postgres scope) and threaded via manifest.
        "ingested_service_orgs": manifest.get("ingested_service_orgs", []),
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
        # The program-page universe (full-tier + rollup-tier sidecars) —
        # request_vs_actuals_gap cards link only where a page exists.
        page_pe_blis=all_pe_blis | set(rollup_pes),
        # P0-5: the feed's superlative claims carry the corpus scope
        # qualifier (same dynamic string as the hero).
        corpus_scope_qualifier=_corpus_qualifier,
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

    # ------------------------------------------------------------------ #
    # 17. years_matrix.json (Phase 5D Task 1 — /years/ grid)              #
    # ------------------------------------------------------------------ #
    _emit_years_matrix(
        json_dir=json_dir,
        con=con,
        all_prog_rows=all_prog_rows,
        detail_rows=detail_rows,
        bl_rows=bl_rows,
        cited_fact_ids=_cited_fact_ids,
        decade_grains=decade_grains,
        # program-lineage Task 8: sparse pe_bli→family_id map (from
        # _load_lineage_for_export above). Drives the /years/ family-thread
        # badge — a UI-only overlay, NOT a column / cell value / CSV field.
        families=_lin_families,
    )
    n_files += 1

    # ------------------------------------------------------------------ #
    # 18. breakdowns/{fact_id}.json (Phase 5D Task 3b — show-your-work)   #
    # ------------------------------------------------------------------ #
    n_files += _emit_breakdowns(
        json_dir=json_dir,
        con=con,
        citation_rows=citation_rows,
        bl_rows=bl_rows,
        detail_rows=detail_rows,
        decade_bl_rows=decade_bl_rows,
        decade_side_meta=decade_side_meta,
    )

    # ------------------------------------------------------------------ #
    # 19. flow_chart.json (Phase 5H — /flow/ flowdown, precomputed layout) #
    # ------------------------------------------------------------------ #
    if flow_payload is not None:
        from govbudget.flow_chart import PAYLOAD_BUDGET_BYTES

        flow_path = json_dir / "flow_chart.json"
        _write_json(flow_path, flow_payload)
        flow_size = flow_path.stat().st_size
        if flow_size > PAYLOAD_BUDGET_BYTES:
            print(
                f"flow_chart.json: {flow_size} bytes EXCEEDS the"
                f" {PAYLOAD_BUDGET_BYTES}-byte budget — aggregate more"
                f" (lower Other member caps / top-N)"
            )
        else:
            print(f"flow_chart.json: {flow_size} bytes"
                  f" (budget {PAYLOAD_BUDGET_BYTES})")
        n_files += 1
    else:
        print("flow_chart.json: NOT written (fct_flow_edges missing/empty)")

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


def _rva_gap_rows(con, cited_fact_ids: set) -> list[dict]:
    """All request-vs-actuals book-diff rows whose derived diff fact is
    minted AND cited, ranked by |delta| descending (Phase 5E Task 7).

    Scope advisory (Task 6 review, binding): the feed's "largest gaps" claim
    is scoped EXACTLY to diff_kind='request_vs_actuals' — the top-100 global
    rva diffs are all minted by _build_decade_citation_rows, so a ranked
    top-N (N ≤ 100) drawn from the CITED set is globally honest.
    request_vs_request diffs are NOT fully minted (dead PEs) and never
    surface here.
    """
    try:
        rows = con.execute(
            "select pe_bli, from_edition, to_edition, from_fy, delta"
            " from fct_book_diff"
            " where diff_kind = 'request_vs_actuals'"
            "   and delta is not null and delta <> 0"
            " order by abs(delta) desc, pe_bli, from_edition"
        ).fetchall()
    except Exception:
        return []
    out: list[dict] = []
    for pe_bli, from_ed, to_ed, from_fy, delta in rows:
        fid = fact_id_derived(
            "book_diff", f"{pe_bli}|{from_ed}|{to_ed}", "request_vs_actuals"
        )
        if fid not in cited_fact_ids:
            continue  # unminted/uncited diffs (out-of-scope PEs) never render
        out.append({
            "pe_bli": pe_bli,
            "from_edition": int(from_ed),
            "to_edition": int(to_ed),
            "fy": int(from_fy),  # rva compares the same FY on both sides
            "delta": float(delta),
            "fid": fid,
        })
    return out


def _rva_gap_index(con, cited_fact_ids: set) -> dict:
    """pe_bli → largest cited request-vs-actuals gap (Phase 5E Task 7).

    Feeds the program-page "asked vs spent" line: {kind, fy, from_edition,
    to_edition, delta, fid}. Side values/fids resolve client-side from the
    sidecar's decade_series (the same grains the diff fact cites as inputs).
    """
    index: dict[str, dict] = {}
    for g in _rva_gap_rows(con, cited_fact_ids):
        if g["pe_bli"] in index:
            continue  # rows arrive ranked by |delta| — first wins
        index[g["pe_bli"]] = {
            "kind": "request_vs_actuals",
            "fy": g["fy"],
            "from_edition": g["from_edition"],
            "to_edition": g["to_edition"],
            "delta": g["delta"],
            "fid": g["fid"],
            # PM Sprint 1 basis threading: both diff sides are workbook
            # grains (toa); the delta is a change measure published by the
            # later edition.
            "basis": _BASIS_TOA,
            "measure": "change",
            "edition": g["to_edition"],
        }
    return index


def _emit_feed_sidecar(
    *,
    json_dir: Path,
    con,
    prog_titles: dict,
    cited_fact_ids: set,
    page_pe_blis: set | None = None,
    corpus_scope_qualifier: str | None = None,
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

    Phase 5E Task 7 — request_vs_actuals_gap events: the top
    {_FEED_RVA_TOP} cited request-vs-actuals book diffs (what a PB(N) book
    asked for FY N vs what the PB(N+2) book reported actually spent),
    ranked by |delta|. Each card cites its minted book_diff derived fact
    (breakdown reachable through the citation panel) and links to the
    program page ONLY when page_pe_blis says the page exists (dead-link
    lesson — 3 top-100 rva PEs have no page).

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

        # PM Sprint 1 basis threading: budget-basis figures declare
        # (basis, fy, measure, edition); non-budget figures (HHI,
        # USAspending obligations, year labels) honestly carry nulls —
        # they have no toa/jbook-detail basis to claim.
        if event_type == "yoy_swing":
            figure_basis = {"basis": _BASIS_TOA, "fy": 2026,
                            "measure": "change", "edition": 2026}
        elif event_type == "zeroed_fy2026":
            figure_basis = {"basis": _BASIS_TOA, "fy": 2025,
                            "measure": "total", "edition": 2026}
        else:
            figure_basis = {"basis": None, "fy": None,
                            "measure": None, "edition": None}

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
            **figure_basis,
            # Resolved program title (null for family_key-based cards and
            # unresolvable pe_blis). The headline already leads with this
            # title — the field exists so the site can key on it without
            # re-parsing headline text.
            "title": program_title or None,
            "why_url": f"{_WHY_BASE}-{event_type}",
        }
        cards.append(card)

    # ---- request_vs_actuals_gap events (Phase 5E Task 7) -------------------
    # Appended AFTER the mart-driven cards, in |delta| rank order (the site
    # groups by event_type, so intra-section order is the ranking).
    pages = page_pe_blis or set()
    for g in _rva_gap_rows(con, cited_fact_ids)[:_FEED_RVA_TOP]:
        pe_bli = g["pe_bli"]
        program_title = prog_titles.get(pe_bli) or bl_titles.get(pe_bli, "")
        direction = "above" if g["delta"] > 0 else "below"
        headline_text = (
            f"{program_title or pe_bli} FY{g['fy']} actuals came in"
            f" {_fmt_thousands(abs(g['delta']))} {direction} the"
            f" PB{g['from_edition']} request (per the PB{g['to_edition']} book)"
        )
        cards.append({
            "event_type": "request_vs_actuals_gap",
            "family_key": None,
            "figure_fact_id": g["fid"],  # cited by construction (_rva_gap_rows)
            "figure_units": "thousands_usd",
            "figure_value": g["delta"],
            "fiscal_year": g["fy"],
            "headline": headline_text,
            "organization": None,
            "pe_bli": pe_bli,
            "program_url": f"/program/{pe_bli}/" if pe_bli in pages else None,
            # Both diff sides are workbook grains — toa change, published
            # by the later (to_) edition.
            "basis": _BASIS_TOA,
            "fy": g["fy"],
            "measure": "change",
            "edition": g["to_edition"],
            "title": program_title or None,
            "why_url": f"{_WHY_BASE}-request_vs_actuals_gap",
        })

    _write_json(json_dir / "feed.json", {
        "cards": cards,
        "total": len(cards),
        # P0-5: the feed's superlative framing ("largest gaps", "biggest
        # swings") is corpus-scoped — the qualifier travels with the payload.
        "scope_qualifier": corpus_scope_qualifier,
    })


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

    index.json: totals per district + dim_geography grand total. The grand
    total and the per-district linkable/cited sums carry derived-citation
    fact_ids (geography/district surfaces — see
    _build_geography_citation_rows), attached ONLY when the fact_id resolves
    in cited_fact_ids; otherwise null and the site renders honest state C.
    {pop_district}.json: per-district program list with cited dollars + counts
    + the district's aggregate fact_ids.

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

    # ---- dim_geography grand total ----
    # Same SQL as _build_geography_citation_rows' grand-total row so the
    # sidecar value and the citation's recorded_value agree by construction.
    try:
        geo_total_row = con.execute(
            "select sum(total_obligation) from dim_geography"
        ).fetchone()
        geo_grand_total = float(geo_total_row[0]) if geo_total_row and geo_total_row[0] else None
    except Exception:
        geo_grand_total = None

    geo_grand_total_fact_id = None
    if geo_grand_total is not None:
        _gt_fid = fact_id_derived("geography", "grand_total", "total_obligation")
        if _gt_fid in cited_fact_ids:
            geo_grand_total_fact_id = _gt_fid

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

    # ---- Attach district aggregate fact_ids (derived 'district' surface) ----
    # Only when the citation row actually resolves — otherwise null and the
    # site renders honest state C for that figure.
    for key, info in district_index.items():
        for metric, field in (
            ("total_linkable_dollars", "total_linkable_fact_id"),
            ("total_cited_dollars", "total_cited_fact_id"),
        ):
            fid = fact_id_derived("district", key, metric)
            info[field] = fid if fid in cited_fact_ids else None

    # ---- Write per-district files ----
    for key, programs in district_programs.items():
        info = district_index[key]
        obj = {
            "pop_district": info["pop_district"],
            "pop_state": info["pop_state"],
            "program_count": info["program_count"],
            "programs": programs,
            "total_cited_dollars": info["total_cited_dollars"],
            "total_cited_fact_id": info["total_cited_fact_id"],
            "total_linkable_dollars": info["total_linkable_dollars"],
            "total_linkable_fact_id": info["total_linkable_fact_id"],
        }
        _write_json(dist_dir / f"{key}.json", obj)
        n_written += 1

    # ---- Write index file ----
    index_records = sorted(district_index.values(), key=lambda x: (x["pop_state"], x["pop_district"]))
    index_obj = {
        "districts": index_records,
        "geo_grand_total": geo_grand_total,
        "geo_grand_total_dataset": "dim_geography",
        "geo_grand_total_fact_id": geo_grand_total_fact_id,
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


# ---------------------------------------------------------------------------
# Phase 5D: years matrix + sharded citation slices + derived breakdowns
# ---------------------------------------------------------------------------

# Size budget for years_matrix.json (fetched lazily by the /years/ client
# island). Phase 5E raised the 5D 900 KB budget to 2 MB raw (5E spec §6:
# the decade adds ~7 columns × existing rows, same lazy-fetch pattern).
# Phase 5G (Navy round) confirmed ~2 KB/program at 813 programs (~1.53 MB).
# Phase 5G (Army/AF/SF archive round) grew the detail-grade matrix to 1,741
# programs at ~1.6 KB/program → ~2.74 MB: the SAME per-program density, just
# more programs (Army 'A' + Air Force/Space Force 'F' J-book detail landed).
# Budget raised to 4 MB, which still catches a doubling from here (1,741 →
# ~2,540 programs) — a regression in the matrix design, not corpus growth.
# Loud guard — a payload over budget beyond linear program growth means the
# matrix design regressed, not that the budget should move.
_YEARS_MATRIX_MAX_BYTES = 4 * 1024 * 1024

# Decade column keys: fy + kind suffix ('fy2020a'). The (kind, fy) pair
# determines the edition uniquely by the year-shift rule (actuals for FY N
# come from PB(N+2), enacted from PB(N+1), request from PB(N)) — the
# per-column edition field in the payload header makes it explicit.
_DECADE_KIND_SUFFIX = {"actuals": "a", "enacted": "e", "request": "r"}
_DECADE_KIND_ORDER = {"actuals": 0, "enacted": 1, "request": 2}


def _decade_column_key(fy: int, kind: str) -> str:
    return f"fy{fy}{_DECADE_KIND_SUFFIX[kind]}"

# Canonical column order for the matrix (workbook amount_types). Types not
# present in the data are dropped; unknown new types are appended sorted.
_YEARS_AMOUNT_TYPE_ORDER = [
    "fy_2024_actuals",
    "fy_2025_enacted",
    "fy_2025_supplemental",
    "fy_2025_total",
    "fy_2026_disc_request",
    "fy_2026_reconciliation_request",
    "fy_2026_total",
]

# amount_type → fct_budget_trajectory metric (the derived-citation fallback
# for multi-line pivot cells — the cited, recompute-verified sum).
_YEARS_TRAJ_METRIC_BY_AT = {
    "fy_2024_actuals": "fy2024_actuals",
    "fy_2025_total": "fy2025_total",
    "fy_2026_total": "fy2026_total",
}

# Project sub-row year columns → jbook_details scenarios (spec §2:
# PriorYear=FY2024, CurrentYear=FY2025, BudgetYearOne=FY2026 request).
_YEARS_PROJECT_SCENARIOS = {
    "fy2024": "PriorYear",
    "fy2025": "CurrentYear",
    "fy2026": "BudgetYearOne",
}

# Default visible columns (spec §1: FY24A, FY25T, FY26T, Δ, %Δ).
_YEARS_DEFAULT_COLUMNS = [
    "fy_2024_actuals",
    "fy_2025_total",
    "fy_2026_total",
    "fy2526_change",
    "fy2526_pct_change",
]


def _emit_years_matrix(
    *,
    json_dir: Path,
    con,  # duckdb connection (read-only mart)
    all_prog_rows: list,
    detail_rows: list,
    bl_rows: list,
    cited_fact_ids: set,
    decade_grains: list | None = None,
    families: dict[str, int] | None = None,
) -> dict:
    """Emit json/years_matrix.json — the /years/ CapIQ-style grid payload.

    Nesting: orgs → programs → projects; every dollar cell is {"v", "fid"}.

    Cell contract (BINDING — mirrored by the G8 yearsmatrix gate and the
    /years/ client island; see tests/test_export_years_matrix.py):
      - exactly ONE cited budget_lines detail row for
        (pe_bli, workbook_org, amount_type) → v = amount_thousands,
        fid = the workbook fact_id (the direct receipt);
      - zero or >1 rows for a trajectory-covered amount_type → v = the
        fct_budget_trajectory value, fid = the derived trajectory fact_id
        (the cited, recompute-verified sum) — never a client-side sum;
      - otherwise the cell is ABSENT: missing renders "–", never 0, and no
        uncited sum is ever minted.
      - Δ cell 'fy2526_change' carries the derived trajectory change fid
        (only when fy25, fy26 and the citation all exist).
      - '%Δ' cell 'fy2526_pct_change' carries {"v"} with NO fid — it is a
        mart-computed presentation figure emitted only alongside a cited Δ.
      - project cells (fy2024/fy2025/fy2026 ← PriorYear/CurrentYear/
        BudgetYearOne): cited rows carry the jbook fact_id; uncited
        zero_amount rows carry xp (xml_path — Cite state B). Duplicate
        (project, scenario) rows resolve last-wins in detail_rows order,
        matching the program-page ProgramDetailsTable behavior.

    Phase 5E decade columns (additive — 5D consumers render unchanged):
      decade_grains rows are (pe_bli, fy, edition_year, amount_type_kind,
      amount_thousands, fid, amount_type) from fct_decade_series (fid minted by
      _build_decade_citation_rows: the workbook fact for single-source
      grains, the derived decade sum otherwise). Cited grains become
      program cells under keys 'fy{fy}{a|e|r}'; the payload header gains
      "decade_columns" [{key, fy, kind, edition}] (edition-honest rule:
      actuals FY N ← PB(N+2)) and "decade_default_columns" (spec §1:
      FY2015A…FY2024A + FY2025E + FY2026R). Grains absent from an edition
      simply have no cell — "–", never 0; uncited grains never render.
      The existing amount_types/default_columns lists are BYTE-STABLE:
      Task 7 adopts the decade keys, current clients ignore them.

    Returns the payload dict (also written to disk). Raises ValueError when
    the serialized payload exceeds _YEARS_MATRIX_MAX_BYTES.
    """
    from collections import defaultdict

    # program-lineage Task 8: sparse pe_bli→family_id overlay (UI-only badge).
    fam_map: dict[str, int] = families or {}

    # ---- trajectory index: (pe_bli, organization) → metrics dict ----------
    try:
        traj_rows = con.execute(
            "select pe_bli, organization, fy2024_actuals, fy2025_total,"
            " fy2026_total, fy2526_change, fy2526_pct_change"
            " from fct_budget_trajectory"
        ).fetchall()
    except Exception:
        traj_rows = []
    traj_index: dict[tuple, dict] = {}
    for r in traj_rows:
        traj_index[(r[0], r[1])] = {
            "fy2024_actuals": r[2],
            "fy2025_total": r[3],
            "fy2026_total": r[4],
            "fy2526_change": r[5],
            "fy2526_pct_change": r[6],
        }

    # ---- budget-line cell index: (pe_bli, org, amount_type) → [(fid, amt)] --
    # Detail rows only (title IS NOT NULL) — the rollup+detail dedup lesson:
    # stg_budget_lines carries R-1 rollup rows (title IS NULL) that would
    # double-count against the trajectory pivot.
    bl_cells: dict[tuple, list] = defaultdict(list)
    for r in bl_rows:
        (fid, _exhibit, _fy, _acct, _acct_title, org, _ba, _ba_title,
         pe_bli, title, amount_type, amount_thousands, _units,
         _sha, _sheet, _cells) = r
        if title is None or amount_thousands is None:
            continue
        bl_cells[(pe_bli, org, amount_type)].append((fid, amount_thousands))

    # ---- present amount_types, canonical order -----------------------------
    present_ats = {k[2] for k in bl_cells}
    amount_types = [at for at in _YEARS_AMOUNT_TYPE_ORDER if at in present_ats]
    amount_types += sorted(present_ats - set(_YEARS_AMOUNT_TYPE_ORDER))

    # ---- project sub-rows: pe_bli → project_number → row -------------------
    # detail_rows order is (sha256, pe_bli, scenario); last-wins per
    # (project, scenario) mirrors the program-page scenarioMap behavior.
    projects_by_pe: dict[str, dict] = defaultdict(dict)
    for r in detail_rows:
        (fid, pe_bli, project_number, project_title, scenario,
         amount_millions, _units, xml_path, _org, _fam,
         _fy, _sha, _resolution) = r
        if project_number is None:
            continue
        proj = projects_by_pe[pe_bli].setdefault(
            project_number, {"title": None, "scenarios": {}}
        )
        if project_title:
            proj["title"] = project_title
        proj["scenarios"][scenario] = (fid, amount_millions, xml_path)

    # ---- decade cells: pe_bli → {column_key: cell}; column key → meta ------
    decade_cells_by_pe: dict[str, dict] = defaultdict(dict)
    decade_col_meta: dict[str, dict] = {}
    for pe_bli, d_fy, d_edition, d_kind, d_amount, d_fid, _d_at in (decade_grains or []):
        key = _decade_column_key(d_fy, d_kind)
        meta = decade_col_meta.setdefault(
            key, {"key": key, "fy": d_fy, "kind": d_kind, "edition": d_edition}
        )
        if meta["edition"] != d_edition:
            raise ValueError(
                f"years_matrix decade column {key} maps to two editions"
                f" ({meta['edition']} and {d_edition}) — the year-shift rule"
                " makes (kind, fy) → edition unique; refusing to emit an"
                " ambiguous column"
            )
        # honesty: only cited grains become cells (missing renders '–')
        if d_fid is not None and d_fid in cited_fact_ids and d_amount is not None:
            decade_cells_by_pe[pe_bli][key] = {"v": d_amount, "fid": d_fid}

    def _program_cells(pe_bli: str, translated_org: str) -> dict:
        traj = traj_index.get((pe_bli, translated_org))
        cells: dict[str, dict] = {}
        for at in amount_types:
            entries = bl_cells.get((pe_bli, translated_org, at), [])
            if len(entries) == 1 and entries[0][0] in cited_fact_ids:
                fid, amt = entries[0]
                cells[at] = {"v": amt, "fid": fid}
                continue
            # zero or multiple lines → the cited trajectory sum, if any
            metric = _YEARS_TRAJ_METRIC_BY_AT.get(at)
            if metric and traj is not None and traj.get(metric) is not None:
                d_fid = fact_id_derived(
                    "trajectory", f"{pe_bli}|{translated_org}", metric
                )
                if d_fid in cited_fact_ids:
                    cells[at] = {"v": traj[metric], "fid": d_fid}
            # else: absent — honest "–", never an uncited sum

        # Δ / %Δ — mirrors _trajectory_fact_ids emission conditions
        if traj is not None:
            chg_fid = fact_id_derived(
                "trajectory", f"{pe_bli}|{translated_org}", "fy2526_change"
            )
            if (
                traj.get("fy2526_change") is not None
                and traj.get("fy2025_total") is not None
                and traj.get("fy2026_total") is not None
                and chg_fid in cited_fact_ids
            ):
                cells["fy2526_change"] = {
                    "v": traj["fy2526_change"], "fid": chg_fid,
                }
                if traj.get("fy2526_pct_change") is not None:
                    cells["fy2526_pct_change"] = {
                        "v": traj["fy2526_pct_change"],
                    }

        # decade columns (keys 'fy{fy}{a|e|r}' — disjoint from amount_type
        # slugs and Δ keys by format)
        cells.update(decade_cells_by_pe.get(pe_bli, {}))
        return cells

    def _project_rows(pe_bli: str) -> list[dict]:
        out = []
        for pn in sorted(projects_by_pe.get(pe_bli, {})):
            proj = projects_by_pe[pe_bli][pn]
            cells: dict[str, dict] = {}
            for ykey, scenario in _YEARS_PROJECT_SCENARIOS.items():
                row = proj["scenarios"].get(scenario)
                if row is None:
                    continue
                fid, amount_millions, xml_path = row
                if fid is not None and fid in cited_fact_ids:
                    cells[ykey] = {"v": amount_millions, "fid": fid}
                elif amount_millions is not None:
                    cell: dict = {"v": amount_millions, "fid": None}
                    if xml_path:
                        cell["xp"] = xml_path
                    cells[ykey] = cell
                # fid uncited AND amount None → absent (nothing to render)
            out.append({
                "project_number": pn,
                "title": proj["title"],
                "cells": cells,
            })
        return out

    # ---- org sections -------------------------------------------------------
    by_org: dict[str, list] = defaultdict(list)
    for r in all_prog_rows:
        pe_bli, org, _fam, title, _pc, _fy24m, _rec = r
        by_org[org].append((pe_bli, title))

    orgs_out = []
    for org in sorted(by_org):
        translated = _workbook_org(org)
        programs = []
        for pe_bli, title in sorted(by_org[org]):
            prog = {
                "pe_bli": pe_bli,
                "title": title,
                "cells": _program_cells(pe_bli, translated),
                "projects": _project_rows(pe_bli),
            }
            # program-lineage Task 8: sparse family_id overlay — present only
            # for PEs in a tracked lineage family (most are not). UI-only: the
            # /years/ client renders a per-row family-thread badge. Never a
            # column, cell data-v, or CSV field (yearsmatrix gate contract).
            if fam_map and pe_bli in fam_map:
                prog["family_id"] = fam_map[pe_bli]
            programs.append(prog)
        orgs_out.append({"org": org, "programs": programs})

    # Drop amount_types that produced NO cells across the whole program set
    # (e.g. fy_2025_supplemental: its only workbook rows belong to pe_blis
    # outside the page set) — an all-dash column is dead UI, not honesty.
    used_ats = {
        at
        for o in orgs_out
        for p in o["programs"]
        for at in p["cells"]
    }
    amount_types = [at for at in amount_types if at in used_ats]

    payload = {
        "schema_version": 1,
        "program_units": "USD thousands",
        "project_units": "USD millions",
        "amount_types": amount_types,
        "delta_columns": ["fy2526_change", "fy2526_pct_change"],
        "default_columns": [
            c for c in _YEARS_DEFAULT_COLUMNS
            if c in amount_types or c in ("fy2526_change", "fy2526_pct_change")
        ],
        "project_scenarios": dict(_YEARS_PROJECT_SCENARIOS),
        "orgs": orgs_out,
    }

    # ---- decade header (Phase 5E — only when decade grains were passed) ----
    if decade_grains:
        # columns with ≥1 emitted cell among matrix programs (a dead all-dash
        # column is dead UI, not honesty — same rule as used_ats above)
        used_decade = {
            key
            for o in orgs_out
            for p in o["programs"]
            for key in p["cells"]
            if key in decade_col_meta
        }
        decade_columns = sorted(
            (decade_col_meta[k] for k in used_decade),
            key=lambda c: (c["fy"], _DECADE_KIND_ORDER[c["kind"]]),
        )
        # Default set (spec §1): per-edition actuals FY(e-2)A, then the
        # latest edition's FY(L-1)E enacted + FY(L)R request ≈ 12 columns
        # with the full 2017–2026 run; filtered to emitted columns.
        editions = sorted({c["edition"] for c in decade_col_meta.values()})
        default_candidates = [
            _decade_column_key(e - 2, "actuals") for e in editions
        ]
        if editions:
            latest = editions[-1]
            default_candidates += [
                _decade_column_key(latest - 1, "enacted"),
                _decade_column_key(latest, "request"),
            ]
        payload["decade_columns"] = decade_columns
        payload["decade_default_columns"] = [
            k for k in default_candidates if k in used_decade
        ]

    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    if len(raw.encode("utf-8")) > _YEARS_MATRIX_MAX_BYTES:
        raise ValueError(
            f"years_matrix.json is {len(raw.encode('utf-8'))} bytes — over the"
            f" {_YEARS_MATRIX_MAX_BYTES}-byte budget (spec §3). The matrix"
            " design regressed; do not raise the budget."
        )
    _write_json(json_dir / "years_matrix.json", payload)
    return payload


def _emit_cite_shards(*, json_dir: Path, citations_dict: dict) -> int:
    """Emit json/cite-shards/{fact_id[:2]}.json — sharded citation slices.

    Covers ALL citations (shard union == citations.json keys) so any page can
    lazily resolve any fact_id: the citation panel's fetch-on-miss path loads
    fid[:2].json and finds the identical row it would have found embedded.
    The values are the SAME objects written to citations.json — one
    serializer, identical panel schema by construction.

    Returns the number of shard files written (≤256).
    """
    shard_dir = json_dir / "cite-shards"
    shard_dir.mkdir(exist_ok=True)

    shards: dict[str, dict] = {}
    for fid, obj in citations_dict.items():
        shards.setdefault(fid[:2], {})[fid] = obj

    for prefix in sorted(shards):
        _write_json(shard_dir / f"{prefix}.json", shards[prefix])
    return len(shards)


# Formula prefix marking the agency FY2024 sum — its inputs are workbook
# fact_ids in THOUSANDS while recorded_value is in MILLIONS, so the generic
# input-grain decomposition cannot hold; it gets a program-grain breakdown
# (dim_programs.fy2024_actual_millions rows, cited via the program's single
# PriorYear root jbook fact where one exists — the same citation the program
# page headline uses; multi-root or uncited programs appear as ⁂ rows).
_AGENCY_FY24_FORMULA_PREFIX = "sum(dim_programs.fy2024_actual_millions)"

_TRAJ_METRIC_LABELS = {
    "fy2024_actuals": "FY2024 actuals",
    "fy2025_total": "FY2025 total",
    "fy2026_total": "FY2026 total",
    "fy2526_change": "Δ FY25→26",
}

# Sum-decomposition tolerance (Decimal): recorded_value is canonically
# 3-decimal-rounded while row values keep full float precision.
_BREAKDOWN_SUM_TOL = "0.005"


def _emit_breakdowns(
    *,
    json_dir: Path,
    con,  # duckdb connection (read-only mart)
    citation_rows: list,
    bl_rows: list,
    detail_rows: list,
    decade_bl_rows: list | None = None,
    decade_side_meta: dict | None = None,
) -> int:
    """Emit json/breakdowns/{fact_id}.json — "show your work" tables (spec §3b).

    One file per SUM-DECOMPOSABLE derived fact with ≥2 fact_id inputs:
      {fact_id, op: 'sum'|'difference', units, formula, recorded_value,
       rows: [{label, pe_bli, v, fid} ...]}
    where sum(rows.v) == recorded_value canonically (difference facts negate
    the subtracted input's v and mark it "subtracted": true). Uncited rows
    (agency FY2024 programs without a cited jbook root) carry fid: null +
    "uncited": true so the table accounts for 100% of the sum honestly.

    NOT emitted (by design, documented in tests/test_export_breakdowns.py):
    crosswalk links (recorded_value is a confidence tier), URL/mixed-input
    facts, <2 inputs, and any row whose inputs do not actually sum to
    recorded_value (skipped LOUDLY — the 5B-1 derived gate owns that failure;
    a breakdown that does not sum must never ship).

    Phase 5E decade extension: decade_bl_rows (budget_lines_decade rows,
    same 16-tuple shape as bl_rows) resolve old-edition workbook inputs;
    decade_side_meta (fid → (label, pe_bli)) labels book-diff difference
    rows by side ("PB2024 FY2022 actuals") — both sides share the program,
    so the title alone cannot distinguish them.

    Returns the number of breakdown files written.
    """
    import json as _json
    import re as _re
    from decimal import Decimal as D

    breakdown_dir = json_dir / "breakdowns"
    breakdown_dir.mkdir(exist_ok=True)

    hex_re = _re.compile(r"^[0-9a-f]{16}$")

    # ---- lookup indexes ------------------------------------------------------
    # fid → recorded_value (derived/usaspending tiers)
    rv_by_fid: dict[str, str] = {}
    # fid → pe_bli (citation rows carry pe_bli at index 24)
    pe_by_fid: dict[str, str] = {}
    for row in citation_rows:
        fid = row[0]
        if row[23] is not None:
            rv_by_fid[fid] = row[23]
        if row[24]:
            pe_by_fid[fid] = row[24]

    # workbook fid → (amount_thousands, title, pe_bli); decade rows (old
    # editions) share the shape and extend the same lookup
    bl_by_fid: dict[str, tuple] = {}
    for r in bl_rows:
        bl_by_fid[r[0]] = (r[11], r[9], r[8])
    for r in (decade_bl_rows or []):
        bl_by_fid.setdefault(r[0], (r[11], r[9], r[8]))

    # dim_pe_titles (single deterministic title mart)
    try:
        titles: dict[str, str] = dict(
            con.execute("select pe_bli, title from dim_pe_titles").fetchall()
        )
    except Exception:
        titles = {}

    # trajectory reverse index: derived fid → (pe_bli, metric)
    traj_meta: dict[str, tuple] = {}
    try:
        traj_rows = con.execute(
            "select pe_bli, organization from fct_budget_trajectory"
        ).fetchall()
    except Exception:
        traj_rows = []
    for t_pe, t_org in traj_rows:
        for metric in _TRAJ_METRIC_LABELS:
            traj_meta[fact_id_derived("trajectory", f"{t_pe}|{t_org}", metric)] = (
                t_pe, metric,
            )

    # usaspending district-program reverse index: fid → (pe_bli, program_title)
    usas_meta: dict[str, tuple] = {}
    try:
        dp_rows = con.execute(
            "select pop_state, pop_district, pe_bli, program_title"
            " from fct_district_programs"
        ).fetchall()
    except Exception:
        dp_rows = []
    for pop_state, pop_district, dp_pe, dp_title in dp_rows:
        fid_us = fact_id_usaspending(
            "district_program", f"{pop_state}|{pop_district}|{dp_pe}",
            "total_obligation",
        )
        usas_meta[fid_us] = (dp_pe, dp_title)

    def _input_meta(fid: str, *, op: str) -> tuple:
        """(label, pe_bli) for an input fact_id."""
        if op == "difference" and decade_side_meta and fid in decade_side_meta:
            # book-diff rows: the side (edition + fy + kind) is the
            # distinguishing label — both sides share the program
            return decade_side_meta[fid]
        if fid in bl_by_fid:
            _amt, title, pe = bl_by_fid[fid]
            return (title or titles.get(pe) or pe, pe)
        if fid in traj_meta:
            pe, metric = traj_meta[fid]
            if op == "difference":
                # Δ rows: both inputs share the program — the metric is
                # the distinguishing label (FY2026 total − FY2025 total).
                return (_TRAJ_METRIC_LABELS[metric], pe)
            return (titles.get(pe) or pe, pe)
        if fid in usas_meta:
            pe, dp_title = usas_meta[fid]
            return (dp_title or titles.get(pe) or pe, pe)
        pe = pe_by_fid.get(fid)
        if pe:
            return (titles.get(pe) or pe, pe)
        return (None, None)

    def _input_value(fid: str):
        rv = rv_by_fid.get(fid)
        if rv is not None:
            try:
                return D(rv)
            except Exception:
                return None
        entry = bl_by_fid.get(fid)
        if entry is not None and entry[0] is not None:
            return D(str(entry[0]))
        return None

    tol = D(_BREAKDOWN_SUM_TOL)
    n_files = 0
    n_skipped_mismatch = 0

    # ---- agency FY2024 special case (program-grain, ⁂ rows) -----------------
    # detail_rows PriorYear roots: pe_bli → [(fid, amount_millions)]
    roots_by_pe: dict[str, list] = {}
    for r in detail_rows:
        (fid, pe_bli, project_number, _pt, scenario, amount_millions,
         *_rest) = r
        if project_number is None and scenario == "PriorYear":
            roots_by_pe.setdefault(pe_bli, []).append((fid, amount_millions))

    cited_fids = {row[0] for row in citation_rows}

    try:
        dim_prog_rows = con.execute(
            "select pe_bli, org, fy2024_actual_millions from dim_programs"
        ).fetchall()
    except Exception:
        dim_prog_rows = []

    agency_fy24_rows: dict[str, list] = {}
    for pe_bli, org, fy24_m in dim_prog_rows:
        if fy24_m is None:
            continue
        roots = roots_by_pe.get(pe_bli, [])
        cited_roots = [
            (f, a) for f, a in roots if f in cited_fids and a is not None
        ]
        row: dict = {
            "label": titles.get(pe_bli) or pe_bli,
            "pe_bli": pe_bli,
            "v": fy24_m,
        }
        # Cited only when a SINGLE cited root row carries the exact program
        # value — otherwise the row is honestly ⁂ (multi-root sums and
        # zero_amount roots have no single citation for this figure).
        if (
            len(roots) == 1
            and len(cited_roots) == 1
            and cited_roots[0][1] is not None
            and abs(D(str(cited_roots[0][1])) - D(str(fy24_m))) <= tol
        ):
            row["fid"] = cited_roots[0][0]
        else:
            row["fid"] = None
            row["uncited"] = True
        agency_fy24_rows.setdefault(org, []).append(row)

    handled_agency_fy24: set[str] = set()
    for row in citation_rows:
        fid, kind, units = row[0], row[1], row[2]
        formula, recorded = row[20], row[23]
        if kind != "derived" or not formula or recorded is None:
            continue
        if not formula.startswith(_AGENCY_FY24_FORMULA_PREFIX):
            continue
        # org from the formula: sum(...) for org='DARPA' (...)
        m = _re.search(r"for org='([^']*)'", formula) or _re.search(
            r'for org="([^"]*)"', formula
        )
        org = m.group(1) if m else None
        rows_out = agency_fy24_rows.get(org or "", [])
        if not rows_out:
            continue
        try:
            recorded_d = D(recorded)
        except Exception:
            continue
        total = sum((D(str(r_["v"])) for r_ in rows_out), D(0))
        if abs(total - recorded_d) > tol:
            n_skipped_mismatch += 1
            print(
                f"breakdowns: SKIP {fid} (agency fy2024 {org}) — program rows"
                f" sum {total} != recorded_value {recorded} (mismatch)"
            )
            continue
        _write_json(breakdown_dir / f"{fid}.json", {
            "fact_id": fid,
            "op": "sum",
            "units": units,
            "formula": formula,
            "recorded_value": recorded,
            "rows": rows_out,
        })
        handled_agency_fy24.add(fid)
        n_files += 1

    # ---- generic input-grain decompositions ---------------------------------
    for row in citation_rows:
        fid, kind, units = row[0], row[1], row[2]
        formula, inputs_raw, recorded = row[20], row[21], row[23]
        if kind != "derived" or not formula or recorded is None:
            continue
        if fid in handled_agency_fy24 or formula.startswith(
            _AGENCY_FY24_FORMULA_PREFIX
        ):
            continue
        if not inputs_raw:
            continue
        try:
            inputs = _json.loads(inputs_raw)
        except Exception:
            continue
        if (
            not isinstance(inputs, list)
            or len(inputs) < 2
            or not all(isinstance(x, str) and hex_re.match(x) for x in inputs)
        ):
            continue
        try:
            recorded_d = D(recorded)
        except Exception:
            continue  # non-numeric recorded_value (crosswalk confidence tier)

        values = [_input_value(f) for f in inputs]
        if any(v is None for v in values):
            continue  # unresolvable input — the 5B-1 derived gate owns this

        is_difference = " - " in formula and len(inputs) == 2
        op = "difference" if is_difference else "sum"

        rows_out = []
        if is_difference:
            computed = values[0] - values[1]
        else:
            computed = sum(values, D(0))
        if abs(computed - recorded_d) > tol:
            n_skipped_mismatch += 1
            print(
                f"breakdowns: SKIP {fid} — {op} of {len(inputs)} inputs"
                f" = {computed} != recorded_value {recorded} (mismatch)"
            )
            continue

        for i, (inp_fid, val) in enumerate(zip(inputs, values)):
            label, pe = _input_meta(inp_fid, op=op)
            r_out: dict = {"label": label, "pe_bli": pe}
            if is_difference and i == 1:
                r_out["v"] = float(-val)
                r_out["fid"] = inp_fid
                r_out["subtracted"] = True
            else:
                r_out["v"] = float(val)
                r_out["fid"] = inp_fid
            rows_out.append(r_out)

        _write_json(breakdown_dir / f"{fid}.json", {
            "fact_id": fid,
            "op": op,
            "units": units,
            "formula": formula,
            "recorded_value": recorded,
            "rows": rows_out,
        })
        n_files += 1

    if n_skipped_mismatch:
        print(
            f"breakdowns: {n_skipped_mismatch} derived fact(s) skipped on"
            " sum mismatch — investigate via verify-phase5b1 derived gate"
        )
    print(f"breakdowns: {n_files} files → json/breakdowns/")
    return n_files


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
