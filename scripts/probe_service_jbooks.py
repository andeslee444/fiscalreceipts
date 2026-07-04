"""Phase 5G Task 1 — live service J-book probe (evidence gathering only).

Settles two feasibility unknowns:
  1. Can a real headless browser reach the Navy + Army comptroller book
     listings that block server-side curl (Navy /fmc WAF; Army Akamai)?
  2. Do the actual service PDFs embed the same jb-2009 .zzz XML the pipeline
     needs?

This script does NOT ingest, does NOT touch the DB, does NOT bulk-download.
It writes PDF inventories + one sample-book extraction proof under
docs/superpowers/reviews/5g-probe/. If a WAF blocks headless Chromium it
records the exact failure (status, title, body head, screenshot) and marks
the service BLOCKED — no stealth escalation.

Run:  uv run python scripts/probe_service_jbooks.py
"""
from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from govbudget.jbooks.attachments import (
    extract_jbook_xml,
    list_embedded,
    pick_book_xml,
)
from govbudget.jbooks.orgs import workbook_org
from govbudget.jbooks.registry import _classify_jbook
from govbudget.jbooks.service_fetch import (
    LOCALE,
    REALISTIC_UA,
    SERVICE_INDEX_URLS,
    VIEWPORT,
    FetchResult,
    PdfLink,
    download_pdf,
    fetch_rendered_html,
    is_waf_block,
    parse_pdf_links,
    parse_year_links,
    render_inventory,
)
from govbudget.jbooks.xml_parser import parse_jbook_xml

REPO = Path(__file__).resolve().parents[1]
EVIDENCE = REPO / "docs" / "superpowers" / "reviews" / "5g-probe"
SHOTS = EVIDENCE / "evidence"
TMP = Path("/tmp/5g_probe")
FY = 2026

# Politeness: one page at a time, this many seconds between navigations.
THROTTLE_S = 3.0


def _log(msg: str) -> None:
    print(f"[probe] {msg}", flush=True)


def _screenshot(page, name: str) -> Path:
    SHOTS.mkdir(parents=True, exist_ok=True)
    p = SHOTS / name
    try:
        page.screenshot(path=str(p), full_page=True)
    except Exception as e:  # noqa: BLE001
        _log(f"screenshot {name} failed: {e}")
    return p


def probe_service(page, context, service: str) -> dict:
    """Fetch a service index, follow to the FY listing, inventory PDFs.

    Returns a verdict dict recording reachability, inventory, and any block.
    """
    verdict: dict = {
        "service": service,
        "reachable": False,
        "blocked": False,
        "block_detail": None,
        "pages_visited": [],
        "pdf_links": [],
    }
    all_links: dict[str, PdfLink] = {}
    to_visit = list(SERVICE_INDEX_URLS[service])
    visited: set[str] = set()

    while to_visit and len(visited) < 8:
        url = to_visit.pop(0)
        if url in visited:
            continue
        visited.add(url)
        _log(f"{service}: GET {url}")
        try:
            res: FetchResult = fetch_rendered_html(page, url)
        except Exception as e:  # noqa: BLE001
            _log(f"{service}: navigation error at {url}: {type(e).__name__}: {e}")
            shot = _screenshot(page, f"{service}-error.png")
            verdict["blocked"] = True
            verdict["block_detail"] = {
                "url": url,
                "error": f"{type(e).__name__}: {e}",
                "screenshot": str(shot.relative_to(EVIDENCE)),
            }
            return verdict
        time.sleep(THROTTLE_S)

        body = res.body_html
        if is_waf_block(res.status, res.title, body):
            _log(f"{service}: WAF BLOCK at {url} (status={res.status}, title={res.title!r})")
            shot = _screenshot(page, f"{service}-blocked.png")
            verdict["blocked"] = True
            verdict["block_detail"] = {
                "url": url,
                "status": res.status,
                "title": res.title,
                "body_head": body[:500],
                "screenshot": str(shot.relative_to(EVIDENCE)),
            }
            return verdict

        verdict["reachable"] = True
        verdict["pages_visited"].append(
            {"url": url, "status": res.status, "title": res.title, "bytes": len(body)}
        )
        _screenshot(page, f"{service}-{len(visited)}.png")

        page_links = parse_pdf_links(body, res.url)
        for ln in page_links:
            all_links.setdefault(ln.href, ln)
        _log(f"{service}: {len(page_links)} PDF links on this page ({len(all_links)} total)")

        # If this page had no PDFs, follow FY2026 child links (hub -> listing).
        if not page_links:
            for child in parse_year_links(body, res.url, fiscal_year=FY):
                if child not in visited and child not in to_visit:
                    to_visit.append(child)
            _log(f"{service}: queued {len(to_visit)} FY{FY} child link(s) to follow")

    links = sorted(all_links.values(), key=lambda x: x.href)
    verdict["pdf_links"] = links
    return verdict


