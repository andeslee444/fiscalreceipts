"""Per-edition probe + coverage manifest (Phase 5E decade backfill, spec §2.3).

Older PB editions may deviate (URL layout, file naming, .zzz convention, XML
schema drift). Before an edition's loader runs, probe_edition smoke-tests the
whole chain on ONE sample book: index URLs reachable → discovery count sane →
sample RDT&E PDF downloads → embedded XML extracts → jb-2009 parse yields
ProgramElements whose self-described BudgetYear matches the edition.

Spec honesty rule: every probe outcome is recorded in
data/research/edition_manifest.json (record_probe). Editions that fail keep
status='probe_failed' + the precise reason, so the verify-phase5e edition
coverage gate surfaces them as WARN/FAIL — an honest gap, never a silent skip.
"""
from __future__ import annotations

import datetime as dt
import json
import tempfile
from pathlib import Path

import httpx

# Sane per-edition discovery envelope. FY2025/FY2026 both discover 37
# classifiable documents (18 rdte + 16 procurement + 3 rollups); the range
# leaves head-room for edition-to-edition drift without accepting a page
# reorganization that silently drops half the books.
DISCOVERED_MIN = 30
DISCOVERED_MAX = 45
# PB2017–PB2023 publish consolidated Defense-Wide volumes instead of ~34
# per-agency books: as few as 5 classifiable documents (PB2023: 3 RDT&E
# volumes + 2 procurement volumes) plus 3 rollups is a healthy edition.
LEGACY_DISCOVERED_MIN = 5
LEGACY_LAST_FY = 2023


def discovery_envelope(fy: int) -> tuple[int, int]:
    """Edition-aware [min, max] discovery envelope."""
    lo = LEGACY_DISCOVERED_MIN if fy <= LEGACY_LAST_FY else DISCOVERED_MIN
    return lo, DISCOVERED_MAX


def probe_edition(client: httpx.Client, fy: int, *, work_dir: Path | None = None) -> dict:
    """Smoke-test one PB edition end to end. Never raises for probe-visible
    failures — returns {fy, ok, reason, discovered, sample_pe_count} with a
    precise reason on the first failed check.
    """
    from govbudget.cli import jbook_index_urls
    from govbudget.jbooks import registry
    from govbudget.jbooks.attachments import extract_jbook_xml, pick_book_xml
    from govbudget.jbooks.xml_parser import parse_jbook_xml

    result = {"fy": fy, "ok": False, "reason": "", "discovered": 0, "sample_pe_count": 0}

    # 1. Both index URLs reachable (HTTP 200) + document discovery.
    docs: list[dict] = []
    seen: set[str] = set()
    for index_url in jbook_index_urls(fy):
        try:
            found = registry.discover_documents(client, index_url, fiscal_year=fy)
        except httpx.HTTPStatusError as e:
            result["reason"] = (
                f"index URL not reachable: {index_url}"
                f" (HTTP {e.response.status_code})"
            )
            return result
        except httpx.HTTPError as e:
            result["reason"] = (
                f"index URL not reachable: {index_url} ({type(e).__name__}: {e})"
            )
            return result
        for d in found:
            if d["source_url"] not in seen:
                seen.add(d["source_url"])
                docs.append(d)
    result["discovered"] = len(docs)

    # 2. Discovery count in the sane (edition-aware) envelope.
    lo, hi = discovery_envelope(fy)
    if not (lo <= len(docs) <= hi):
        result["reason"] = (
            f"discovered {len(docs)} documents — outside sane range"
            f" [{lo}, {hi}]"
        )
        return result

    # 3. Download ONE sample rdte PDF to a temp dir.
    rdte = sorted(
        (d for d in docs if d["exhibit_family"] == "rdte"), key=lambda d: d["title"]
    )
    if not rdte:
        result["reason"] = "no rdte documents discovered — cannot sample"
        return result
    sample = rdte[0]
    work = Path(work_dir) if work_dir is not None else Path(
        tempfile.mkdtemp(prefix=f"govbudget-probe-pb{fy}-")
    )
    work.mkdir(parents=True, exist_ok=True)
    pdf_path = work / sample["title"]
    try:
        r = client.get(sample["source_url"], follow_redirects=True)
        r.raise_for_status()
        pdf_path.write_bytes(r.content)
    except httpx.HTTPError as e:
        result["reason"] = (
            f"sample download failed: {sample['source_url']}"
            f" ({type(e).__name__}: {e})"
        )
        return result

    # 4. Embedded-XML extraction (.zzz renamed-zip convention).
    try:
        xmls = extract_jbook_xml(pdf_path, work / "xml")
    except Exception as e:
        result["reason"] = (
            f"extract_jbook_xml failed on {sample['title']}"
            f" ({type(e).__name__}: {e})"
        )
        return result
    if not xmls:
        result["reason"] = f"no embedded XML extracted from sample {sample['title']}"
        return result
    book_xml = pick_book_xml(work / "xml", family="rdte")
    if book_xml is None:
        result["reason"] = f"no book XML selectable from sample {sample['title']}"
        return result

    # 5. Parse yields ProgramElements whose BudgetYear self-describes as fy.
    try:
        pes = parse_jbook_xml(book_xml)
    except Exception as e:
        result["reason"] = (
            f"parse_jbook_xml failed on {book_xml.name} ({type(e).__name__}: {e})"
        )
        return result
    if not pes:
        result["reason"] = f"0 ProgramElements parsed from sample {book_xml.name}"
        return result
    result["sample_pe_count"] = len(pes)
    bad_years = sorted({pe.budget_year for pe in pes if pe.budget_year != fy},
                       key=lambda y: (y is None, y))
    if bad_years:
        result["reason"] = (
            f"BudgetYear mismatch in sample {book_xml.name}:"
            f" expected {fy}, found {bad_years}"
        )
        return result

    result["ok"] = True
    return result


