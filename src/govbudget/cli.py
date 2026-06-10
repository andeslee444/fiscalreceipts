import argparse
import subprocess
import sys
from pathlib import Path

import httpx

from govbudget import config


def _usaspending_client() -> httpx.Client:
    return httpx.Client(base_url=config.USASPENDING_API, timeout=60)


def sync_archive_cmd(client, type_, fy) -> str:
    from govbudget.usaspending.archive_sync import sync_archive

    return sync_archive(
        client, type_=type_, fiscal_year=fy,
        parquet_dir=config.PARQUET_DIR, raw_dir=config.RAW_DIR,
        manifest_path=config.MANIFEST_PATH,
        required_columns=config.REQUIRED_COLUMNS[type_],
        min_free_gb=config.MIN_FREE_GB,
    )


def cmd_sync_archive(args) -> None:
    from govbudget.convert import sweep_incoming_dirs
    from govbudget.download import sweep_stale_parts

    swept = sweep_stale_parts(config.RAW_DIR)
    if swept:
        print(f"swept {swept} stale .part file(s)")
    sweep_incoming_dirs(config.PARQUET_DIR)
    types = ["contracts", "assistance"] if args.type == "both" else [args.type]
    with _usaspending_client() as client:
        for fy in range(args.fy_start, args.fy_end + 1):
            for type_ in types:
                result = sync_archive_cmd(client, type_, fy)
                print(f"{type_} fy{fy}: {result}")


def cmd_sync_subawards(args) -> None:
    import datetime as dt

    from govbudget.convert import convert_zip_to_parquet, sweep_incoming_dirs
    from govbudget.download import download_file, ensure_free_space, sweep_stale_parts
    from govbudget.manifest import ManifestRecord, append_record, has_dataset_fy, has_file
    from govbudget.usaspending.subawards import poll_until_ready, request_subaward_download

    sweep_stale_parts(config.RAW_DIR)
    sweep_incoming_dirs(config.PARQUET_DIR)
    if has_dataset_fy(config.MANIFEST_PATH, "subawards", args.fy):
        print(f"subawards fy{args.fy}: skipped")
        return
    with _usaspending_client() as client:
        resp = request_subaward_download(client, fiscal_year=args.fy)
        file_name = resp["file_name"]
        if has_file(config.MANIFEST_PATH, file_name):
            print(f"subawards fy{args.fy}: skipped")
            return
        url = poll_until_ready(client, file_name)
        ensure_free_space(config.RAW_DIR, config.MIN_FREE_GB)
        zip_path = config.RAW_DIR / file_name
        sha, n = download_file(client, url, zip_path)
        convert_zip_to_parquet(
            zip_path, dataset="subawards", fiscal_year=args.fy,
            parquet_dir=config.PARQUET_DIR, raw_dir=config.RAW_DIR,
            required_columns=config.REQUIRED_COLUMNS["subawards"],
        )
        append_record(config.MANIFEST_PATH, ManifestRecord(
            dataset="subawards", fiscal_year=args.fy,
            file_name=file_name, source_url=url, sha256=sha, bytes=n,
            downloaded_at=dt.datetime.now(dt.UTC).isoformat(),
        ))
        print(f"subawards fy{args.fy}: loaded")


def cmd_sync_fiscaldata(args) -> None:
    from govbudget.fiscaldata import sync_mts_outlays

    with httpx.Client(base_url=config.FISCALDATA_API, timeout=60) as client:
        out = sync_mts_outlays(
            client, parquet_dir=config.PARQUET_DIR, raw_dir=config.RAW_DIR,
            manifest_path=config.MANIFEST_PATH, fy_start=config.FY_START,
        )
    print(f"fiscaldata: loaded {out}")


def cmd_build(args) -> None:
    import os

    env = {
        **os.environ,
        "GOVBUDGET_DATA": os.environ.get("GOVBUDGET_DATA", str(config.DATA_DIR)),
        "GOVBUDGET_DUCKDB": os.environ.get("GOVBUDGET_DUCKDB", str(config.DUCKDB_PATH)),
    }
    Path(env["GOVBUDGET_DUCKDB"]).parent.mkdir(parents=True, exist_ok=True)
    rc = subprocess.run(
        ["dbt", "build", "--project-dir", "dbt", "--profiles-dir", "dbt"],
        env=env,
    ).returncode
    sys.exit(rc)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="govbudget")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("sync-archive", help="DoD award archive zips -> parquet")
    a.add_argument("--type", choices=["contracts", "assistance", "both"], default="both")
    a.add_argument("--fy-start", type=int, default=config.FY_START)
    a.add_argument("--fy-end", type=int, default=config.FY_END)
    a.set_defaults(func=cmd_sync_archive)

    s = sub.add_parser("sync-subawards", help="DoD subawards (custom download) -> parquet")
    s.add_argument("--fy", type=int, required=True)
    s.set_defaults(func=cmd_sync_subawards)

    f = sub.add_parser("sync-fiscaldata", help="Treasury MTS outlays -> parquet")
    f.set_defaults(func=cmd_sync_fiscaldata)

    b = sub.add_parser("build", help="dbt build star schema")
    b.set_defaults(func=cmd_build)

    args = p.parse_args(argv)
    args.func(args)
