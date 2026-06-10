import datetime as dt
from pathlib import Path

import httpx
import psycopg

from govbudget.download import download_file, ensure_free_space
from govbudget.jbooks.attachments import extract_jbook_xml


def acquire_pending(
    dsn: str, client: httpx.Client, *, raw_docs_dir: Path, min_free_gb: float
) -> tuple[int, list[tuple[int, str, str]]]:
    """Download every 'registered' document, detect embedded XML, update rows.

    PDFs and XLSX are KEPT on disk — they are the provenance source.
    Per-document failures don't stop the sweep: the row is marked 'failed'
    (so re-runs skip it until re-registered) and reported in the second
    return value as (doc_id, title, error). Returns (downloaded_count, failures).
    """
    with psycopg.connect(dsn) as con:
        pending = con.execute(
            "select id, org, fiscal_year, title, source_url from jbook_documents "
            "where status = 'registered' order by id"
        ).fetchall()
    done = 0
    failures: list[tuple[int, str, str]] = []
    for doc_id, org, fy, title, url in pending:
        dest = raw_docs_dir / f"fy{fy}" / org.lower() / title
        try:
            ensure_free_space(dest.parent, min_free_gb)
            sha, n = download_file(client, url, dest)
            has_xml: bool | None = None
            if title.lower().endswith(".pdf"):
                xmls = extract_jbook_xml(dest, dest.parent / "xml")
                has_xml = bool(xmls)
        except Exception as e:
            failures.append((doc_id, title, f"{type(e).__name__}: {e}"))
            with psycopg.connect(dsn) as con:
                con.execute(
                    "update jbook_documents set status='failed' where id=%s", (doc_id,)
                )
            continue
        with psycopg.connect(dsn) as con:
            con.execute(
                "update jbook_documents set status='downloaded', file_path=%s, sha256=%s, "
                "bytes=%s, downloaded_at=%s, has_embedded_xml=%s where id=%s",
                (str(dest), sha, n, dt.datetime.now(dt.UTC), has_xml, doc_id),
            )
        done += 1
    return done, failures
