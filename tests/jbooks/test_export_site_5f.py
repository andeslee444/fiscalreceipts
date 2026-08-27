"""Phase 5F exporter tests.

§2a — program_details sidecars for EVERY distinct PE in budget_lines:
      full tier (dim_programs / programs.json members, shape unchanged) vs
      rollup tier (explicit tier + service_org + title + trajectory).
§2b — jbook_narrative citations gain page + bbox where the narrative
      provenance builder located the paragraph opening; unresolved keep the
      current pageless shape (ambiguity flag preserved).
§2c — deterministic prose-amount links: a dollar token in a narrative body
      links to a fact ONLY when it exactly matches (canonical dollars) exactly
      one fact scoped to the same PE and that fact is cited. Ambiguous /
      unitless / uncited tokens stay plain prose.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import duckdb
import psycopg

from jbooks.test_export_site_pg import (
    FIXTURE_PDF,
    _make_test_duckdb,
    _seed_budget_line,
    _seed_jbook_doc,
)
from pdf_factory import make_pdf

from govbudget.export_site import export_site, fact_id_jbook, fact_id_narrative
from govbudget.jbooks.provenance_pages import (
    build_narrative_provenance,
    build_provenance_pages,
)

_PE = "0602222A"
_XML_PATH = "ProgramElement[0]/Narrative[0]"
_SOURCE_URL = "https://example.mil/synth-narr.pdf"

_BODY = (
    "The Corrosion Prevention program develops coatings that reduce maintenance"
    " costs across weapon systems. The FY 2025 request of $15.750 million"
    " supports continued development."
)


def _make_synth_pdf(path: Path) -> None:
    """One R-2 page carrying the PE anchor, the narrative opening (split
    across two lines) and the detail amount 15.750 as a standalone word."""
    make_pdf(path, [[
        "Exhibit R-2, RDT&E Budget Item Justification",
        f"PE {_PE} / SYNTHETIC PROGRAM",
        "A. Mission Description and Budget Item Justification",
        "The Corrosion Prevention program develops coatings that reduce",
        "maintenance costs across weapon systems.",
        "FY 2025: 15.750",
    ]])


def _seed_synth_doc(pg_dsn: str, tmp_path: Path, *, body: str = _BODY,
                    detail_amounts: tuple = ()) -> str:
    """Seed a synthetic jbook doc with one narrative and optional details.

    detail_amounts: (scenario, amount) pairs inserted as budget_line_details.
    Returns the document sha256. (Callers needing the PE inside the sidecar
    universe also seed a budget_lines row via _seed_rollup_budget_line.)
    """
    pdf = tmp_path / "synth_narr.pdf"
    _make_synth_pdf(pdf)
    sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('OSD','rdte',2026,'synth-narr.pdf',%s,%s,%s, now(),'downloaded')"
            " on conflict (source_url) do nothing",
            (_SOURCE_URL, str(pdf), sha),
        )
        doc_id = con.execute(
            "select id from jbook_documents where sha256 = %s", (sha,)
        ).fetchone()[0]
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 1, '{}')",
            (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        con.execute(
            "insert into detail_narratives (extraction_run_id, document_id,"
            " pe_bli, kind, title, body, xml_path)"
            " values (%s,%s,%s,'mission','A. Mission Description',%s,%s)",
            (run_id, doc_id, _PE, body, _XML_PATH),
        )
        for scenario, amount in detail_amounts:
            con.execute(
                "insert into budget_line_details (extraction_run_id, document_id,"
                " pe_bli, scenario, amount_millions, xml_path) values"
                " (%s,%s,%s,%s,%s,'ProgramElement[0]')",
                (run_id, doc_id, _PE, scenario, amount),
            )
    return sha


def _doc_id(pg_dsn: str, sha: str) -> int:
    with psycopg.connect(pg_dsn) as con:
        return con.execute(
            "select id from jbook_documents where sha256 = %s", (sha,)
        ).fetchone()[0]


def _narr_citation_row(site: Path, fid: str) -> dict:
    cit_pq = site / "citations" / "citations.parquet"
    con = duckdb.connect()
    try:
        cols = [d[0] for d in con.execute(
            f"describe select * from read_parquet('{cit_pq}')").fetchall()]
        row = con.execute(
            f"select * from read_parquet('{cit_pq}')"
            " where kind = 'jbook_narrative' and fact_id = ?", [fid],
        ).fetchone()
    finally:
        con.close()
    assert row is not None, f"jbook_narrative citation {fid} missing"
    return dict(zip(cols, row))


def _export(pg_dsn: str, tmp_path: Path, *, extend_duckdb=None) -> Path:
    db = tmp_path / "wh.duckdb"
    _make_test_duckdb(db)
    if extend_duckdb is not None:
        con = duckdb.connect(str(db))
        try:
            extend_duckdb(con)
        finally:
            con.close()
    site = tmp_path / "site"
    export_site(pg_dsn, db, out_dir=site, pdf_base_url="https://cdn.example/pdfs")
    return site


# ---------------------------------------------------------------------------
# §2b — narrative citations gain page + bbox
# ---------------------------------------------------------------------------


def test_narrative_citation_gains_page_bbox(pg_dsn, tmp_path):
    sha = _seed_synth_doc(pg_dsn, tmp_path)
    assert build_narrative_provenance(pg_dsn) == 1
    site = _export(pg_dsn, tmp_path)

    fid = fact_id_narrative(sha, _PE, "mission", _XML_PATH)
    row = _narr_citation_row(site, fid)
    assert row["page_number"] == 1
    assert row["resolution"] == "unique"
    assert row["x0"] is not None and row["x1"] is not None
    assert row["top_pt"] is not None and row["bottom_pt"] is not None
    assert row["page_width"] is not None and row["page_height"] is not None
    assert row["hosted_pdf_url"] == f"https://cdn.example/pdfs/{sha}.pdf#page=1"
    assert row["official_url"] == f"{_SOURCE_URL}#page=1"
    assert row["xml_path"] == _XML_PATH          # locator survives


def test_narrative_citation_without_provenance_stays_pageless(pg_dsn, tmp_path):
    """No narrative provenance row → the citation keeps the pre-5F shape
    (no page, no bbox, no resolution) — the ambiguity flag, not a fake."""
    sha = _seed_synth_doc(pg_dsn, tmp_path)
    site = _export(pg_dsn, tmp_path)

    fid = fact_id_narrative(sha, _PE, "mission", _XML_PATH)
    row = _narr_citation_row(site, fid)
    assert row["page_number"] is None
    assert row["resolution"] is None
    assert row["x0"] is None
    assert row["hosted_pdf_url"] is None
    assert row["official_url"] == _SOURCE_URL    # no #page anchor minted


def test_unresolved_narrative_provenance_stays_pageless(pg_dsn, tmp_path):
    """An 'unresolved' narrative provenance row must NOT page the citation."""
    sha = _seed_synth_doc(
        pg_dsn, tmp_path,
        body="Opening words that never appear anywhere in the rendered"
             " synthetic document pages at all",
    )
    assert build_narrative_provenance(pg_dsn) == 1
    site = _export(pg_dsn, tmp_path)

    fid = fact_id_narrative(sha, _PE, "mission", _XML_PATH)
    row = _narr_citation_row(site, fid)
    assert row["page_number"] is None
    assert row["resolution"] is None
    assert row["hosted_pdf_url"] is None


def test_narrative_provenance_rows_do_not_leak_into_amount_citations(
        pg_dsn, tmp_path):
    """REGRESSION: with BOTH kinds of provenance rows in the table and detail
    facts present (so the jbook_pdf citation pass runs), narrative rows
    (NULL scenario / amount_millions) must not enter the amount citation
    loop — pre-fix this crashed fact_id_jbook with 'amount is None'."""
    sha = _seed_synth_doc(pg_dsn, tmp_path,
                          detail_amounts=(("CurrentYear", "15.750"),))
    assert build_provenance_pages(pg_dsn) >= 1
    assert build_narrative_provenance(pg_dsn) == 1
    site = _export(pg_dsn, tmp_path)

    cit_pq = site / "citations" / "citations.parquet"
    con = duckdb.connect()
    try:
        pdf_rows = con.execute(
            f"select fact_id, amount_text from read_parquet('{cit_pq}')"
            " where kind = 'jbook_pdf'"
        ).fetchall()
    finally:
        con.close()
    detail_fid = fact_id_jbook(sha, _PE, None, "CurrentYear", "15.750")
    assert [r[0] for r in pdf_rows] == [detail_fid]
    assert all(r[1] is not None for r in pdf_rows)
    # and the narrative citation still gets its page via the 4h pass
    narr_fid = fact_id_narrative(sha, _PE, "mission", _XML_PATH)
    assert _narr_citation_row(site, narr_fid)["page_number"] == 1


# ---------------------------------------------------------------------------
# §2a — sidecars for every distinct PE in budget_lines, tiered
# ---------------------------------------------------------------------------


def _seed_rollup_budget_line(pg_dsn: str, doc_id: int, *, pe_bli: str = _PE,
                             org: str = "A") -> None:
    """A budget_lines row for a PE that is NOT in dim_programs."""
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            """
            insert into budget_lines
              (exhibit, fiscal_year, account, account_title, organization,
               budget_activity, budget_activity_title, pe_bli, title,
               amount_type, amount_thousands, source_document_id,
               source_sheet, source_cells)
            values
              ('R-1', 2026, '2040', 'RDT&E Army', %s,
               '02', 'Applied Research', %s, 'ARMY TEST PROGRAM',
               'fy_2024_actuals', 1000, %s, 'Exhibit R-1', ARRAY['J9'])
            on conflict (exhibit, fiscal_year, account, organization,
                         budget_activity, pe_bli, amount_type)
            do update set amount_thousands = excluded.amount_thousands
            """,
            (org, pe_bli, doc_id),
        )


def _rollup_marts(con) -> None:
    con.execute("create table dim_pe_titles (pe_bli varchar, title varchar)")
    con.execute(
        "insert into dim_pe_titles values"
        " ('0601101E','Defense Research Sciences'),"
        f" ('{_PE}','Army Test Program')"
    )
    con.execute(
        f"insert into fct_budget_trajectory values"
        f" ('{_PE}','A',1000.0,2000.0,3000.0,1000.0,50.0)"
    )
    # fct_program_trajectory — the PROGRAM grain (backlog #37). Rebuilt after
    # the extra component row above, exactly as
    # dbt/models/marts/fct_program_trajectory.sql builds it.
    con.execute(
        "create or replace table fct_program_trajectory as"
        " with c as (select pe_bli, count(*) as n_org_components,"
        "   sum(fy2024_actuals) as fy2024_actuals,"
        "   sum(fy2025_total) as fy2025_total,"
        "   sum(fy2026_total) as fy2026_total"
        "  from fct_budget_trajectory group by pe_bli)"
        " select pe_bli, n_org_components, fy2024_actuals, fy2025_total,"
        "  fy2026_total, (fy2026_total - fy2025_total) as fy2526_change,"
        "  case when fy2025_total is null or fy2025_total = 0 then null"
        "   else round(100.0 * (fy2026_total - fy2025_total) / fy2025_total, 2)"
        "  end as fy2526_pct_change from c"
    )


def test_sidecar_for_every_budget_lines_pe(pg_dsn, tmp_path):
    """Sidecar count == distinct PE count in budget_lines.parquet; PEs outside
    programs.json get rollup-tier sidecars."""
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)                  # 0601101E (full)
    _seed_rollup_budget_line(pg_dsn, doc_id)                # 0602222A (rollup)
    build_provenance_pages(pg_dsn)
    site = _export(pg_dsn, tmp_path, extend_duckdb=_rollup_marts)

    bl_pq = site / "data" / "budget_lines.parquet"
    distinct_pes = {
        r[0] for r in duckdb.sql(
            f"select distinct pe_bli from read_parquet('{bl_pq}')").fetchall()
    }
    files = {p.stem for p in (site / "json" / "program_details").glob("*.json")}
    assert distinct_pes <= files, f"missing sidecars: {distinct_pes - files}"
    # every distinct budget_lines PE + every programs.json PE — nothing else
    progs = json.loads((site / "json" / "programs.json").read_text())
    assert files == distinct_pes | {p["pe_bli"] for p in progs}
    assert _PE in files


def test_rollup_sidecar_carries_tier_service_title_trajectory(pg_dsn, tmp_path):
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)
    _seed_rollup_budget_line(pg_dsn, doc_id)
    build_provenance_pages(pg_dsn)
    site = _export(pg_dsn, tmp_path, extend_duckdb=_rollup_marts)

    rollup = json.loads(
        (site / "json" / "program_details" / f"{_PE}.json").read_text())
    assert rollup["tier"] == "rollup"
    assert rollup["service_org"] == "A"
    assert rollup["title"] == "Army Test Program"
    # backlog #37: the PROGRAM's trajectory, and it says how many
    # organisation components it was summed from.
    assert rollup["trajectory"] == {
        "n_org_components": 1,
        "fy2024_actuals": 1000.0, "fy2025_total": 2000.0,
        "fy2026_total": 3000.0, "fy2526_change": 1000.0,
        "fy2526_pct_change": 50.0,
    }
    # derived trajectory citations are emitted for every mart row — the fids
    # must resolve (Cite state A on the rollup page)
    fids = rollup["trajectory_fact_ids"]
    assert fids["fy2024_actuals"] is not None
    assert fids["fy2526_change"] is not None
    # R-1 numbers present; no J-book detail behind this page
    assert len(rollup["budget_lines"]) == 1
    assert rollup["details"] == []
    assert rollup["narratives"] == []
    # rollup pages are NOT in programs.json (no /program page in this batch)
    progs = json.loads((site / "json" / "programs.json").read_text())
    assert _PE not in {p["pe_bli"] for p in progs}


def test_rollup_sidecar_without_trajectory_is_honest(pg_dsn, tmp_path):
    """A rollup PE with no fct_budget_trajectory row keeps trajectory null —
    never an invented figure. service_org falls back to the budget_lines org."""
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)
    _seed_rollup_budget_line(pg_dsn, doc_id, pe_bli="0603333N", org="N")
    build_provenance_pages(pg_dsn)
    site = _export(pg_dsn, tmp_path)   # no dim_pe_titles, no traj row

    rollup = json.loads(
        (site / "json" / "program_details" / "0603333N.json").read_text())
    assert rollup["tier"] == "rollup"
    assert rollup["service_org"] == "N"
    assert rollup["title"] is None       # dim_pe_titles unavailable → honest null
    assert rollup["trajectory"] is None
    assert rollup["trajectory_fact_ids"] is None


def test_full_tier_sidecar_shape_unchanged(pg_dsn, tmp_path):
    """Existing (programs.json) sidecars keep their exact pre-5F key set —
    byte-stability of the 462 depends on it. (PM Sprint 1 adds exactly ONE
    key: the union `summary` block — every full-tier sidecar carries it.)

    ROADMAP #32(a) adds `fy2026_absent`, and it is CONDITIONAL: present only
    where the PB2026 workbook carries FY2024/FY2025 money and no FY2026 row.
    So the shape assertion is split — the unconditional keys are still pinned
    exactly, and the conditional one is pinned to its predicate rather than
    waved through as "an extra key we now allow". This fixture's line is one
    of the qualifying ones, which is why it appears here at all.
    """
    doc_id, sha = _seed_jbook_doc(pg_dsn, pdf_path=FIXTURE_PDF)
    _seed_budget_line(pg_dsn, doc_id, sha)
    _seed_rollup_budget_line(pg_dsn, doc_id)
    build_provenance_pages(pg_dsn)
    site = _export(pg_dsn, tmp_path, extend_duckdb=_rollup_marts)

    full = json.loads(
        (site / "json" / "program_details" / "0601101E.json").read_text())
    always = {
        "awards", "budget_lines", "details", "mentions", "narratives",
        "summary",
    }
    assert set(full.keys()) - {"fy2026_absent"} == always

    funded = {
        bl["fy"] for bl in full["budget_lines"]
        if (bl.get("amount_thousands") or 0) > 0
    }
    qualifies = bool(funded & {2024, 2025}) and not any(
        bl["fy"] == 2026 for bl in full["budget_lines"]
    )
    assert ("fy2026_absent" in full) is qualifies
    if qualifies:
        assert full["fy2026_absent"] == {"last_fy": max(funded & {2024, 2025})}


# ---------------------------------------------------------------------------
# §2c — deterministic prose-amount links
# ---------------------------------------------------------------------------


def test_amount_links_single_exact_match(pg_dsn, tmp_path):
    """'$15.750 million' in prose matches exactly one cited detail fact of the
    same PE → state-A link with that fact_id and body offsets."""
    sha = _seed_synth_doc(pg_dsn, tmp_path,
                          detail_amounts=(("CurrentYear", "15.750"),))
    _seed_rollup_budget_line(pg_dsn, _doc_id(pg_dsn, sha))
    build_provenance_pages(pg_dsn)      # detail resolves on the synth page
    site = _export(pg_dsn, tmp_path)

    det = json.loads(
        (site / "json" / "program_details" / f"{_PE}.json").read_text())
    narr = det["narratives"][0]
    expected_fid = fact_id_jbook(sha, _PE, None, "CurrentYear", "15.750")
    token = "$15.750 million"
    start = _BODY.index(token)
    assert narr["amount_links"] == [{
        "end": start + len(token),
        "fact_id": expected_fid,
        "start": start,
        "token": token,
    }]


def test_amount_links_ambiguous_token_gets_no_link(pg_dsn, tmp_path):
    """NEGATIVE: the same canonical dollar value behind TWO facts of the PE
    (two scenarios, both cited) → the token stays plain prose."""
    sha = _seed_synth_doc(pg_dsn, tmp_path,
                          detail_amounts=(("CurrentYear", "15.750"),
                                          ("BudgetYearOne", "15.750")))
    _seed_rollup_budget_line(pg_dsn, _doc_id(pg_dsn, sha))
    build_provenance_pages(pg_dsn)
    site = _export(pg_dsn, tmp_path)

    det = json.loads(
        (site / "json" / "program_details" / f"{_PE}.json").read_text())
    narr = det["narratives"][0]
    assert "amount_links" not in narr


def test_amount_links_unitless_token_gets_no_link(pg_dsn, tmp_path):
    """NEGATIVE: '$15.750' with no unit word is not canonicalizable — no
    guessing, no link."""
    sha = _seed_synth_doc(
        pg_dsn, tmp_path,
        body="The Corrosion Prevention program develops coatings that reduce"
             " maintenance costs across weapon systems. The request of $15.750"
             " supports continued development.",
        detail_amounts=(("CurrentYear", "15.750"),),
    )
    _seed_rollup_budget_line(pg_dsn, _doc_id(pg_dsn, sha))
    build_provenance_pages(pg_dsn)
    site = _export(pg_dsn, tmp_path)

    det = json.loads(
        (site / "json" / "program_details" / f"{_PE}.json").read_text())
    assert "amount_links" not in det["narratives"][0]


def test_amount_links_uncited_fact_gets_no_link(pg_dsn, tmp_path):
    """NEGATIVE: a token matching exactly one fact whose citation does NOT
    exist (amount never resolved on a page) must not mint a dangling
    data-fact-id."""
    sha = _seed_synth_doc(pg_dsn, tmp_path,
                          body="The FY 2025 request of $99.999 million supports"
                               " continued development of the program.",
                          detail_amounts=(("CurrentYear", "99.999"),))
    _seed_rollup_budget_line(pg_dsn, _doc_id(pg_dsn, sha))
    build_provenance_pages(pg_dsn)      # 99.999 is NOT on the page → unresolved
    site = _export(pg_dsn, tmp_path)

    det = json.loads(
        (site / "json" / "program_details" / f"{_PE}.json").read_text())
    assert "amount_links" not in det["narratives"][0]
