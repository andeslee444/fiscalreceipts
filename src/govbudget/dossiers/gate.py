"""Phase 5B-3 Task 7b: dossier cited-or-absent gate.

Per the plan's evaluator design (dossier_gate bullet):

- all top-50 pe_blis ∈ dim_programs — the pre-batch assertion, also exposed
  standalone via `govbudget dossiers gate --pre` (recon §C: a naive top-50
  over fct_budget_trajectory alone picks service lines without pages).
- a dossier file exists for every top-50 pe_bli and is structurally valid.
- ZERO claims with unresolvable citations: every {"fact_id"} must be a key
  of citations.json; every {"url"} must be the url of a cached snapshot.
- >= 80% of claims CORPUS-WIDE carry warehouse (fact_id) citations.
- required sections (what_it_is / why_it_matters / players) are non-empty;
  recent_developments MAY be empty (warehouse-only dossiers are valid).
- program_categories.csv covers all top-50 pe_blis with an enum category and
  a resolvable source_ref (snapshot:{sha} resolving to a cached snapshot, a
  J-book xml_path, jbook:{pe_bli}:{xml_path}, or lda:{filing_uuid} — the
  conventions documented in govbudget.dossiers.research).

Returns the standard {ok, ...} dict; wired into verify-phase5b3 in Task 9.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from govbudget.dossiers.batch import (
    ALL_SECTIONS,
    REQUIRED_SECTIONS,
    validate_dossier,
)

WAREHOUSE_FLOOR = 0.80

CATEGORY_ENUM = frozenset(
    {"drones", "hypersonics", "space", "shipbuilding", "cyber", "default"}
)

_XML_PATH_RE = re.compile(
    r"^[A-Za-z][A-Za-z0-9]*\[\d+\](?:/[A-Za-z][A-Za-z0-9]*\[\d+\])*$"
)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def _load_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _top_pe(top50_list) -> list[str]:
    """Accept top50() tuples or bare pe_bli strings."""
    return [r[0] if isinstance(r, (list, tuple)) else r for r in top50_list]


def dim_programs_pe_set(duckdb_path: str | Path) -> set[str]:
    import duckdb

    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        return {r[0] for r in con.execute("select pe_bli from dim_programs").fetchall()}
    finally:
        con.close()


def pre_batch_check(top50_pe: list[str], dim_programs_pe: set[str]) -> dict:
    """Recon §C assertion: every dossier pe_bli has a program page."""
    pes = _top_pe(top50_pe)
    missing = sorted(set(pes) - set(dim_programs_pe))
    return {"ok": not missing, "count": len(pes), "missing": missing}


def source_ref_resolvable(ref: str, snapshot_shas: set[str]) -> bool:
    """program_categories.csv source_ref conventions (research.py docstring)."""
    ref = (ref or "").strip()
    if not ref:
        return False
    if ref.startswith("snapshot:"):
        return ref.split(":", 1)[1] in snapshot_shas
    if ref.startswith("lda:"):
        return bool(_UUID_RE.fullmatch(ref.split(":", 1)[1]))
    if ref.startswith("jbook:"):
        parts = ref.split(":", 2)
        return (
            len(parts) == 3
            and bool(parts[1])
            and bool(_XML_PATH_RE.fullmatch(parts[2]))
        )
    return bool(_XML_PATH_RE.fullmatch(ref))


def dossier_gate(
    dossier_dir: str | Path,
    citations_path: str | Path,
    snapshots_index: str | Path,
    categories_csv: str | Path,
    top50_list,
    *,
    dim_programs_pe: set[str] | None = None,
    warehouse_floor: float = WAREHOUSE_FLOOR,
) -> dict:
    """The cited-or-absent dossier gate. Returns {ok, checks, totals}."""
    dossier_dir = Path(dossier_dir)
    top_pe = _top_pe(top50_list)
    checks: dict[str, dict] = {}

    # -- pre-batch assertion (also standalone via `dossiers gate --pre`) ----
    if dim_programs_pe is not None:
        checks["pre_batch"] = pre_batch_check(top_pe, dim_programs_pe)

    # -- reference sets -----------------------------------------------------
    citations_path = Path(citations_path)
    fact_ids: set[str] = (
        set(_load_json(citations_path).keys()) if citations_path.exists() else set()
    )
    snapshots_index = Path(snapshots_index)
    snapshot_urls: set[str] = set()
    snapshot_shas: set[str] = set()
    if snapshots_index.exists():
        for entry in _load_json(snapshots_index).get("snapshots", []):
            if entry.get("url"):
                snapshot_urls.add(entry["url"])
            if entry.get("sha256"):
                snapshot_shas.add(entry["sha256"])

    # -- walk dossiers --------------------------------------------------------
    missing_files: list[str] = []
    structure_errors: list[str] = []
    unresolved: list[dict] = []
    empty_required: list[str] = []
    total_claims = 0
    warehouse_claims = 0

    for pe_bli in top_pe:
        path = dossier_dir / f"{pe_bli}.json"
        if not path.exists():
            missing_files.append(pe_bli)
            continue
        doc = _load_json(path)
        sections = doc.get("dossier", doc) if isinstance(doc, dict) else doc
        errors = validate_dossier(sections)
        if errors:
            structure_errors.extend(f"{pe_bli}: {e}" for e in errors)
            continue
        for section in ALL_SECTIONS:
            claims = sections[section]["claims"]
            if section in REQUIRED_SECTIONS and not claims:
                empty_required.append(f"{pe_bli}: {section}")
            for i, claim in enumerate(claims):
                total_claims += 1
                citation = claim["citation"]
                if "fact_id" in citation:
                    warehouse_claims += 1
                    if citation["fact_id"] not in fact_ids:
                        unresolved.append(
                            {
                                "pe_bli": pe_bli,
                                "section": section,
                                "claim": i,
                                "fact_id": citation["fact_id"],
                            }
                        )
                else:
                    if citation["url"] not in snapshot_urls:
                        unresolved.append(
                            {
                                "pe_bli": pe_bli,
                                "section": section,
                                "claim": i,
                                "url": citation["url"],
                            }
                        )

    checks["dossiers_present"] = {
        "ok": not missing_files,
        "expected": len(top_pe),
        "missing": missing_files,
    }
    checks["structure"] = {
        "ok": not structure_errors,
        "errors": structure_errors,
    }
    checks["citations_resolvable"] = {
        "ok": not unresolved,
        "unresolved": unresolved,
    }
    checks["required_sections"] = {
        "ok": not empty_required,
        "empty": empty_required,
    }
    ratio = (warehouse_claims / total_claims) if total_claims else 0.0
    checks["warehouse_ratio"] = {
        "ok": total_claims > 0 and ratio >= warehouse_floor,
        "claims": total_claims,
        "warehouse_cited": warehouse_claims,
        "ratio": ratio,
        "floor": warehouse_floor,
    }

    # -- categories -----------------------------------------------------------
    categories_csv = Path(categories_csv)
    cat_rows: dict[str, dict] = {}
    if categories_csv.exists():
        with categories_csv.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                pe = (row.get("pe_bli") or "").strip()
                if pe:
                    cat_rows[pe] = row
    cat_missing = sorted(set(top_pe) - set(cat_rows))
    cat_bad: list[str] = []
    for pe_bli in top_pe:
        row = cat_rows.get(pe_bli)
        if row is None:
            continue
        if (row.get("category") or "").strip() not in CATEGORY_ENUM:
            cat_bad.append(f"{pe_bli}: category {row.get('category')!r} not in enum")
        if not source_ref_resolvable(row.get("source_ref") or "", snapshot_shas):
            cat_bad.append(
                f"{pe_bli}: unresolvable source_ref {row.get('source_ref')!r}"
            )
    checks["categories"] = {
        "ok": not cat_missing and not cat_bad,
        "missing": cat_missing,
        "errors": cat_bad,
    }

    return {
        "ok": all(c["ok"] for c in checks.values()),
        "checks": checks,
        "totals": {
            "dossiers": len(top_pe) - len(missing_files),
            "claims": total_claims,
            "warehouse_cited": warehouse_claims,
            "warehouse_ratio": ratio,
        },
    }


def print_gate(result: dict) -> None:
    """Human-readable PASS/FAIL rendering for the CLI."""
    for name, check in result["checks"].items():
        status = "PASS" if check["ok"] else "FAIL"
        detail = ""
        if name == "warehouse_ratio":
            detail = (
                f" ({check['warehouse_cited']}/{check['claims']}"
                f" = {check['ratio']:.1%}, floor {check['floor']:.0%})"
            )
        print(f"dossier gate: {name}: {status}{detail}")
        if not check["ok"]:
            for key in ("missing", "errors", "unresolved", "empty"):
                for item in check.get(key, [])[:20]:
                    print(f"  {key[:-1] if key.endswith('s') else key}: {item}")
    print(f"dossier gate: {'PASS' if result['ok'] else 'FAIL'}")
