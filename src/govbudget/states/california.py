"""California state budget/checkbook ingestion.

Sources
-------
CA checkbook (Open Fi$Cal):
  Azure Blob CSV files per department.
  Pointer manifest: DepartmentSpendingTransactionPointer.csv
  Individual files: DepartmentSpendingTransactionFiles/<name>.csv
  Columns: business_unit, agency_name, department_name, fiscal_year_begin,
           account_category_1, monetary_amount, fund_description_1, ...
  No API key required.

CA ACFR PDF (sco.ca.gov):
  https://www.sco.ca.gov/Files-ARD/ACFR/acfr23web.pdf (FY 2022-23)
  Downloaded with sha provenance via download_file → manifest.

Recon notes (June 2026):
  - open.fiscal.ca.gov is NOT Socrata; it serves per-department Azure Blob CSVs.
  - ebudget.ca.gov is a JS SPA with no machine-readable CSV export.
  - Open Fi$Cal CSV IS the authoritative CA expenditure record; used for both
    "budget" and "checkbook" aggregates (same source, same contract shape).
  - Pointer CSV lists ~1420 files; FY25 has 178 files.
  - Aggregate small FY25 department files (< 5 MB) to keep download manageable.
"""
from __future__ import annotations

import csv
import io
import re
from pathlib import Path

import duckdb
import httpx

POINTER_URL = (
    "https://adwoutputfilesadlsstore.blob.core.windows.net/transparency"
    "/DepartmentSpendingTransactionPointer/DepartmentSpendingTransactionPointer.csv"
)
FILE_BASE_URL = (
    "https://adwoutputfilesadlsstore.blob.core.windows.net/transparency"
    "/DepartmentSpendingTransactionFiles/"
)

ACFR_URL = "https://www.sco.ca.gov/Files-ARD/ACFR/acfr23web.pdf"
ACFR_FILE_NAME = "ca_acfr_fy2023.pdf"
ACFR_FISCAL_YEAR = 2023

# Columns in the raw CSV files
FISCAL_YEAR_COL = "fiscal_year_begin"
DEPT_COL = "department_name"
AGENCY_COL = "agency_name"
CATEGORY_COL = "account_category_1"
AMOUNT_COL = "monetary_amount"
FUND_COL = "fund_description_1"


def _parse_file_size_mb(size_str: str) -> float:
    """Parse '2 MB' -> 2.0 or '500 KB' -> 0.5. Returns large value for unknowns."""
    s = size_str.strip()
    if s.endswith("KB"):
        try:
            return float(s[:-2].strip()) / 1024
        except ValueError:
            return 999.0
    if s.endswith("MB"):
        try:
            return float(s[:-2].strip())
        except ValueError:
            return 999.0
    return 999.0


def list_department_files(
    client: httpx.Client,
    *,
    fiscal_year: str = "FY25",
    max_mb: float = 5.0,
) -> list[dict]:
    """Fetch pointer CSV and return file entries for the given fiscal year.

    Each entry: {"file_name": str, "url": str, "size_mb": float}
    Filtered to files <= max_mb for efficient aggregate (avoids loading 100MB files).
    """
    r = client.get(POINTER_URL, follow_redirects=True)
    r.raise_for_status()
    reader = csv.DictReader(io.StringIO(r.text))
    entries = []
    for row in reader:
        fn = row.get("FileName", "").strip().strip('"')
        url = row.get("Download", "").strip().strip('"')
        size_str = row.get("FileSize", "999 MB")
        if f"_{fiscal_year}.csv" not in fn:
            continue
        size_mb = _parse_file_size_mb(size_str)
        if size_mb <= max_mb:
            entries.append({"file_name": fn, "url": url, "size_mb": size_mb})
    return entries


def parse_spending_csv(text: str, source_url: str) -> list[tuple]:
    """Parse one Open Fi$Cal spending CSV into row tuples.

    Returns list of (department, agency, category, fund, fiscal_year, amount_usd, source_url).
    Aggregated at row level — caller aggregates further via DuckDB.
    """
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        try:
            amount = float(r.get(AMOUNT_COL, "") or "0")
        except ValueError:
            amount = 0.0
        rows.append((
            r.get(DEPT_COL, ""),
            r.get(AGENCY_COL, ""),
            r.get(CATEGORY_COL, ""),
            r.get(FUND_COL, ""),
            r.get(FISCAL_YEAR_COL, ""),
            amount,
            source_url,
        ))
    return rows


def aggregate_checkbook(
    rows: list[tuple],
    source_url: str,
) -> list[tuple]:
    """Aggregate raw rows into (jurisdiction, department, category, fiscal_year, amount_usd, source_url).

    Wraps DuckDB in-memory aggregation.
    """
    con = duckdb.connect()
    try:
        con.execute(
            "create table _raw (department varchar, agency varchar, category varchar,"
            " fund varchar, fiscal_year varchar, amount double, url varchar)"
        )
        con.executemany("insert into _raw values (?,?,?,?,?,?,?)", rows)
        result = con.execute(
            "select 'CA' as jurisdiction, department, category, fiscal_year,"
            " sum(amount) as amount_usd, ? as source_url"
            " from _raw"
            " group by department, category, fiscal_year",
            (source_url,),
        ).fetchall()
    finally:
        con.close()
    return result


