import hashlib
from decimal import Decimal
from pathlib import Path

import psycopg

import govbudget.jbooks.provenance_pages as _pp_mod
from govbudget.jbooks.provenance_pages import (
    _page_exhibit,
    _project_pattern,
    _source_exhibit,
    amount_strings,
    build_provenance_pages,
    find_fact_page,
)

from pdf_factory import make_pdf as _make_pdf

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_p24_25.pdf"


def test_amount_strings():
    assert amount_strings(Decimal("280.494")) == ["280.494"]
    assert amount_strings(Decimal("1234.5")) == ["1,234.500", "1234.500"]
    assert amount_strings(Decimal("-1.2")) == ["-1.200"]


def test_find_fact_page_resolves_with_anchor():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("280.494"))
    assert hit["page_number"] == 1                  # 1-based within the excerpt
    assert hit["resolution"] == "ambiguous_first"   # both pages carry anchor+amount
    assert hit["candidate_pages"] == 2
    assert 200 < hit["x0"] < 300 and 150 < hit["top_pt"] < 175


def test_find_fact_page_word_boundary():
    """'280.494' must NOT match inside '1,280.494'-style strings; the prefilter
    is regex word-boundary, not substring. Probe with an amount absent from the
    fixture but whose digits appear as a substring of present numbers."""
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("80.494"))
    assert hit["resolution"] == "unresolved"        # '80.494' only occurs inside '280.494'


def test_find_fact_page_zero_amount_policy():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("0"))
    assert hit["resolution"] == "zero_amount"
    assert hit["page_number"] is None


def test_find_fact_page_unresolved():
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("999999.999"))
    assert hit["page_number"] is None
    assert hit["resolution"] == "unresolved"


def test_find_fact_page_nan_amount():
    """Decimal('NaN') must not crash the f-string formatter — return unresolved."""
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("NaN"))
    assert hit["resolution"] == "unresolved"
    assert hit["page_number"] is None


# ---------------------------------------------------------------------------
# Exhibit-aware tie-breaking (5B backlog #3)
# ---------------------------------------------------------------------------


def test_page_exhibit_marker_detection():
    assert _page_exhibit("Exhibit R-2A, RDT&E Project Justification") == "R-2A"
    assert _page_exhibit("Exhibit R-2, RDT&E Budget Item Justification") == "R-2"
    assert _page_exhibit("Exhibit P-40, Budget Line Item Justification") == "P-40"
    assert _page_exhibit("Exhibit P-40A, Budget Item Justification") == "P-40A"
    assert _page_exhibit("Table of Contents") is None


def test_source_exhibit_mapping():
    assert _source_exhibit("rdte", None) == "R-2"
    assert _source_exhibit("rdte", "RD") == "R-2A"
    assert _source_exhibit("procurement", None) == "P-40"
    assert _source_exhibit("rollup", None) is None
    assert _source_exhibit(None, "RD") is None


def test_project_pattern_standalone_token_only():
    pat = _project_pattern("RD")
    assert pat.search("Project (Number/Name) RD / Advanced Research")
    assert not pat.search("BOARD")
    assert not pat.search("RD1 something")


def test_exhibit_preference_detail_beats_summary(tmp_path):
    """Amount on both an R-1 summary page and the R-2 detail page: the R-2
    page must win with resolution 'unique' (uniquely determined), and
    candidate_pages must keep the honest raw count of 2."""
    pdf = tmp_path / "two_exhibits.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-1, RDT&E Program", "0601101E 280.494"],
        ["Exhibit R-2, RDT&E Budget Item Justification",
         "PE 0601101E / DEFENSE RESEARCH SCIENCES", "280.494"],
    ])
    hit = find_fact_page(pdf, pe_bli="0601101E", amount=Decimal("280.494"),
                         exhibit_family="rdte")
    assert hit["page_number"] == 2
    assert hit["resolution"] == "unique"
    assert hit["candidate_pages"] == 2


