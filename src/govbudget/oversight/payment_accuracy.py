"""paymentaccuracy.gov scraper -> improper_payments parquet.

Page structure (verified from live site, June 2026):
  - Program title in <h1>
  - Sponsoring agency in <h3> containing "Sponsoring agency:"
  - Per-FY summary in <div class="metrics-summary">:
      PROGRAM METRICS / $41,256 M / inFY 2022 outlays, with a / 99.4% / payment accuracy rate
  - FY labels also appear in <div class="usa-card__body"> containing
    "FY YYYY improper payment estimates"

Output parquet columns (all varchar): program, agency_name, agency_code,
fiscal_year, rate_pct, amount_usd, outlays_usd, source_url.
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from urllib.parse import urljoin

import duckdb
import httpx
from selectolax.parser import HTMLParser

INDEX_URL = "https://paymentaccuracy.gov/agencies-and-programs"
_MILLION = 1_000_000

# Regex to parse "$41,256 M" or "$1,234.56 M" style amounts
_AMOUNT_RE = re.compile(r"\$([0-9,]+(?:\.[0-9]+)?)\s*M")
# Regex to parse "FY 2022" from card body text
_FY_RE = re.compile(r"FY\s+(20\d\d)")
# Regex to parse "99.4%" accuracy rate
_RATE_RE = re.compile(r"(\d+\.?\d*)%")


def discover_program_urls(client: httpx.Client, index_url: str) -> list[str]:
    """Fetch index page and return deduplicated absolute /program/... URLs."""
    r = client.get(index_url, follow_redirects=True)
    r.raise_for_status()
    seen: set[str] = set()
    urls: list[str] = []
    for a in HTMLParser(r.text).css("a[href]"):
        href = a.attributes.get("href") or ""
        if not href.startswith("/program/"):
            continue
        abs_url = urljoin(index_url, href)
        if abs_url in seen:
            continue
        seen.add(abs_url)
        urls.append(abs_url)
    return urls


def _parse_dollar_millions(text: str) -> str | None:
    """Parse '$41,256 M' -> '41256000000' (integer USD, as string)."""
    m = _AMOUNT_RE.search(text)
    if not m:
        return None
    raw = m.group(1).replace(",", "")
    try:
        millions = float(raw)
        return str(round(millions * _MILLION))
    except ValueError:
        return None


def _round_rate(val: float) -> str:
    """Format improper rate to 1 decimal place, stripping trailing zeros."""
    rounded = round(val, 1)
    # Format: 1.0 -> "1.0", 0.6 -> "0.6"
    return f"{rounded:.1f}"


def parse_program_page(html: str, url: str) -> dict:
    """Parse one program page.

    Returns dict with keys:
      program, agency_name, agency_code, source_url,
      fy_rows: list[dict] where each has fiscal_year, rate_pct, amount_usd,
               outlays_usd, source_url.

    agency_code is extracted from the URL slug prefix (e.g. hhs-, ssa-, dow-).
    rate_pct is the IMPROPER payment rate (= 100 - accuracy_rate).
    amount_usd is derived as outlays * rate_pct / 100 (no separate amount shown).
    """
    tree = HTMLParser(html)

    # Program name
    h1 = tree.css_first("h1")
    program = h1.text(strip=True) if h1 else ""

    # Sponsoring agency
    agency_name = ""
    for h3 in tree.css("h3"):
        t = h3.text(strip=True)
        if "Sponsoring agency" in t:
            # "Sponsoring agency:  Department of Health and Human Services"
            agency_name = t.split(":", 1)[-1].strip()
            break

    # Agency code from URL slug prefix (segment after last /)
    agency_code = ""
    slug = url.rstrip("/").rsplit("/", 1)[-1]  # e.g. "hhs-centers-for-..."
    parts = slug.split("-", 1)
    if parts:
        agency_code = parts[0].lower()

    # Per-FY data from metrics-summary cards
    # Each card: [PROGRAM METRICS, $X M, inFY YYYY outlays, with a, ZZ.Z%, payment accuracy rate]
    fy_rows: list[dict] = []
    for card in tree.css("div.metrics-summary"):
        texts = [n.text(strip=True) for n in card.iter()
                 if hasattr(n, "tag") and n.text(strip=True)]

        outlays_raw = None
        fy = None
        accuracy_rate = None

        for t in texts:
            # Parse dollar amount
            if _AMOUNT_RE.search(t) and outlays_raw is None:
                outlays_raw = t

            # Parse FY year
            fy_m = _FY_RE.search(t)
            if fy_m and fy is None:
                fy = fy_m.group(1)

            # Parse accuracy rate (the percentage in the card is accuracy, not improper)
            rate_m = _RATE_RE.fullmatch(t)
            if rate_m and accuracy_rate is None:
                accuracy_rate = float(rate_m.group(1))

        if fy is None or outlays_raw is None or accuracy_rate is None:
            continue

        outlays_usd = _parse_dollar_millions(outlays_raw)
        if outlays_usd is None:
            continue

        # Improper rate = 100 - accuracy_rate
        improper_rate = 100.0 - accuracy_rate
        rate_pct = _round_rate(improper_rate)

        # Derived amount: outlays * improper_rate / 100
        try:
            amount_usd = str(round(int(outlays_usd) * improper_rate / 100))
        except (ValueError, ZeroDivisionError):
            amount_usd = ""

        fy_rows.append({
            "fiscal_year": fy,
            "rate_pct": rate_pct,
            "amount_usd": amount_usd,
            "outlays_usd": outlays_usd,
            "source_url": url,
        })

    return {
        "program": program,
        "agency_name": agency_name,
        "agency_code": agency_code,
        "source_url": url,
        "fy_rows": fy_rows,
    }


def scrape_payment_accuracy(
    client: httpx.Client,
    *,
    out_path: Path,
) -> Path:
    """Scrape all program pages and write improper_payments.parquet.

    Columns (all varchar): program, agency_name, agency_code, fiscal_year,
    rate_pct, amount_usd, outlays_usd, source_url.
    """
    urls = discover_program_urls(client, INDEX_URL)
    print(f"payment_accuracy: discovered {len(urls)} program pages")

    rows: list[tuple] = []
    for i, url in enumerate(urls, 1):
        if i % 25 == 0:
            print(f"  ... {i}/{len(urls)} pages scraped")
        try:
            r = client.get(url, follow_redirects=True)
            r.raise_for_status()
            page = parse_program_page(r.text, url)
            for fy_row in page["fy_rows"]:
                rows.append((
                    page["program"],
                    page["agency_name"],
                    page["agency_code"],
                    fy_row["fiscal_year"],
                    fy_row["rate_pct"],
                    fy_row["amount_usd"],
                    fy_row["outlays_usd"],
                    fy_row["source_url"],
                ))
        except Exception as exc:
            print(f"  WARNING: {url} -> {type(exc).__name__}: {exc}")
        # Polite delay between requests
        time.sleep(0.3)

    print(f"payment_accuracy: {len(rows)} FY rows from {len(urls)} programs")

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    try:
        con.execute(
            "create table _ip ("
            "program varchar, agency_name varchar, agency_code varchar,"
            "fiscal_year varchar, rate_pct varchar, amount_usd varchar,"
            "outlays_usd varchar, source_url varchar)"
        )
        con.executemany("insert into _ip values (?,?,?,?,?,?,?,?)", rows)
        con.execute(
            f"copy _ip to '{out_path}' (format parquet, compression zstd)"
        )
    finally:
        con.close()

    return out_path
