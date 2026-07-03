"""Phase 5E Task 4: per-edition probe + coverage-manifest recording.

probe_edition is exercised entirely through httpx MockTransport fixtures
(mirroring tests/jbooks/test_registry.py) — no live network. The sample PDF
is a real pypdf-written PDF carrying a .zzz (renamed zip) attachment with a
minimal jb-2009 XML, so the probe's extract/parse legs run the real code.
"""
import io
import json
import zipfile

import httpx
import psycopg
import pytest
from pypdf import PdfWriter

from govbudget.jbooks.edition_probe import (
    edition_counts,
    probe_edition,
    record_failure,
    record_loaded,
    record_probe,
)

BASE = "https://comptroller.war.gov"
ROLLUPS = ("r1_display.xlsx", "p1_display.xlsx", "p1r_display.xlsx")


def _index_html(hrefs) -> str:
    links = "".join(f'<a href="{h}">link</a>' for h in hrefs)
    return f"<html><body>{links}</body></html>"


def _probe_xml(fy: int, *, n_pes: int = 2, budget_year: int | None = None) -> bytes:
    by = fy if budget_year is None else budget_year
    pes = "".join(
        f"<jb:ProgramElement>"
        f"<jb:ProgramElementNumber>060110{i}E</jb:ProgramElementNumber>"
        f"<jb:ProgramElementTitle>Test PE {i}</jb:ProgramElementTitle>"
        f"<jb:BudgetYear>{by}</jb:BudgetYear>"
        f"<jb:ProgramElementFunding>"
        f"<jb:BudgetYearOne>12.345</jb:BudgetYearOne>"
        f"</jb:ProgramElementFunding>"
        f"</jb:ProgramElement>"
        for i in range(n_pes)
    )
    return (
        '<?xml version="1.0"?>'
        '<root xmlns:jb="http://www.dtic.mil/comptroller/xml/schema/022009/jb">'
        f"{pes}</root>"
    ).encode()


def _sample_pdf(fy: int, *, xml: bytes | None = None, with_attachment: bool = True) -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    if with_attachment:
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w") as z:
            z.writestr(
                f"U_RDTE_MJB_ORG00_PB_{fy}.xml",
                xml if xml is not None else _probe_xml(fy),
            )
        w.add_attachment(f"U_RDTE_MJB_ORG00_PB_{fy}.zzz", zbuf.getvalue())
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def _client(
    fy: int = 2025,
    *,
    n_rdte: int = 20,
    n_proc: int = 14,
    rollups=ROLLUPS,
    pdf_bytes: bytes | None = None,
    budget_status: int = 200,
    justification_status: int = 200,
) -> tuple[httpx.Client, list[str]]:
    requested: list[str] = []
    pdf = pdf_bytes if pdf_bytes is not None else _sample_pdf(fy)

    def handler(request):
        url = str(request.url)
        requested.append(url)
        if url.endswith(".pdf"):
            return httpx.Response(200, content=pdf)
        if f"/Budget-Materials/Budget{fy}/" in url:
            if budget_status != 200:
                return httpx.Response(budget_status)
            return httpx.Response(200, text=_index_html(rollups))
        if f"/Budget-Materials/FY{fy}BudgetJustification/" in url:
            if justification_status != 200:
                return httpx.Response(justification_status)
            hrefs = [f"pdfs/rdte/RDTE_ORG{i:02d}_PB_{fy}.pdf" for i in range(n_rdte)]
            hrefs += [f"pdfs/proc/PROC_ORG{i:02d}_PB_{fy}.pdf" for i in range(n_proc)]
            return httpx.Response(200, text=_index_html(hrefs))
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler)), requested


# ---------------------------------------------------------------------------
# probe_edition
# ---------------------------------------------------------------------------


def test_probe_ok(tmp_path):
    client, requested = _client(2025)
    with client:
        result = probe_edition(client, 2025, work_dir=tmp_path)
    assert result["ok"] is True
    assert result["fy"] == 2025
    assert result["discovered"] == 37  # 20 rdte + 14 proc + 3 rollups
    assert result["sample_pe_count"] == 2
    assert result["reason"] == ""
    # exactly one sample PDF downloaded, an rdte book
    pdf_requests = [u for u in requested if u.endswith(".pdf")]
    assert len(pdf_requests) == 1 and "/RDTE_" in pdf_requests[0]


def test_probe_index_unreachable(tmp_path):
    client, requested = _client(2025, budget_status=404)
    with client:
        result = probe_edition(client, 2025, work_dir=tmp_path)
    assert result["ok"] is False
    assert "Budget2025" in result["reason"] and "404" in result["reason"]
    # fails fast: no PDFs downloaded
    assert not any(u.endswith(".pdf") for u in requested)