def write_ca_checkbook_parquet(
    rows: list[tuple],
    out_path: Path,
    source_url: str,
) -> Path:
    """Write aggregated CA checkbook to parquet.

    Schema (all varchar): jurisdiction, department, category, fiscal_year,
    amount_usd, source_url.
    """
    agg = aggregate_checkbook(rows, source_url)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(
            "create table _ck (jurisdiction varchar, department varchar, category varchar,"
            " fiscal_year varchar, amount_usd varchar, source_url varchar)"
        )
        # Convert amount to string (all-varchar contract)
        str_rows = [
            (str(j), str(d), str(c), str(fy), str(round(amt, 2)), str(su))
            for j, d, c, fy, amt, su in agg
        ]
        con.executemany("insert into _ck values (?,?,?,?,?,?)", str_rows)
        con.execute(f"copy _ck to '{out_path}' (format parquet, compression zstd)")
    finally:
        con.close()
    return out_path


def write_ca_budget_parquet(
    rows: list[tuple],
    out_path: Path,
    source_url: str,
) -> Path:
    """Write CA budget (department-level aggregate) to parquet.

    The CA "budget" artifact is the Open Fi$Cal expenditure aggregate —
    the same source as the checkbook. Budget lines are aggregated by
    (department, agency, category, fund, fiscal_year). Includes an
    is_total=False flag on all rows (no separate published control-total
    rows available in this source; the aggregate itself is the total).

    Schema (all varchar): department, agency, category, fund, fiscal_year,
    amount_usd, is_total, source_url.
    """
    con = duckdb.connect()
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        con.execute(
            "create table _raw (department varchar, agency varchar, category varchar,"
            " fund varchar, fiscal_year varchar, amount double, url varchar)"
        )
        con.executemany("insert into _raw values (?,?,?,?,?,?,?)", rows)
        agg = con.execute(
            "select department, agency, category, fund, fiscal_year, sum(amount) as amount_usd"
            " from _raw group by department, agency, category, fund, fiscal_year"
        ).fetchall()
        str_rows = [
            (str(d), str(a), str(c), str(f), str(fy), str(round(amt, 2)), "False", source_url)
            for d, a, c, f, fy, amt in agg
        ]
        con.execute(
            "create table _bud (department varchar, agency varchar, category varchar,"
            " fund varchar, fiscal_year varchar, amount_usd varchar, is_total varchar,"
            " source_url varchar)"
        )
        con.executemany("insert into _bud values (?,?,?,?,?,?,?,?)", str_rows)
        con.execute(f"copy _bud to '{out_path}' (format parquet, compression zstd)")
    finally:
        con.close()
    return out_path


def acquire_ca_checkbook(
    client: httpx.Client,
    *,
    parquet_dir: Path,
    fiscal_year: str = "FY25",
    max_mb: float = 5.0,
    max_files: int | None = None,
) -> tuple[Path, Path, int]:
    """Download and aggregate CA Open Fi$Cal spending data.

    Returns (budget_parquet, checkbook_parquet, total_raw_rows).
    Downloads only department files <= max_mb in size.
    """
    entries = list_department_files(client, fiscal_year=fiscal_year, max_mb=max_mb)
    if max_files is not None:
        entries = entries[:max_files]

    POINTER_SOURCE = (
        "https://open.fiscal.ca.gov/dept_spending_transaction.html"
        " (pointer: DepartmentSpendingTransactionPointer.csv)"
    )

    all_rows: list[tuple] = []
    print(f"ca_checkbook: fetching {len(entries)} department files (FY {fiscal_year})")
    for i, entry in enumerate(entries, 1):
        try:
            r = client.get(entry["url"], follow_redirects=True)
            r.raise_for_status()
            file_rows = parse_spending_csv(r.text, entry["url"])
            all_rows.extend(file_rows)
            if i % 10 == 0:
                print(f"  ... {i}/{len(entries)} files, {len(all_rows)} rows so far")
        except Exception as exc:
            print(f"  WARNING: {entry['file_name']} -> {type(exc).__name__}: {exc}")

    print(f"ca_checkbook: {len(all_rows)} raw rows from {len(entries)} files")

    budget_path = parquet_dir / "states" / "ca_budget.parquet"
    checkbook_path = parquet_dir / "states" / "ca_checkbook_agg.parquet"

    write_ca_budget_parquet(all_rows, budget_path, POINTER_SOURCE)
    write_ca_checkbook_parquet(all_rows, checkbook_path, POINTER_SOURCE)

    return budget_path, checkbook_path, len(all_rows)


def acquire_ca_acfr(
    client: httpx.Client,
    *,
    raw_docs_dir: Path,
    manifest_path: Path,
) -> tuple[str, int]:
    """Download CA ACFR PDF and record in manifest.

    Returns (sha256, byte_count).
    Skips if already in manifest.
    """
    import datetime as dt

    from govbudget.download import download_file
    from govbudget.manifest import ManifestRecord, append_record, has_file

    dest = raw_docs_dir / "state" / "ca" / ACFR_FILE_NAME
    if has_file(manifest_path, ACFR_FILE_NAME):
        print(f"ca_acfr: {ACFR_FILE_NAME} already in manifest, skipping")
        # Return sha from manifest if file exists
        from govbudget.manifest import load_records
        for rec in load_records(manifest_path):
            if rec.file_name == ACFR_FILE_NAME:
                return rec.sha256, rec.bytes
        return "", 0

    sha, n = download_file(client, ACFR_URL, dest)
    append_record(manifest_path, ManifestRecord(
        dataset="state_acfr_ca",
        fiscal_year=ACFR_FISCAL_YEAR,
        file_name=ACFR_FILE_NAME,
        source_url=ACFR_URL,
        sha256=sha,
        bytes=n,
        downloaded_at=dt.datetime.now(dt.UTC).isoformat(),
    ))
    print(f"ca_acfr: downloaded {ACFR_FILE_NAME} ({n:,} bytes) sha={sha[:16]}...")
    return sha, n
