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
            try:
                if title.startswith("r1"):
                    n = rollup_loader.load_rollup(
                        config.PG_DSN, Path(file_path), exhibit="R-1", fiscal_year=fy,
                        source_document_id=doc_id,
                    )
                else:
                    from govbudget.jbooks.p1_loader import load_p1_rollup

                    exhibit = "P-1R" if title.startswith("p1r") else "P-1"
                    n = load_p1_rollup(
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
            book_xml = pick_book_xml(Path(file_path).parent / "xml", family=family)
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
    elif args.action == "export-facts":
        from govbudget.jbooks.export_facts import export_facts

        out = export_facts(config.PG_DSN, parquet_dir=config.PARQUET_DIR)
        print("exported:", ", ".join(p.name for p in out))
    elif args.action == "crosswalk":
        from govbudget.jbooks.crosswalk import crosswalk_org
        from govbudget.jbooks.orgs import workbook_org

        import psycopg

        if args.org:
            orgs = [workbook_org(args.org)]
        else:
            with psycopg.connect(config.PG_DSN) as con:
                orgs = sorted({
                    r[0] for r in con.execute(
                        "select distinct organization from budget_lines"
                        " where organization is not null and organization <> ''"
                    )
                })
        fy_start = getattr(args, "fy_start", None)
        fy_end = getattr(args, "fy_end", None)
        total = 0
        for org in orgs:
            n = crosswalk_org(
                config.PG_DSN, organization=org, treasury_agency="097",
                award_glob=str(config.PARQUET_DIR / "contracts" / "*" / "*.parquet"),
                fy_start=fy_start,
                fy_end=fy_end,
            )
            print(f"crosswalk {org}: {n} links")
            total += n
        print(f"crosswalk total: {total}")


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
            if args.id is None:
                print("review accept requires --id")
                sys.exit(2)
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
    if args.trace:
        import psycopg

        from govbudget.jbooks.trace import trace_gate

        with psycopg.connect(config.PG_DSN) as con:
            sample = [r[0] for r in con.execute(
                """
                select pe_bli from budget_lines
                where organization='DARPA' and exhibit='R-1'
                  and amount_type='fy_2024_actuals'
                order by amount_thousands desc nulls last limit 5
                """
            )]
        t = trace_gate(
            config.PG_DSN, pe_blis=sample,
            award_glob=str(config.PARQUET_DIR / "contracts" / "*" / "*.parquet"),
        )
        print(f"gate 6 trace: {t['traced']}/{len(sample)} traced"
              + (f" failed: {t['failed']}" if t["failed"] else ""))
        if t.get("notes"):
            for note in t["notes"]:
                print(f"  note: {note}")
        ok = ok and t["traced"] == len(sample)
    print("verify-phase1:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


def cmd_entity_graph(args) -> None:
    from govbudget.entity_graph import build_entity_xwalk

    out = build_entity_xwalk(
        award_glob=str(config.PARQUET_DIR / "contracts" / "*" / "*.parquet"),
        out_path=config.PARQUET_DIR / "entities" / "entity_xwalk.parquet",
    )
    print(f"entity-graph: wrote {out}")


def cmd_verify_phase2(args) -> None:
    from govbudget.verify_phase2 import entity_gate, geography_gate, golden_gate

    e = entity_gate(config.DUCKDB_PATH)
    g = golden_gate(config.DUCKDB_PATH)
    geo = geography_gate(config.DUCKDB_PATH)
    print(f"gate e1 entities: {e['resolved']}/{e['top_n']} resolved ({e['resolved_pct']}%)")
    print(f"gate e2 goldens: boeing {g['boeing_ueis']} UEIs one_family={g['boeing_one_family']}"
          f" hii one_family={g['hii_one_family']}")
    print(f"gate e3 geography: {geo['with_district']}/{geo['with_state']}"
          f" ({geo['resolved_pct']}%) state-rows with districts")
    ok = (e["resolved_pct"] >= 95.0 and g["boeing_one_family"] and g["hii_one_family"]
          and geo["resolved_pct"] >= 99.0)
    print("verify-phase2:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


def cmd_oversight(args) -> None:
    from govbudget import config

    if args.action == "scrape-pa":
        from govbudget.oversight.payment_accuracy import scrape_payment_accuracy

        out_path = config.PARQUET_DIR / "oversight" / "improper_payments.parquet"
        with httpx.Client(
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36"
                )
            },
            timeout=60,
        ) as client:
            out = scrape_payment_accuracy(client, out_path=out_path)
        print(f"oversight scrape-pa: wrote {out}")
    elif args.action == "high-risk":
        from govbudget.oversight.high_risk import build_high_risk

        out_path = config.PARQUET_DIR / "oversight" / "high_risk.parquet"
        agency_map_csv = (
            config.ROOT / "data-seeds" / "gao_high_risk_agency_map.csv"
        )
        with httpx.Client(
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36"
                )
            },
            timeout=60,
        ) as client:
            out = build_high_risk(
                client, agency_map_csv=agency_map_csv, out_path=out_path
            )
        print(f"oversight high-risk: wrote {out}")