def write_inventory(service: str, verdict: dict) -> Path:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    out = EVIDENCE / f"{service}-inventory.txt"
    lines = [f"# {service.upper()} FY{FY} J-book PDF inventory (Phase 5G Task 1 probe)"]
    lines.append(f"# generated {time.strftime('%Y-%m-%dT%H:%M:%S%z')}")
    if verdict["blocked"]:
        lines.append("# STATUS: BLOCKED (see PROBE-REPORT.md)")
        d = verdict["block_detail"] or {}
        for k in ("url", "status", "title", "error", "screenshot"):
            if d.get(k) is not None:
                lines.append(f"# {k}: {d[k]}")
    else:
        lines.append(f"# STATUS: reachable — {len(verdict['pdf_links'])} PDF links")
        for pg in verdict["pages_visited"]:
            lines.append(f"# page: {pg['url']} (status={pg['status']}, {pg['bytes']} bytes)")
    lines.append("")
    lines.append(render_inventory(verdict["pdf_links"]).rstrip("\n"))
    out.write_text("\n".join(lines) + "\n")
    _log(f"{service}: wrote inventory -> {out}")
    return out


def classify_inventory(verdict: dict) -> list[dict]:
    """Run the existing classifier over each inventoried filename."""
    rows: list[dict] = []
    for ln in verdict["pdf_links"]:
        name = ln.href.rsplit("/", 1)[-1]
        cls = _classify_jbook(name)
        row = {"name": name, "href": ln.href, "classified": cls}
        if cls:
            fam, org = cls
            row["workbook_org"] = workbook_org(org)
        rows.append(row)
    return rows


def pick_sample_rdte(verdict: dict) -> PdfLink | None:
    """Pick an RDT&E master book to sample: classified rdte, prefer 'master'."""
    rdte = []
    for ln in verdict["pdf_links"]:
        name = ln.href.rsplit("/", 1)[-1]
        cls = _classify_jbook(name)
        if cls and cls[0] == "rdte":
            rdte.append(ln)
    if not rdte:
        # fallback: any href mentioning RDTE/RDT&E even if unclassified
        rdte = [
            ln
            for ln in verdict["pdf_links"]
            if "rdte" in ln.href.lower() or "rdt_e" in ln.href.lower()
        ]
    if not rdte:
        return None

    def score(ln: PdfLink) -> tuple[int, str]:
        n = ln.href.rsplit("/", 1)[-1].lower()
        return (("master" in n or "mjb" in n), n)

    return sorted(rdte, key=score, reverse=True)[0]


def sample_extraction(service: str, context, link: PdfLink) -> dict:
    """Download one RDT&E book, run extract + parse WITHOUT touching the DB."""
    TMP.mkdir(parents=True, exist_ok=True)
    name = link.href.rsplit("/", 1)[-1]
    dest = TMP / name
    _log(f"{service}: downloading sample RDT&E book {name}")
    sha, nbytes = download_pdf(context, link.href, dest)
    result: dict = {
        "service": service,
        "file": name,
        "href": link.href,
        "sha256": sha,
        "bytes": nbytes,
    }
    # Embedded attachments — the .zzz / .xml the pipeline extracts.
    embedded = list_embedded(dest)
    result["embedded_attachments"] = embedded
    result["has_zzz"] = any(a.lower().endswith(".zzz") for a in embedded)
    result["has_xml_attachment"] = any(a.lower().endswith(".xml") for a in embedded)

    with tempfile.TemporaryDirectory(prefix="5g_xml_") as td:
        xmls = extract_jbook_xml(dest, Path(td))
        result["xml_files_written"] = [p.name for p in xmls]
        book_xml = pick_book_xml(Path(td), family="rdte")
        if book_xml is None:
            result["scenario"] = "B (scan-only / no embedded XML)"
            result["pe_count"] = 0
            return result
        result["picked_book_xml"] = book_xml.name
        pes = parse_jbook_xml(book_xml)
        result["scenario"] = "A (embedded jb-2009 XML)"
        result["pe_count"] = len(pes)
        # Namespace from the root tag.
        import xml.etree.ElementTree as ET

        root = ET.parse(book_xml).getroot()
        ns = root.tag.split("}")[0].lstrip("{") if "}" in root.tag else ""
        result["xml_namespace"] = ns
        budget_years = sorted({p.budget_year for p in pes if p.budget_year is not None})
        result["budget_years"] = budget_years
        result["budget_year_2026"] = 2026 in budget_years
        agencies = sorted({p.service_agency for p in pes if p.service_agency})
        result["service_agency_names"] = agencies
        # Classifier verdict for this filename.
        cls = _classify_jbook(name)
        result["classified"] = cls
        if cls:
            result["workbook_org"] = workbook_org(cls[1])
    return result


