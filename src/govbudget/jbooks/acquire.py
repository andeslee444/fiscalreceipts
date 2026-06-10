import datetime as dt
from pathlib import Path

import httpx
import psycopg

from govbudget.download import download_file, ensure_free_space
from govbudget.jbooks.attachments import extract_jbook_xml


def acquire_pending(
    dsn: str, client: httpx.Client, *, raw_docs_dir: Path, min_free_gb: float
) -> int:
    """Download every 'registered' document, detect embedded XML, update rows.

    PDFs and XLSX are KEPT on disk — they are the provenance source.
    Returns the number of documents downloaded.
    """
    with psycopg.connect(dsn) as con:
        pending = con.execute(
            "select id, org, fiscal_year, title, source_url from jbook_documents "
            "where status = 'registered' order by id"
        ).fetchall()
    done = 0
    for doc_id, org, fy, title, url in pending:
        dest = raw_docs_dir / f"fy{fy}" / org.lower() / title
        ensure_free_space(dest.parent, min_free_gb)
        sha, n = download_file(client, url, dest)
        has_xml: bool | None = None
        if title.lower().endswith(".pdf"):
            xmls = extract_jbook_xml(dest, dest.parent / "xml")
            has_xml = bool(xmls)
        with psycopg.connect(dsn) as con:
            con.execute(
                "update jbook_documents set status='downloaded', file_path=%s, sha256=%s, "
                "bytes=%s, downloaded_at=%s, has_embedded_xml=%s where id=%s",
                (str(dest), sha, n, dt.datetime.now(dt.UTC), has_xml, doc_id),
            )
        done += 1
    return done
