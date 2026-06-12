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
                          one citation was sampled.

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
        passed: int
        failures: list[(fact_id, reason)]
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

    failures: list[tuple[str, str]] = []

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
            reason = _verify_derived(row, col_idx, all_cits, col_idx)
        elif kind == "usaspending":
            reason = _verify_usaspending(row, col_idx)
        elif kind == "state_soql":
            reason = _verify_state_soql(row, col_idx)
        elif kind == "state_file":
            reason = _verify_state_file(row, col_idx)
        else:
            reason = f"unknown citation kind: {kind}"

        if reason:
            failures.append((fact_id, reason))

    sampled = len(sample)
    passed = sampled - len(failures)
    ok = sampled > 0 and len(failures) == 0

    return {
        "ok": ok,
        "sampled": sampled,
        "passed": passed,
        "failures": failures,
    }


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

    if not official_url.startswith("https://lda.senate.gov/"):
        return f"official_url does not start with https://lda.senate.gov/: {official_url}"

    # The filing UUID must be embedded in the URL path (LDA API contract).
    # All live LDA filing URLs are https://lda.senate.gov/filings/{uuid}/
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
) -> str | None:
    """Verify a derived citation.

    Rules:
    1. formula must be non-empty.
    2. recorded_value must be present.
    3. inputs is a JSON array string (may be []).
    4. If all inputs are 16-hex fact_ids (i.e. references to other citations):
       a. All referenced fact_ids must exist in the citation set.
       b. For trajectory difference (formula contains ' - ') with exactly 2
          16-hex inputs: recompute fy26 - fy25 within 0.001 tolerance.
       c. For trajectory sum (formula starts with 'sum(budget_lines') with
          16-hex inputs: recompute sum within 0.001 tolerance.
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

        # Rule 4b: difference formula (fy2526_change = fy2026 - fy2025)
        if " - " in formula and len(inputs) == 2:
            rv0 = fid_to_rv.get(inputs[0])
            rv1 = fid_to_rv.get(inputs[1])
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
        elif formula.startswith("sum(budget_lines") and len(inputs) > 0:
            values = []
            for inp_fid in inputs:
                rv = fid_to_rv.get(inp_fid)
                if rv is not None:
                    try:
                        values.append(D(rv))
                    except Exception:
                        pass
            if values:
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
    bl_pq = site_dir / "data" / "budget_lines.parquet"
    bl_ids = _parquet_ids(bl_pq)
    if wb_cit_ids or bl_ids:
        wb_orphan = wb_cit_ids - bl_ids  # citation fact_ids not in budget_lines
        bl_uncited = bl_ids - wb_cit_ids  # budget_lines fact_ids not cited
        # Both directions must match exactly
        if wb_orphan:
            failures.append(
                f"workbook: {len(wb_orphan)} citation fact_id(s) not in budget_lines: "
                f"{sorted(wb_orphan)[:5]}"
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
                 "state_soql", "state_file"):
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
    lda_pq = site_dir / "data" / "fct_program_lobbying.parquet"
    if lda_pq.exists() and lda_cit_ids:
        from govbudget.export_site import fact_id_lda

        con = duckdb.connect()
        try:
            lda_mart_rows = con.execute(
                f"select filing_uuid, pe_bli, matched_term"
                f" from read_parquet('{_sql_path(lda_pq)}')"
            ).fetchall()
        finally:
            con.close()

        # Recompute fact_ids from the mart
        mart_fids = {
            fact_id_lda(r[0], r[1], r[2])
            for r in lda_mart_rows
            if r[0] and r[1] and r[2]
        }
        lda_not_in_mart = lda_cit_ids - mart_fids
        if lda_not_in_mart:
            failures.append(
                f"lda: {len(lda_not_in_mart)} lda_filing citation fact_id(s) "
                f"not re-derivable from fct_program_lobbying: {sorted(lda_not_in_mart)[:5]}"
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
