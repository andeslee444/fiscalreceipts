"""Phase 5B-1 acceptance gates: citation export verification.

Gates (CLI: verify-phase5b1):
  1. citation_gate5b1   — stratified sample (≥5/kind or all), 100% mechanical
                          re-derivation per citation tier:
                          - jbook_pdf: PDF file exists + sha matches + pdfplumber
                            word found at stored page with x0/top_pt within 2 pt
                          - workbook: xlsx file exists + sha matches +
                            load_workbook(read_only=True, data_only=True) cell
                            values SUM == stored amount_thousands exactly
                          - lda_filing: official_url starts with
                            https://lda.senate.gov/ and contains filing_uuid
                            (shape-only; no network in gates)
                          PASS iff 100% of sampled citations pass AND at least
                          one citation was sampled AND every fact_id present
                          in BOTH budget_lines.parquet and
                          budget_lines_decade.parquet carries exactly equal
                          amounts (backlog #24 — a divergent decade copy
                          must not hide behind the setdefault load).

  2. integrity_gate5b1  — set-level checks:
                          - jbook: resolved details rows have exactly one
                            jbook_pdf citation; zero orphan citations; count
                            reconciliation with manifest skipped counters.
                          - workbook: citation fact_ids == budget_lines
                            fact_ids (set equality both directions).
                          - lda: every lda_filing fact_id re-derives from some
                            fct_program_lobbying row via fact_id_lda.
                          - manifest rowcounts match actual parquet files.

  3. coverage_report5b1 — NOT pass/fail: counts by resolution + uncited_datasets
                          ledger echoed from manifest.

  4. narrative_gate5b1  — Phase 5F §2b: sample (N=25) of page-resolved
                          jbook_narrative citations; each opening text
                          (recomputed from the exported body via the BINDING
                          narrative_opening) must appear on the cited page of
                          the sha-named PDF; sha + resolution + #page anchor +
                          bbox-in-page-box checked. FAILS when narrative
                          citations exist but none carries page provenance
                          (the pre-5F state).

All gate functions take explicit paths — never read config.
No network access in any gate.
"""
from __future__ import annotations

import json
import re
from decimal import Decimal
from pathlib import Path


def _sql_path(p) -> str:
    """Return a path string safe for embedding in DuckDB SQL string literals."""
    return str(p).replace("'", "''")


# ---------------------------------------------------------------------------
# Gate 1: citation_gate5b1
# ---------------------------------------------------------------------------

_SAMPLE_SIZE = 50
_MIN_PER_KIND = 5
_BBOX_TOL_PT = 2.0  # points tolerance for x0/top_pt re-check


def citation_gate5b1(
    site_dir: Path,
    *,
    sample_size: int = _SAMPLE_SIZE,
) -> dict:
    """Re-derive a stratified sample of citations at 100%.

    PASS iff every sampled citation passes its tier re-derivation AND at least
    one citation exists.

    Returns:
        ok: bool
        sampled: int
        passed: int (sample results only — overlap failures are additive)
        failures: list[(fact_id, reason)] (overlap divergences first)
        overlap_fids: int (fids in both budget_lines and decade parquets)
        overlap_divergent: int (backlog #24 equality check; must be 0)
        reason: str (only when ok is False for structural reasons like missing dir)
    """
    site_dir = Path(site_dir)
    if not site_dir.exists():
        return {
            "ok": False,
            "sampled": 0,
            "passed": 0,
            "failures": [],
            "reason": f"site_dir missing: {site_dir}",
        }

    cit_pq = site_dir / "citations" / "citations.parquet"
    if not cit_pq.exists():
        return {
            "ok": False,
            "sampled": 0,
            "passed": 0,
            "failures": [],
            "reason": f"citations.parquet missing: {cit_pq}",
        }

    import duckdb

    con = duckdb.connect()
    try:
        total = con.execute(f"select count(*) from read_parquet('{_sql_path(cit_pq)}')").fetchone()[0]
    finally:
        con.close()

    if total == 0:
        return {
            "ok": False,
            "sampled": 0,
            "passed": 0,
            "failures": [],
            "reason": "citations.parquet is empty",
        }

    # Load all citations grouped by kind
    con = duckdb.connect()
    try:
        all_cits = con.execute(f"select * from read_parquet('{_sql_path(cit_pq)}')").fetchall()
        col_names = [d[0] for d in con.execute(f"describe select * from read_parquet('{_sql_path(cit_pq)}')").fetchall()]
    finally:
        con.close()

    col_idx = {name: i for i, name in enumerate(col_names)}

    # Group by kind
    by_kind: dict[str, list[tuple]] = {}
    for row in all_cits:
        kind = row[col_idx["kind"]]
        by_kind.setdefault(kind, []).append(row)

    # True two-pass stratified sample:
    # Pass 1 — reserve min(_MIN_PER_KIND, len(rows)) per kind present.
    # Pass 2 — distribute remaining budget across kinds in sorted order.
    kinds_sorted = sorted(by_kind.keys())
    reserved: dict[str, int] = {}
    pass1_total = 0
    for kind in kinds_sorted:
        r = min(_MIN_PER_KIND, len(by_kind[kind]))
        reserved[kind] = r
        pass1_total += r

    # If pass-1 already exceeds budget, scale down proportionally (round-robin trim).
    if pass1_total > sample_size:
        # Trim from the back of the sorted list until we fit
        for kind in reversed(kinds_sorted):
            excess = pass1_total - sample_size
            if excess <= 0:
                break
            cut = min(reserved[kind], excess)
            reserved[kind] -= cut
            pass1_total -= cut

    remaining = sample_size - pass1_total

    # Pass 2 — distribute remaining slots, one per kind per round (round-robin)
    extra: dict[str, int] = {k: 0 for k in kinds_sorted}
    if remaining > 0:
        for kind in kinds_sorted:
            available = len(by_kind[kind]) - reserved[kind]
            if available > 0 and remaining > 0:
                give = min(available, remaining)
                extra[kind] = give
                remaining -= give
                if remaining <= 0:
                    break

    sample: list[tuple] = []
    for kind in kinds_sorted:
        take = reserved[kind] + extra[kind]
        sample.extend(by_kind[kind][:take])

    # Ensure we cap at sample_size total
    sample = sample[:sample_size]

    # ── Load budget-line parquets once for derived recompute ────────────────
    # Workbook citations carry recorded_value=None; their value lives in
    # amount_thousands.  The derived sum rule (4c) and the difference rule
    # (4b) resolve input fact_ids through budget lines when recorded_value
    # is absent.  Phase 5E gate-scope extension (documented in
    # docs/superpowers/reviews/5c-gates-pre-failure.txt): the decade tier
    # ships old-edition workbook rows in data/budget_lines_decade.parquet —
    # the same fact universe extension integrity_gate5b1 applies.
    (fid_to_bl_amount, bl_overlap_fids,
     bl_overlap_divergences) = _load_fid_to_bl_amount(site_dir)

    # Backlog #24: overlap equality is a gate failure in its own right —
    # setdefault alone would let a divergent decade amount hide behind the
    # budget_lines copy. These failures print first (CLI shows the first 10).
    failures: list[tuple[str, str]] = [
        (fid, f"fid in both budget_lines and budget_lines_decade with"
              f" divergent amount_thousands: {a} (budget_lines) vs"
              f" {b} (decade)")
        for fid, a, b in bl_overlap_divergences
    ]
    n_overlap_failures = len(failures)

    for row in sample:
        fact_id = row[col_idx["fact_id"]]
        kind = row[col_idx["kind"]]

        if kind == "jbook_pdf":
            reason = _verify_jbook_pdf(site_dir, row, col_idx)
        elif kind == "workbook":
            reason = _verify_workbook(site_dir, row, col_idx)
        elif kind == "lda_filing":
            reason = _verify_lda(row, col_idx)
        elif kind == "derived":
            reason = _verify_derived(row, col_idx, all_cits, col_idx, fid_to_bl_amount)
        elif kind == "usaspending":
            reason = _verify_usaspending(row, col_idx)
        elif kind == "state_soql":
            reason = _verify_state_soql(row, col_idx)
        elif kind == "state_file":
            reason = _verify_state_file(row, col_idx)
        elif kind == "jbook_narrative":
            reason = _verify_jbook_narrative(row, col_idx)
        else:
            reason = f"unknown citation kind: {kind}"

        if reason:
            failures.append((fact_id, reason))

    sampled = len(sample)
    passed = sampled - (len(failures) - n_overlap_failures)
    ok = sampled > 0 and len(failures) == 0

    return {
        "ok": ok,
        "sampled": sampled,
        "passed": passed,
        "failures": failures,
        "overlap_fids": bl_overlap_fids,
        "overlap_divergent": len(bl_overlap_divergences),
    }


