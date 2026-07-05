"""Phase 5G Task 3 — CLI wiring for service J-books (navy backfill + ingest-local).

The live pieces (Playwright inventory fetch + browser download) are Task 4 and
are injected here as monkeypatched module-level helpers, so the dispatch,
ordering, plan/register/exclusion recording, and scoped extract are unit-tested
without a browser or network.
"""
import json

import psycopg
import pytest

from govbudget.jbooks.service_fetch import PdfLink

NAVY_BASE = "https://www.secnav.navy.mil/fmc/fmb/Documents/26pres"


def _navy_inventory(*names):
    return [PdfLink(text=n[:-4], href=f"{NAVY_BASE}/{n}") for n in names]


def _wire_service_backfill(monkeypatch, tmp_path, pg_dsn, inventory):
    """Monkeypatch the service-backfill collaborators; returns (calls, manifest)."""
    import govbudget.jbooks.db
    from govbudget import cli, config

    calls: list[tuple] = []
    monkeypatch.setattr(govbudget.jbooks.db, "migrate", lambda *a, **kw: [])
    monkeypatch.setattr(config, "RESEARCH_DIR", tmp_path)
    monkeypatch.setattr(config, "PG_DSN", pg_dsn)

    # live inventory fetch (Playwright) — injected
    monkeypatch.setattr(
        cli, "_service_fetch_inventory",
        lambda service, fiscal_year: (
            calls.append(("fetch-inventory", service, fiscal_year)), inventory
        )[1],
    )
    # live browser download — injected; flips registered rows to 'downloaded'
    def fake_download(service, fiscal_year):
        calls.append(("download", service, fiscal_year))
        with psycopg.connect(pg_dsn) as con:
            con.execute(
                "update jbook_documents set status='downloaded' where status='registered'"
            )
        return (2, [])

    monkeypatch.setattr(cli, "_service_download", fake_download)
    # scoped extract — injected (real extract needs XML on disk, Task 4)
    monkeypatch.setattr(
        cli, "_jbooks_extract",
        lambda org=None, fiscal_year=None: (
            calls.append(("extract", org, fiscal_year)), (2, [])
        )[1],
    )
    return calls, tmp_path / "edition_manifest.json"


def test_backfill_service_navy_registers_dedups_downloads_extracts(
    monkeypatch, tmp_path, pg_dsn
):
    from govbudget import cli

    inventory = _navy_inventory(
        "RDTEN_BA1-3_Book.pdf", "RDTEN_BA4_Book.pdf", "RDTEN_BA7-8_Book.pdf",
        "APN_BA5_Book.pdf",
        "OMN_Book.pdf", "BRAC_Book.pdf",  # excluded
    )
    calls, manifest = _wire_service_backfill(monkeypatch, tmp_path, pg_dsn, inventory)

    cli.main(["jbooks", "backfill", "--fiscal-year", "2026", "--service", "navy"])

    # ordering: fetch -> download -> extract (register happens between)
    assert calls == [
        ("fetch-inventory", "navy", 2026),
        ("download", "navy", 2026),
        ("extract", "N", 2026),
    ]
    # exactly the deduped/registrable set landed in the DB
    with psycopg.connect(pg_dsn) as con:
        rows = dict(con.execute(
            "select title, acquisition from jbook_documents order by title"
        ))
    assert set(rows) == {"RDTEN_BA1-3_Book.pdf", "APN_BA5_Book.pdf"}
    assert all(v == "playwright" for v in rows.values())

    # service exclusions recorded: 2 non-justification + 2 ba-split dupes
    svc = json.loads(manifest.read_text())["services"]["navy_2026"]["exclusions"]
    by_rule = {}
    for e in svc:
        by_rule.setdefault(e["rule"], []).append(e["filename"])
    assert set(by_rule["non-justification-appropriation"]) == {
        "OMN_Book.pdf", "BRAC_Book.pdf"
    }
    assert set(by_rule["ba-split-duplicate"]) == {
        "RDTEN_BA4_Book.pdf", "RDTEN_BA7-8_Book.pdf"
    }


