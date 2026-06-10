"""Build the committed golden fixture from the real FY2026 DARPA J-book.

Downloads the book (if not already at data/raw_docs/), extracts the embedded
XML, trims to the first TWO ProgramElement records, writes the fixture.
Run: uv run python scripts/make_jbook_fixture.py
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx

sys.path.insert(0, "src")
from govbudget.download import download_file  # noqa: E402
from govbudget.jbooks.attachments import extract_jbook_xml  # noqa: E402

URL = (
    "https://comptroller.war.gov/Portals/45/Documents/defbudget/FY2026/"
    "budget_justification/pdfs/03_RDT_and_E/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf"
)
PDF = Path("data/raw_docs/fy2026/darpa/RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf")
FIXTURE = Path("tests/fixtures/jbooks/darpa_fy2026_excerpt.xml")


def local(tag: str) -> str:
    return tag.split("}")[-1]


def main() -> None:
    if not PDF.exists():
        with httpx.Client() as client:
            download_file(client, URL, PDF)
    xmls = extract_jbook_xml(PDF, PDF.parent / "xml")
    book = max(xmls, key=lambda p: p.stat().st_size)  # the MJB xml is the largest
    tree = ET.parse(book)
    for parent in tree.getroot().iter():
        pes = [c for c in list(parent) if local(c.tag) == "ProgramElement"]
        for extra in pes[2:]:
            parent.remove(extra)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    tree.write(FIXTURE, encoding="utf-8", xml_declaration=True)
    print(f"wrote {FIXTURE} ({FIXTURE.stat().st_size} bytes) from {book.name}")


if __name__ == "__main__":
    main()