def _load_fid_to_bl_amount(
    site_dir: Path,
) -> tuple[dict[str, str], int, list[tuple[str, str, str]]]:
    """fact_id → amount_thousands across budget_lines ∪ budget_lines_decade.

    Edition-2026 decade grains share workbook fact_ids with the main
    export (5,257 overlapping fids at 5E close). Backlog #24: the old
    setdefault-only load made a divergent decade amount invisible — the
    budget_lines copy always won. Every fid present in BOTH parquets must
    now carry exactly equal amounts (exact Decimal comparison); any
    divergence is returned for citation_gate5b1 to FAIL on.

    Returns (fid→amount str, overlap_count, divergences
    [(fid, budget_lines_amount, decade_amount)] — first 10, sorted by fid
    for determinism).
    """
    from decimal import Decimal as _Decimal, InvalidOperation as _InvalidOperation

    fid_to_bl_amount: dict[str, str] = {}
    divergences: list[tuple[str, str, str]] = []
    overlap = 0
    for bl_name in ("budget_lines.parquet", "budget_lines_decade.parquet"):
        bl_pq = site_dir / "data" / bl_name
        if not bl_pq.exists():
            continue
        try:
            import duckdb as _duckdb
            _con = _duckdb.connect()
            try:
                bl_rows = _con.execute(
                    f"select fact_id, amount_thousands from read_parquet('{_sql_path(bl_pq)}')"
                ).fetchall()
            finally:
                _con.close()
            for _fid, _amt in bl_rows:
                if _fid is None or _amt is None:
                    continue
                existing = fid_to_bl_amount.setdefault(_fid, str(_amt))
                if bl_name == "budget_lines_decade.parquet" and existing != str(_amt):
                    # existing may only come from budget_lines.parquet here
                    # (decade fact_ids are unique within the decade export).
                    try:
                        equal = _Decimal(existing) == _Decimal(str(_amt))
                    except _InvalidOperation:
                        equal = False
                    if not equal:
                        divergences.append((_fid, existing, str(_amt)))
        except Exception:
            pass  # fail gracefully; _verify_derived will FAIL individual rows

    # Overlap count: decade fids already present from budget_lines. Recount
    # cheaply only when both parquets loaded rows.
    bl_pq = site_dir / "data" / "budget_lines.parquet"
    dec_pq = site_dir / "data" / "budget_lines_decade.parquet"
    if bl_pq.exists() and dec_pq.exists():
        try:
            import duckdb as _duckdb
            _con = _duckdb.connect()
            try:
                overlap = _con.execute(
                    f"""
                    select count(*)
                    from read_parquet('{_sql_path(bl_pq)}') a
                    join read_parquet('{_sql_path(dec_pq)}') b using (fact_id)
                    """
                ).fetchone()[0]
            finally:
                _con.close()
        except Exception:
            pass

    divergences.sort(key=lambda d: d[0])
    return fid_to_bl_amount, overlap, divergences[:10]


def _verify_jbook_pdf(site_dir: Path, row: tuple, idx: dict) -> str | None:
    """Re-derive jbook_pdf citation. Returns None on pass, error string on fail."""
    import hashlib

    import pdfplumber

    sha = row[idx["sha256"]]
    amount_text = row[idx["amount_text"]]
    page_number = row[idx["page_number"]]
    stored_x0 = row[idx["x0"]]
    stored_top = row[idx["top_pt"]]

    if not sha:
        return "sha256 is null"
    if not amount_text:
        return "amount_text is null"
    if page_number is None:
        return "page_number is null"

    pdf_path = site_dir / "pdfs" / f"{sha}.pdf"
    if not pdf_path.exists():
        return f"PDF not found: {pdf_path}"

    # SHA check
    actual_sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    if actual_sha != sha:
        return f"sha256 mismatch: stored={sha} actual={actual_sha}"

    # pdfplumber word search on the stored page (1-based → 0-based index)
    try:
        with pdfplumber.open(pdf_path) as pdf:
            page_idx = int(page_number) - 1
            if page_idx < 0 or page_idx >= len(pdf.pages):
                return f"page_number={page_number} out of range (doc has {len(pdf.pages)} pages)"
            page = pdf.pages[page_idx]
            words = page.extract_words()
    except Exception as e:
        return f"pdfplumber error: {e}"

    # Find word matching amount_text
    word = next((w for w in words if w["text"] == amount_text), None)
    if word is None:
        return f"word '{amount_text}' not found on page {page_number}"

    # Bbox tolerance check
    if stored_x0 is not None and abs(float(word["x0"]) - float(stored_x0)) > _BBOX_TOL_PT:
        return (f"x0 mismatch: stored={stored_x0:.2f} actual={word['x0']:.2f}"
                f" (tolerance {_BBOX_TOL_PT} pt)")
    if stored_top is not None and abs(float(word["top"]) - float(stored_top)) > _BBOX_TOL_PT:
        return (f"top_pt mismatch: stored={stored_top:.2f} actual={word['top']:.2f}"
                f" (tolerance {_BBOX_TOL_PT} pt)")

    return None


def _verify_workbook(site_dir: Path, row: tuple, idx: dict) -> str | None:
    """Re-derive workbook citation. Returns None on pass, error string on fail."""
    import hashlib

    from decimal import Decimal as D
    from openpyxl import load_workbook

    sha = row[idx["sha256"]]
    sheet_name = row[idx["sheet"]]
    cells_str = row[idx["cells"]]
    stored_amount = row[idx["amount_thousands"]]

    if not sha:
        return "sha256 is null"
    if not sheet_name:
        return "sheet is null"
    if not cells_str:
        return "cells is null"
    if stored_amount is None:
        return "amount_thousands is null"

    wb_path = site_dir / "workbooks" / f"{sha}.xlsx"
    if not wb_path.exists():
        return f"workbook not found: {wb_path}"

    # SHA check
    actual_sha = hashlib.sha256(wb_path.read_bytes()).hexdigest()
    if actual_sha != sha:
        return f"sha256 mismatch: stored={sha} actual={actual_sha}"

    # Load workbook with same flags as the loaders
    try:
        wb = load_workbook(wb_path, read_only=True, data_only=True)
    except Exception as e:
        return f"load_workbook error: {e}"

    try:
        if sheet_name not in wb.sheetnames:
            return f"sheet '{sheet_name}' not found in workbook"

        ws = wb[sheet_name]

        # Sum cell values
        cell_refs = [c.strip() for c in cells_str.split(",") if c.strip()]
        total = D(0)
        for cell_ref in cell_refs:
            cell = ws[cell_ref]
            val = cell.value
            if val is None:
                continue
            try:
                total += D(str(val))
            except Exception as e:
                return f"cell {cell_ref} value={val!r} not numeric: {e}"

        # Compare with stored amount_thousands (exact Decimal comparison)
        try:
            stored_d = D(str(stored_amount))
        except Exception as e:
            return f"stored amount_thousands={stored_amount!r} not numeric: {e}"

        if total != stored_d:
            return (f"cell sum mismatch: cells={cell_refs} sum={total}"
                    f" stored={stored_d}")

        return None
    finally:
        wb.close()


