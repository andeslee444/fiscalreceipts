import io
import zipfile

import httpx
import psycopg
from pypdf import PdfWriter

from govbudget.jbooks.acquire import acquire_pending
from govbudget.jbooks.registry import upsert_documents

XML = b'<?xml version="1.0"?><root/>'


def make_pdf_bytes(with_attachment: bool) -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    if with_attachment:
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w") as z:
            z.writestr("book.xml", XML)
        w.add_attachment("book.zzz", zbuf.getvalue())
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def test_acquire_downloads_detects_xml_and_updates_rows(pg_dsn, tmp_path):
    upsert_documents(pg_dsn, [
        {"org": "DARPA", "exhibit_family": "rdte", "fiscal_year": 2026,
         "title": "darpa.pdf", "source_url": "https://example.test/darpa.pdf"},
        {"org": "NOXML", "exhibit_family": "rdte", "fiscal_year": 2026,
         "title": "noxml.pdf", "source_url": "https://example.test/noxml.pdf"},
        {"org": "DoD", "exhibit_family": "rollup", "fiscal_year": 2026,
         "title": "r1_display.xlsx", "source_url": "https://example.test/r1_display.xlsx"},
    ])
    payloads = {
        "/darpa.pdf": make_pdf_bytes(True),
        "/noxml.pdf": make_pdf_bytes(False),
        "/r1_display.xlsx": b"PK\x03\x04fakexlsx",
    }

    def handler(request):
        return httpx.Response(200, content=payloads[request.url.path])

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        n = acquire_pending(pg_dsn, client, raw_docs_dir=tmp_path, min_free_gb=0)
    assert n == 3
    with psycopg.connect(pg_dsn) as con:
        rows = {
            r[0]: r for r in con.execute(
                "select title, status, has_embedded_xml, file_path, sha256 from jbook_documents"
            )
        }
    assert rows["darpa.pdf"][1] == "downloaded" and rows["darpa.pdf"][2] is True
    assert rows["noxml.pdf"][2] is False
    assert rows["r1_display.xlsx"][2] is None  # xlsx: attachment check not applicable
    assert (tmp_path / "fy2026" / "darpa" / "darpa.pdf").exists()
    assert (tmp_path / "fy2026" / "darpa" / "xml" / "book.xml").exists()

    # second run: nothing pending
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert acquire_pending(pg_dsn, client, raw_docs_dir=tmp_path, min_free_gb=0) == 0