def test_project_fact_prefers_r2a_page_with_project_number(tmp_path):
    """Project-level RDT&E fact: R-2A pages beat the R-2 cost table, and
    among R-2A pages the one carrying the project number wins."""
    pdf = tmp_path / "r2a_projects.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-2, RDT&E Budget Item Justification",
         "PE 0601101E", "P1 12.345", "P2 99.999"],
        ["Exhibit R-2A, RDT&E Project Justification",
         "PE 0601101E", "Project (Number/Name) P2", "12.345"],
        ["Exhibit R-2A, RDT&E Project Justification",
         "PE 0601101E", "Project (Number/Name) P1", "12.345"],
    ])
    hit = find_fact_page(pdf, pe_bli="0601101E", amount=Decimal("12.345"),
                         project_number="P1", exhibit_family="rdte")
    assert hit["page_number"] == 3
    assert hit["resolution"] == "unique"
    assert hit["candidate_pages"] == 3


def test_procurement_fact_prefers_p40_over_p1(tmp_path):
    pdf = tmp_path / "proc.pdf"
    _make_pdf(pdf, [
        ["Exhibit P-1, Procurement Program", "1108MQ9 330.083"],
        ["Exhibit P-40, Budget Line Item Justification",
         "LI 1108MQ9 - MQ-9 UNMANNED AERIAL VEHICLE", "330.083"],
    ])
    hit = find_fact_page(pdf, pe_bli="1108MQ9", amount=Decimal("330.083"),
                         exhibit_family="procurement")
    assert hit["page_number"] == 2
    assert hit["resolution"] == "unique"
    assert hit["candidate_pages"] == 2


def test_same_exhibit_pages_stay_ambiguous(tmp_path):
    """Two pages of the SAME source exhibit both carrying the amount are
    genuinely unresolvable — the ambiguity flag must be KEPT."""
    pdf = tmp_path / "same_exhibit.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-2, RDT&E Budget Item Justification",
         "PE 0601101E", "280.494"],
        ["Exhibit R-2, RDT&E Budget Item Justification",
         "PE 0601101E", "Program Change Summary 280.494"],
    ])
    hit = find_fact_page(pdf, pe_bli="0601101E", amount=Decimal("280.494"),
                         exhibit_family="rdte")
    assert hit["resolution"] == "ambiguous_first"
    assert hit["page_number"] == 1          # deterministic: first preferred page
    assert hit["candidate_pages"] == 2


def test_real_fixture_stays_ambiguous_with_exhibit_family():
    """The real DARPA excerpt has the amount on two R-2 pages — tie-breaking
    must not fake certainty there even when exhibit_family is supplied."""
    hit = find_fact_page(FIXTURE, pe_bli="0601101E", amount=Decimal("280.494"),
                         exhibit_family="rdte")
    assert hit["resolution"] == "ambiguous_first"
    assert hit["page_number"] == 1
    assert hit["candidate_pages"] == 2


def test_word_match_fallback_never_fakes_unique(tmp_path):
    """The preferred R-2 page passes the text prefilter but its amount is not
    an exact standalone word ('280.494X'); the word match falls back to the
    R-1 page — resolution must stay 'ambiguous_first', never 'unique'."""
    pdf = tmp_path / "fallback.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-1, RDT&E Program", "0601101E 280.494"],
        ["Exhibit R-2, RDT&E Budget Item Justification",
         "PE 0601101E", "280.494X"],
    ])
    hit = find_fact_page(pdf, pe_bli="0601101E", amount=Decimal("280.494"),
                         exhibit_family="rdte")
    assert hit["page_number"] == 1
    assert hit["resolution"] == "ambiguous_first"


def test_exhibit_filter_falls_back_when_no_page_matches(tmp_path):
    """If no candidate page carries the source-exhibit marker, the filter is
    skipped (previous behavior preserved: first candidate wins, ambiguous)."""
    pdf = tmp_path / "no_marker.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-1, RDT&E Program", "0601101E 280.494"],
        ["Exhibit R-1, RDT&E Program continued", "0601101E 280.494"],
    ])
    hit = find_fact_page(pdf, pe_bli="0601101E", amount=Decimal("280.494"),
                         exhibit_family="rdte")
    assert hit["page_number"] == 1
    assert hit["resolution"] == "ambiguous_first"
    assert hit["candidate_pages"] == 2