def _verify_lda(row: tuple, idx: dict) -> str | None:
    """Re-derive lda_filing citation (shape-only, no network). Returns None or error."""
    official_url = row[idx["official_url"]]
    fact_id = row[idx["fact_id"]]

    if not official_url:
        return "official_url is null"

    # TIGHTENED 2026-08-29. This checked only the HOST, so an API endpoint
    # (…/api/v1/filings/{uuid}/) satisfied it — a JSON resource passing as an
    # "official_url" a reader could open. It went unnoticed until the host
    # moved (lda.senate.gov now 301s to lda.gov) and the prefix stopped
    # matching, which is the only reason the weak check ever surfaced.
    #
    # Now requires the PUBLIC filing page. Verified 2026-08-29:
    #   https://lda.gov/filings/public/filing/{uuid}/print/  -> 200
    #   https://lda.senate.gov/filings/public/filing/{uuid}/  -> 301 to lda.gov
    # Both hosts stay acceptable so an older corpus is not retroactively
    # failed for a redirect the Senate performed, but an /api/ path is not.
    if not re.match(r"^https://(lda\.gov|lda\.senate\.gov)/", official_url):
        return f"official_url is not an LDA host: {official_url}"
    if "/api/" in official_url:
        return (
            "official_url points at the JSON API resource, not a page a reader "
            f"can open: {official_url}"
        )

    # The filing UUID must be embedded in the URL path (LDA API contract).
    uuid_pattern = re.compile(r"[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}", re.I)
    if not uuid_pattern.search(official_url):
        return f"filing uuid not found in official_url: {official_url}"

    return None


_FACT_ID_PATTERN = re.compile(r"^[0-9a-f]{16}$")


def _verify_derived(
    row: tuple,
    idx: dict,
    all_cits: list[tuple],
    cit_idx: dict,
    fid_to_bl_amount: "dict[str, str] | None" = None,
) -> str | None:
    """Verify a derived citation.

    Rules:
    1. formula must be non-empty.
    2. recorded_value must be present.
    3. inputs is a JSON array string (may be []).
    4. If all inputs are 16-hex fact_ids (i.e. references to other citations):
       a. All referenced fact_ids must exist in the citation set.
       b0. For flow-node facts (formula starts with 'sum(flow_children',
           Phase 5H): recompute the Decimal sum of the inputs'
           recorded_values within 0.001 tolerance. Checked BEFORE the
           difference rule — flow node ids embed sub-agency/office names
           that may contain ' - ' and must never be misread as differences.
       b. For difference facts (formula contains ' - ') with exactly 2
          16-hex inputs — trajectory Δ and Phase 5E book-diff facts:
          recompute inputs[0] - inputs[1] within 0.001 tolerance. Input
          values resolve from citations.recorded_value, falling back to
          budget-line amounts (budget_lines ∪ budget_lines_decade — the
          book-diff sides may be plain workbook facts) exactly like rule
          4c. Both sides unresolvable → legacy shape-check only.
       c. For trajectory/decade sum (formula starts with
          'sum(budget_lines') with 16-hex inputs: recompute sum within
          0.001 tolerance.
    5. If inputs contain URLs (non-hex strings): shape check only.
    """
    import json as _json
    from decimal import Decimal as D

    formula = row[idx.get("formula", -1)] if "formula" in idx else None
    inputs_raw = row[idx.get("inputs", -1)] if "inputs" in idx else None
    recorded_value = row[idx.get("recorded_value", -1)] if "recorded_value" in idx else None

    if not formula:
        return "formula is null or empty"
    if recorded_value is None:
        return "recorded_value is null"

    # Parse inputs
    if inputs_raw is None:
        inputs = []
    else:
        try:
            inputs = _json.loads(inputs_raw)
        except Exception as e:
            return f"inputs not valid JSON: {e}"
    if not isinstance(inputs, list):
        return "inputs is not a JSON array"

    # Check if all inputs are 16-hex fact_ids
    all_fact_ids = all(isinstance(x, str) and _FACT_ID_PATTERN.match(x) for x in inputs)

    # Rule for sum formula with empty inputs: a 'sum(budget_lines' formula that has
    # no inputs is not recomputable — it must fail.  The emission side must use the
    # pivot formula string instead ('trajectory pivot of budget_lines ...').
    if not inputs and formula.startswith(("sum(budget_lines", "sum(flow_children")):
        return (
            "derived sum formula with empty inputs — not recomputable; "
            "use pivot formula string for honest shape-check rows"
        )

    if inputs and all_fact_ids:
        # Build lookup: fact_id → recorded_value from citation set
        fid_to_rv: dict[str, str | None] = {}
        for cit_row in all_cits:
            cit_fid = cit_row[cit_idx["fact_id"]]
            cit_rv = cit_row[cit_idx.get("recorded_value", -1)] if "recorded_value" in cit_idx else None
            fid_to_rv[cit_fid] = cit_rv

        # Rule 4a: all input fact_ids must resolve
        missing = [f for f in inputs if f not in fid_to_rv]
        if missing:
            return f"derived inputs not found in citations: {missing[:3]}"

        # Rule 4b0 (Phase 5H): flow-node facts — recorded_value must equal the
        # Decimal sum of the inputs' (edge facts') recorded_values. Runs
        # BEFORE the difference rule: node ids inside the formula embed
        # sub-agency/office names that may contain ' - '.
        if formula.startswith("sum(flow_children"):
            values = []
            unresolvable = []
            for inp_fid in inputs:
                rv = fid_to_rv.get(inp_fid)
                if rv is None:
                    unresolvable.append(inp_fid)
                    continue
                try:
                    values.append(D(rv))
                except Exception as e:
                    return f"flow_children input {inp_fid} not numeric: {e}"
            if unresolvable:
                return (
                    f"flow_children inputs unresolvable (no recorded_value): "
                    f"{unresolvable[:3]}"
                )
            try:
                expected_sum = sum(values, D(0))
                actual = D(recorded_value)
                if abs(actual - expected_sum) > D("0.001"):
                    return (
                        f"flow_children recompute mismatch: "
                        f"sum({len(values)} inputs)={expected_sum} "
                        f"but recorded_value={recorded_value}"
                    )
            except Exception as e:
                return f"flow_children recompute error: {e}"

        # Rule 4b: difference formula (trajectory fy2526_change and Phase 5E
        # book-diff facts). Sides resolve via recorded_value with the same
        # budget-line fallback as rule 4c (book-diff sides may be plain
        # workbook facts whose recorded_value is None by design).
        elif " - " in formula and len(inputs) == 2:
            _bl_diff = fid_to_bl_amount or {}
            rv0 = fid_to_rv.get(inputs[0])
            if rv0 is None:
                rv0 = _bl_diff.get(inputs[0])
            rv1 = fid_to_rv.get(inputs[1])
            if rv1 is None:
                rv1 = _bl_diff.get(inputs[1])
            if rv0 is not None and rv1 is not None:
                try:
                    expected = D(rv0) - D(rv1)
                    actual = D(recorded_value)
                    if abs(actual - expected) > D("0.001"):
                        return (
                            f"derived difference recompute mismatch: "
                            f"{rv0} - {rv1} = {expected} but recorded_value={recorded_value}"
                        )
                except Exception as e:
                    return f"derived difference recompute error: {e}"

        # Rule 4c: sum formula over fact_id inputs
        # Workbook citations carry recorded_value=None; resolve their value via
        # fid_to_bl_amount (budget_lines.parquet fact_id→amount_thousands).
        # If an input is still unresolvable after both lookups → FAIL (never skip).
        elif formula.startswith("sum(budget_lines") and len(inputs) > 0:
            _bl = fid_to_bl_amount or {}
            values = []
            unresolvable = []
            for inp_fid in inputs:
                rv = fid_to_rv.get(inp_fid)
                if rv is None:
                    rv = _bl.get(inp_fid)
                if rv is None:
                    unresolvable.append(inp_fid)
                else:
                    try:
                        values.append(D(rv))
                    except Exception as e:
                        return f"derived sum input {inp_fid} not numeric: {e}"
            if unresolvable:
                return (
                    f"derived inputs unresolvable: fact_ids not found in "
                    f"citations.recorded_value or budget_lines.amount_thousands: "
                    f"{unresolvable[:3]}"
                )
            try:
                expected_sum = sum(values, D(0))
                actual = D(recorded_value)
                if abs(actual - expected_sum) > D("0.001"):
                    return (
                        f"derived sum recompute mismatch: "
                        f"sum({len(values)} inputs)={expected_sum} "
                        f"but recorded_value={recorded_value}"
                    )
            except Exception as e:
                return f"derived sum recompute error: {e}"

        # Rule 4d (PM Sprint 2, §P1-3): curated corporate-family combined
        # obligations. THE double-count guard: the combined figure /companies/
        # renders for a merged family must equal the plain sum of its member
        # entity facts' recorded_values — no more (a member counted twice) and
        # no less (a member silently dropped from the sum but shown in the row).
        # Members are disjoint by warehouse construction (entity_xwalk assigns
        # each recipient_uei one family_key; the exporter re-asserts it), so
        # the sum is the correct combination and this recompute is exact.
        elif formula.startswith("sum(entity_family_members") and len(inputs) > 0:
            if len(inputs) < 2:
                return (
                    "entity_family combined fact with fewer than 2 member inputs "
                    "— nothing was combined"
                )
            values = []
            unresolvable = []
            for inp_fid in inputs:
                rv = fid_to_rv.get(inp_fid)
                if rv is None:
                    unresolvable.append(inp_fid)
                    continue
                try:
                    values.append(D(rv))
                except Exception as e:
                    return f"entity_family member {inp_fid} not numeric: {e}"
            if unresolvable:
                return (
                    f"entity_family member facts unresolvable (no recorded_value): "
                    f"{unresolvable[:3]}"
                )
            if len(set(inputs)) != len(inputs):
                return (
                    "entity_family inputs contain a duplicate member fact_id — "
                    "that member's obligations would be counted twice"
                )
            try:
                expected_sum = sum(values, D(0))
                actual = D(recorded_value)
                if abs(actual - expected_sum) > D("0.001"):
                    return (
                        f"entity_family combined recompute mismatch: "
                        f"sum({len(values)} members)={expected_sum} "
                        f"but recorded_value={recorded_value}"
                    )
            except Exception as e:
                return f"entity_family recompute error: {e}"

    # URL inputs or empty inputs: shape check only (no network, no arithmetic)
    # Just confirm recorded_value is a parseable number or non-empty string
    if recorded_value is not None and len(recorded_value.strip()) == 0:
        return "recorded_value is blank"

    return None


