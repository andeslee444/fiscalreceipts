import json
from pathlib import Path

import psycopg

from govbudget.jbooks.xml_parser import parse_jbook_xml


def load_document_details(dsn: str, *, document_id: int, xml_path: Path) -> int:
    """Parse a J-book XML and load details/narratives. Supersedes prior rows
    for the document. Returns the extraction_run id."""
    records = parse_jbook_xml(xml_path)
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
    from govbudget.jbooks.p40_parser import parse_p40_xml

    records = parse_p40_xml(xml_path)
    with psycopg.connect(dsn) as con:
        run_id = con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions) "
            "values (%s, 0, %s) returning id",
            (document_id, json.dumps({"parser": "p40_parser/1", "source": str(xml_path)})),
        ).fetchone()[0]
        con.execute(
            "update budget_line_details set superseded=true where document_id=%s",
            (document_id,),
        )
        con.execute(
            "update detail_narratives set superseded=true where document_id=%s",
            (document_id,),
        )
        for li in records:
            for f in li.funding:
                con.execute(
                    "insert into budget_line_details (extraction_run_id, document_id,"
                    " pe_bli, project_number, project_title, scenario, amount_millions,"
                    " xml_path) values (%s,%s,%s,null,null,%s,%s,%s)",
                    (run_id, document_id, li.number, f.scenario, f.amount_millions,
                     li.xml_path),
                )
            for kind, body in (("description", li.description),
                               ("justification", li.justification)):
                if body:
                    con.execute(
                        "insert into detail_narratives (extraction_run_id, document_id,"
                        " pe_bli, project_number, kind, title, body, xml_path)"
                        " values (%s,%s,%s,null,%s,%s,%s,%s)",
                        (run_id, document_id, li.number, kind, li.title, body,
                         li.xml_path),
                    )
        con.execute(
            "update extraction_runs set status='finished', finished_at=now() where id=%s",
            (run_id,),
        )
    return run_id