def _seed_fact(pg_dsn, amount="280.494"):
    sha = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('DARPA','rdte',2026,'excerpt.pdf','https://example.mil/x.pdf',%s,%s,"
            " now(),'downloaded') on conflict (source_url) do nothing",
            (str(FIXTURE), sha),
        )
        doc_id = con.execute("select id from jbook_documents").fetchone()[0]
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 1, '{}')",
            (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path) values"
            " (%s,%s,'0601101E','PriorYear',%s,'ProgramElement[0]')",
            (run_id, doc_id, amount),
        )


def test_build_provenance_pages_passes_exhibit_family(pg_dsn, tmp_path):
    """End-to-end: the builder must feed j.exhibit_family + d.project_number
    into the resolver — an R-1/R-2 doc resolves 'unique' to the R-2 page."""
    pdf = tmp_path / "synthetic_rdte.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-1, RDT&E Program", "0601101E 280.494"],
        ["Exhibit R-2, RDT&E Budget Item Justification",
         "PE 0601101E / DEFENSE RESEARCH SCIENCES", "280.494"],
    ])
    sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('DARPA','rdte',2026,'synthetic.pdf','https://example.mil/s.pdf',%s,%s,"
            " now(),'downloaded')",
            (str(pdf), sha),
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
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path) values"
            " (%s,%s,'0601101E','PriorYear','280.494','ProgramElement[0]')",
            (run_id, doc_id),
        )
    assert build_provenance_pages(pg_dsn) == 1
    with psycopg.connect(pg_dsn) as con:
        page_number, resolution, candidates = con.execute(
            "select page_number, resolution, candidate_pages from provenance_pages"
            " where document_sha256 = %s", (sha,)
        ).fetchone()
    assert page_number == 2, "must cite the R-2 detail page, not the R-1 summary"
    assert resolution == "unique"
    assert candidates == 2


def test_build_provenance_pages_inserts_and_caches(pg_dsn):
    _seed_fact(pg_dsn)
    assert build_provenance_pages(pg_dsn) == 1
    assert build_provenance_pages(pg_dsn) == 0   # cached by identity incl. amount
    with psycopg.connect(pg_dsn) as con:
        row = con.execute(
            "select page_number, resolution, amount_text, amount_millions"
            " from provenance_pages"
        ).fetchone()
        count = con.execute("select count(*) from provenance_pages").fetchone()[0]
    assert row[0] == 1 and row[2] == "280.494"
    assert count == 1, "second call must not insert a duplicate row"


def test_build_provenance_pages_distinct_amounts_both_stored(pg_dsn):
    """Live data has duplicate keys differing only in amount — both must store."""
    _seed_fact(pg_dsn, amount="280.494")
    _seed_fact(pg_dsn, amount="281.000")
    assert build_provenance_pages(pg_dsn) == 2


def test_build_provenance_pages_fiscal_year_filter(pg_dsn, tmp_path):
    """Phase 5E: fiscal_year=N scopes the build to edition N's documents;
    None keeps the historical whole-corpus behavior."""
    for fy, pe in ((2025, "0601101E"), (2026, "0602101E")):
        pdf = tmp_path / f"synthetic_{fy}.pdf"
        _make_pdf(pdf, [
            ["Exhibit R-2, RDT&E Budget Item Justification",
             f"PE {pe} / TEST PROGRAM", "280.494"],
        ])
        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        with psycopg.connect(pg_dsn, autocommit=True) as con:
            doc_id = con.execute(
                "insert into jbook_documents (org, exhibit_family, fiscal_year,"
                " title, source_url, file_path, sha256, downloaded_at, status)"
                " values ('DARPA','rdte',%s,%s,%s,%s,%s,now(),'downloaded')"
                " returning id",
                (fy, f"synthetic_{fy}.pdf", f"https://example.mil/{fy}.pdf",
                 str(pdf), sha),
            ).fetchone()[0]
            run_id = con.execute(
                "insert into extraction_runs (document_id, tier, tool_versions)"
                " values (%s, 1, '{}') returning id",
                (doc_id,),
            ).fetchone()[0]
            con.execute(
                "insert into budget_line_details (extraction_run_id, document_id,"
                " pe_bli, scenario, amount_millions, xml_path) values"
                " (%s,%s,%s,'PriorYear','280.494','ProgramElement[0]')",
                (run_id, doc_id, pe),
            )
    assert build_provenance_pages(pg_dsn, fiscal_year=2025) == 1
    with psycopg.connect(pg_dsn) as con:
        rows = con.execute("select pe_bli from provenance_pages").fetchall()
    assert rows == [("0601101E",)], "only the 2025 edition's fact resolves"
    # unfiltered run picks up the remaining edition
    assert build_provenance_pages(pg_dsn) == 1