# Allowlisted USAspending endpoints (no network in gates — shape check only)
_USASPENDING_ENDPOINT_ALLOWLIST = {
    "api/v2/references/filter/",
    "api/v2/recipient/",
}


def _verify_usaspending(row: tuple, idx: dict) -> str | None:
    """Verify a USAspending citation (shape-only, no network).

    Rules:
    1. official_url must contain api.usaspending.gov with an allowlisted endpoint
       OR be None/empty (hash permalink is optional, durable artifact is query_body).
    2. query_body must be non-null and JSON-parseable.
    3. recorded_value must be present and non-blank.
    4. profile link is optional (official_url may be null for rows where profile
       id lookup failed — this is not a failure).
    """
    import json as _json

    query_body = row[idx.get("query_body", -1)] if "query_body" in idx else None
    recorded_value = row[idx.get("recorded_value", -1)] if "recorded_value" in idx else None
    official_url = row[idx.get("official_url", -1)] if "official_url" in idx else None

    # query_body is the durable artifact — must be present and valid JSON
    if not query_body:
        return "usaspending: query_body is null or empty"
    try:
        parsed = _json.loads(query_body)
    except Exception as e:
        return f"usaspending: query_body is not valid JSON: {e}"
    if not isinstance(parsed, dict):
        return "usaspending: query_body does not parse to a dict"

    # recorded_value must be present
    if recorded_value is None:
        return "usaspending: recorded_value is null"
    if not recorded_value.strip():
        return "usaspending: recorded_value is blank"

    # official_url shape check (optional — may be None when hash minting skipped)
    if official_url:
        # Must reference usaspending.gov domain (not just contain the path fragment)
        if "api.usaspending.gov" not in official_url and "usaspending.gov" not in official_url:
            return (
                f"usaspending: official_url does not reference api.usaspending.gov"
                f" or usaspending.gov: {official_url!r}"
            )

    return None


def _verify_state_soql(row: tuple, idx: dict) -> str | None:
    """Verify a state_soql citation (CT Socrata per-figure aggregate).

    Rules:
    1. official_url must be a data.ct.gov resource URL containing $select and $where.
    2. recorded_value must be present and numeric.
    3. retrieved_at must be present.
    """
    official_url = row[idx.get("official_url", -1)] if "official_url" in idx else None
    recorded_value = row[idx.get("recorded_value", -1)] if "recorded_value" in idx else None
    retrieved_at = row[idx.get("retrieved_at", -1)] if "retrieved_at" in idx else None

    if not official_url:
        return "state_soql: official_url is null or empty"

    # Must reference data.ct.gov
    if "data.ct.gov" not in official_url:
        return f"state_soql: official_url does not reference data.ct.gov: {official_url!r}"

    # Must contain $select and $where (the per-figure aggregate shape)
    if "$select" not in official_url and "%24select" not in official_url:
        return f"state_soql: official_url missing $select (not a per-figure SoQL URL): {official_url!r}"
    if "$where" not in official_url and "%24where" not in official_url:
        return f"state_soql: official_url missing $where (no filter applied): {official_url!r}"

    # recorded_value must be present and parseable as a float
    if recorded_value is None:
        return "state_soql: recorded_value is null"
    if not str(recorded_value).strip():
        return "state_soql: recorded_value is blank"
    try:
        float(recorded_value)
    except (ValueError, TypeError):
        return f"state_soql: recorded_value is not numeric: {recorded_value!r}"

    # retrieved_at must be present
    if not retrieved_at:
        return "state_soql: retrieved_at is null or empty"

    return None


def _verify_state_file(row: tuple, idx: dict) -> str | None:
    """Verify a state_file citation (CA Open Fi$Cal pointer-page tier).

    Rules:
    1. official_url must be https:// (the pointer page URL).
    2. recorded_value must be present and numeric.
    3. retrieved_at must be present.
    """
    official_url = row[idx.get("official_url", -1)] if "official_url" in idx else None
    recorded_value = row[idx.get("recorded_value", -1)] if "recorded_value" in idx else None
    retrieved_at = row[idx.get("retrieved_at", -1)] if "retrieved_at" in idx else None

    if not official_url:
        return "state_file: official_url is null or empty"

    if not official_url.startswith("https://"):
        return f"state_file: official_url does not start with https://: {official_url!r}"

    # recorded_value must be present and parseable as a float
    if recorded_value is None:
        return "state_file: recorded_value is null"
    if not str(recorded_value).strip():
        return "state_file: recorded_value is blank"
    try:
        float(recorded_value)
    except (ValueError, TypeError):
        return f"state_file: recorded_value is not numeric: {recorded_value!r}"

    # retrieved_at must be present
    if not retrieved_at:
        return "state_file: retrieved_at is null or empty"

    return None


