import json
from pathlib import Path

import psycopg

from govbudget.jbooks.xml_parser import parse_jbook_xml


def load_document_details(dsn: str, *, document_id: int, xml_path: Path) -> int:
    """Parse a J-book XML and load details/narratives. Supersedes prior rows
    for the document. Returns the extraction_run id."""
    records = parse_jbook_xml(xml_path)
    if not records:
        raise ValueError(f"no records parsed from {xml_path} — wrong file or schema drift")
    with psycopg.connect(dsn) as con:
        run_id = con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions) "
            "values (%s, 0, %s) returning id",
            (document_id, json.dumps({"parser": "xml_parser/1", "source": str(xml_path)})),
        ).fetchone()[0]
        con.execute(
            "update budget_line_details set superseded=true where document_id=%s",
            (document_id,),
        )
        con.execute(
            "update detail_narratives set superseded=true where document_id=%s",
            (document_id,),
        )
        for pe in records:
            for f in pe.funding:
                con.execute(
                    "insert into budget_line_details (extraction_run_id, document_id, pe_bli,"
                    " project_number, project_title, scenario, amount_millions, xml_path)"
                    " values (%s,%s,%s,null,null,%s,%s,%s)",
                    (run_id, document_id, pe.number, f.scenario, f.amount_millions, pe.xml_path),
                )
            if pe.mission_description:
                con.execute(
                    "insert into detail_narratives (extraction_run_id, document_id, pe_bli,"
                    " project_number, kind, title, body, xml_path)"
                    " values (%s,%s,%s,null,'mission',%s,%s,%s)",
                    (run_id, document_id, pe.number, pe.title, pe.mission_description, pe.xml_path),
                )
            for proj in pe.projects:
                for f in proj.funding:
                    con.execute(
                        "insert into budget_line_details (extraction_run_id, document_id,"
                        " pe_bli, project_number, project_title, scenario, amount_millions,"
                        " xml_path) values (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (run_id, document_id, pe.number, proj.number, proj.title,
                         f.scenario, f.amount_millions, proj.xml_path),
                    )
                if proj.mission_description:
                    con.execute(
                        "insert into detail_narratives (extraction_run_id, document_id,"
                        " pe_bli, project_number, kind, title, body, xml_path)"
                        " values (%s,%s,%s,%s,'mission',%s,%s,%s)",
                        (run_id, document_id, pe.number, proj.number, proj.title,
                         proj.mission_description, proj.xml_path),
                    )
                for n in proj.narratives:
                    con.execute(
                        "insert into detail_narratives (extraction_run_id, document_id,"
                        " pe_bli, project_number, kind, title, body, xml_path)"
                        " values (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (run_id, document_id, pe.number, proj.number, n.kind, n.title,
                         n.body, n.xml_path),
                    )
        con.execute(
            "update extraction_runs set status='finished', finished_at=now() where id=%s",
            (run_id,),
        )
    return run_id


def load_procurement_details(dsn: str, *, document_id: int, xml_path: Path) -> int:
    """Parse a P-40 procurement XML and load details/narratives. Supersedes
    prior rows for the document. Returns the extraction_run id."""
    from govbudget.jbooks.edition_probe import LEGACY_LAST_FY
    from govbudget.jbooks.era_keys import era_procurement_key, p40_agency_org
    from govbudget.jbooks.p40_parser import parse_p40_xml

    records = parse_p40_xml(xml_path)
    if not records:
        raise ValueError(f"no records parsed from {xml_path} — wrong file or schema drift")
    with psycopg.connect(dsn) as con:
        run_id = con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions) "
            "values (%s, 0, %s) returning id",
            (document_id, json.dumps({"parser": "p40_parser/1", "source": str(xml_path)})),
        ).fetchone()[0]
        # PB2017–PB2023: the era P-1 display and P-40 XMLs share only the P-1
        # line number (XML P1LineNumber) — LineItemNumber vocabulary is
        # per-agency inconsistent in that era. The key is namespaced to
        # '{account}-{org}-L{line}' via era_procurement_key (Finding D: bare
        # line numbers collide with modern BLI codes and conflate programs
        # within one consolidated document); the era p1_loader namespaces
        # budget_lines.pe_bli identically so reconciliation still joins.
        doc_fy = con.execute(
            "select fiscal_year from jbook_documents where id=%s", (document_id,)
        ).fetchone()[0]
        legacy = doc_fy is not None and doc_fy <= LEGACY_LAST_FY
        con.execute(
            "update budget_line_details set superseded=true where document_id=%s",
            (document_id,),
        )
        con.execute(
            "update detail_narratives set superseded=true where document_id=%s",
            (document_id,),
        )
        for li in records:
            if legacy:
                if not li.p1_line_number:
                    raise ValueError(
                        f"era P-40 LineItem {li.number!r} (doc {document_id})"
                        " has no P1LineNumber — cannot build a namespaced era"
                        " key; refusing to load a colliding bare key"
                    )
                key = era_procurement_key(
                    li.appropriation_number,
                    p40_agency_org(li.service_agency),
                    li.p1_line_number,
                )
            else:
                key = li.number.strip() if li.number else li.number
            # The appropriation (account) disambiguates P-1 line numbers that
            # collide within an org (Navy FY2026: line 2210 = JATM in 1507N AND
            # Submarine Acoustic in 1810N). Gate B scopes its P-1 control lookup
            # by this account; it equals budget_lines.account byte-for-byte.
            account = (li.appropriation_number or "").strip() or None
            for f in li.funding:
                con.execute(
                    "insert into budget_line_details (extraction_run_id, document_id,"
                    " pe_bli, project_number, project_title, scenario, amount_millions,"
                    " xml_path, account) values (%s,%s,%s,null,null,%s,%s,%s,%s)",
                    (run_id, document_id, key, f.scenario, f.amount_millions,
                     li.xml_path, account),
                )
            for kind, body in (("description", li.description),
                               ("justification", li.justification)):
                if body:
                    con.execute(
                        "insert into detail_narratives (extraction_run_id, document_id,"
                        " pe_bli, project_number, kind, title, body, xml_path)"
                        " values (%s,%s,%s,null,%s,%s,%s,%s)",
                        (run_id, document_id, key, kind, li.title, body,
                         li.xml_path),
                    )
        con.execute(
            "update extraction_runs set status='finished', finished_at=now() where id=%s",
            (run_id,),
        )
    return run_id
