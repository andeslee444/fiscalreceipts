import datetime as dt
from pathlib import Path

import httpx

from govbudget.config import DOD_TOPTIER_CODE
from govbudget.convert import convert_zip_to_parquet
from govbudget.download import download_file, ensure_free_space
from govbudget.manifest import ManifestRecord, append_record, has_file
from govbudget.usaspending.archive import list_full_files, resolve_agency_id


def sync_archive(
    client: httpx.Client,
    *,
    type_: str,
    fiscal_year: int,
    parquet_dir: Path,
    raw_dir: Path,
    manifest_path: Path,
    required_columns: set[str],
    min_free_gb: float,
    toptier_code: str = DOD_TOPTIER_CODE,
) -> str:
    """Returns 'loaded' or 'skipped'."""
    agency_id = resolve_agency_id(client, toptier_code)
    info = list_full_files(client, agency_id=agency_id, fiscal_year=fiscal_year, type_=type_)
    if has_file(manifest_path, info["file_name"]):
        return "skipped"
    ensure_free_space(raw_dir, min_free_gb)
    zip_path = raw_dir / info["file_name"]
    sha, n = download_file(client, info["url"], zip_path)
    convert_zip_to_parquet(
        zip_path, dataset=type_, fiscal_year=fiscal_year,
        parquet_dir=parquet_dir, raw_dir=raw_dir,
        required_columns=required_columns,
    )
    append_record(manifest_path, ManifestRecord(
        dataset=type_, fiscal_year=fiscal_year,
        file_name=info["file_name"], source_url=info["url"],
        sha256=sha, bytes=n,
        downloaded_at=dt.datetime.now(dt.UTC).isoformat(),
    ))
    return "loaded"
