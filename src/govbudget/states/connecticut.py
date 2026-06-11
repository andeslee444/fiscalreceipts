"""Connecticut state checkbook ingestion via data.ct.gov Socrata.

Source
------
CT OpenCheckbook: data.ct.gov Socrata dataset ajdm-rvz7
  "State of CT: Open Expenditures - Ledger Current"
  Updated nightly. Fields: department, expense_category, fiscal_year, amount, ...
  SoQL aggregate used (sum/group) — NOT the raw row feed.

Recon notes (June 2026):
  - Dataset ajdm-rvz7 confirmed live with SoQL aggregate working.
  - ajdm-rvz7 is the "current" dataset; avfh-2eg7 is the archive (FY2011+).
  - SoQL URL is embedded as source_url for full provenance.
  - No API key required for public Socrata aggregates.
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlencode

import duckdb
import httpx

SOCRATA_BASE = "https://data.ct.gov/resource/ajdm-rvz7.json"
DATASET_ID = "ajdm-rvz7"
DOMAIN = "data.ct.gov"


def build_soql_url(fiscal_year: str | None = None, limit: int = 50000) -> str:
    """Build the SoQL aggregate URL for CT checkbook data.

    Groups by department, expense_category, fiscal_year.
    Optionally filters to a specific fiscal year.
    """
    select = "department,expense_category,fiscal_year,sum(amount) as total"
    group = "department,expense_category,fiscal_year"
    params: dict[str, str] = {
        "$select": select,
        "$group": group,
        "$order": "fiscal_year DESC, total DESC",
        "$limit": str(limit),
    }
    if fiscal_year:
        params["$where"] = f"fiscal_year='{fiscal_year}'"
    return f"{SOCRATA_BASE}?{urlencode(params)}"


def fetch_ct_checkbook(
    client: httpx.Client,
    *,
    fiscal_year: str | None = None,
    limit: int = 50000,
) -> tuple[list[dict], str]:
    """Fetch CT checkbook aggregate from Socrata.

    Returns (rows, source_url) where source_url is the full SoQL query URL.
    Each row: {"department", "expense_category", "fiscal_year", "total"}.
    """
    url = build_soql_url(fiscal_year=fiscal_year, limit=limit)
    r = client.get(url, follow_redirects=True)
    r.raise_for_status()
    rows = json.loads(r.text)
    return rows, url


def parse_ct_rows(rows: list[dict], source_url: str) -> list[tuple]:
    """Convert Socrata JSON rows to (jurisdiction, department, category, fiscal_year, amount_usd, source_url) tuples."""
    result = []
    for row in rows:
        try:
            amount = float(row.get("total", "0") or "0")
        except (ValueError, TypeError):
            amount = 0.0
        result.append((
            "CT",
            str(row.get("department", "")),
            str(row.get("expense_category", "")),
            str(row.get("fiscal_year", "")),
            round(amount, 2),
            source_url,
        ))
    return result


def write_ct_checkbook_parquet(rows: list[tuple], out_path: Path) -> Path:
    """Write CT checkbook aggregate to parquet.

    Schema (all varchar): jurisdiction, department, category, fiscal_year,
    amount_usd, source_url.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(
            "create table _ct (jurisdiction varchar, department varchar, category varchar,"
            " fiscal_year varchar, amount_usd varchar, source_url varchar)"
        )
        str_rows = [
            (j, d, c, fy, str(amt), su)
            for j, d, c, fy, amt, su in rows
        ]
        con.executemany("insert into _ct values (?,?,?,?,?,?)", str_rows)
        con.execute(f"copy _ct to '{out_path}' (format parquet, compression zstd)")
    finally:
        con.close()
    return out_path


def acquire_ct_checkbook(
    client: httpx.Client,
    *,
    parquet_dir: Path,
    fiscal_year: str | None = None,
) -> tuple[Path, int]:
    """Fetch and write CT checkbook aggregate parquet.

    Returns (parquet_path, row_count).
    """
    raw_rows, source_url = fetch_ct_checkbook(client, fiscal_year=fiscal_year)
    parsed = parse_ct_rows(raw_rows, source_url)
    out_path = parquet_dir / "states" / "ct_checkbook_agg.parquet"
    write_ct_checkbook_parquet(parsed, out_path)
    print(f"ct_checkbook: {len(parsed)} rows -> {out_path}")
    return out_path, len(parsed)