def test_not_exists_predicate_filters_prefetched(pg_dsn, monkeypatch):
    """The NOT EXISTS sub-select must filter rows that are already in
    provenance_pages — NOT rely on ON CONFLICT suppression to hide them.

    Proof: we pre-insert the provenance_pages row directly (bypassing
    build_provenance_pages), then monkeypatch _page_texts to raise if called,
    so if the SELECT wrongly returns the fact, the test fails loud.
    """
    _seed_fact(pg_dsn)
    sha = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()

    # Manually insert the matching provenance_pages row.
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            """
            insert into provenance_pages
              (document_sha256, pe_bli, project_number, scenario,
               amount_millions, amount_text, page_number, x0, x1,
               top_pt, bottom_pt, page_width, page_height,
               resolution, candidate_pages)
            values (%s, '0601101E', null, 'PriorYear', '280.494',
                    '280.494', 1, 0, 0, 0, 0, 612, 792,
                    'unique', 1)
            """,
            (sha,),
        )

    # If the NOT EXISTS predicate fails and the row leaks through, _page_texts
    # will be called — the monkeypatch turns that into an immediate failure so
    # the bug is obvious rather than silently suppressed by ON CONFLICT.
    def _no_pdf_allowed(path):
        raise AssertionError("PDF should not be opened for cached facts")

    monkeypatch.setattr(_pp_mod, "_page_texts", _no_pdf_allowed)

    result = build_provenance_pages(pg_dsn)
    assert result == 0, "pre-cached row must be filtered by NOT EXISTS, not ON CONFLICT"


# ---------------------------------------------------------------------------
# Narrative paragraph provenance (Phase 5F §2b)
# ---------------------------------------------------------------------------

from govbudget.jbooks.provenance_pages import (  # noqa: E402
    build_narrative_provenance,
    find_narrative_page,
    narrative_opening,
    normalize_ws,
)

_NARR_BODY = (
    "The Corrosion Prevention program develops coatings that reduce maintenance"
    " costs across weapon systems. Additional trailing sentences follow the"
    " distinctive opening and are not part of the search snippet."
)
# first 12 words of _NARR_BODY
_NARR_OPENING = (
    "The Corrosion Prevention program develops coatings that reduce"
    " maintenance costs across weapon"
)


def test_normalize_ws_collapses_all_whitespace():
    assert normalize_ws("a\n b\t\tc  d ") == "a b c d"


def test_narrative_opening_first_12_words_ws_normalized():
    assert narrative_opening(_NARR_BODY) == _NARR_OPENING
    # short bodies: all words, no padding, no crash
    assert narrative_opening("only three words") == "only three words"
    assert narrative_opening("  \n ") == ""
    # internal whitespace runs collapse
    assert narrative_opening("a\nb\t c") == "a b c"


def _narr_pdf(path):
    """Two-page PDF: R-1 summary page, then the R-2 page carrying the
    narrative opening split across two rendered lines."""
    _make_pdf(path, [
        ["Exhibit R-1, RDT&E Program", "0605502TST 12.345"],
        ["Exhibit R-2, RDT&E Budget Item Justification",
         "PE 0605502TST / CORROSION PREVENTION",
         "A. Mission Description and Budget Item Justification",
         "The Corrosion Prevention program develops coatings that reduce",
         "maintenance costs across weapon systems. Additional trailing"
         " sentences follow."],
    ])


def test_find_narrative_page_resolves_with_bbox(tmp_path):
    pdf = tmp_path / "narr.pdf"
    _narr_pdf(pdf)
    hit = find_narrative_page(pdf, pe_bli="0605502TST", body=_NARR_BODY,
                              exhibit_family="rdte")
    assert hit["page_number"] == 2
    assert hit["resolution"] == "unique"       # single candidate page
    assert hit["candidate_pages"] == 1
    assert hit["search_text"] == _NARR_OPENING
    # bbox sanity: first line of the passage, inside the page box
    assert 0 <= hit["x0"] < hit["x1"] <= hit["page_width"]
    assert 0 <= hit["top_pt"] < hit["bottom_pt"] <= hit["page_height"]


