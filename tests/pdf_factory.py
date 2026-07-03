"""Shared synthetic-PDF factory for provenance tests.

make_pdf writes a minimal multi-page PDF; each page is a list of Helvetica
text lines rendered top-down (extractable by both pypdf and pdfplumber).
Single source — imported by tests/jbooks/test_provenance_pages.py and
tests/test_verify_phase5b1.py (pytest puts tests/ on sys.path for both).
"""
from __future__ import annotations

from pathlib import Path


def make_pdf(path: Path, pages: list[list[str]]) -> None:
    def esc(s: str) -> str:
        return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    objects: list[bytes] = []  # 1-indexed body objects
    n_pages = len(pages)
    font_num = 3 + 2 * n_pages
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n_pages))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")            # 1: catalog
    objects.append(                                                  # 2: pages
        f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode()
    )
    for i, lines in enumerate(pages):
        page_num, content_num = 3 + 2 * i, 4 + 2 * i
        objects.append(                                              # page
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_num} 0 R >> >> "
            f"/Contents {content_num} 0 R >>".encode()
        )
        ops = ["BT", "/F1 10 Tf", "72 720 Td"]
        for j, line in enumerate(lines):
            if j:
                ops.append("0 -20 Td")
            ops.append(f"({esc(line)}) Tj")
        ops.append("ET")
        stream = "\n".join(ops).encode()
        objects.append(                                              # content
            b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)
        )
    objects.append(                                                  # font
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    )

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for num, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (num, body)
    xref_at = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets[1:]:
        out += b"%010d 00000 n \n" % off
    out += (
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, xref_at)
    )
    path.write_bytes(bytes(out))