def test_probe_discovered_below_range(tmp_path):
    client, requested = _client(2025, n_rdte=3, n_proc=2)
    with client:
        result = probe_edition(client, 2025, work_dir=tmp_path)
    assert result["ok"] is False
    assert result["discovered"] == 8
    assert "8" in result["reason"] and "30" in result["reason"]
    assert not any(u.endswith(".pdf") for u in requested)


def test_probe_discovered_above_range(tmp_path):
    client, _ = _client(2025, n_rdte=40, n_proc=20)
    with client:
        result = probe_edition(client, 2025, work_dir=tmp_path)
    assert result["ok"] is False
    assert result["discovered"] == 63
    assert "45" in result["reason"]


def test_discovery_envelope_is_edition_aware():
    """Consolidated-volume era (PB2017–PB2023) publishes as few as 5
    classifiable documents; the per-agency era (PB2024+) publishes ~37."""
    from govbudget.jbooks.edition_probe import discovery_envelope

    for fy in range(2017, 2024):
        assert discovery_envelope(fy) == (5, 45)
    for fy in (2024, 2025, 2026, 2027):
        assert discovery_envelope(fy) == (30, 45)


def test_probe_legacy_edition_accepts_consolidated_count(tmp_path):
    # 5 rdte + 0 proc + 3 rollups = 8 discovered: fails the [30,45] modern
    # envelope but is a healthy consolidated-era edition.
    client, requested = _client(2023, n_rdte=5, n_proc=0)
    with client:
        result = probe_edition(client, 2023, work_dir=tmp_path)
    assert result["ok"] is True
    assert result["discovered"] == 8
    assert result["sample_pe_count"] == 2


def test_probe_legacy_edition_still_rejects_below_envelope(tmp_path):
    # 1 rdte + 0 proc + 3 rollups = 4 discovered < 5: a broken index page.
    client, requested = _client(2017, n_rdte=1, n_proc=0)
    with client:
        result = probe_edition(client, 2017, work_dir=tmp_path)
    assert result["ok"] is False
    assert result["discovered"] == 4
    assert "5" in result["reason"] and "45" in result["reason"]
    assert not any(u.endswith(".pdf") for u in requested)


def test_probe_no_embedded_xml(tmp_path):
    client, _ = _client(2025, pdf_bytes=_sample_pdf(2025, with_attachment=False))
    with client:
        result = probe_edition(client, 2025, work_dir=tmp_path)
    assert result["ok"] is False
    assert "XML" in result["reason"]


def test_probe_corrupt_sample_pdf(tmp_path):
    client, _ = _client(2025, pdf_bytes=b"%PDF-1.4 not really a pdf")
    with client:
        result = probe_edition(client, 2025, work_dir=tmp_path)
    assert result["ok"] is False
    assert "extract" in result["reason"].lower()


def test_probe_budget_year_mismatch(tmp_path):
    client, _ = _client(
        2025, pdf_bytes=_sample_pdf(2025, xml=_probe_xml(2025, budget_year=2024))
    )
    with client:
        result = probe_edition(client, 2025, work_dir=tmp_path)
    assert result["ok"] is False
    assert "BudgetYear" in result["reason"]
    assert "2024" in result["reason"] and "2025" in result["reason"]
    assert result["sample_pe_count"] == 2  # parsed fine; the year is what's wrong


def test_probe_zero_program_elements(tmp_path):
    client, _ = _client(2025, pdf_bytes=_sample_pdf(2025, xml=_probe_xml(2025, n_pes=0)))
    with client:
        result = probe_edition(client, 2025, work_dir=tmp_path)
    assert result["ok"] is False
    assert "ProgramElement" in result["reason"]


# ---------------------------------------------------------------------------
# record_probe / record_loaded / record_failure (manifest upserts)
# ---------------------------------------------------------------------------


def test_record_probe_ok_creates_manifest(tmp_path):
    manifest_path = tmp_path / "edition_manifest.json"
    entry = record_probe(
        manifest_path,
        {"fy": 2025, "ok": True, "reason": "", "discovered": 37, "sample_pe_count": 17},
        date="2026-07-03",
    )
    saved = json.loads(manifest_path.read_text())["editions"]["2025"]
    assert saved == entry
    assert saved["status"] == "probed_ok"
    assert saved["reason"]  # non-empty even on success (gate excusal contract)
    assert saved["discovered"] == 37
    assert saved["sample_pe_count"] == 17
    assert saved["date"] == "2026-07-03"