def test_find_narrative_page_unresolved_never_fakes(tmp_path):
    pdf = tmp_path / "narr.pdf"
    _narr_pdf(pdf)
    hit = find_narrative_page(pdf, pe_bli="0605502TST",
                              body="Entirely different text that appears nowhere"
                                   " in the rendered document pages at all")
    assert hit["resolution"] == "unresolved"
    assert hit["page_number"] is None
    assert hit["x0"] is None


def test_find_narrative_page_empty_body(tmp_path):
    pdf = tmp_path / "narr.pdf"
    _narr_pdf(pdf)
    hit = find_narrative_page(pdf, pe_bli="0605502TST", body="   \n ")
    assert hit["resolution"] == "unresolved"
    assert hit["page_number"] is None
    assert hit["candidate_pages"] == 0


def test_find_narrative_page_ambiguous_two_pages(tmp_path):
    """The same opening on two pages of the SAME exhibit stays ambiguous —
    never fake certainty."""
    pdf = tmp_path / "dup.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-2, RDT&E Budget Item Justification", "PE 0605502TST",
         "The Corrosion Prevention program develops coatings that reduce",
         "maintenance costs across weapon systems."],
        ["Exhibit R-2, RDT&E Budget Item Justification", "PE 0605502TST",
         "The Corrosion Prevention program develops coatings that reduce",
         "maintenance costs across weapon systems. Continued."],
    ])
    hit = find_narrative_page(pdf, pe_bli="0605502TST", body=_NARR_BODY,
                              exhibit_family="rdte")
    assert hit["resolution"] == "ambiguous_first"
    assert hit["page_number"] == 1
    assert hit["candidate_pages"] == 2


def test_find_narrative_page_exhibit_tiebreak(tmp_path):
    """Opening text on both an R-2 page and an R-2A page: a project-level
    narrative (project_number set) must resolve 'unique' to the R-2A page."""
    pdf = tmp_path / "tiebreak.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-2, RDT&E Budget Item Justification", "PE 0605502TST",
         "The Corrosion Prevention program develops coatings that reduce",
         "maintenance costs across weapon systems."],
        ["Exhibit R-2A, RDT&E Project Justification", "PE 0605502TST",
         "Project (Number/Name) PJ1",
         "The Corrosion Prevention program develops coatings that reduce",
         "maintenance costs across weapon systems."],
    ])
    hit = find_narrative_page(pdf, pe_bli="0605502TST", body=_NARR_BODY,
                              project_number="PJ1", exhibit_family="rdte")
    assert hit["page_number"] == 2
    assert hit["resolution"] == "unique"
    assert hit["candidate_pages"] == 2


def test_find_narrative_page_pe_bli_tiebreak(tmp_path):
    """Same opening under two PEs in one document: the page carrying the
    fact's PE wins, resolution 'unique' (narrowed to exactly one page)."""
    pdf = tmp_path / "twope.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-2, RDT&E Budget Item Justification", "PE 0699999TST",
         "The Corrosion Prevention program develops coatings that reduce",
         "maintenance costs across weapon systems."],
        ["Exhibit R-2, RDT&E Budget Item Justification", "PE 0605502TST",
         "The Corrosion Prevention program develops coatings that reduce",
         "maintenance costs across weapon systems."],
    ])
    hit = find_narrative_page(pdf, pe_bli="0605502TST", body=_NARR_BODY,
                              exhibit_family="rdte")
    assert hit["page_number"] == 2
    assert hit["resolution"] == "unique"
    assert hit["candidate_pages"] == 2


def test_find_narrative_page_rejects_mid_word_match(tmp_path):
    """Word-boundary guard: the opening appearing only as a suffix inside a
    longer word must NOT produce a location."""
    pdf = tmp_path / "midword.pdf"
    _make_pdf(pdf, [
        ["Exhibit R-2, RDT&E Budget Item Justification", "PE 0605502TST",
         "prefixThe Corrosion Prevention program develops coatings that reduce",
         "maintenance costs across weapon systems."],
    ])
    hit = find_narrative_page(pdf, pe_bli="0605502TST", body=_NARR_BODY)
    assert hit["resolution"] == "unresolved"
    assert hit["page_number"] is None


