"""Resolve J-book facts to PDF page + word bbox.

Per DOCUMENT (not per fact): one pypdf text pass over all pages (~12 ms/page)
caches page texts; candidate pages are those whose text contains the pe_bli
anchor AND a word-boundary regex match of a formatted amount string; ONE
pdfplumber handle (opened lazily) extracts words only on candidate pages
(~60 ms/page) until one yields the exact word → bbox.

Phase 5F (§2b) adds NARRATIVE provenance (target_kind='narrative'): each
narrative paragraph is located by its opening text (first ~12 words,
whitespace-normalized — narrative_opening is BINDING, shared with the
verify-phase5b1 narrative re-derivation leg). Candidate pages are those whose
normalized text contains the opening; tie-breaking narrows by pe_bli presence,
then the same source-exhibit/project rules as amounts. The bbox is the FIRST
LINE of the passage (pdfplumber word span). Resolution vocabulary and honesty
rules are identical to amounts; unresolvable openings store an 'unresolved'
row with NO page — locations are never faked.

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


def build_provenance_pages(dsn: str, *, fiscal_year: int | None = None) -> int:
    """Resolve every non-superseded detail fact lacking a provenance_pages row.

    fiscal_year scopes the run to one PB edition's documents (Phase 5E
    per-edition backfill); None keeps the historical whole-corpus behavior.
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
              and (%(fy)s::int is null or j.fiscal_year = %(fy)s)
              and not exists (
                select 1 from provenance_pages p
                where p.target_kind = 'amount'
                  and p.document_sha256 = j.sha256 and p.pe_bli = d.pe_bli
                  and p.scenario = d.scenario
                  and p.project_number is not distinct from d.project_number
                  and p.amount_millions = d.amount_millions
              )
            order by j.sha256
            """,
            {"fy": fiscal_year},
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
                          (target_kind, document_sha256, pe_bli, project_number,
                           scenario, amount_millions, amount_text, page_number,
                           x0, x1, top_pt, bottom_pt, page_width, page_height,
                           resolution, candidate_pages)
                        values ('amount',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        on conflict (document_sha256, pe_bli, project_number,
                                     scenario, amount_millions)
                          where target_kind = 'amount' do nothing
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


# ---------------------------------------------------------------------------
# Narrative paragraph provenance (Phase 5F §2b)
# ---------------------------------------------------------------------------

_WS_RE = re.compile(r"\s+")

# BINDING: the opening-word count shared by the builder and the
# verify-phase5b1 narrative re-derivation leg. Changing it invalidates every
# stored narrative row (amount_text holds the searched opening).
NARRATIVE_OPENING_WORDS = 12


def normalize_ws(text: str) -> str:
    """Collapse all whitespace runs to single spaces and strip the ends."""
    return _WS_RE.sub(" ", text).strip()


def narrative_opening(body: str, n_words: int = NARRATIVE_OPENING_WORDS) -> str:
    """A narrative's distinctive opening: first n_words, whitespace-normalized.

    BINDING for the verify-phase5b1 narrative leg — the gate recomputes this
    from the exported body and must land on the same searched string.
    """
    return " ".join(body.split()[:n_words])


def _find_word_span(words: list[dict], snippet: str) -> list[int] | None:
    """Indices of the consecutive pdfplumber words spelling `snippet`.

    Words are joined with single spaces; the match must start AND end on word
    boundaries (a passage opening appearing only inside a longer word is not
    a location). Returns None when the page's words never spell the snippet.
    """
    texts = [w["text"] for w in words]
    joined = " ".join(texts)
    starts: list[int] = []
    off = 0
    for t in texts:
        starts.append(off)
        off += len(t) + 1
    pos = joined.find(snippet)
    while pos != -1:
        end = pos + len(snippet)
        if (pos == 0 or joined[pos - 1] == " ") and (
            end == len(joined) or joined[end] == " "
        ):
            return [
                i for i, s in enumerate(starts)
                if s < end and s + len(texts[i]) > pos
            ]
        pos = joined.find(snippet, pos + 1)
    return None


def _first_line_bbox(words: list[dict], span: list[int]) -> dict:
    """Bbox of the passage START: the matched words on the passage's first
    rendered line (top within 3 pt of the first matched word)."""
    w0 = words[span[0]]
    line_top = float(w0["top"])
    line = [words[i] for i in span if abs(float(words[i]["top"]) - line_top) <= 3.0]
    return {
        "x0": float(w0["x0"]),
        "x1": max(float(w["x1"]) for w in line),
        "top_pt": min(float(w["top"]) for w in line),
        "bottom_pt": max(float(w["bottom"]) for w in line),
    }


def _resolve_narrative(page_texts: list[str], norm_texts: list[str], plumber, *,
                       snippet: str, pe_bli: str,
                       project_number: str | None = None,
                       exhibit_family: str | None = None,
                       words_cache: dict | None = None) -> dict:
    """Resolve one narrative opening against pre-extracted (raw + normalized)
    page texts and an open pdfplumber handle.

    Same honesty vocabulary as _resolve_fact: 'unique' only when the page is
    uniquely determined (single raw candidate, or tie-breaking narrowed to
    exactly the confirming page); 'ambiguous_first' otherwise; 'unresolved'
    when the opening is never found — NO page, never a fake location.
    candidate_pages records the RAW pre-tie-breaking count.
    """
    if not snippet:
        return {**_UNRESOLVED, "resolution": "unresolved",
                "candidate_pages": 0, "search_text": snippet}
    candidates = [i for i, t in enumerate(norm_texts) if snippet in t]
    if not candidates:
        return {**_UNRESOLVED, "resolution": "unresolved",
                "candidate_pages": 0, "search_text": snippet}
    # Tie-break 1: pages carrying the fact's PE anchor (skip if it would
    # eliminate every candidate — same fallback rule as _preferred_candidates).
    preferred = list(candidates)
    narrowed = [i for i in preferred if pe_bli in norm_texts[i]]
    if narrowed:
        preferred = narrowed
    # Tie-breaks 2+3: source exhibit header, then project token (shared with
    # the amount resolver).
    preferred = _preferred_candidates(
        page_texts, preferred,
        project_number=project_number, exhibit_family=exhibit_family,
    )
    ordered = preferred + [i for i in candidates if i not in preferred]
    for idx in ordered:
        if words_cache is not None and idx in words_cache:
            words, page_width, page_height = words_cache[idx]
        else:
            page = plumber().pages[idx]
            words = page.extract_words()
            page_width, page_height = float(page.width), float(page.height)
            if words_cache is not None:
                words_cache[idx] = (words, page_width, page_height)
        span = _find_word_span(words, snippet)
        if span:
            uniquely = len(candidates) == 1 or (
                len(preferred) == 1 and idx == preferred[0]
            )
            return {
                "page_number": idx + 1,         # 1-based for #page=N anchors
                **_first_line_bbox(words, span),
                "page_width": page_width, "page_height": page_height,
                "resolution": "unique" if uniquely else "ambiguous_first",
                "candidate_pages": len(candidates),
                "search_text": snippet,
            }
    return {**_UNRESOLVED, "resolution": "unresolved",
            "candidate_pages": len(candidates), "search_text": snippet}


def find_narrative_page(pdf_path: Path, *, pe_bli: str, body: str,
                        project_number: str | None = None,
                        exhibit_family: str | None = None) -> dict:
    """Single-narrative public entry point (tests; ad-hoc use)."""
    import pdfplumber

    texts = _page_texts(pdf_path)
    norm_texts = [normalize_ws(t) for t in texts]
    pdf_handle = None

    def plumber():
        nonlocal pdf_handle
        if pdf_handle is None:
            pdf_handle = pdfplumber.open(pdf_path)
        return pdf_handle

    try:
        return _resolve_narrative(
            texts, norm_texts, plumber,
            snippet=narrative_opening(body), pe_bli=pe_bli,
            project_number=project_number, exhibit_family=exhibit_family,
        )
    finally:
        if pdf_handle is not None:
            pdf_handle.close()


def build_narrative_provenance(dsn: str) -> int:
    """Resolve every non-superseded narrative lacking a narrative provenance row.

    Identity is (document_sha256, pe_bli, narrative_kind, xml_path) — the same
    key fact_id_narrative hashes. Grouped by document (one text pass per PDF;
    per-document word cache since narratives of one book share pages). Returns
    rows actually inserted. Missing document files raise loudly.
    """
    import pdfplumber

    inserted = 0
    with psycopg.connect(dsn) as con:
        rows = con.execute(
            """
            select j.sha256, j.file_path, n.pe_bli, n.project_number, n.kind,
                   n.xml_path, n.body, j.exhibit_family
            from detail_narratives n
            join jbook_documents j on j.id = n.document_id
            where not n.superseded and j.sha256 is not null
              and not exists (
                select 1 from provenance_pages p
                where p.target_kind = 'narrative'
                  and p.document_sha256 = j.sha256 and p.pe_bli = n.pe_bli
                  and p.narrative_kind = n.kind and p.xml_path = n.xml_path
              )
            order by j.sha256
            """
        ).fetchall()
        for sha, doc_group in groupby(rows, key=lambda r: r[0]):
            narratives = list(doc_group)
            pdf_path = Path(narratives[0][1])
            if not pdf_path.exists():
                raise FileNotFoundError(f"document {sha} missing on disk: {pdf_path}")
            texts = _page_texts(pdf_path)
            norm_texts = [normalize_ws(t) for t in texts]
            words_cache: dict = {}
            pdf_handle = None

            def plumber(path=pdf_path):
                nonlocal pdf_handle
                if pdf_handle is None:
                    pdf_handle = pdfplumber.open(path)
                return pdf_handle

            try:
                for (_, _, pe_bli, project_number, kind, xml_path, body,
                     exhibit_family) in narratives:
                    hit = _resolve_narrative(
                        texts, norm_texts, plumber,
                        snippet=narrative_opening(body), pe_bli=pe_bli,
                        project_number=project_number,
                        exhibit_family=exhibit_family,
                        words_cache=words_cache,
                    )
                    cur = con.execute(
                        """
                        insert into provenance_pages
                          (target_kind, document_sha256, pe_bli, project_number,
                           narrative_kind, xml_path, amount_text, page_number,
                           x0, x1, top_pt, bottom_pt, page_width, page_height,
                           resolution, candidate_pages)
                        values ('narrative',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        on conflict (document_sha256, pe_bli, narrative_kind,
                                     xml_path)
                          where target_kind = 'narrative' do nothing
                        """,
                        (sha, pe_bli, project_number, kind, xml_path,
                         hit["search_text"], hit["page_number"], hit["x0"],
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