def cmd_verify_phase3(args) -> None:
    from govbudget.verify_phase3 import (
        ingest_gate,
        linkage_gate,
        marts_gate,
        trace_gate3,
    )

    ip_path = config.PARQUET_DIR / "oversight" / "improper_payments.parquet"
    hr_path = config.PARQUET_DIR / "oversight" / "high_risk.parquet"

    gates_ok = True

    # Gate 1: ingest
    ig = ingest_gate(ip_path, hr_path)
    status = "PASS" if ig["ok"] else "FAIL"
    print(
        f"gate 1 ingest: programs={ig['program_count']} areas={ig['area_count']}"
        f" ip_urls={ig['ip_rows_with_url']}/{ig['ip_total_rows']}"
        f" hr_urls={ig['hr_rows_with_url']}/{ig['area_count']} → {status}"
    )
    gates_ok = gates_ok and ig["ok"]

    # Gate 2: linkage
    lg = linkage_gate(hr_path)
    status = "PASS" if lg["ok"] else "FAIL"
    print(
        f"gate 2 linkage: mapped={lg['mapped']}/{lg['total_areas']}"
        f" ({lg['mapped_pct']}%) unmapped={lg['unmapped_count']} → {status}"
    )
    gates_ok = gates_ok and lg["ok"]

    # Gate 3: marts
    mg = marts_gate(config.DUCKDB_PATH)
    status = "PASS" if mg["ok"] else "FAIL"
    print(
        f"gate 3 marts: trajectory={mg['trajectory_rows']} concentration={mg['concentration_rows']}"
        f" agency={mg['agency_rows']} exposure={mg['exposure_rows']}"
        f" bad_hhi_prog={mg['bad_hhi_program']} bad_hhi_agency={mg['bad_hhi_agency']} → {status}"
    )
    gates_ok = gates_ok and mg["ok"]

    # Gate 4: trace
    tg = trace_gate3(config.DUCKDB_PATH, hr_path)
    status = "PASS" if tg["ok"] else "FAIL"
    print(
        f"gate 4 trace: dod_areas={tg.get('dod_areas_checked', 0)}"
        f" traced={tg.get('dod_areas_traced', 0)}"
        f" dim_programs={tg.get('dim_programs_count', 0)}"
        f" top_family={tg.get('sample_top_family')} → {status}"
    )
    if "reason" in tg:
        print(f"  reason: {tg['reason']}")
    gates_ok = gates_ok and tg["ok"]

    print("verify-phase3:", "PASS" if gates_ok else "FAIL")
    sys.exit(0 if gates_ok else 1)


def cmd_states(args) -> None:
    from govbudget import config

    action = args.action
    if action == "acquire-ca":
        from govbudget.states.california import acquire_ca_acfr, acquire_ca_checkbook

        with httpx.Client(timeout=300) as client:
            budget_path, ck_path, raw_rows = acquire_ca_checkbook(
                client,
                parquet_dir=config.PARQUET_DIR,
                fiscal_year=getattr(args, "fy", "FY25"),
                max_mb=getattr(args, "max_mb", 5.0),
            )
        print(f"states acquire-ca: budget -> {budget_path}")
        print(f"states acquire-ca: checkbook -> {ck_path} ({raw_rows:,} raw rows)")
        with httpx.Client(timeout=300) as client:
            sha, n = acquire_ca_acfr(
                client,
                raw_docs_dir=config.RAW_DOCS_DIR,
                manifest_path=config.MANIFEST_PATH,
            )
        print(f"states acquire-ca: ACFR sha={sha[:16]}... ({n:,} bytes)")
    elif action == "acquire-ct":
        from govbudget.states.connecticut import acquire_ct_checkbook

        with httpx.Client(timeout=120) as client:
            out_path, count = acquire_ct_checkbook(
                client,
                parquet_dir=config.PARQUET_DIR,
            )
        print(f"states acquire-ct: {count} rows -> {out_path}")
    elif action == "population":
        from govbudget.states.population import acquire_population

        with httpx.Client(timeout=120) as client:
            out_path, count = acquire_population(
                client,
                parquet_dir=config.PARQUET_DIR,
            )
        print(f"states population: {count} rows -> {out_path}")
    else:
        print(f"unknown states action: {action}", file=sys.stderr)
        sys.exit(2)


