"""Save a trimmed paymentaccuracy.gov program-page fixture for testing.

Downloads the APTC program page (HHS CMS), strips nav/footer, keeps only
the data sections (program title, sponsoring agency, metrics-summary cards,
and the FY estimate card bodies). Writes < 100 KB to the fixture path.

Run: uv run python scripts/make_pa_fixture.py
"""
import sys
from pathlib import Path

import httpx
from selectolax.parser import HTMLParser

sys.path.insert(0, "src")

PROGRAM_URL = (
    "https://paymentaccuracy.gov/program/"
    "hhs-centers-for-medicare-medicaid-services-cms-advance-premi-155942da"
)
FIXTURE = Path("tests/fixtures/oversight/pa_program_page.html")

# Tags/classes to remove (nav, footer, scripts, styles, non-data boilerplate)
STRIP_SELECTORS = [
    "script",
    "style",
    "nav",
    "footer",
    "header",
    "link",
    "meta",
    "noscript",
    "[class*=recovery-audits]",
    "[class*=actions-table]",
    "[class*=overpayments-table]",
    "[class*=eligibility-table]",
    "[class*=future-outlook]",
    "[class*=chart-toggle]",
    "[class*=chart-legend]",
    "[class*=sampling]",
    "[class*=causes]",
    "[class*=prevention]",
    "svg",
    "iframe",
    "[class*=video]",
    "[class*=social]",
    "[class*=breadcrumb]",
    "[class*=footer]",
    "[class*=nav]",
    "[class*=menu]",
    "[class*=sidebar]",
    "[class*=share]",
    "[class*=feedback]",
    "[class*=skip]",
]


def main() -> None:
    with httpx.Client(
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36"
            )
        },
        timeout=30,
        follow_redirects=True,
    ) as client:
        r = client.get(PROGRAM_URL)
        r.raise_for_status()

    tree = HTMLParser(r.text)

    # Strip boilerplate nodes
    for sel in STRIP_SELECTORS:
        for node in tree.css(sel):
            node.decompose()

    # Build a minimal HTML shell with just the data we need
    # Extract: h1 (title), h3 (sponsoring agency), metrics-summary cards,
    # and usa-card__body divs (FY sections)
    parts = ["<!DOCTYPE html><html><body>"]

    # Program title
    h1 = tree.css_first("h1")
    if h1:
        parts.append(f"<h1>{h1.text(strip=True)}</h1>")

    # Sponsoring agency h3
    for h3 in tree.css("h3"):
        if "Sponsoring agency" in h3.text(strip=True):
            parts.append(f"<h3>{h3.text(strip=True)}</h3>")
            break

    # FY summary cards (metrics-summary)
    for card in tree.css("div.metrics-summary"):
        parts.append(card.html or "")

    # FY estimate card bodies (for the FY label)
    for card_body in tree.css("div.usa-card__body"):
        text = card_body.text(strip=True)
        if "improper payment estimates" in text:
            parts.append(card_body.html or "")

    parts.append("</body></html>")

    content = "\n".join(parts)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(content, encoding="utf-8")
    size_kb = FIXTURE.stat().st_size / 1024
    print(f"wrote {FIXTURE} ({size_kb:.1f} KB)")
    if size_kb > 100:
        print(f"WARNING: fixture is {size_kb:.1f} KB (target < 100 KB)")


if __name__ == "__main__":
    main()
