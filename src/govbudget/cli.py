import argparse
import subprocess
import sys

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
    from govbudget.download import sweep_stale_parts

    swept = sweep_stale_parts(config.RAW_DIR)
    if swept:
        print(f"swept {swept} stale .part file(s)")
    types = ["contracts", "assistance"] if args.type == "both" else [args.type]
    with _usaspending_client() as client:
        for fy in range(args.fy_start, args.fy_end + 1):
            for type_ in types:
                result = sync_archive_cmd(client, type_, fy)
                print(f"{type_} fy{fy}: {result}")


def cmd_build(args) -> None:
    rc = subprocess.run(
        ["dbt", "build", "--project-dir", "dbt", "--profiles-dir", "dbt"]
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

    b = sub.add_parser("build", help="dbt build star schema")
    b.set_defaults(func=cmd_build)

    args = p.parse_args(argv)
    args.func(args)