def test_backfill_service_navy_resume_skips_downloaded(monkeypatch, tmp_path, pg_dsn):
    """A second backfill after some books already downloaded re-plans nothing
    for them (resume safety via known_downloaded_urls)."""
    from govbudget import cli

    # pre-seed APN as already downloaded
    with psycopg.connect(pg_dsn) as con:
        con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year,"
            " title, source_url, status, acquisition)"
            " values ('N','procurement',2026,'APN_BA5_Book.pdf',%s,"
            " 'downloaded','playwright')",
            (f"{NAVY_BASE}/APN_BA5_Book.pdf",),
        )

    inventory = _navy_inventory("RDTEN_BA1-3_Book.pdf", "APN_BA5_Book.pdf")
    calls, _ = _wire_service_backfill(monkeypatch, tmp_path, pg_dsn, inventory)
    cli.main(["jbooks", "backfill", "--fiscal-year", "2026", "--service", "navy"])

    with psycopg.connect(pg_dsn) as con:
        registered_now = [r[0] for r in con.execute(
            "select title from jbook_documents where acquisition='playwright'"
            " order by title"
        )]
    # APN already present (not re-registered as a new row); only RDTEN newly registered
    assert registered_now == ["APN_BA5_Book.pdf", "RDTEN_BA1-3_Book.pdf"]
    with psycopg.connect(pg_dsn) as con:
        n_apn = con.execute(
            "select count(*) from jbook_documents where title='APN_BA5_Book.pdf'"
        ).fetchone()[0]
    assert n_apn == 1  # no duplicate row


def test_ingest_local_registers_manual(monkeypatch, tmp_path, pg_dsn):
    from govbudget import cli, config

    monkeypatch.setattr(config, "PG_DSN", pg_dsn)
    import govbudget.jbooks.db
    monkeypatch.setattr(govbudget.jbooks.db, "migrate", lambda *a, **kw: [])

    drop = tmp_path / "army_drop"
    drop.mkdir()
    (drop / "RDTEN_BA1-3_Book.pdf").write_bytes(b"%PDF-1.4 fake")
    (drop / "APN_BA5_Book.pdf").write_bytes(b"%PDF-1.4 fake")
    (drop / "mystery.pdf").write_bytes(b"%PDF-1.4 fake")

    cli.main([
        "jbooks", "ingest-local", "--service", "army", "--fiscal-year", "2026",
        "--source-url", "https://www.asafm.army.mil/Budget-Materials/Budget2026/",
        str(drop),
    ])
    with psycopg.connect(pg_dsn) as con:
        rows = dict(con.execute(
            "select title, acquisition from jbook_documents order by title"
        ))
    assert set(rows) == {"RDTEN_BA1-3_Book.pdf", "APN_BA5_Book.pdf"}
    assert all(v == "manual" for v in rows.values())


def test_ingest_local_requires_source_url(monkeypatch, tmp_path, pg_dsn):
    from govbudget import cli, config

    monkeypatch.setattr(config, "PG_DSN", pg_dsn)
    import govbudget.jbooks.db
    monkeypatch.setattr(govbudget.jbooks.db, "migrate", lambda *a, **kw: [])
    drop = tmp_path / "drop"
    drop.mkdir()

    # argparse enforces --source-url required
    with pytest.raises(SystemExit):
        cli.main([
            "jbooks", "ingest-local", "--service", "af",
            "--fiscal-year", "2026", str(drop),
        ])


# --------------------------------------------------------------------------
# Phase 5G (archive round) — Army / AF / Space Force via the Internet Archive.
# --------------------------------------------------------------------------

ARMY_BASE = ("https://www.asafm.army.mil/Portals/72/Documents/BudgetMaterial/2026/"
             "Discretionary%20Budget")


def _army_inventory(*names):
    """Build a PdfLink inventory of Army archive originals (rdte/ + Procurement/)."""
    out = []
    for n in names:
        sub = "rdte" if n.startswith("RDTE") else "Procurement"
        out.append(PdfLink(text=n, href=f"{ARMY_BASE}/{sub}/{n.replace(' ', '%20')}"))
    return out


