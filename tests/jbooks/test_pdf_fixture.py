from pathlib import Path

import pdfplumber

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "jbooks" / "darpa_p24_25.pdf"


def test_fixture_contains_anchor_and_amount_on_both_pages():
    with pdfplumber.open(FIXTURE) as pdf:
        assert len(pdf.pages) == 2
        texts = [p.extract_text() or "" for p in pdf.pages]
    assert "0601101E" in texts[0] and "280.494" in texts[0]
    assert "0601101E" in texts[1] and "280.494" in texts[1]  # ambiguity case is real
