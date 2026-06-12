"""Resolve J-book facts to PDF page + word bbox.

Per DOCUMENT (not per fact): one pypdf text pass over all pages (~12 ms/page)
caches page texts; candidate pages are those whose text contains the pe_bli
anchor AND a word-boundary regex match of a formatted amount string; ONE
pdfplumber handle (opened lazily) extracts words only on candidate pages
(~60 ms/page) until one yields the exact word → bbox.

Resolution honesty: 'unique' (one candidate page), 'ambiguous_first' (several;
the first page with a word match wins, count recorded), 'zero_amount' (amount
== 0 — '0.000' floods pages, a page highlight would be arbitrary; NO page
citation, the xml_path citation remains), 'unresolved' (no page). Identity
includes the amount (live data has same-key facts with different amounts).
Cached: already-built (sha, pe_bli, project, scenario, amount) keys are skipped.
"""
from __future__ import annotations

import re
from decimal import Decimal
from itertools import groupby
from pathlib import Path

import psycopg


def amount_strings(amount: Decimal) -> list[str]:
    """Candidate page renderings, 3-decimal J-book style; comma form first."""
    grouped = f"{amount:,.3f}"
    bare = f"{amount:.3f}"
    return [grouped] if grouped == bare else [grouped, bare]


def _page_texts(pdf_path: Path) -> list[str]:
    from pypdf import PdfReader

    return [p.extract_text() or "" for p in PdfReader(str(pdf_path)).pages]


def _amount_pattern(target: str) -> re.Pattern:
    # word-boundary for numerics: '280.494' must not match inside '1,280.494'
    return re.compile(rf"(?<![\d,.]){re.escape(target)}(?![\d])")


_UNRESOLVED = {
    "page_number": None, "x0": None, "x1": None, "top_pt": None,
    "bottom_pt": None, "page_width": None, "page_height": None,
}


def _resolve_fact(page_texts: list[str], plumber, *, pe_bli: str,
                  amount: Decimal) -> dict:
    """Resolve one fact against pre-extracted texts + an open pdfplumber handle.

    `plumber` is a zero-arg callable returning the (lazily opened, cached)
    pdfplumber.PDF — so documents whose facts all miss never pay the open cost.
    """
    if not amount.is_finite():
        return {**_UNRESOLVED, "resolution": "unresolved",
                "candidate_pages": 0, "amount_text": str(amount)}
    targets = amount_strings(amount)
    if amount == 0:
        return {**_UNRESOLVED, "resolution": "zero_amount",
                "candidate_pages": 0, "amount_text": targets[0]}
    patterns = [_amount_pattern(t) for t in targets]
    candidates = [
        i for i, text in enumerate(page_texts)
        if pe_bli in text and any(p.search(text) for p in patterns)
    ]
    if not candidates:
        return {**_UNRESOLVED, "resolution": "unresolved",
                "candidate_pages": 0, "amount_text": targets[0]}
    pdf = plumber()
    for idx in candidates:                      # try ALL candidates, not just first
        page = pdf.pages[idx]
        word = next((w for w in page.extract_words() if w["text"] in targets), None)
        if word is not None:
            return {
                "page_number": idx + 1,         # 1-based for #page=N anchors
                "x0": float(word["x0"]), "x1": float(word["x1"]),
                "top_pt": float(word["top"]), "bottom_pt": float(word["bottom"]),
                "page_width": float(page.width), "page_height": float(page.height),
                "resolution": "unique" if len(candidates) == 1 else "ambiguous_first",
                "candidate_pages": len(candidates),
                "amount_text": word["text"],
            }
    return {**_UNRESOLVED, "resolution": "unresolved",
            "candidate_pages": len(candidates), "amount_text": targets[0]}


def find_fact_page(pdf_path: Path, *, pe_bli: str, amount: Decimal) -> dict:
    """Single-fact public entry point (tests; ad-hoc use)."""
    import pdfplumber

    texts = _page_texts(pdf_path)
    pdf_handle = None

    def plumber():
        nonlocal pdf_handle
        if pdf_handle is None:
            pdf_handle = pdfplumber.open(pdf_path)
        return pdf_handle

    try:
        return _resolve_fact(texts, plumber, pe_bli=pe_bli, amount=amount)
    finally:
        if pdf_handle is not None:
            pdf_handle.close()


def build_provenance_pages(dsn: str) -> int:
    """Resolve every non-superseded detail fact lacking a provenance_pages row.

    Grouped by document: each PDF's text is extracted ONCE for all its facts.
    Returns rows actually inserted (cursor rowcount — ON CONFLICT suppressions
    don't count). Missing document files raise loudly.
    """
    import pdfplumber

    inserted = 0
    with psycopg.connect(dsn) as con:
        rows = con.execute(
            """
            select j.sha256, j.file_path, d.pe_bli, d.project_number, d.scenario,
                   d.amount_millions
            from budget_line_details d
            join jbook_documents j on j.id = d.document_id
            where not d.superseded and j.sha256 is not null
              and not exists (
                select 1 from provenance_pages p
                where p.document_sha256 = j.sha256 and p.pe_bli = d.pe_bli
                  and p.scenario = d.scenario
                  and p.project_number is not distinct from d.project_number
                  and p.amount_millions = d.amount_millions
              )
            order by j.sha256
            """
        ).fetchall()
        for sha, doc_group in groupby(rows, key=lambda r: r[0]):
            facts = list(doc_group)
            pdf_path = Path(facts[0][1])
            if not pdf_path.exists():
                raise FileNotFoundError(f"document {sha} missing on disk: {pdf_path}")
            texts = _page_texts(pdf_path)
            pdf_handle = None

            def plumber(path=pdf_path):
                nonlocal pdf_handle
                if pdf_handle is None:
                    pdf_handle = pdfplumber.open(path)
                return pdf_handle

            try:
                for _, _, pe_bli, project_number, scenario, amount in facts:
                    hit = _resolve_fact(texts, plumber, pe_bli=pe_bli,
                                        amount=Decimal(amount))
                    cur = con.execute(
                        """
                        insert into provenance_pages
                          (document_sha256, pe_bli, project_number, scenario,
                           amount_millions, amount_text, page_number, x0, x1,
                           top_pt, bottom_pt, page_width, page_height,
                           resolution, candidate_pages)
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        on conflict (document_sha256, pe_bli, project_number,
                                     scenario, amount_millions) do nothing
                        """,
                        (sha, pe_bli, project_number, scenario, amount,
                         hit["amount_text"], hit["page_number"], hit["x0"],
                         hit["x1"], hit["top_pt"], hit["bottom_pt"],
                         hit["page_width"], hit["page_height"],
                         hit["resolution"], hit["candidate_pages"]),
                    )
                    inserted += cur.rowcount
            finally:
                if pdf_handle is not None:
                    pdf_handle.close()
        con.commit()
    return inserted