def test_record_probe_failed_keeps_reason(tmp_path):
    manifest_path = tmp_path / "edition_manifest.json"
    record_probe(
        manifest_path,
        {"fy": 2017, "ok": False, "reason": "index URL not reachable: HTTP 404",
         "discovered": 0, "sample_pe_count": 0},
        date="2026-07-03",
    )
    saved = json.loads(manifest_path.read_text())["editions"]["2017"]
    assert saved["status"] == "probe_failed"
    assert saved["reason"] == "index URL not reachable: HTTP 404"


def test_record_probe_upserts_preserving_other_editions(tmp_path):
    manifest_path = tmp_path / "edition_manifest.json"
    manifest_path.write_text(json.dumps({
        "editions": {"2024": {"status": "loaded", "reason": "loaded: 37 docs"}}
    }))
    record_probe(
        manifest_path,
        {"fy": 2025, "ok": False, "reason": "boom", "discovered": 2, "sample_pe_count": 0},
        date="2026-07-03",
    )
    record_probe(
        manifest_path,
        {"fy": 2025, "ok": True, "reason": "", "discovered": 37, "sample_pe_count": 9},
        date="2026-07-03",
    )
    editions = json.loads(manifest_path.read_text())["editions"]
    assert editions["2024"]["status"] == "loaded"          # untouched
    assert editions["2025"]["status"] == "probed_ok"       # second probe wins
    assert editions["2025"]["discovered"] == 37


def test_record_loaded_and_failure(tmp_path):
    manifest_path = tmp_path / "edition_manifest.json"
    record_probe(
        manifest_path,
        {"fy": 2025, "ok": True, "reason": "", "discovered": 37, "sample_pe_count": 9},
        date="2026-07-03",
    )
    entry = record_loaded(
        manifest_path, 2025,
        {"documents": 37, "downloaded": 37, "budget_lines": 8000,
         "recon_checks": 2500, "detail_facts": 12000},
        date="2026-07-03",
    )
    assert entry["status"] == "loaded"
    assert "37 docs" in entry["reason"] and "8000" in entry["reason"]
    assert entry["discovered"] == 37  # probe fields preserved by the upsert

    entry = record_failure(
        manifest_path, 2017, status="load_failed",
        reason="acquire failed for 3 document(s)", date="2026-07-03",
    )
    saved = json.loads(manifest_path.read_text())["editions"]
    assert saved["2017"]["status"] == "load_failed"
    assert saved["2017"]["reason"] == "acquire failed for 3 document(s)"
    assert saved["2025"]["status"] == "loaded"


def test_record_probe_defaults_to_today(tmp_path):
    import datetime as dt

    manifest_path = tmp_path / "edition_manifest.json"
    entry = record_probe(
        manifest_path,
        {"fy": 2025, "ok": True, "reason": "", "discovered": 37, "sample_pe_count": 1},
    )
    assert entry["date"] == dt.date.today().isoformat()


# ---------------------------------------------------------------------------
# edition_counts (DB sanity summary)
# ---------------------------------------------------------------------------


def test_edition_counts(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, status) values"
            " ('DARPA','rdte',2025,'a.pdf','https://x.test/a.pdf','downloaded'),"
            " ('DTRA','rdte',2025,'b.pdf','https://x.test/b.pdf','registered'),"
            " ('DARPA','rdte',2026,'c.pdf','https://x.test/c.pdf','downloaded')"
        )
        doc_id = con.execute(
            "select id from jbook_documents where title='a.pdf'"
        ).fetchone()[0]
        con.execute(
            "insert into budget_lines (exhibit, fiscal_year, account, organization,"
            " budget_activity, pe_bli, amount_type, amount_thousands) values"
            " ('R-1', 2025, '0400', 'DARPA', '1', '0601101E', 'fy_2025_total', 100),"
            " ('R-1', 2026, '0400', 'DARPA', '1', '0601101E', 'fy_2026_total', 200)"
        )
        con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions)"
            " values (%s, 0, '{}')", (doc_id,),
        )
        run_id = con.execute("select max(id) from extraction_runs").fetchone()[0]
        con.execute(
            "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
            " scenario, amount_millions, xml_path) values"
            " (%s,%s,'0601101E','BudgetYearOne','0.1','ProgramElement[0]')",
            (run_id, doc_id),
        )
        con.execute(
            "insert into reconciliation_checks (extraction_run_id, gate, pe_bli,"
            " scenario, passed, detail) values (%s,'B','0601101E','BudgetYearOne',"
            " true,'test')", (run_id,),
        )
    counts = edition_counts(pg_dsn, 2025)
    assert counts == {
        "documents": 2,
        "downloaded": 1,
        "budget_lines": 1,
        "recon_checks": 1,
        "detail_facts": 1,
    }
    assert edition_counts(pg_dsn, 2017)["documents"] == 0


