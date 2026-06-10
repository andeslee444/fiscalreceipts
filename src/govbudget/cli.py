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
    failures = []
    with _usaspending_client() as client:
        for fy in range(args.fy_start, args.fy_end + 1):
            for type_ in types:
                try:
                    result = sync_archive_cmd(client, type_, fy)
                except Exception as e:
                    failures.append((type_, fy))
                    print(f"{type_} fy{fy}: FAILED ({type(e).__name__}: {e})")
                    continue
                print(f"{type_} fy{fy}: {result}")
    if failures:
        failed = ", ".join(f"{t} fy{fy}" for t, fy in failures)
        print(f"sync-archive finished with {len(failures)} failure(s): {failed}")
        sys.exit(1)


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


def cmd_migrate(args) -> None:
    from govbudget.jbooks.db import migrate

    applied = migrate()
    print(f"migrations applied: {applied or 'none (up to date)'}")


JBOOK_INDEX_URLS = [
    "https://comptroller.war.gov/Budget-Materials/Budget2026/",
    "https://comptroller.war.gov/Budget-Materials/FY2026BudgetJustification/",
]


def cmd_jbooks(args) -> None:
    import psycopg

    from govbudget.jbooks import acquire, load_details, reconcile, registry, rollup_loader
    from govbudget.jbooks.db import migrate

    migrate()
    if args.action == "scrape":
        docs = []
        with httpx.Client(timeout=60) as client:
            for index_url in JBOOK_INDEX_URLS:
                docs.extend(registry.discover_documents(client, index_url, fiscal_year=config.JBOOK_FY))
        n = registry.upsert_documents(config.PG_DSN, docs)
        print(f"jbooks scrape: {len(docs)} discovered, {n} new")
    elif args.action == "acquire":
        with httpx.Client(timeout=120) as client:
            n, failures = acquire.acquire_pending(
                config.PG_DSN, client,
                raw_docs_dir=config.RAW_DOCS_DIR, min_free_gb=config.MIN_FREE_GB,
            )
        print(f"jbooks acquire: {n} downloaded")
        for doc_id, title, err in failures:
            print(f"  FAILED #{doc_id} {title}: {err}")
        if failures:
            sys.exit(1)
    elif args.action == "load-rollups":
        with psycopg.connect(config.PG_DSN) as con:
            rows = con.execute(
                "select id, title, file_path, fiscal_year from jbook_documents "
                "where exhibit_family='rollup' and status='downloaded'"
            ).fetchall()
        failures = []
        for doc_id, title, file_path, fy in rows:
            exhibit = "R-1" if title.startswith("r1") else "P-1"
            try:
                n = rollup_loader.load_rollup(
                    config.PG_DSN, Path(file_path), exhibit=exhibit, fiscal_year=fy,
                    source_document_id=doc_id,
                )
            except Exception as e:
                failures.append(title)
                print(f"{title}: FAILED ({type(e).__name__}: {e})")
                continue
            print(f"{title}: {n} budget_lines")
        if failures:
            print(f"load-rollups finished with {len(failures)} failure(s): {', '.join(failures)}")
            sys.exit(1)
    elif args.action == "extract":
        with psycopg.connect(config.PG_DSN) as con:
            rows = con.execute(
                "select id, file_path, exhibit_family from jbook_documents "
                "where has_embedded_xml and status='downloaded'"
                + (" and org = %s" if args.org else ""),
                ((args.org,) if args.org else ()),
            ).fetchall()
        from govbudget.jbooks.attachments import pick_book_xml
        from govbudget.jbooks.gaps import record_extraction_gaps

        failures = []
        for doc_id, file_path, family in rows:
            book_xml = pick_book_xml(Path(file_path).parent / "xml")
            if book_xml is None:
                print(f"doc {doc_id}: no xml on disk, skipping")
                continue
            try:
                if family == "procurement":
                    run_id = load_details.load_procurement_details(
                        config.PG_DSN, document_id=doc_id, xml_path=book_xml
                    )
                else:
                    run_id = load_details.load_document_details(
                        config.PG_DSN, document_id=doc_id, xml_path=book_xml
                    )
                result = reconcile.reconcile_document(
                    config.PG_DSN, document_id=doc_id, extraction_run_id=run_id
                )
                gaps = record_extraction_gaps(config.PG_DSN, document_id=doc_id)
            except Exception as e:
                failures.append((doc_id, f"{type(e).__name__}: {e}"))
                print(f"doc {doc_id}: FAILED ({type(e).__name__}: {e})")
                continue
            print(f"doc {doc_id}: run {run_id} reconcile {result} gaps {gaps}")
        if failures:
            print(f"extract finished with {len(failures)} failure(s)")
            sys.exit(1)


def cmd_review(args) -> None:
    import psycopg

    with psycopg.connect(config.PG_DSN) as con:
        if args.review_action == "list":
            rows = con.execute(
                "select rq.id, c.gate, c.pe_bli, c.scenario, c.expected, c.actual, c.detail"
                " from review_queue rq join reconciliation_checks c on c.id=rq.check_id"
                " where rq.status='open' order by rq.id"
            ).fetchall()
            for r in rows:
                print(f"#{r[0]} gate {r[1]} {r[2]}/{r[3]} expected={r[4]} actual={r[5]} :: {r[6]}")
            print(f"{len(rows)} open item(s)")
        elif args.review_action == "accept":
            con.execute(
                "update review_queue set status='accepted', resolution=%s, resolved_at=now()"
                " where id=%s",
                (args.reason, args.id),
            )
            print(f"#{args.id} accepted: {args.reason}")


def cmd_verify_phase1(args) -> None:
    from govbudget.jbooks.verify import accuracy_gate, coverage_gate, provenance_gate

    orgs = args.orgs.split(",") if args.orgs else ["DARPA"]
    cov = coverage_gate(config.PG_DSN, organizations=orgs)
    acc = accuracy_gate(config.PG_DSN)
    prov = provenance_gate(config.PG_DSN)
    print(f"gate 1 coverage: {cov['covered']}/{cov['r1_lines']} ({cov['pct']}%)"
          + (f" missing: {cov['missing']}" if cov["missing"] else ""))
    print(f"gate 2 accuracy: silent_unreconciled={acc['silent_unreconciled']}"
          f" open_review={acc['open_review_items']}")
    print(f"gate 3 provenance: {prov['resolved']}/{prov['sampled']} resolved")
    ok = cov["pct"] >= 99.0 and acc["silent_unreconciled"] == 0 and (
        prov["sampled"] == 0 or prov["resolved"] == prov["sampled"]
    )
    print("verify-phase1:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


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

    m = sub.add_parser("migrate", help="apply postgres migrations")
    m.set_defaults(func=cmd_migrate)

    j = sub.add_parser("jbooks", help="phase 1 j-book pipeline")
    j.add_argument("action", choices=["scrape", "acquire", "load-rollups", "extract"])
    j.add_argument("--org", default=None)
    j.set_defaults(func=cmd_jbooks)

    rv = sub.add_parser("review", help="reconciliation review queue")
    rv.add_argument("review_action", choices=["list", "accept"])
    rv.add_argument("--id", type=int)
    rv.add_argument("--reason", default="")
    rv.set_defaults(func=cmd_review)

    v = sub.add_parser("verify-phase1", help="run phase 1 acceptance gates 1-3")
    v.add_argument("--orgs", default="DARPA")
    v.set_defaults(func=cmd_verify_phase1)

    args = p.parse_args(argv)
    args.func(args)
