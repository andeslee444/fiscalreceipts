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
