"""GAO high-risk list ingest -> high_risk.parquet.

Page structure (verified from live site, June 2026):
  - gao.gov/high-risk-list serves a page with a section starting 'Current List'
  - That section contains <a href="..."> links to individual area sections
    in the GAO-25-107743 report PDF hosted on files.gao.gov
  - One additional link ('This table') points to a PDF table and is excluded

Parquet columns (all varchar): area_title, area_url, agency_code, mapped,
notes, source_url.
"""
from __future__ import annotations

import csv
from pathlib import Path
from urllib.parse import urljoin

import duckdb
import httpx
from selectolax.parser import HTMLParser

from govbudget.agency_codes import canonical_agency

GAO_URL = "https://www.gao.gov/high-risk-list"

# The 'This table' link in the current-list section is metadata, not an area
_EXCLUDE_TEXTS = frozenset({"This table"})


def parse_high_risk_index(html: str, url: str) -> list[dict]:
    """Parse the GAO high-risk page and return list of area dicts.

    Each dict has: area_title, area_url, source_url.
    """
    tree = HTMLParser(html)
    areas: list[dict] = []

    # Find the section that starts with 'Current List'
    current_list_section = None
    for section in tree.css("section"):
        text = section.text(strip=True)
        if text.startswith("Current List"):
            current_list_section = section
            break

    if current_list_section is None:
        return areas

    for a in current_list_section.css("a[href]"):
        href = a.attributes.get("href") or ""
        if not href:
            continue
        title = a.text(strip=True)
        if not title or title in _EXCLUDE_TEXTS:
            continue
        # Only include links that point to external report (files.gao.gov)
        if "gao.gov" not in href:
            continue
        abs_url = urljoin(url, href) if href.startswith("/") else href
        areas.append({
            "area_title": title,
            "area_url": abs_url,
            "source_url": url,
        })

    return areas


def _normalize_title(title: str) -> str:
    """Normalize smart quotes/apostrophes to ASCII for reliable matching.

    GAO's page uses U+2019 RIGHT SINGLE QUOTATION MARK in titles like
    "DOE's" and "Nation's". The CSV seed file uses straight apostrophes.
    Normalizing both sides ensures matches regardless of quote style.
    """
    return (
        title
        .replace("’", "'")   # right single quotation mark
        .replace("‘", "'")   # left single quotation mark
        .replace("“", '"')   # left double quotation mark
        .replace("”", '"')   # right double quotation mark
        .strip()
    )


def _load_agency_map(agency_map_csv: Path) -> dict[str, dict]:
    """Load the curated agency map CSV.

    Returns {normalized_area_title: {agency_code, notes}}.
    Keys are normalized via _normalize_title to handle smart-quote variants.
    """
    mapping: dict[str, dict] = {}
    with open(agency_map_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = _normalize_title(row["area_title"])
            mapping[key] = {
                "agency_code": row.get("agency_code", "").strip(),
                "notes": row.get("notes", "").strip(),
            }
    return mapping


def build_high_risk(
    client: httpx.Client,
    *,
    agency_map_csv: Path,
    out_path: Path,
) -> Path:
    """Scrape GAO high-risk index, left-join agency map, write parquet.

    Parquet columns (all varchar): area_title, area_url, agency_code,
    mapped, notes, source_url.
    """
    r = client.get(GAO_URL, follow_redirects=True)
    r.raise_for_status()

    areas = parse_high_risk_index(r.text, GAO_URL)
    print(f"high_risk: found {len(areas)} areas")

    agency_map = _load_agency_map(agency_map_csv)

    rows: list[tuple] = []
    for area in areas:
        title = area["area_title"]
        # Normalize for map lookup (handles smart-quote variants)
        mapping = agency_map.get(_normalize_title(title), {})
        raw_code = mapping.get("agency_code", "")
        agency_code = canonical_agency(raw_code) or ""
        notes = mapping.get("notes", "")
        mapped = "true" if agency_code else "false"
        rows.append((
            title,
            area["area_url"],
            agency_code,
            mapped,
            notes,
            area["source_url"],
        ))

    # Report mapping coverage
    n_mapped = sum(1 for r in rows if r[3] == "true")
    pct = n_mapped / len(rows) * 100 if rows else 0
    print(f"high_risk: {n_mapped}/{len(rows)} areas mapped ({pct:.1f}%)")
    if pct < 80:
        print(
            f"  WARNING: mapped {pct:.1f}% < 80% target; "
            "update data-seeds/gao_high_risk_agency_map.csv"
        )

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    try:
        con.execute(
            "create table _hr ("
            "area_title varchar, area_url varchar, agency_code varchar,"
            "mapped varchar, notes varchar, source_url varchar)"
        )
        con.executemany("insert into _hr values (?,?,?,?,?,?)", rows)
        con.execute(
            f"copy _hr to '{out_path}' (format parquet, compression zstd)"
        )
    finally:
        con.close()

    return out_path