def write_sample_extraction(samples: list[dict]) -> None:
    out = EVIDENCE / "sample-extraction.md"
    lines = ["# Phase 5G Task 1 — sample-book extraction proof", ""]
    if not samples:
        lines.append("No service reached inventory stage; no sample downloaded.")
        out.write_text("\n".join(lines) + "\n")
        return
    for s in samples:
        lines.append(f"## {s['service'].upper()} — `{s['file']}`")
        lines.append("")
        lines.append(f"- source: {s['href']}")
        lines.append(f"- sha256: `{s['sha256']}`")
        lines.append(f"- bytes: {s['bytes']:,}")
        lines.append(f"- embedded attachments: {s.get('embedded_attachments')}")
        lines.append(f"- `.zzz` present: **{s.get('has_zzz')}**")
        lines.append(f"- `.xml` attachment present: {s.get('has_xml_attachment')}")
        lines.append(f"- XML files written by extractor: {s.get('xml_files_written')}")
        lines.append(f"- picked book XML: {s.get('picked_book_xml')}")
        lines.append(f"- **scenario: {s.get('scenario')}**")
        lines.append(f"- ProgramElement count: {s.get('pe_count')}")
        lines.append(f"- XML namespace: `{s.get('xml_namespace')}`")
        lines.append(f"- BudgetYear values: {s.get('budget_years')}")
        lines.append(f"- BudgetYear == 2026: **{s.get('budget_year_2026')}**")
        lines.append(f"- ServiceAgencyName values: {s.get('service_agency_names')}")
        lines.append(f"- classifier verdict for filename: {s.get('classified')}")
        lines.append(f"- workbook org: {s.get('workbook_org')}")
        lines.append("")
    out.write_text("\n".join(lines) + "\n")
    _log(f"wrote sample extraction -> {out}")


def main() -> int:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    SHOTS.mkdir(parents=True, exist_ok=True)
    verdicts: dict[str, dict] = {}
    samples: list[dict] = []
    classifications: dict[str, list[dict]] = {}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=REALISTIC_UA,
            viewport=VIEWPORT,
            locale=LOCALE,
            timezone_id="America/New_York",
        )
        page = context.new_page()
        for service in ("navy", "army"):
            _log(f"=== probing {service} ===")
            verdict = probe_service(page, context, service)
            verdicts[service] = verdict
            write_inventory(service, verdict)
            if verdict["reachable"] and verdict["pdf_links"]:
                classifications[service] = classify_inventory(verdict)
                sample = pick_sample_rdte(verdict)
                if sample is not None:
                    try:
                        samples.append(sample_extraction(service, context, sample))
                        time.sleep(THROTTLE_S)
                    except Exception as e:  # noqa: BLE001
                        _log(f"{service}: sample extraction FAILED: {type(e).__name__}: {e}")
                        samples.append(
                            {
                                "service": service,
                                "file": sample.href.rsplit("/", 1)[-1],
                                "href": sample.href,
                                "error": f"{type(e).__name__}: {e}",
                                "scenario": "ERROR",
                            }
                        )
                else:
                    _log(f"{service}: no RDT&E book found to sample")
        context.close()
        browser.close()

    write_sample_extraction(samples)
    _write_classification_dump(classifications)
    _print_summary(verdicts, samples)
    return 0


def _write_classification_dump(classifications: dict[str, list[dict]]) -> None:
    out = EVIDENCE / "classifier-verdicts.txt"
    lines = ["# _classify_jbook() verdict per inventoried filename (Task 1 probe)", ""]
    for service, rows in classifications.items():
        lines.append(f"## {service.upper()}")
        for r in rows:
            wb = f" -> workbook {r['workbook_org']}" if r.get("workbook_org") else ""
            lines.append(f"{r['classified']}{wb}\t{r['name']}")
        lines.append("")
    out.write_text("\n".join(lines) + "\n")


def _print_summary(verdicts: dict, samples: list[dict]) -> None:
    _log("================ SUMMARY ================")
    for service, v in verdicts.items():
        if v["blocked"]:
            _log(f"{service}: BLOCKED — {v['block_detail']}")
        else:
            _log(f"{service}: reachable, {len(v['pdf_links'])} PDF links")
    for s in samples:
        _log(
            f"{s['service']} sample: {s.get('scenario')} "
            f"PEs={s.get('pe_count')} BY2026={s.get('budget_year_2026')} "
            f"zzz={s.get('has_zzz')}"
        )


if __name__ == "__main__":
    sys.exit(main())
