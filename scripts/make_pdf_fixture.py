"""One-shot: extract pages 24-25 (1-based) from the DARPA master book into a
~104 KB committed test fixture. Re-run only if the source book changes.

Usage: uv run python scripts/make_pdf_fixture.py
"""
from pathlib import Path

from pypdf import PdfReader, PdfWriter

SRC = Path("data/raw_docs/fy2026/darpa/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf")
DST = Path("tests/fixtures/jbooks/darpa_p24_25.pdf")

reader = PdfReader(str(SRC))
writer = PdfWriter()
for i in (23, 24):  # 0-based indices for 1-based pages 24, 25
    writer.add_page(reader.pages[i])
DST.parent.mkdir(parents=True, exist_ok=True)
with DST.open("wb") as fh:
    writer.write(fh)
print(f"wrote {DST} ({DST.stat().st_size} bytes)")
