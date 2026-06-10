import psycopg

SENTINEL_PE = "9999999999"  # R-1 display subtotal rows, not real programs


def record_extraction_gaps(dsn: str, *, document_id: int) -> int:
    """Record in-scope rollup lines with no extracted detail from ANY of the
    org's documents. Replaces this document's prior gap rows (idempotent).
    Returns the number of gaps recorded."""
    with psycopg.connect(dsn) as con:
        org, family, fy = con.execute(
            "select org, exhibit_family, fiscal_year from jbook_documents where id=%s",
            (document_id,),
        ).fetchone()
        exhibit = {"rdte": "R-1", "procurement": "P-1"}.get(family)
        if exhibit is None:
            return 0
        con.execute("delete from extraction_gaps where document_id=%s", (document_id,))
        missing = con.execute(
            """
            select distinct b.pe_bli from budget_lines b
            where b.exhibit=%s and b.organization=%s and b.fiscal_year=%s
              and b.pe_bli <> %s
              and not exists (
                select 1 from budget_line_details d
                join jbook_documents j on j.id = d.document_id
                where d.pe_bli = b.pe_bli and not d.superseded and j.org = %s
              )
            """,
            (exhibit, org, fy, SENTINEL_PE, org),
        ).fetchall()
        for (pe,) in missing:
            con.execute(
                "insert into extraction_gaps (exhibit, pe_bli, reason, document_id)"
                " values (%s,%s,%s,%s)",
                (exhibit, pe, f"no extracted detail in {org} fy{fy} documents", document_id),
            )
        return len(missing)