# ---------------------------------------------------------------------------
# Edition coverage manifest (data/research/edition_manifest.json)
# ---------------------------------------------------------------------------


def _update_edition(manifest_path: Path, fy: int, fields: dict) -> dict:
    """Merge fields into manifest editions[str(fy)]; create file/entry as needed."""
    manifest_path = Path(manifest_path)
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    else:
        manifest = {"editions": {}}
    editions = manifest.setdefault("editions", {})
    entry = {**editions.get(str(fy), {}), **fields}
    editions[str(fy)] = entry
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return entry


def record_probe(manifest_path: Path, result: dict, *, date: str | None = None) -> dict:
    """Upsert a probe outcome. status='probed_ok'/'probe_failed'; the reason is
    always non-empty (the verify-phase5e gate excuses an unloaded edition only
    when both status and reason are present)."""
    date = date or dt.date.today().isoformat()
    status = "probed_ok" if result["ok"] else "probe_failed"
    reason = result["reason"] or (
        f"probe passed (discovered={result['discovered']},"
        f" sample_pe_count={result['sample_pe_count']})"
    )
    return _update_edition(manifest_path, result["fy"], {
        "status": status,
        "reason": reason,
        "discovered": result["discovered"],
        "sample_pe_count": result["sample_pe_count"],
        "date": date,
    })


def record_loaded(manifest_path: Path, fy: int, counts: dict, *,
                  date: str | None = None) -> dict:
    """Mark an edition loaded with its one-line count summary."""
    date = date or dt.date.today().isoformat()
    summary = (
        f"loaded: {counts['documents']} docs ({counts['downloaded']} downloaded),"
        f" {counts['budget_lines']} budget_lines,"
        f" {counts['detail_facts']} detail facts,"
        f" {counts['recon_checks']} recon checks"
    )
    return _update_edition(manifest_path, fy, {
        "status": "loaded", "reason": summary, "date": date, **counts,
    })


def record_exclusions(manifest_path: Path, fy: int,
                      exclusions: list[dict]) -> dict:
    """Record an edition's intentionally-excluded J-book files.

    Spec honesty rule 3: gaps live in the manifest, not agent reports. Each
    entry is {filename, rule, reason} where rule ∈ {numeric-index-duplicate,
    evidence-duplicate, tokenless-undecidable, niche-fund}. Entries are
    sorted by filename for deterministic diffs; the list replaces any prior
    exclusions for the edition (regeneration is idempotent — see
    scripts/record_edition_exclusions.py).
    """
    allowed = {"numeric-index-duplicate", "evidence-duplicate",
               "tokenless-undecidable", "niche-fund"}
    for e in exclusions:
        if set(e) != {"filename", "rule", "reason"} or e["rule"] not in allowed:
            raise ValueError(f"malformed exclusion entry: {e!r}")
    ordered = sorted(exclusions, key=lambda e: e["filename"])
    return _update_edition(manifest_path, fy, {"exclusions": ordered})


def record_failure(manifest_path: Path, fy: int, *, status: str, reason: str,
                   date: str | None = None) -> dict:
    """Record a structural load failure (post-probe) with a precise reason."""
    date = date or dt.date.today().isoformat()
    return _update_edition(manifest_path, fy, {
        "status": status, "reason": reason, "date": date,
    })


def edition_counts(dsn: str, fy: int) -> dict:
    """Post-load sanity counts for one edition (documents, budget_lines,
    non-superseded detail facts, reconciliation checks)."""
    import psycopg

    with psycopg.connect(dsn) as con:
        documents, downloaded = con.execute(
            "select count(*), count(*) filter (where status = 'downloaded')"
            " from jbook_documents where fiscal_year = %s",
            (fy,),
        ).fetchone()
        budget_lines = con.execute(
            "select count(*) from budget_lines where fiscal_year = %s", (fy,)
        ).fetchone()[0]
        detail_facts = con.execute(
            """
            select count(*)
            from budget_line_details bd
            join jbook_documents d on d.id = bd.document_id
            where not bd.superseded and d.fiscal_year = %s
            """,
            (fy,),
        ).fetchone()[0]
        recon_checks = con.execute(
            """
            select count(*)
            from reconciliation_checks rc
            join extraction_runs er on er.id = rc.extraction_run_id
            join jbook_documents d on d.id = er.document_id
            where d.fiscal_year = %s
            """,
            (fy,),
        ).fetchone()[0]
    return {
        "documents": documents,
        "downloaded": downloaded,
        "budget_lines": budget_lines,
        "detail_facts": detail_facts,
        "recon_checks": recon_checks,
    }