def _verify_jbook_narrative(row: tuple, idx: dict) -> str | None:
    """Verify a jbook_narrative citation (shape-only).

    Rules:
    1. sha256 must be present (the document fingerprint).
    2. xml_path must be non-empty and start with 'ProgramElement[' or 'LineItem['.
    3. official_url must be non-empty (the document's source_url).
    """
    sha = row[idx.get("sha256", -1)] if "sha256" in idx else None
    xml_path = row[idx.get("xml_path", -1)] if "xml_path" in idx else None
    official_url = row[idx.get("official_url", -1)] if "official_url" in idx else None

    if not sha:
        return "jbook_narrative: sha256 is null or empty"

    if not xml_path:
        return "jbook_narrative: xml_path is null or empty — narrative not locatable"

    # xml_path must start with a known J-book anchor prefix
    if not (xml_path.startswith("ProgramElement[") or xml_path.startswith("LineItem[")):
        return (
            f"jbook_narrative: xml_path does not start with 'ProgramElement[' or "
            f"'LineItem[': {xml_path!r}"
        )

    if not official_url:
        return "jbook_narrative: official_url is null or empty"

    return None


# ---------------------------------------------------------------------------
# Gate 4: narrative_gate5b1 — narrative provenance re-derivation (Phase 5F §2b)
# ---------------------------------------------------------------------------

_NARRATIVE_SAMPLE_SIZE = 25
_NARRATIVE_BBOX_TOL_PT = 1.0  # bbox must sit inside the stored page box


