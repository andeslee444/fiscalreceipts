import io
import zipfile
from pathlib import Path

from pypdf import PdfReader


def _attachment_bytes(contents) -> bytes:
    # pypdf returns list[bytes] for attachments with multiple streams
    if isinstance(contents, list):
        return contents[0]
    return contents


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
            p = out_dir / Path(name).name
            p.write_bytes(data)
            written.append(p)
        elif name.lower().endswith(".zzz"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for member in z.namelist():
                    if member.lower().endswith(".xml"):
                        out_dir.mkdir(parents=True, exist_ok=True)
                        p = out_dir / Path(member).name
                        p.write_bytes(z.read(member))
                        written.append(p)
    return sorted(written)