def _wire_archive_backfill(monkeypatch, tmp_path, pg_dsn, inventory):
    import govbudget.jbooks.db
    from govbudget import cli, config
    from govbudget.jbooks import service_fetch

    calls: list[tuple] = []
    monkeypatch.setattr(govbudget.jbooks.db, "migrate", lambda *a, **kw: [])
    monkeypatch.setattr(config, "RESEARCH_DIR", tmp_path)
    monkeypatch.setattr(config, "PG_DSN", pg_dsn)

    monkeypatch.setattr(
        cli, "_service_archive_enumerate",
        lambda service, fy: (calls.append(("enum", service, fy)), inventory)[1],
    )

    def fake_download(service, fy):
        calls.append(("download", service, fy))
        with psycopg.connect(pg_dsn) as con:
            con.execute(
                "update jbook_documents set status='downloaded'"
                " where status='registered' and acquisition='archive'"
            )
        return (2, [])

    monkeypatch.setattr(cli, "_service_archive_download", fake_download)
    monkeypatch.setattr(
        cli, "_jbooks_extract",
        lambda org=None, fiscal_year=None: (
            calls.append(("extract", org, fiscal_year)), (2, [])
        )[1],
    )
    monkeypatch.setattr(
        service_fetch, "dedup_service_master_dups",
        lambda dsn, *, fiscal_year, org, log=print: (
            calls.append(("dedup", org, fiscal_year)), []
        )[1],
    )
    return calls, tmp_path / "edition_manifest.json"


def test_backfill_service_army_archive_registers_downloads_extracts_dedups(
    monkeypatch, tmp_path, pg_dsn
):
    from govbudget import cli

    inventory = _army_inventory(
        "RDTE - Vol 1 - Budget Activity 1.pdf",
        "Aircraft Procurement Army.pdf",
        "Army Working Capital Fund.pdf",  # excluded
    )
    calls, manifest = _wire_archive_backfill(monkeypatch, tmp_path, pg_dsn, inventory)

    cli.main(["jbooks", "backfill", "--fiscal-year", "2026",
              "--service", "army", "--source", "archive"])

    # ordering: enumerate -> download -> extract -> dedup
    assert calls == [
        ("enum", "army", 2026),
        ("download", "army", 2026),
        ("extract", "A", 2026),
        ("dedup", "A", 2026),
    ]
    with psycopg.connect(pg_dsn) as con:
        rows = list(con.execute(
            "select title, acquisition, org, source_url from jbook_documents order by title"
        ))
    titles = {r[0] for r in rows}
    assert titles == {"RDTE - Vol 1 - Budget Activity 1.pdf", "Aircraft Procurement Army.pdf"}
    # acquisition stamped 'archive'; source_url is the ORIGINAL official gov URL
    for title, acq, org, url in rows:
        assert acq == "archive"
        assert org == "A"
        assert url.startswith("https://www.asafm.army.mil/")  # NOT web.archive.org
        assert "web.archive.org" not in url

    # excluded non-justification book recorded in the service manifest
    svc = json.loads(manifest.read_text())["services"]["army_2026"]["exclusions"]
    assert [e["filename"] for e in svc] == ["Army Working Capital Fund.pdf"]


def test_backfill_service_spaceforce_archive_loads_as_org_f(monkeypatch, tmp_path, pg_dsn):
    from govbudget import cli
    from govbudget.jbooks.service_fetch import PdfLink

    sf_base = "https://www.saffm.hq.af.mil/Portals/84/documents/FY26"
    inventory = [
        PdfLink("FY26 Space Force Research and Development Test and Evaluation.pdf",
                f"{sf_base}/FY26%20Space%20Force%20Research%20and%20Development%20Test%20and%20Evaluation.pdf"),
        PdfLink("FY26 Space Force Procurement.pdf",
                f"{sf_base}/FY26%20Space%20Force%20Procurement.pdf"),
    ]
    calls, _ = _wire_archive_backfill(monkeypatch, tmp_path, pg_dsn, inventory)
    cli.main(["jbooks", "backfill", "--fiscal-year", "2026",
              "--service", "spaceforce", "--source", "archive"])
    with psycopg.connect(pg_dsn) as con:
        orgs = {r[0] for r in con.execute("select distinct org from jbook_documents")}
    assert orgs == {"F"}  # Space Force loads under the AF workbook org
    assert ("extract", "F", 2026) in calls