def cmd_verify_phase4(args) -> None:
    from govbudget.verify_phase4 import (
        comparable_gate4,
        provenance_gate4,
        reconcile_gate4,
    )

    states_dir = config.PARQUET_DIR / "states"
    ca_budget_path = states_dir / "ca_budget.parquet"
    ca_checkbook_path = states_dir / "ca_checkbook_agg.parquet"
    ct_checkbook_path = states_dir / "ct_checkbook_agg.parquet"
    population_path = states_dir / "state_population.parquet"

    gates_ok = True

    # Gate 1: provenance
    pg = provenance_gate4(
        ca_budget_path, ca_checkbook_path, ct_checkbook_path, population_path,
        config.MANIFEST_PATH, config.RAW_DOCS_DIR,
    )
    g1_ok = pg["ok"]
    files = pg["files"]
    print(
        f"gate 1 provenance: "
        f"ca_budget={files['ca_budget'].get('total_rows','?')}rows"
        f" ca_ck={files['ca_checkbook'].get('total_rows','?')}rows"
        f" ct_ck={files['ct_checkbook'].get('total_rows','?')}rows"
        f" pop={files['population'].get('total_rows','?')}rows"
        f" acfr_sha={files['acfr']['sha256'][:16] if files['acfr']['sha256'] else 'missing'}..."
        f" acfr_on_disk={files['acfr']['on_disk']}"
        f" → {'PASS' if g1_ok else 'FAIL'}"
    )
    for name, info in files.items():
        if not info.get("ok", False):
            print(f"  {name}: {info}")
    gates_ok = gates_ok and g1_ok

    # Gate 2: aggregation reconciliation
    rg = reconcile_gate4(ca_budget_path, ca_checkbook_path)
    g2_ok = rg["ok"]
    print(
        f"gate 2 aggregation-reconciliation: "
        f"depts={rg['total_departments']} passing={rg['passing']} failing={rg['failing_count']}"
        f" pass_pct={rg['pass_pct']}% (threshold: ≥95% within {rg['threshold_pct']}%)"
        f" → {'PASS' if g2_ok else 'FAIL'}"
    )
    if rg["failing_details"]:
        for f in rg["failing_details"][:5]:
            print(f"  FAIL dept: {f}")
    gates_ok = gates_ok and g2_ok

    # Gate 3: comparable
    cg = comparable_gate4(config.DUCKDB_PATH)
    g3_ok = cg["ok"]
    print(
        f"gate 3 comparable: pairs_found={cg['comparable_pairs_found']}"
        f" → {'PASS' if g3_ok else 'FAIL'}"
    )
    if cg.get("reason"):
        print(f"  reason: {cg['reason']}")
    for pair in cg.get("comparable_pairs", []):
        print(
            f"  ✓ ({pair['category']}, fy={pair['fiscal_year']}): "
            f"CA={pair['ca_per_capita']:.2f}/capita "
            f"CT={pair['ct_per_capita']:.2f}/capita"
        )
    gates_ok = gates_ok and g3_ok

    print("verify-phase4:", "PASS" if gates_ok else "FAIL")
    sys.exit(0 if gates_ok else 1)


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

    e = sub.add_parser("entity-graph", help="build uei->family crosswalk")
    e.set_defaults(func=cmd_entity_graph)

    m = sub.add_parser("migrate", help="apply postgres migrations")
    m.set_defaults(func=cmd_migrate)

    j = sub.add_parser("jbooks", help="phase 1 j-book pipeline")
    j.add_argument("action", choices=["scrape", "acquire", "load-rollups", "extract", "export-facts", "crosswalk"])
    j.add_argument("--org", default=None)
    j.add_argument("--fy-start", type=int, default=None, dest="fy_start",
                   help="crosswalk: filter awards to fiscal years >= this value")
    j.add_argument("--fy-end", type=int, default=None, dest="fy_end",
                   help="crosswalk: filter awards to fiscal years <= this value")
    j.set_defaults(func=cmd_jbooks)

    rv = sub.add_parser("review", help="reconciliation review queue")
    rv.add_argument("review_action", choices=["list", "accept"])
    rv.add_argument("--id", type=int)
    rv.add_argument("--reason", default="")
    rv.set_defaults(func=cmd_review)

    v = sub.add_parser("verify-phase1", help="run phase 1 acceptance gates 1-3")
    v.add_argument("--orgs", default="DARPA")
    v.add_argument("--trace", action="store_true",
                   help="gate 6: walk budget->detail->crosswalk->award->recipient for top-5 DARPA PEs")
    v.set_defaults(func=cmd_verify_phase1)

    v2 = sub.add_parser("verify-phase2", help="phase 2 acceptance gates")
    v2.set_defaults(func=cmd_verify_phase2)

    ov = sub.add_parser("oversight", help="phase 3 oversight ingestion pipeline")
    ov.add_argument("action", choices=["scrape-pa", "high-risk"])
    ov.set_defaults(func=cmd_oversight)

    v3 = sub.add_parser("verify-phase3", help="phase 3 acceptance gates")
    v3.set_defaults(func=cmd_verify_phase3)

    v4 = sub.add_parser("verify-phase4", help="phase 4 acceptance gates")
    v4.set_defaults(func=cmd_verify_phase4)

    st = sub.add_parser("states", help="phase 4 state/local pilot ingestion")
    st.add_argument(
        "action",
        choices=["acquire-ca", "acquire-ct", "population"],
        help="acquire-ca: CA budget+checkbook+ACFR; acquire-ct: CT checkbook; population: Census PEP",
    )
    st.add_argument("--fy", default="FY25", help="FI$Cal fiscal year tag (default: FY25)")
    st.add_argument("--max-mb", type=float, default=5.0, dest="max_mb",
                    help="Max department file size in MB to download (default: 5)")
    st.set_defaults(func=cmd_states)

    args = p.parse_args(argv)
    args.func(args)