# ---------------------------------------------------------------------------
# CLI: govbudget jbooks backfill --fiscal-year N [--probe-only]
# ---------------------------------------------------------------------------


def _wire_backfill(monkeypatch, tmp_path, probe_result, counts=None):
    """Monkeypatch the backfill collaborators; returns (calls, manifest_path)."""
    import govbudget.jbooks.db
    import govbudget.jbooks.edition_probe as ep
    from govbudget import cli, config

    calls: list[tuple] = []
    monkeypatch.setattr(govbudget.jbooks.db, "migrate", lambda *a, **kw: [])
    monkeypatch.setattr(config, "RESEARCH_DIR", tmp_path)
    monkeypatch.setattr(ep, "probe_edition", lambda client, fy: dict(probe_result, fy=fy))
    monkeypatch.setattr(
        cli, "_jbooks_scrape",
        lambda fy: (calls.append(("scrape", fy)), (37, 37))[1],
    )
    monkeypatch.setattr(
        cli, "_jbooks_acquire",
        lambda: (calls.append(("acquire",)), (37, []))[1],
    )
    monkeypatch.setattr(
        cli, "_jbooks_load_rollups",
        lambda fiscal_year=None: (calls.append(("load-rollups", fiscal_year)), ([], []))[1],
    )
    monkeypatch.setattr(
        cli, "_jbooks_extract",
        lambda org=None, fiscal_year=None: (
            calls.append(("extract", fiscal_year)), (34, [])
        )[1],
    )
    monkeypatch.setattr(
        ep, "edition_counts",
        lambda dsn, fy: counts or {
            "documents": 37, "downloaded": 37, "budget_lines": 8000,
            "recon_checks": 2500, "detail_facts": 12000,
        },
    )
    return calls, tmp_path / "edition_manifest.json"


def test_backfill_probe_only_records_and_skips_pipeline(monkeypatch, tmp_path):
    from govbudget import cli

    calls, manifest_path = _wire_backfill(
        monkeypatch, tmp_path,
        {"ok": True, "reason": "", "discovered": 37, "sample_pe_count": 17},
    )
    cli.main(["jbooks", "backfill", "--fiscal-year", "2025", "--probe-only"])
    assert calls == []
    editions = json.loads(manifest_path.read_text())["editions"]
    assert editions["2025"]["status"] == "probed_ok"


def test_backfill_failed_probe_records_and_exits_nonzero(monkeypatch, tmp_path):
    from govbudget import cli

    calls, manifest_path = _wire_backfill(
        monkeypatch, tmp_path,
        {"ok": False, "reason": "index URL not reachable: HTTP 404",
         "discovered": 0, "sample_pe_count": 0},
    )
    with pytest.raises(SystemExit) as e:
        cli.main(["jbooks", "backfill", "--fiscal-year", "2017"])
    assert e.value.code == 1
    assert calls == []  # probe failure: never runs the pipeline
    editions = json.loads(manifest_path.read_text())["editions"]
    assert editions["2017"]["status"] == "probe_failed"
    assert "404" in editions["2017"]["reason"]


def test_backfill_runs_pipeline_in_order_and_records_loaded(monkeypatch, tmp_path):
    from govbudget import cli

    calls, manifest_path = _wire_backfill(
        monkeypatch, tmp_path,
        {"ok": True, "reason": "", "discovered": 37, "sample_pe_count": 17},
    )
    cli.main(["jbooks", "backfill", "--fiscal-year", "2025"])
    assert calls == [
        ("scrape", 2025),
        ("acquire",),
        ("load-rollups", 2025),
        ("extract", 2025),
    ]
    editions = json.loads(manifest_path.read_text())["editions"]
    assert editions["2025"]["status"] == "loaded"
    assert "8000" in editions["2025"]["reason"]


def test_backfill_acquire_failure_records_load_failed(monkeypatch, tmp_path):
    import govbudget.jbooks.edition_probe as ep
    from govbudget import cli

    calls, manifest_path = _wire_backfill(
        monkeypatch, tmp_path,
        {"ok": True, "reason": "", "discovered": 37, "sample_pe_count": 17},
    )
    monkeypatch.setattr(
        cli, "_jbooks_acquire",
        lambda: (calls.append(("acquire",)), (36, [(9, "RDTE_X_PB_2025.pdf", "HTTP 500")]))[1],
    )
    with pytest.raises(SystemExit) as e:
        cli.main(["jbooks", "backfill", "--fiscal-year", "2025"])
    assert e.value.code == 1
    assert ("load-rollups", 2025) not in calls  # stops at the failed step
    editions = json.loads(manifest_path.read_text())["editions"]
    assert editions["2025"]["status"] == "load_failed"
    assert "RDTE_X_PB_2025.pdf" in editions["2025"]["reason"]
