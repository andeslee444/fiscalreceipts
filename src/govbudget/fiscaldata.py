import datetime as dt
import hashlib
import json
from pathlib import Path

import duckdb
import httpx

from govbudget.convert import _sql_path
from govbudget.manifest import ManifestRecord, append_record


def fetch_all_pages(client: httpx.Client, path: str, params: dict) -> list[dict]:
    rows: list[dict] = []
    page = 1
    while True:
        r = client.get(path, params={**params, "page[number]": str(page), "page[size]": "10000"})
        r.raise_for_status()
        body = r.json()
        rows.extend(body["data"])
        total_pages = body.get("meta", {}).get("total-pages")
        if total_pages is None:
            raise ValueError(
                f"Unexpected FiscalData response — no meta.total-pages: {body!r}"
            )
        if page >= int(total_pages):
            return rows
        page += 1


def sync_mts_outlays(
    client: httpx.Client, *, parquet_dir: Path, raw_dir: Path,
    manifest_path: Path, fy_start: int,
) -> Path:
    path = "/v1/accounting/mts/mts_table_5"
    rows = fetch_all_pages(client, path, {"filter": f"record_fiscal_year:gte:{fy_start}"})
    raw_dir.mkdir(parents=True, exist_ok=True)
    jsonl = raw_dir / "mts_table_5.jsonl"
    with open(jsonl, "w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
    out_dir = parquet_dir / "mts_outlays"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "mts_table_5.parquet"
    con = duckdb.connect()
    try:
        con.execute(
            f"""
            copy (select * from read_json_auto('{_sql_path(jsonl)}', format='newline_delimited'))
            to '{_sql_path(out_path)}' (format parquet, compression zstd)
            """
        )
    finally:
        con.close()
    jsonl.unlink()
    append_record(manifest_path, ManifestRecord(
        dataset="mts_outlays", fiscal_year=None,
        file_name=out_path.name,
        source_url=str(client.base_url).rstrip("/") + path,
        sha256=hashlib.sha256(out_path.read_bytes()).hexdigest(),
        bytes=out_path.stat().st_size,
        downloaded_at=dt.datetime.now(dt.UTC).isoformat(),
    ))
    return out_path
