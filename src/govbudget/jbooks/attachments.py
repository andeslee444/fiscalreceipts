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


def pick_book_xml(xml_dir: Path) -> Path | None:
    """Choose the justification-book XML among extracted attachments.

    Books ship companion XMLs (Exhibit_R-1D/P-1D spreadsheets, wall charts)
    that can be LARGER than the book itself, so prefer by name convention:
    master book (_MJB_), then volume book (_JB_), then largest file.
    """
    if not xml_dir.exists():
        return None
    xmls = list(xml_dir.glob("*.xml"))
    if not xmls:
        return None
    for marker in ("_MJB_", "_JB_"):
        marked = [p for p in xmls if marker in p.name]
        if marked:
            return max(marked, key=lambda p: p.stat().st_size)
    return max(xmls, key=lambda p: p.stat().st_size)


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
