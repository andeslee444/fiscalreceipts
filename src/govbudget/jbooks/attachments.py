import io
import zipfile
from pathlib import Path

from pypdf import PdfReader


def _attachment_bytes(contents: list[bytes] | bytes) -> bytes:
    # pypdf returns list[bytes] when the same file is attached at multiple
    # PDF locations; the streams are identical copies.
    if isinstance(contents, list):
        return contents[0]
    return contents


def _dest_path(out_dir: Path, base: str, attachment_name: str) -> Path:
    """Flat layout; on basename collision, prefix with the attachment stem."""
    p = out_dir / base
    if p.exists():
        p = out_dir / f"{Path(attachment_name).stem}__{base}"
    return p


FAMILY_MARKERS = {"rdte": "U_RDTE_", "procurement": "U_PROCUREMENT_"}


def pick_book_xml(xml_dir: Path, *, family: str) -> Path | None:
    """Choose the justification-book XML for the given exhibit family.

    Dual-family orgs share one xml dir, and books ship companion XMLs
    (Exhibit_R-1D/P-1D spreadsheets) that can outweigh the book itself.
    Filter by family marker first, then prefer master (_MJB_) over volume
    (_JB_) books, then largest file as a last resort.
    """
    if not xml_dir.exists():
        return None
    xmls = list(xml_dir.glob("*.xml"))
    if not xmls:
        return None
    marker = FAMILY_MARKERS.get(family, "")
    family_xmls = [p for p in xmls if marker and p.name.upper().startswith(marker)]
    pool = family_xmls or xmls
    for book_marker in ("_MJB_", "_JB_"):
        marked = [p for p in pool if book_marker in p.name]
        if marked:
            return max(marked, key=lambda p: p.stat().st_size)
    return max(pool, key=lambda p: p.stat().st_size)


def list_embedded(pdf_path: Path) -> list[str]:
    return list(PdfReader(str(pdf_path)).attachments.keys())


def extract_jbook_xml(pdf_path: Path, out_dir: Path) -> list[Path]:
    """Extract XML payloads: direct .xml attachments plus .xml members of .zzz zips.

    The DoD budget system attaches the full justification-book XML as a zip
    renamed to .zzz ("save & rename to .zip to open").
    """
    reader = PdfReader(str(pdf_path))
    written: list[Path] = []
    for name, contents in reader.attachments.items():
        data = _attachment_bytes(contents)
        if name.lower().endswith(".xml"):
            out_dir.mkdir(parents=True, exist_ok=True)
            p = _dest_path(out_dir, Path(name).name, name)
            p.write_bytes(data)
            written.append(p)
        elif name.lower().endswith(".zzz"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for member in z.namelist():
                    if member.lower().endswith(".xml"):
                        out_dir.mkdir(parents=True, exist_ok=True)
                        p = _dest_path(out_dir, Path(member).name, name)
                        p.write_bytes(z.read(member))
                        written.append(p)
    return sorted(written)
