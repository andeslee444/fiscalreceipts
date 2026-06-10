"""Build the committed P-40 golden fixture from the real FY2026 CBDP book.

The CBDP procurement MJB XML is already on disk (extracted during the
Phase 1A live smoke). Trims each LineItem's ItemExhibitList (P-5/P-21
detail, not parsed in Phase 1B) to keep the fixture small.
Run: uv run python scripts/make_p40_fixture.py
"""
import xml.etree.ElementTree as ET
from pathlib import Path

SRC = Path(
    "data/raw_docs/fy2026/cbdp/xml/U_PROCUREMENT_MJB_2506240848XAYF_CBDP_PB_2026.xml"
)
FIXTURE = Path("tests/fixtures/jbooks/cbdp_fy2026_excerpt.xml")


def local(tag: str) -> str:
    return tag.split("}")[-1]


def main() -> None:
    tree = ET.parse(SRC)
    for li in (e for e in tree.getroot().iter() if local(e.tag) == "LineItem"):
        for child in [c for c in list(li) if local(c.tag) == "ItemExhibitList"]:
            li.remove(child)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    tree.write(FIXTURE, encoding="utf-8", xml_declaration=True)
    print(f"wrote {FIXTURE} ({FIXTURE.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
