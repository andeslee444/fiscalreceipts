import io
import zipfile

from pypdf import PdfWriter

from govbudget.jbooks.attachments import extract_jbook_xml, list_embedded

XML_BODY = b'<?xml version="1.0"?><root xmlns:jb="http://www.dtic.mil/comptroller/xml/schema/022009/jb"><jb:ProgramElement/></root>'


def make_pdf(tmp_path, attachments):
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    for name, data in attachments.items():
        w.add_attachment(name, data)
    p = tmp_path / "book.pdf"
    with open(p, "wb") as f:
        w.write(f)
    return p


def make_zzz():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("U_RDTE_MJB_FAKE_PB_2026.xml", XML_BODY)
        z.writestr("seal.png", b"\x89PNG")
    return buf.getvalue()


def test_list_embedded(tmp_path):
    pdf = make_pdf(tmp_path, {"Exhibit_R-1D.xml": XML_BODY, "book.zzz": make_zzz()})
    assert set(list_embedded(pdf)) == {"Exhibit_R-1D.xml", "book.zzz"}


def test_extract_jbook_xml_handles_direct_and_zipped(tmp_path):
    pdf = make_pdf(tmp_path, {"Exhibit_R-1D.xml": XML_BODY, "book.zzz": make_zzz()})
    out = extract_jbook_xml(pdf, tmp_path / "xml")
    names = sorted(p.name for p in out)
    assert names == ["Exhibit_R-1D.xml", "U_RDTE_MJB_FAKE_PB_2026.xml"]
    for p in out:
        assert p.read_bytes() == XML_BODY


def test_extract_on_pdf_without_attachments(tmp_path):
    pdf = make_pdf(tmp_path, {})
    assert extract_jbook_xml(pdf, tmp_path / "xml") == []
    assert list_embedded(pdf) == []


def test_colliding_basenames_are_disambiguated_not_overwritten(tmp_path):
    def zzz_with(name, body):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr(name, body)
        return buf.getvalue()

    pdf = make_pdf(tmp_path, {
        "JB_A.zzz": zzz_with("Exhibit_R-2.xml", b"<a/>"),
        "JB_B.zzz": zzz_with("Exhibit_R-2.xml", b"<b/>"),
    })
    out = extract_jbook_xml(pdf, tmp_path / "xml")
    assert len(out) == 2
    assert len({p.name for p in out}) == 2  # distinct file names
    bodies = {p.read_bytes() for p in out}
    assert bodies == {b"<a/>", b"<b/>"}


def test_zip_member_paths_are_flattened(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("sub/dir/book.xml", XML_BODY)
    pdf = make_pdf(tmp_path, {"book.zzz": buf.getvalue()})
    out = extract_jbook_xml(pdf, tmp_path / "xml")
    assert [p.name for p in out] == ["book.xml"]
    assert out[0].parent == tmp_path / "xml"
