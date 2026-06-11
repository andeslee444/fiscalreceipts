"""US Census state population estimates ingestion.

Source
------
Census Bureau Population Estimates Program (PEP) bulk CSV.
  URL: https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/state/totals/NST-EST2024-ALLDATA.csv
  No API key required (FTP bulk file, not the API).
  Columns: SUMLEV, STATE (FIPS), NAME, POPESTIMATE2020 ... POPESTIMATE2024

Recon notes (June 2026):
  - Census API endpoints (api.census.gov) require a key for ALL datasets tested:
    ACS 1-year, ACS 5-year, PEP, decennial DHC/PL.
  - The FTP bulk file at www2.census.gov works without authentication.
  - NST-EST2024-ALLDATA.csv: 57 rows (US, regions, divisions, 50 states + DC).
  - SUMLEV=040 filters to state-level rows only.
  - Source URL recorded on every row for provenance.
"""
from __future__ import annotations

import csv
import io
from pathlib import Path

import duckdb
import httpx

POPULATION_CSV_URL = (
    "https://www2.census.gov/programs-surveys/popest/datasets"
    "/2020-2024/state/totals/NST-EST2024-ALLDATA.csv"
)

# FIPS codes → state abbreviations (subset covering at least CA + CT)
FIPS_TO_ABBREV: dict[str, str] = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
    "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
    "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
    "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY",
}


def parse_population_csv(
    text: str,
    source_url: str,
    fips_filter: list[str] | None = None,
    years: list[int] | None = None,
) -> list[tuple]:
    """Parse NST-EST bulk CSV into (state, year, population, source_url) tuples.

    Args:
        text: CSV content.
        source_url: URL to embed in each row.
        fips_filter: If set, only include these FIPS codes (e.g. ['06', '09']).
        years: Which POPESTIMATE years to include. Defaults to [2022, 2023, 2024].

    Returns list of (state_abbrev, year_str, population_str, source_url).
    """
    if years is None:
        years = [2022, 2023, 2024]

    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        if r.get("SUMLEV") != "040":
            # Skip US totals, regions, divisions
            continue
        fips = r.get("STATE", "")
        if fips_filter and fips not in fips_filter:
            continue
        abbrev = FIPS_TO_ABBREV.get(fips)
        if not abbrev:
            continue
        for yr in years:
            col = f"POPESTIMATE{yr}"
            pop_val = r.get(col, "")
            if not pop_val:
                continue
            rows.append((abbrev, str(yr), str(pop_val), source_url))
    return rows


def write_population_parquet(rows: list[tuple], out_path: Path) -> Path:
    """Write population rows to parquet.

    Schema (all varchar): state, year, population, source_url.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(
            "create table _pop (state varchar, year varchar, population varchar,"
            " source_url varchar)"
        )
        con.executemany("insert into _pop values (?,?,?,?)", rows)
        con.execute(f"copy _pop to '{out_path}' (format parquet, compression zstd)")
    finally:
        con.close()
    return out_path


def acquire_population(
    client: httpx.Client,
    *,
    parquet_dir: Path,
    fips_filter: list[str] | None = None,
    years: list[int] | None = None,
) -> tuple[Path, int]:
    """Download Census PEP bulk CSV and write population parquet.

    Returns (parquet_path, row_count).
    fips_filter defaults to all 50 states + DC.
    """
    r = client.get(POPULATION_CSV_URL, follow_redirects=True)
    r.raise_for_status()
    rows = parse_population_csv(r.text, POPULATION_CSV_URL, fips_filter=fips_filter, years=years)
    out_path = parquet_dir / "states" / "state_population.parquet"
    write_population_parquet(rows, out_path)
    print(f"population: {len(rows)} rows -> {out_path}")
    return out_path, len(rows)