def narrative_gate5b1(
    site_dir: Path,
    *,
    sample_size: int = _NARRATIVE_SAMPLE_SIZE,
) -> dict:
    """Re-derive a sample of page-resolved jbook_narrative citations.

    For each sampled citation the opening text is RECOMPUTED from the exported
    narrative body (jbook_narratives.parquet, via the BINDING
    narrative_opening — never trusted from the citation row) and must appear,
    whitespace-normalized, in the pypdf text of the cited page of the
    sha-named PDF. Also checked: sha256 integrity, resolution vocabulary,
    #page anchor on hosted_pdf_url, bbox inside the page box.

    PASS iff ≥1 narrative citation carries page provenance AND 100% of the
    sample re-derives. A bundle whose narrative citations are ALL pageless
    FAILS — that is exactly the pre-5F state this leg exists to catch.

    Returns: ok, narrative_total, resolved_total, sampled, passed,
             failures [(fact_id, reason)], reason (structural failures only).
    """
    import hashlib

    site_dir = Path(site_dir)
    base = {
        "ok": False, "narrative_total": 0, "resolved_total": 0,
        "sampled": 0, "passed": 0, "failures": [],
    }
    if not site_dir.exists():
        return {**base, "reason": f"site_dir missing: {site_dir}"}
    cit_pq = site_dir / "citations" / "citations.parquet"
    if not cit_pq.exists():
        return {**base, "reason": f"citations.parquet missing: {cit_pq}"}

    import duckdb

    con = duckdb.connect()
    try:
        narr_rows = con.execute(
            f"select * from read_parquet('{_sql_path(cit_pq)}')"
            " where kind = 'jbook_narrative' order by fact_id"
        ).fetchall()
        col_names = [d[0] for d in con.execute(
            f"describe select * from read_parquet('{_sql_path(cit_pq)}')"
        ).fetchall()]
    finally:
        con.close()
    idx = {name: i for i, name in enumerate(col_names)}

    narrative_total = len(narr_rows)
    if narrative_total == 0:
        return {**base, "reason": "no jbook_narrative citations found"}

    resolved = [r for r in narr_rows if r[idx["page_number"]] is not None]
    resolved_total = len(resolved)
    if resolved_total == 0:
        return {
            **base, "narrative_total": narrative_total,
            "reason": "no narrative citation carries page provenance"
                      " (pre-5F state — run the narrative provenance builder"
                      " and re-export)",
        }

    # fact_id → body from the exported narratives parquet (the re-derivation
    # source; a missing parquet or row is a FAIL, never a skip).
    narr_pq = site_dir / "data" / "jbook_narratives.parquet"
    if not narr_pq.exists():
        return {
            **base, "narrative_total": narrative_total,
            "resolved_total": resolved_total,
            "reason": f"jbook_narratives.parquet missing: {narr_pq}",
        }
    con = duckdb.connect()
    try:
        body_by_fid = {
            r[0]: r[1] for r in con.execute(
                f"select fact_id, body from read_parquet('{_sql_path(narr_pq)}')"
                " where fact_id is not null"
            ).fetchall()
        }
    finally:
        con.close()

    # Deterministic sample: fact_id order (already sorted), evenly strided.
    if resolved_total <= sample_size:
        sample = resolved
    else:
        sample = [
            resolved[(i * resolved_total) // sample_size]
            for i in range(sample_size)
        ]

    from govbudget.jbooks.provenance_pages import narrative_opening, normalize_ws

    failures: list[tuple[str, str]] = []
    page_texts_cache: dict[str, list] = {}   # sha → page texts
    sha_ok_cache: dict[str, str | None] = {}  # sha → None (ok) | reason

    def _check(row) -> str | None:
        fid = row[idx["fact_id"]]
        sha = row[idx["sha256"]]
        page_number = row[idx["page_number"]]
        resolution = row[idx["resolution"]]
        hosted = row[idx["hosted_pdf_url"]]

        if not sha:
            return "sha256 is null"
        if resolution not in ("unique", "ambiguous_first"):
            return f"paged citation with resolution {resolution!r}"
        if not hosted or not hosted.endswith(f"#page={int(page_number)}"):
            return f"hosted_pdf_url lacks #page={int(page_number)} anchor: {hosted!r}"

        body = body_by_fid.get(fid)
        if body is None:
            return "no jbook_narratives row for this fact_id"
        snippet = narrative_opening(body)
        if not snippet:
            return "narrative body yields an empty opening"

        pdf_path = site_dir / "pdfs" / f"{sha}.pdf"
        if sha not in sha_ok_cache:
            if not pdf_path.exists():
                sha_ok_cache[sha] = f"PDF not found: {pdf_path}"
            else:
                actual = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
                sha_ok_cache[sha] = (
                    None if actual == sha
                    else f"sha256 mismatch: stored={sha} actual={actual}"
                )
        if sha_ok_cache[sha] is not None:
            return sha_ok_cache[sha]

        if sha not in page_texts_cache:
            from pypdf import PdfReader
            try:
                page_texts_cache[sha] = [
                    p.extract_text() or "" for p in PdfReader(str(pdf_path)).pages
                ]
            except Exception as e:
                return f"pypdf error: {e}"
        texts = page_texts_cache[sha]
        page_idx = int(page_number) - 1
        if page_idx < 0 or page_idx >= len(texts):
            return f"page_number={page_number} out of range (doc has {len(texts)} pages)"
        if snippet not in normalize_ws(texts[page_idx]):
            return (f"opening text not found on cited page {page_number}:"
                    f" {snippet[:60]!r}")

        # bbox sanity: present and inside the stored page box
        x0, x1 = row[idx["x0"]], row[idx["x1"]]
        top_pt, bottom_pt = row[idx["top_pt"]], row[idx["bottom_pt"]]
        pw, ph = row[idx["page_width"]], row[idx["page_height"]]
        if None in (x0, x1, top_pt, bottom_pt, pw, ph):
            return "paged citation with incomplete bbox"
        tol = _NARRATIVE_BBOX_TOL_PT
        if not (-tol <= x0 < x1 <= pw + tol):
            return f"bbox x out of page box: x0={x0} x1={x1} page_width={pw}"
        if not (-tol <= top_pt < bottom_pt <= ph + tol):
            return (f"bbox y out of page box: top={top_pt} bottom={bottom_pt}"
                    f" page_height={ph}")
        return None

    for row in sample:
        reason = _check(row)
        if reason:
            failures.append((row[idx["fact_id"]], reason))

    sampled = len(sample)
    passed = sampled - len(failures)
    return {
        "ok": sampled > 0 and not failures,
        "narrative_total": narrative_total,
        "resolved_total": resolved_total,
        "sampled": sampled,
        "passed": passed,
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Gate 2: integrity_gate5b1
# ---------------------------------------------------------------------------


def integrity_gate5b1(site_dir: Path) -> dict:
    """Check per-kind set invariants and manifest rowcount reconciliation.

    Returns:
        ok: bool
        checks: dict of sub-check name → bool
        failures: list[str]  — descriptions of invariant violations
        reason: str (only when structural error prevents execution)
    """
    site_dir = Path(site_dir)
    if not site_dir.exists():
        return {
            "ok": False,
            "checks": {},
            "failures": [],
            "reason": f"site_dir missing: {site_dir}",
        }

    cit_pq = site_dir / "citations" / "citations.parquet"
    man_path = site_dir / "manifest.json"

    if not cit_pq.exists():
        return {
            "ok": False,
            "checks": {},
            "failures": [f"citations.parquet missing: {cit_pq}"],
        }

    import duckdb

    failures: list[str] = []
    checks: dict[str, bool] = {}

    def _parquet_ids(path: Path, col: str = "fact_id") -> set[str]:
        if not path.exists():
            return set()
        con = duckdb.connect()
        try:
            return {
                r[0] for r in con.execute(
                    f"select {col} from read_parquet('{_sql_path(path)}')"
                ).fetchall()
                if r[0] is not None
            }
        finally:
            con.close()

    def _parquet_count(path: Path) -> int:
        if not path.exists():
            return 0
        return duckdb.sql(f"select count(*) from read_parquet('{_sql_path(path)}')").fetchone()[0]

    def _parquet_ids_where(path: Path, col: str, where: str) -> set[str]:
        if not path.exists():
            return set()
        con = duckdb.connect()
        try:
            return {
                r[0] for r in con.execute(
                    f"select {col} from read_parquet('{_sql_path(path)}') where {where}"
                ).fetchall()
                if r[0] is not None
            }
        finally:
            con.close()

    # ---- Load citation rows by kind ----
    con = duckdb.connect()
    try:
        all_cit = con.execute(f"select * from read_parquet('{_sql_path(cit_pq)}')").fetchall()
        cit_cols = [d[0] for d in con.execute(f"describe select * from read_parquet('{_sql_path(cit_pq)}')").fetchall()]
    finally:
        con.close()

    cidx = {name: i for i, name in enumerate(cit_cols)}

    jbook_cit_ids: set[str] = set()
    wb_cit_ids: set[str] = set()
    lda_cit_ids: set[str] = set()
    derived_cit_ids: set[str] = set()
    usaspending_cit_ids: set[str] = set()
    state_soql_cit_ids: set[str] = set()
    state_file_cit_ids: set[str] = set()
    jbook_narrative_cit_ids: set[str] = set()

    for row in all_cit:
        kind = row[cidx["kind"]]
        fid = row[cidx["fact_id"]]
        if kind == "jbook_pdf":
            jbook_cit_ids.add(fid)
        elif kind == "workbook":
            wb_cit_ids.add(fid)
        elif kind == "lda_filing":
            lda_cit_ids.add(fid)
        elif kind == "derived":
            derived_cit_ids.add(fid)
        elif kind == "usaspending":
            usaspending_cit_ids.add(fid)
        elif kind == "state_soql":
            state_soql_cit_ids.add(fid)
        elif kind == "state_file":
            state_file_cit_ids.add(fid)
        elif kind == "jbook_narrative":
            jbook_narrative_cit_ids.add(fid)

    # ---- jbook checks ----
    details_pq = site_dir / "data" / "jbook_details.parquet"
    if details_pq.exists():
        con = duckdb.connect()
        try:
            resolved_ids = {
                r[0] for r in con.execute(
                    f"select fact_id from read_parquet('{_sql_path(details_pq)}')"
                    " where resolution in ('unique','ambiguous_first')"
                ).fetchall()
                if r[0] is not None
            }
            unresolved_count = con.execute(
                f"select count(*) from read_parquet('{_sql_path(details_pq)}')"
                " where resolution = 'unresolved'"
            ).fetchone()[0]
            zero_count = con.execute(
                f"select count(*) from read_parquet('{_sql_path(details_pq)}')"
                " where resolution = 'zero_amount'"
            ).fetchone()[0]
        finally:
            con.close()

        # Every resolved detail must have exactly one jbook_pdf citation
        missing_citations = resolved_ids - jbook_cit_ids
        if missing_citations:
            failures.append(
                f"jbook: {len(missing_citations)} resolved details row(s) "
                f"missing jbook_pdf citation: {sorted(missing_citations)[:5]}"
            )
        checks["jbook_all_resolved_cited"] = len(missing_citations) == 0

        # Zero orphan jbook_pdf citations (citation fact_id not in details)
        all_detail_ids = _parquet_ids(details_pq)
        orphan_jbook = jbook_cit_ids - all_detail_ids
        if orphan_jbook:
            failures.append(
                f"jbook: {len(orphan_jbook)} orphan jbook_pdf citation(s) "
                f"not in jbook_details: {sorted(orphan_jbook)[:5]}"
            )
        checks["jbook_no_orphan_citations"] = len(orphan_jbook) == 0

        # Manifest skipped count reconciliation (if manifest exists)
        if man_path.exists():
            try:
                man = json.loads(man_path.read_text())
                man_unresolved = man.get("skipped_unresolved", None)
                man_zero = man.get("skipped_zero_amount", None)
                if man_unresolved is not None and man_zero is not None:
                    expected = unresolved_count + zero_count
                    actual_skipped = man_unresolved + man_zero
                    if actual_skipped != expected:
                        failures.append(
                            f"jbook: manifest skipped counts mismatch — "
                            f"manifest skipped_unresolved={man_unresolved} "
                            f"skipped_zero_amount={man_zero} "
                            f"(total={actual_skipped}) but parquet has "
                            f"unresolved={unresolved_count} zero_amount={zero_count} "
                            f"(total={expected})"
                        )
                    checks["jbook_manifest_skip_counts"] = (actual_skipped == expected)
            except Exception:
                pass
    else:
        checks["jbook_all_resolved_cited"] = True  # no details → trivially ok
        checks["jbook_no_orphan_citations"] = len(jbook_cit_ids) == 0

    # ---- workbook checks ----
    # Phase 5E gate-scope extension (documented in
    # docs/superpowers/reviews/5c-gates-pre-failure.txt): the workbook fact
    # universe is budget_lines.parquet ∪ budget_lines_decade.parquet — the
    # decade tier ships old-edition (PB2017–PB2025) workbook rows in the
    # sibling parquet so the PB2026 edition fence stays intact. Set
    # equality remains bidirectional over the union.
    bl_pq = site_dir / "data" / "budget_lines.parquet"
    bl_ids = _parquet_ids(bl_pq) | _parquet_ids(
        site_dir / "data" / "budget_lines_decade.parquet"
    )
    if wb_cit_ids or bl_ids:
        wb_orphan = wb_cit_ids - bl_ids  # citation fact_ids not in budget_lines
        bl_uncited = bl_ids - wb_cit_ids  # budget_lines fact_ids not cited
        # Both directions must match exactly
        if wb_orphan:
            failures.append(
                f"workbook: {len(wb_orphan)} citation fact_id(s) not in"
                f" budget_lines ∪ budget_lines_decade: {sorted(wb_orphan)[:5]}"
            )
        if bl_uncited:
            failures.append(
                f"workbook: {len(bl_uncited)} budget_lines fact_id(s) not cited: "
                f"{sorted(bl_uncited)[:5]}"
            )
        checks["workbook_set_equality"] = len(wb_orphan) == 0 and len(bl_uncited) == 0
    else:
        checks["workbook_set_equality"] = True

    # ---- citation_distinctness check ----
    # For each citation kind, verify that total row count == count(distinct fact_id).
    # A duplicate fact_id within a kind means a join fan-out slipped through (e.g. a
    # filing_uuid that appears twice in lda_filings multiplied a mention row).
    distinctness_ok = True
    for kind in ("jbook_pdf", "workbook", "lda_filing", "derived", "usaspending",
                 "state_soql", "state_file", "jbook_narrative"):
        con = duckdb.connect()
        try:
            row = con.execute(
                f"select count(*), count(distinct fact_id)"
                f" from read_parquet('{_sql_path(cit_pq)}')"
                f" where kind = ?",
                [kind],
            ).fetchone()
        finally:
            con.close()
        total_rows, distinct_ids = row
        if total_rows != distinct_ids:
            failures.append(
                f"citation_distinctness: kind={kind!r} has {total_rows} rows"
                f" but only {distinct_ids} distinct fact_ids"
                f" ({total_rows - distinct_ids} duplicate(s))"
            )
            distinctness_ok = False
    checks["citation_distinctness"] = distinctness_ok

    # ---- LDA checks ----
    # kind='lda_filing' rows come from THREE emitters (all must re-derive):
    #   1. mention grain — fact_id_lda(filing_uuid, pe_bli, matched_term)
    #      from fct_program_lobbying rows
    #   2. filing-amount grain (Task 2b/6a) — fact_id_lda_filing(uuid, role)
    #      for non-null income/expenses, re-derived from the filings sidecars
    #   3. lobbyist grain (ledger clearance) —
    #      fact_id_lda_lobbyist(disclosing_filing_uuid, name), re-derived from
    #      the enriched dim_lobbyists.parquet columns
    lda_pq = site_dir / "data" / "fct_program_lobbying.parquet"
    if lda_pq.exists() and lda_cit_ids:
        from govbudget.export_site import (
            fact_id_lda,
            fact_id_lda_filing,
            fact_id_lda_lobbyist,
        )

        con = duckdb.connect()
        try:
            lda_mart_rows = con.execute(
                f"select filing_uuid, pe_bli, matched_term"
                f" from read_parquet('{_sql_path(lda_pq)}')"
            ).fetchall()
        finally:
            con.close()

        # Recompute mention-grain fact_ids from the mart
        mart_fids = {
            fact_id_lda(r[0], r[1], r[2])
            for r in lda_mart_rows
            if r[0] and r[1] and r[2]
        }

        # Recompute filing-amount fact_ids from the filings sidecars (the
        # sidecar carries the amount IFF its citation row was emitted)
        filing_fids: set[str] = set()
        filings_dir = site_dir / "json" / "filings"
        if filings_dir.is_dir():
            import json as _json

            for fp in filings_dir.glob("*.json"):
                try:
                    filing = _json.loads(fp.read_text()).get("filing", {})
                except Exception:
                    continue
                f_uuid = filing.get("filing_uuid")
                if not f_uuid:
                    continue
                if filing.get("income_usd") is not None:
                    filing_fids.add(fact_id_lda_filing(f_uuid, "income"))
                if filing.get("expenses_usd") is not None:
                    filing_fids.add(fact_id_lda_filing(f_uuid, "expenses"))

        # Recompute lobbyist-grain fact_ids from the enriched
        # dim_lobbyists.parquet (name + disclosing_filing_uuid columns).
        # Older bundles without the columns contribute an empty set.
        lobbyist_fids: set[str] = set()
        lob_pq = site_dir / "data" / "dim_lobbyists.parquet"
        if lob_pq.exists():
            con = duckdb.connect()
            try:
                lob_cols = {
                    d[0] for d in con.execute(
                        f"describe select * from read_parquet('{_sql_path(lob_pq)}')"
                    ).fetchall()
                }
                if {"name", "disclosing_filing_uuid"} <= lob_cols:
                    for name, dfu in con.execute(
                        f"select name, disclosing_filing_uuid"
                        f" from read_parquet('{_sql_path(lob_pq)}')"
                        f" where disclosing_filing_uuid is not null"
                    ).fetchall():
                        if name and dfu:
                            lobbyist_fids.add(fact_id_lda_lobbyist(dfu, name))
            finally:
                con.close()

        lda_not_in_mart = lda_cit_ids - mart_fids - filing_fids - lobbyist_fids
        if lda_not_in_mart:
            failures.append(
                f"lda: {len(lda_not_in_mart)} lda_filing citation fact_id(s) "
                f"not re-derivable from fct_program_lobbying, the filings "
                f"sidecars, or dim_lobbyists disclosing filings: "
                f"{sorted(lda_not_in_mart)[:5]}"
            )
        checks["lda_fact_ids_in_mart"] = len(lda_not_in_mart) == 0
    else:
        checks["lda_fact_ids_in_mart"] = True

    # ---- Derived checks ----
    # For each derived citation: formula non-empty + recorded_value present.
    # Input resolution: if inputs are fact_ids, they must all exist in citations.
    if derived_cit_ids:
        derived_failures: list[str] = []
        # Build a fast fact_id lookup from all_cit
        all_cit_fid_set = {r[cidx["fact_id"]] for r in all_cit}
        for row in all_cit:
            if row[cidx["kind"]] != "derived":
                continue
            fid = row[cidx["fact_id"]]
            # formula must be non-empty
            formula = row[cidx["formula"]] if "formula" in cidx else None
            recorded_value = row[cidx["recorded_value"]] if "recorded_value" in cidx else None
            inputs_raw = row[cidx["inputs"]] if "inputs" in cidx else None
            if not formula:
                derived_failures.append(f"derived {fid}: formula is null/empty")
                continue
            if recorded_value is None:
                derived_failures.append(f"derived {fid}: recorded_value is null")
                continue
            # Check input fact_id resolution
            if inputs_raw:
                try:
                    import json as _json
                    import re as _re
                    inputs_list = _json.loads(inputs_raw)
                    _hex16 = _re.compile(r"^[0-9a-f]{16}$")
                    fid_inputs = [x for x in inputs_list if isinstance(x, str) and _hex16.match(x)]
                    for inp in fid_inputs:
                        if inp not in all_cit_fid_set:
                            derived_failures.append(
                                f"derived {fid}: input fact_id {inp!r} not found in citations"
                            )
                except Exception:
                    pass  # invalid JSON handled by citation_gate
        if derived_failures:
            failures.extend(derived_failures[:5])
        checks["derived_formula_and_value"] = len(derived_failures) == 0
    else:
        checks["derived_formula_and_value"] = True

    # ---- USAspending checks ----
    # For each usaspending citation: query_body parses as JSON + recorded_value present.
    if usaspending_cit_ids:
        usas_failures: list[str] = []
        for row in all_cit:
            if row[cidx["kind"]] != "usaspending":
                continue
            fid = row[cidx["fact_id"]]
            query_body = row[cidx["query_body"]] if "query_body" in cidx else None
            recorded_value = row[cidx["recorded_value"]] if "recorded_value" in cidx else None
            if not query_body:
                usas_failures.append(f"usaspending {fid}: query_body is null/empty")
                continue
            try:
                import json as _json
                parsed = _json.loads(query_body)
                if not isinstance(parsed, dict):
                    usas_failures.append(f"usaspending {fid}: query_body not a dict")
            except Exception:
                usas_failures.append(f"usaspending {fid}: query_body not valid JSON")
            if recorded_value is None or not str(recorded_value).strip():
                usas_failures.append(f"usaspending {fid}: recorded_value is null/blank")
        if usas_failures:
            failures.extend(usas_failures[:5])
        checks["usaspending_query_and_value"] = len(usas_failures) == 0
    else:
        checks["usaspending_query_and_value"] = True

    # ---- State SOQL checks ----
    # For each state_soql citation: official_url is data.ct.gov + $select/$where shape +
    # recorded_value present + retrieved_at present.
    if state_soql_cit_ids:
        soql_failures: list[str] = []
        for row in all_cit:
            if row[cidx["kind"]] != "state_soql":
                continue
            fid = row[cidx["fact_id"]]
            official_url = row[cidx["official_url"]] if "official_url" in cidx else None
            recorded_value = row[cidx["recorded_value"]] if "recorded_value" in cidx else None
            retrieved_at = row[cidx["retrieved_at"]] if "retrieved_at" in cidx else None
            if not official_url or "data.ct.gov" not in official_url:
                soql_failures.append(f"state_soql {fid}: official_url not data.ct.gov: {official_url!r}")
            if recorded_value is None or not str(recorded_value).strip():
                soql_failures.append(f"state_soql {fid}: recorded_value is null/blank")
            if not retrieved_at:
                soql_failures.append(f"state_soql {fid}: retrieved_at is null/blank")
        if soql_failures:
            failures.extend(soql_failures[:5])
        checks["state_soql_url_and_value"] = len(soql_failures) == 0
    else:
        checks["state_soql_url_and_value"] = True

    # ---- State file checks ----
    # For each state_file citation: official_url is https:// + recorded_value present +
    # retrieved_at present.
    if state_file_cit_ids:
        file_failures: list[str] = []
        for row in all_cit:
            if row[cidx["kind"]] != "state_file":
                continue
            fid = row[cidx["fact_id"]]
            official_url = row[cidx["official_url"]] if "official_url" in cidx else None
            recorded_value = row[cidx["recorded_value"]] if "recorded_value" in cidx else None
            retrieved_at = row[cidx["retrieved_at"]] if "retrieved_at" in cidx else None
            if not official_url or not official_url.startswith("https://"):
                file_failures.append(f"state_file {fid}: official_url not https://: {official_url!r}")
            if recorded_value is None or not str(recorded_value).strip():
                file_failures.append(f"state_file {fid}: recorded_value is null/blank")
            if not retrieved_at:
                file_failures.append(f"state_file {fid}: retrieved_at is null/blank")
        if file_failures:
            failures.extend(file_failures[:5])
        checks["state_file_url_and_value"] = len(file_failures) == 0
    else:
        checks["state_file_url_and_value"] = True

    # ---- jbook_narrative checks ----
    # For each jbook_narrative citation:
    #   - sha256 must be present
    #   - xml_path must be non-empty and start with a known J-book anchor
    #   - official_url must be non-empty
    # Additionally every jbook_narrative citation fact_id must appear in
    # jbook_narratives.parquet (no orphan citations).
    if jbook_narrative_cit_ids:
        narr_pq = site_dir / "data" / "jbook_narratives.parquet"
        narr_failures: list[str] = []
        for row in all_cit:
            if row[cidx["kind"]] != "jbook_narrative":
                continue
            fid = row[cidx["fact_id"]]
            sha = row[cidx["sha256"]] if "sha256" in cidx else None
            xml_path = row[cidx["xml_path"]] if "xml_path" in cidx else None
            official_url = row[cidx["official_url"]] if "official_url" in cidx else None
            if not sha:
                narr_failures.append(f"jbook_narrative {fid}: sha256 is null")
            if not xml_path:
                narr_failures.append(f"jbook_narrative {fid}: xml_path is null/empty")
            elif not (xml_path.startswith("ProgramElement[") or xml_path.startswith("LineItem[")):
                narr_failures.append(
                    f"jbook_narrative {fid}: xml_path does not start with "
                    f"'ProgramElement[' or 'LineItem[': {xml_path!r}"
                )
            if not official_url:
                narr_failures.append(f"jbook_narrative {fid}: official_url is null/empty")
        # Orphan check: every citation fact_id must exist in jbook_narratives.parquet
        narr_fact_ids = _parquet_ids(narr_pq) if narr_pq.exists() else set()
        orphan_narr = jbook_narrative_cit_ids - narr_fact_ids
        if orphan_narr:
            narr_failures.append(
                f"jbook_narrative: {len(orphan_narr)} orphan citation fact_id(s) not in "
                f"jbook_narratives.parquet: {sorted(orphan_narr)[:5]}"
            )
        if narr_failures:
            failures.extend(narr_failures[:5])
        checks["jbook_narrative_shape"] = len(narr_failures) == 0
    else:
        checks["jbook_narrative_shape"] = True

    # ---- Manifest rowcount check ----
    if man_path.exists():
        try:
            man = json.loads(man_path.read_text())
            man_datasets = man.get("datasets", {})
            rowcount_ok = True
            for name, expected_count in man_datasets.items():
                pq_path = site_dir / "data" / f"{name}.parquet"
                if pq_path.exists():
                    actual = _parquet_count(pq_path)
                    if actual != expected_count:
                        failures.append(
                            f"manifest: {name} declares {expected_count} rows"
                            f" but parquet has {actual}"
                        )
                        rowcount_ok = False
            checks["manifest_rowcounts_match"] = rowcount_ok
        except Exception as e:
            failures.append(f"manifest parse error: {e}")
            checks["manifest_rowcounts_match"] = False
    else:
        checks["manifest_rowcounts_match"] = True  # no manifest → skip check

    ok = len(failures) == 0
    return {
        "ok": ok,
        "checks": checks,
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Gate 3: coverage_report5b1 (non-gating)
# ---------------------------------------------------------------------------


def coverage_report5b1(site_dir: Path) -> dict:
    """Non-gating coverage statistics.

    Returns a dict with:
        by_resolution: {resolution: count}
        total_details: int
        uncited_datasets: list[str]  — from manifest
        error: str (only if site_dir/files missing)
    """
    site_dir = Path(site_dir)

    if not site_dir.exists():
        return {
            "by_resolution": {},
            "total_details": 0,
            "uncited_datasets": [],
            "error": f"site_dir missing: {site_dir}",
        }

    details_pq = site_dir / "data" / "jbook_details.parquet"
    man_path = site_dir / "manifest.json"

    by_resolution: dict[str, int] = {}
    total = 0

    if details_pq.exists():
        import duckdb

        con = duckdb.connect()
        try:
            rows = con.execute(
                f"select resolution, count(*) from read_parquet('{_sql_path(details_pq)}')"
                " group by resolution order by resolution"
            ).fetchall()
        finally:
            con.close()
        for res, count in rows:
            by_resolution[res or "null"] = count
            total += count

    uncited: list[str] = []
    if man_path.exists():
        try:
            man = json.loads(man_path.read_text())
            uncited = man.get("uncited_datasets", [])
        except Exception:
            pass

    return {
        "by_resolution": by_resolution,
        "total_details": total,
        "unique": by_resolution.get("unique", 0),
        "ambiguous_first": by_resolution.get("ambiguous_first", 0),
        "zero_amount": by_resolution.get("zero_amount", 0),
        "unresolved": by_resolution.get("unresolved", 0),
        "uncited_datasets": uncited,
    }
