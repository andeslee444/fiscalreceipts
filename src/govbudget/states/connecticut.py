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


def build_soql_url(
    fiscal_year: str | None = None,
    limit: int = 50000,
    *,
    select_override: str | None = None,
    where_override: str | None = None,
) -> str:
    """Build the SoQL aggregate URL for CT checkbook data.

    Groups by department, expense_category, fiscal_year.
    Optionally filters to a specific fiscal year.

    Args:
        fiscal_year: Optional fiscal year string (e.g. 'FY 2025') for $where clause.
            Ignored if where_override is supplied.
        limit: Row limit (default 50000). Not applied when select_override is set
            for per-figure (aggregate scalar) queries.
        select_override: If supplied, replaces the default $select clause entirely
            (e.g. "sum(amount) as total"). No $group or $order are added when
            select_override is set, since aggregate-only queries need neither.
        where_override: If supplied, replaces the fiscal-year $where clause entirely.

    Backwards-compatible: existing callers without overrides behave identically.
    """
    if select_override is not None:
        # Per-figure aggregate query: only $select + $where (no $group/$order/$limit)
        params: dict[str, str] = {"$select": select_override}
        if where_override is not None:
            params["$where"] = where_override
        elif fiscal_year:
            params["$where"] = f"fiscal_year='{fiscal_year}'"
        return f"{SOCRATA_BASE}?{urlencode(params)}"

    # Default grouped aggregate query (backwards-compatible)
    select = "department,expense_category,fiscal_year,sum(amount) as total"
    group = "department,expense_category,fiscal_year"
    params = {
        "$select": select,
        "$group": group,
        "$order": "fiscal_year DESC, total DESC",
        "$limit": str(limit),
    }
    if where_override is not None:
        params["$where"] = where_override
    elif fiscal_year:
        params["$where"] = f"fiscal_year='{fiscal_year}'"
    return f"{SOCRATA_BASE}?{urlencode(params)}"


# Mapping from comparable_category to CT raw expense_category values
# (loaded lazily from dbt/seeds/state_category_map.csv; cached at module level)
_CT_CATEGORY_MAP: dict[str, list[str]] | None = None


def _load_ct_category_map() -> dict[str, list[str]]:
    """Load the CT→comparable_category mapping from state_category_map.csv.

    Returns {comparable_category: [raw_expense_category, ...]} for jurisdiction='CT'.
    Searches for the seed CSV relative to this module's package root.
    """
    global _CT_CATEGORY_MAP
    if _CT_CATEGORY_MAP is not None:
        return _CT_CATEGORY_MAP

    import csv
    from pathlib import Path as _Path

    # state_category_map.csv lives in dbt/seeds/ relative to the repo root
    # (src/govbudget/states/ → up 3 levels → repo root → dbt/seeds/)
    here = _Path(__file__).resolve()
    candidates = [
        here.parents[3] / "dbt" / "seeds" / "state_category_map.csv",
        here.parents[4] / "dbt" / "seeds" / "state_category_map.csv",
    ]
    csv_path = next((p for p in candidates if p.exists()), None)

    result: dict[str, list[str]] = {}
    if csv_path is not None:
        with open(csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("jurisdiction") != "CT":
                    continue
                comparable = row.get("comparable_category", "").strip()
                raw = row.get("raw_category", "").strip()
                if comparable and raw:
                    result.setdefault(comparable, []).append(raw)

    _CT_CATEGORY_MAP = result
    return result


def build_figure_soql_url(
    comparable_category: str,
    fiscal_year: str,
) -> str:
    """Build a per-figure SoQL URL for a CT comparable_category + fiscal_year.

    Returns a URL that fetches:
        SELECT sum(amount) as total
        WHERE fiscal_year='{fiscal_year}'
          AND expense_category IN (<raw categories for comparable_category>)

    The URL is the durable citation artifact for the CT state_soql citation tier.
    If no raw categories are found for comparable_category, returns a minimal URL
    (the gate will capture a zero/null total, which is honest).

    Args:
        comparable_category: e.g. 'grants_and_subventions', 'travel',
            'consulting_professional'
        fiscal_year: CT fiscal year string as stored in the dataset, e.g. 'FY 2025'
    """
    cat_map = _load_ct_category_map()
    raw_categories = cat_map.get(comparable_category, [])

    # Build the IN-list for the $where clause using single-quoted SQL strings
    in_list = ", ".join(f"'{c}'" for c in raw_categories)

    if in_list:
        where = f"fiscal_year='{fiscal_year}' AND expense_category in ({in_list})"
    else:
        where = f"fiscal_year='{fiscal_year}'"

    return build_soql_url(
        select_override="sum(amount) as total",
        where_override=where,
    )


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
