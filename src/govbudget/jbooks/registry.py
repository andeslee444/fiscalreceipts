import re
from urllib.parse import urljoin

import httpx
import psycopg
from selectolax.parser import HTMLParser

ROLLUP_NAMES = {"r1_display.xlsx", "p1_display.xlsx", "p1r_display.xlsx"}
FAMILY = {"RDTE": "rdte", "PROC": "procurement"}
# Tokens that are structural, not part of the org name. Built from observed
# real filenames: Vol1/VOL2B volume markers, PB/PB26 cycle markers, years,
# JustificationBook in its camel-case, split, and Master variants.
_NOISE_TOKEN = re.compile(
    r"(?i)^(vol\w*|pb\d*|\d{2,4}|master|book|amended|base|oco"
    r"|(master)?justification(book)?)$"
)


def _classify_jbook(name: str) -> tuple[str, str] | None:
    """Classify a J-book PDF filename -> (exhibit_family, org), or None.

    Handles both naming conventions on the comptroller site:
    long  RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf -> (rdte, DARPA)
    short RDTE_CBDP_PB_2026.pdf                               -> (rdte, CBDP)
    """
    m = re.match(r"(?i)^(RDTE|PROC)[_-](.+)\.pdf$", name)
    if not m:
        return None
    family = FAMILY[m.group(1).upper()]
    tokens = re.split(r"[_-]+", m.group(2))
    org_tokens = [
        t for t in tokens
        if t and not _NOISE_TOKEN.match(t) and t.upper() not in FAMILY
    ]
    if not org_tokens:
        return None
    return family, "_".join(org_tokens)


def discover_documents(client: httpx.Client, index_url: str, *, fiscal_year: int) -> list[dict]:
    r = client.get(index_url, follow_redirects=True)
    r.raise_for_status()
    docs: list[dict] = []
    seen: set[str] = set()
    for a in HTMLParser(r.text).css("a[href]"):
        href = a.attributes.get("href") or ""
        url = urljoin(index_url, href)
        if url in seen:
            continue
        seen.add(url)
        name = url.rsplit("/", 1)[-1]
        if name.lower() in ROLLUP_NAMES:
            docs.append({
                "org": "DoD", "exhibit_family": "rollup", "fiscal_year": fiscal_year,
                "title": name, "source_url": url,
            })
            continue
        classified = _classify_jbook(name)
        if classified:
            family, org = classified
            docs.append({
                "org": org, "exhibit_family": family,
                "fiscal_year": fiscal_year, "title": name, "source_url": url,
            })
    return docs


def upsert_documents(dsn: str, docs: list[dict]) -> int:
    inserted = 0
    with psycopg.connect(dsn) as con:
        for d in docs:
            cur = con.execute(
                """
                insert into jbook_documents (org, exhibit_family, fiscal_year, title, source_url)
                values (%(org)s, %(exhibit_family)s, %(fiscal_year)s, %(title)s, %(source_url)s)
                on conflict (source_url) do nothing
                """,
                d,
            )
            inserted += cur.rowcount
    return inserted
