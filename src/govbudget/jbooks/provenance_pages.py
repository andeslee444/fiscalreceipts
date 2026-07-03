"""Resolve J-book facts to PDF page + word bbox.

Per DOCUMENT (not per fact): one pypdf text pass over all pages (~12 ms/page)
caches page texts; candidate pages are those whose text contains the pe_bli
anchor AND a word-boundary regex match of a formatted amount string; ONE
pdfplumber handle (opened lazily) extracts words only on candidate pages
(~60 ms/page) until one yields the exact word → bbox.

Deterministic tie-breaking (several candidate pages): detail facts have one
true source exhibit — R-2A for project-level RDT&E facts, R-2 for PE-level
RDT&E facts, P-40 for procurement line items. Candidates are narrowed to
pages whose 'Exhibit <type>' header matches that source exhibit, then (for
project facts) to pages containing the project number as a standalone token.
Each narrowing step is skipped if it would eliminate every candidate.

Resolution honesty: 'unique' (page uniquely determined — either a single
candidate, or tie-breaking narrowed several candidates to exactly one AND the
word match confirmed on that page), 'ambiguous_first' (several pages remain
even after tie-breaking; the first preferred page with a word match wins),
'zero_amount' (amount == 0 — '0.000' floods pages, a page highlight would be
arbitrary; NO page citation, the xml_path citation remains), 'unresolved' (no
page). candidate_pages always records the RAW text-match count (pre
tie-breaking), so 'unique' rows with candidate_pages > 1 are disambiguated
ones — never fabricated certainty. Identity includes the amount (live data
has same-key facts with different amounts).
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


# 'Exhibit R-2A' etc. page headers. Longer variants BEFORE their prefixes
# (R-2A before R-2, R-4A before R-4, P-40A before P-40) so alternation
# never truncates a match.
_EXHIBIT_MARKER_RE = re.compile(
    r"Exhibit\s+(R-2A|R-2|R-1|R-3|R-4A|R-4|P-40A|P-40|P-1|P-5|P-3A|P-21|P-10)\b"
)


def _page_exhibit(text: str) -> str | None:
    """First 'Exhibit <type>' marker on the page, or None (TOC/index pages)."""
    m = _EXHIBIT_MARKER_RE.search(text)
    return m.group(1) if m else None


def _source_exhibit(exhibit_family: str | None,
                    project_number: str | None) -> str | None:
    """The one exhibit type a detail fact is extracted from.

    RDT&E project rows live on R-2A (RDT&E Project Justification) pages;
    PE-level rows on R-2 (RDT&E Budget Item Justification) pages; procurement
    line items on P-40 (Budget Line Item Justification) pages. Unknown
    families get no exhibit preference.
    """
    if exhibit_family == "rdte":
        return "R-2A" if project_number else "R-2"
    if exhibit_family == "procurement":
        return "P-40"
    return None


def _project_pattern(project_number: str) -> re.Pattern:
    # standalone token: project 'RD' must not match inside 'BOARD' or 'RD1'
    return re.compile(
        rf"(?<![A-Za-z0-9]){re.escape(project_number)}(?![A-Za-z0-9])"
    )


def _preferred_candidates(page_texts: list[str], candidates: list[int], *,
                          project_number: str | None,
                          exhibit_family: str | None) -> list[int]:
    """Narrow candidates by source-exhibit header, then project number.

    Each narrowing step only applies if it keeps ≥1 candidate — the fallback
    is always the previous (wider) set, never an empty one. Returned list
    preserves page order, so 'first' stays deterministic.
    """
    result = list(candidates)
    source = _source_exhibit(exhibit_family, project_number)
    if source is not None:
        narrowed = [i for i in result if _page_exhibit(page_texts[i]) == source]
        if narrowed:
            result = narrowed
    if project_number:
        pat = _project_pattern(project_number)
        narrowed = [i for i in result if pat.search(page_texts[i])]
        if narrowed:
            result = narrowed
    return result


_UNRESOLVED = {
    "page_number": None, "x0": None, "x1": None, "top_pt": None,
    "bottom_pt": None, "page_width": None, "page_height": None,
}


def _resolve_fact(page_texts: list[str], plumber, *, pe_bli: str,
                  amount: Decimal, project_number: str | None = None,
                  exhibit_family: str | None = None) -> dict:
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
    preferred = _preferred_candidates(
        page_texts, candidates,
        project_number=project_number, exhibit_family=exhibit_family,
    )
    # Preferred pages first; remaining raw candidates keep the word-match
    # fallback exhaustive (a text-layer match can still fail word extraction).
    ordered = preferred + [i for i in candidates if i not in preferred]
    pdf = plumber()
    for idx in ordered:
        page = pdf.pages[idx]
        word = next((w for w in page.extract_words() if w["text"] in targets), None)
        if word is not None:
            # 'unique' ONLY when the page is uniquely determined: a single raw
            # candidate, or tie-breaking narrowed to exactly this one page AND
            # the word match confirmed here (not on a fallback page).
            uniquely = len(candidates) == 1 or (
                len(preferred) == 1 and idx == preferred[0]
            )
            return {
                "page_number": idx + 1,         # 1-based for #page=N anchors
                "x0": float(word["x0"]), "x1": float(word["x1"]),
                "top_pt": float(word["top"]), "bottom_pt": float(word["bottom"]),
                "page_width": float(page.width), "page_height": float(page.height),
                "resolution": "unique" if uniquely else "ambiguous_first",
                "candidate_pages": len(candidates),
                "amount_text": word["text"],
            }
    return {**_UNRESOLVED, "resolution": "unresolved",
            "candidate_pages": len(candidates), "amount_text": targets[0]}


def find_fact_page(pdf_path: Path, *, pe_bli: str, amount: Decimal,
                   project_number: str | None = None,
                   exhibit_family: str | None = None) -> dict:
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
        return _resolve_fact(texts, plumber, pe_bli=pe_bli, amount=amount,
                             project_number=project_number,
                             exhibit_family=exhibit_family)
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
                   d.amount_millions, j.exhibit_family
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
                for (_, _, pe_bli, project_number, scenario, amount,
                     exhibit_family) in facts:
                    hit = _resolve_fact(texts, plumber, pe_bli=pe_bli,
                                        amount=Decimal(amount),
                                        project_number=project_number,
                                        exhibit_family=exhibit_family)
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
