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

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_p24_25.pdf"


def _make_pdf(path: Path, pages: list[list[str]]) -> None:
    """Write a minimal multi-page PDF; each page is a list of Helvetica text
    lines rendered top-down (extractable by both pypdf and pdfplumber)."""

    def esc(s: str) -> str:
        return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    objects: list[bytes] = []  # 1-indexed body objects
    n_pages = len(pages)
    font_num = 3 + 2 * n_pages
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n_pages))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")            # 1: catalog
    objects.append(                                                  # 2: pages
        f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode()
    )
    for i, lines in enumerate(pages):
        page_num, content_num = 3 + 2 * i, 4 + 2 * i
        objects.append(                                              # page
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_num} 0 R >> >> "
            f"/Contents {content_num} 0 R >>".encode()
        )
        ops = ["BT", "/F1 10 Tf", "72 720 Td"]
        for j, line in enumerate(lines):
            if j:
                ops.append("0 -20 Td")
            ops.append(f"({esc(line)}) Tj")
        ops.append("ET")
        stream = "\n".join(ops).encode()
        objects.append(                                              # content
            b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)
        )
    objects.append(                                                  # font
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    )

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for num, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (num, body)
    xref_at = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets[1:]:
        out += b"%010d 00000 n \n" % off
    out += (
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, xref_at)
    )
    path.write_bytes(bytes(out))


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
