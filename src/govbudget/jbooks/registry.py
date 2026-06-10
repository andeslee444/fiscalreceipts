import re
from urllib.parse import urljoin

import httpx
import psycopg
from selectolax.parser import HTMLParser

ROLLUP_NAMES = {"r1_display.xlsx", "p1_display.xlsx", "p1r_display.xlsx"}
# e.g. RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf
JBOOK_RE = re.compile(
    r"(?P<family>RDTE|PROC)_[^/]*?_(?P<org>[A-Za-z0-9-]+)_(?:Master)?JustificationBook[^/]*\.pdf$",
    re.IGNORECASE,
)
FAMILY = {"RDTE": "rdte", "PROC": "procurement"}


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
        m = JBOOK_RE.search(name)
        if m:
            docs.append({
                "org": m.group("org"), "exhibit_family": FAMILY[m.group("family").upper()],
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