def _seed_narrative(pg_dsn, pdf_path, *, kind="mission",
                    xml_path="ProgramElement[0]/Narrative[0]",
                    body=_NARR_BODY, pe_bli="0605502TST",
                    project_number=None):
    sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, file_path, sha256, downloaded_at, status) values"
            " ('OSD','rdte',2026,'narr.pdf','https://example.mil/narr.pdf',%s,%s,"
            " now(),'downloaded') on conflict (source_url) do nothing",
            (str(pdf_path), sha),
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
            " pe_bli, project_number, kind, title, body, xml_path)"
            " values (%s,%s,%s,%s,%s,'A. Mission Description',%s,%s)",
            (run_id, doc_id, pe_bli, project_number, kind, body, xml_path),
        )
    return sha


def test_build_narrative_provenance_inserts_and_caches(pg_dsn, tmp_path):
    pdf = tmp_path / "narr.pdf"
    _narr_pdf(pdf)
    sha = _seed_narrative(pg_dsn, pdf)
    assert build_narrative_provenance(pg_dsn) == 1
    assert build_narrative_provenance(pg_dsn) == 0    # cached by identity
    with psycopg.connect(pg_dsn) as con:
        row = con.execute(
            "select target_kind, narrative_kind, xml_path, page_number,"
            " resolution, amount_text, scenario, amount_millions"
            " from provenance_pages where document_sha256 = %s", (sha,)
        ).fetchone()
    assert row[0] == "narrative"
    assert row[1] == "mission"
    assert row[2] == "ProgramElement[0]/Narrative[0]"
    assert row[3] == 2
    assert row[4] == "unique"
    assert row[5] == _NARR_OPENING       # the searched string, stored honestly
    assert row[6] is None and row[7] is None


def test_build_narrative_provenance_unresolved_row_kept_honest(pg_dsn, tmp_path):
    """A narrative whose opening is not locatable stores an unresolved row
    with NO page — the ambiguity flag survives, nothing is faked."""
    pdf = tmp_path / "narr.pdf"
    _narr_pdf(pdf)
    sha = _seed_narrative(
        pg_dsn, pdf, xml_path="ProgramElement[0]/Narrative[1]",
        body="Body text that never appears in the rendered document pages"
             " anywhere at all in any form",
    )
    assert build_narrative_provenance(pg_dsn) == 1
    with psycopg.connect(pg_dsn) as con:
        page_number, resolution = con.execute(
            "select page_number, resolution from provenance_pages"
            " where document_sha256 = %s and target_kind = 'narrative'", (sha,)
        ).fetchone()
    assert page_number is None
    assert resolution == "unresolved"


def test_amount_and_narrative_rows_coexist(pg_dsn, tmp_path):
    """Migration 004: both target_kinds share the table without colliding;
    the amount builder still caches after narrative rows exist."""
    _seed_fact(pg_dsn)
    pdf = tmp_path / "narr.pdf"
    _narr_pdf(pdf)
    _seed_narrative(pg_dsn, pdf)
    assert build_provenance_pages(pg_dsn) == 1
    assert build_narrative_provenance(pg_dsn) == 1
    assert build_provenance_pages(pg_dsn) == 0
    assert build_narrative_provenance(pg_dsn) == 0
    with psycopg.connect(pg_dsn) as con:
        kinds = dict(con.execute(
            "select target_kind, count(*) from provenance_pages group by 1"
        ).fetchall())
    assert kinds == {"amount": 1, "narrative": 1}


def test_two_narratives_same_pe_do_not_collide(pg_dsn, tmp_path):
    """The old 5-column NULLS-NOT-DISTINCT key would have collapsed two
    narratives of one PE (both scenario/amount NULL) into a single row —
    migration 004's partial narrative key must keep BOTH."""
    pdf = tmp_path / "narr.pdf"
    _narr_pdf(pdf)
    _seed_narrative(pg_dsn, pdf, xml_path="ProgramElement[0]/Narrative[0]")
    _seed_narrative(pg_dsn, pdf, xml_path="ProgramElement[0]/Narrative[1]",
                    kind="justification")
    assert build_narrative_provenance(pg_dsn) == 2
