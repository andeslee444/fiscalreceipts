"""Service J-book probe: Playwright-backed index fetch + PDF inventory.

Navy (secnav.navy.mil/fmc/fmb) sits behind a bot-WAF that returns a 244-byte
"Request Rejected" page to server-side curl; Army (asafm.army.mil) sits behind
Akamai returning 403 to the same. A real headless browser completes the
TLS+JS handshake those clients cannot. This module is the Phase 5G Task 1
probe: it fetches each service's FY2026 index page with headless Chromium and
inventories every PDF link. It does NOT download books in bulk, write the
warehouse, or touch the DB — that is Task 3+.

Split by testability:
  - Pure functions (parse_pdf_links, is_waf_block, absolute) — HTML/URL logic,
    unit-tested against recorded fixtures.
  - Live functions (fetch_rendered_html, download_pdf) — Playwright transport,
    exercised only by scripts/probe_service_jbooks.py against the real sites.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urljoin

from selectolax.parser import HTMLParser

# Realistic desktop Chrome on macOS — the probe presents as a normal browser,
# no evasion beyond a real UA/viewport/locale (the WAF blocks non-browsers,
# not browsers; if it blocks THIS, that is a finding, not a challenge).
REALISTIC_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
VIEWPORT = {"width": 1440, "height": 900}
LOCALE = "en-US"

# FY2026 service index entry points. The listing page may be a child link of
# these; the live probe follows year links from here.
#
# Navy: the feasibility-spike URL /fmc/fmb/Pages/Pres-Budget.aspx is DEAD in
# 2026-07 — it redirects to the SECNAV homepage. The live FY2026 book listing
# is the SharePoint document library folder /fmc/fmb/Documents/26pres/ ("26pres"
# = 2026 President's budget), reached from the "Budget Materials" nav. Both are
# listed so the probe records the dead redirect and still finds the real books.
SERVICE_INDEX_URLS: dict[str, list[str]] = {
    "navy": [
        "https://www.secnav.navy.mil/fmc/fmb/Documents/26pres/",
        "https://www.secnav.navy.mil/fmc/fmb/Pages/Pres-Budget.aspx",
    ],
    "army": [
        "https://www.asafm.army.mil/Budget-Materials/",
    ],
}

# Signatures of the WAF rejection pages the feasibility spike recorded from
# server-side curl. If a headless browser still hits one of these, the service
# is BLOCKED — we stop, we do not escalate to stealth.
_WAF_MARKERS = (
    "request rejected",
    "the requested url was rejected",
    "access denied",
    "akamai",
    "reference #",
)


@dataclass(frozen=True)
class PdfLink:
    text: str
    href: str  # absolute


def absolute(base_url: str, href: str) -> str:
    """Resolve a possibly-relative href against the page URL."""
    return urljoin(base_url, href)


def parse_pdf_links(html: str, base_url: str) -> list[PdfLink]:
    """Every <a> whose (unquoted) absolute href ends in .pdf, de-duplicated.

    Link text is normalized to a single line; empty-text links keep the PDF
    basename as their text so the inventory is never blank.
    """
    out: list[PdfLink] = []
    seen: set[str] = set()
    for a in HTMLParser(html).css("a[href]"):
        href = a.attributes.get("href") or ""
        url = absolute(base_url, href)
        low = unquote(url).lower().split("?")[0].split("#")[0]
        if not low.endswith(".pdf"):
            continue
        if url in seen:
            continue
        seen.add(url)
        text = " ".join((a.text() or "").split()).strip()
        if not text:
            text = unquote(url).rsplit("/", 1)[-1]
        out.append(PdfLink(text=text, href=url))
    return out


def parse_year_links(html: str, base_url: str, *, fiscal_year: int) -> list[str]:
    """Absolute hrefs of links whose text/href mentions the fiscal year.

    Service index pages are hubs: the FY2026 book listing is usually a child
    page ("FY 2026", "Budget2026", "president-s-budget-fy-2026"). This finds
    candidate drill-down links for the live probe to follow.
    """
    fy = str(fiscal_year)
    fy_short = fy[-2:]
    needles = (fy, f"fy{fy_short}", f"budget{fy}", f"pb{fy_short}", f"pb {fy}")
    out: list[str] = []
    seen: set[str] = set()
    for a in HTMLParser(html).css("a[href]"):
        href = a.attributes.get("href") or ""
        url = absolute(base_url, href)
        hay = f"{(a.text() or '')} {unquote(url)}".lower()
        if any(n in hay for n in needles) and url not in seen:
            seen.add(url)
            out.append(url)
    return out


def is_waf_block(status: int | None, title: str, body: str) -> bool:
    """True when the response is a WAF rejection, not real content.

    A non-2xx status, or a small body containing a known rejection marker with
    no PDF links, is a block. Real index pages are large and carry PDF anchors.
    """
    if status is not None and status >= 400:
        return True
    hay = f"{title}\n{body}".lower()
    if any(m in hay for m in _WAF_MARKERS) and "<a" not in body.lower():
        return True
    # Tiny bodies with a marker are the classic 244-byte rejection page.
    if len(body) < 1500 and any(m in hay for m in _WAF_MARKERS):
        return True
    return False


def render_inventory(links: list[PdfLink]) -> str:
    """Format a PDF inventory as `text\\thref` lines for the evidence file."""
    return "\n".join(f"{ln.text}\t{ln.href}" for ln in links) + ("\n" if links else "")


# --------------------------------------------------------------------------
# Live transport (Playwright). Not unit-tested; driven by the probe script.
# --------------------------------------------------------------------------


@dataclass
class FetchResult:
    url: str
    status: int | None
    title: str
    body_html: str


def fetch_rendered_html(page, url: str, *, wait_ms: int = 1500) -> FetchResult:
    """Navigate a Playwright page to url, wait for network idle, return HTML.

    `page` is a playwright.sync_api.Page. Kept parameterized so the probe
    script owns browser lifecycle (one browser, one page at a time — polite).
    """
    resp = page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    try:
        page.wait_for_load_state("networkidle", timeout=20_000)
    except Exception:
        pass  # some pages keep long-poll sockets open; DOM is already settled
    page.wait_for_timeout(wait_ms)
    return FetchResult(
        url=url,
        status=(resp.status if resp is not None else None),
        title=page.title(),
        body_html=page.content(),
    )


def download_pdf(context, url: str, dest: Path) -> tuple[str, int]:
    """Download one PDF via the browser context's request API. Returns (sha256, bytes).

    Uses the SAME authenticated browser context that passed the WAF, so the
    request carries the browser's TLS fingerprint and cookies. Bounded to the
    Task 1 sample: the caller downloads exactly one book per reachable service.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    resp = context.request.get(url, timeout=180_000)
    if resp.status >= 400:
        raise RuntimeError(f"HTTP {resp.status} fetching {url}")
    data = resp.body()
    dest.write_bytes(data)
    return hashlib.sha256(data).hexdigest(), len(data)
