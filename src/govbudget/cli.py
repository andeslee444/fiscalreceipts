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
    elif args.action == "provenance-pages":
        from govbudget.jbooks.provenance_pages import build_provenance_pages

        n = build_provenance_pages(config.PG_DSN)
        print(f"provenance-pages: {n} facts resolved")
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

        max_mb_arg = getattr(args, "max_mb", None)  # None = no cap (full capture)
        with httpx.Client(timeout=600) as client:
            budget_path, ck_path, raw_rows, depts_failed = acquire_ca_checkbook(
                client,
                parquet_dir=config.PARQUET_DIR,
                fiscal_year=getattr(args, "fy", "FY25"),
                max_mb=max_mb_arg,
            )
        print(f"states acquire-ca: budget -> {budget_path}")
        print(
            f"states acquire-ca: checkbook -> {ck_path}"
            f" ({raw_rows:,} raw rows, {depts_failed} dept failures)"
        )
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
    import duckdb as _duckdb

    from govbudget.verify_phase4 import (
        comparable_gate4,
        coverage_gate4,
        provenance_gate4,
        reconcile_gate4,
    )
    from govbudget.states.california import list_department_files, POINTER_URL
    import httpx as _httpx

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

    # Gate 3: coverage + comparable
    # Compute CA coverage: sum captured vs pointer manifest
    ca_coverage = None
    if ca_checkbook_path.exists():
        try:
            con = _duckdb.connect()
            ca_captured = con.execute(
                f"select sum(try_cast(amount_usd as double)) from read_parquet('{ca_checkbook_path}')"
            ).fetchone()[0] or 0.0
            con.close()

            # Fetch pointer to compute implied total (count * avg is not available without
            # downloading; instead use the number of FY25 files as proxy for "expected"
            # OR compare distinct dept count vs pointer count)
            # More robust: compare departments captured vs pointer file count
            ca_dept_captured = _duckdb.sql(
                f"select count(distinct department) from read_parquet('{ca_checkbook_path}')"
            ).fetchone()[0]

            with _httpx.Client(timeout=60) as hclient:
                pointer_entries = list_department_files(hclient, fiscal_year="FY25", max_mb=None)
            pointer_dept_count = len(pointer_entries)

            # Coverage = depts captured / total pointer depts
            # We use department count as the coverage proxy since we don't have
            # per-file spend totals without downloading everything.
            # If all files downloaded, coverage_pct = 100%.
            # depts_failed is implicitly pointer_dept_count - ca_dept_captured.
            depts_failed_est = max(0, pointer_dept_count - ca_dept_captured)
            # For financial coverage we compare captured spend to an estimated
            # pointer total using avg spend per captured dept as proxy.
            # A simpler approach: if ca_dept_captured >= 0.8 * pointer_dept_count → pass
            dept_coverage_pct = round(100.0 * ca_dept_captured / pointer_dept_count, 2) if pointer_dept_count else 0.0
            ca_coverage = {
                "ok": dept_coverage_pct >= 80.0,
                "coverage_pct": dept_coverage_pct,
                "threshold_pct": 80.0,
                "departments_failed": depts_failed_est,
                "coverage_note": (
                    f"CA: {ca_dept_captured}/{pointer_dept_count} departments captured"
                    f" ({dept_coverage_pct:.1f}% dept coverage)"
                    f"; total spend ${ca_captured:,.0f}"
                ),
            }
            print(f"  CA coverage: {ca_coverage['coverage_note']}")
        except Exception as exc:
            print(f"  WARNING: CA coverage check failed: {exc}")

    cg = comparable_gate4(config.DUCKDB_PATH, ca_coverage=ca_coverage)
    g3_ok = cg["ok"]
    print(
        f"gate 3 comparable: pairs_found={cg['comparable_pairs_found']}"
        f" → {'PASS' if g3_ok else 'FAIL'}"
    )
    if cg.get("reason"):
        print(f"  reason: {cg['reason']}")
    for pair in cg.get("comparable_pairs", []):
        print(
            f"  ({pair['category']}, fy={pair['fiscal_year']}): "
            f"CA=${pair['ca_per_capita']:.2f}/capita "
            f"CT=${pair['ct_per_capita']:.2f}/capita"
        )
    gates_ok = gates_ok and g3_ok

    print("verify-phase4:", "PASS" if gates_ok else "FAIL")
    sys.exit(0 if gates_ok else 1)


def cmd_verify_phase5a(args) -> None:
    from govbudget.verify_phase5a import (
        influence_gate5a,
        match_gate5a,
        mention_gate5a,
        provenance_gate5a,
    )

    influence_dir = config.PARQUET_DIR / "influence"
    filings_path = influence_dir / "lda_filings.parquet"
    mentions_path = influence_dir / "lda_program_mentions.parquet"

    gates_ok = True

    # Gate 1: provenance
    pg = provenance_gate5a(filings_path)
    g1_ok = pg["ok"]
    if "reason" in pg:
        print(f"gate 1 provenance: {pg['reason']} → FAIL")
    else:
        print(
            f"gate 1 provenance: filings={pg['total_filings']} violations={pg['violations']}"
            f" → {'PASS' if g1_ok else 'FAIL'}"
        )
    gates_ok = gates_ok and g1_ok

    # Gate 2: match coverage
    mg = match_gate5a(config.DUCKDB_PATH, filings_path)
    g2_ok = mg["ok"]
    if "reason" in mg:
        print(f"gate 2 match: {mg['reason']} → FAIL")
    else:
        print(
            f"gate 2 match: top_n={mg['top_n']} matched={mg['matched_count']}"
            f" fraction={mg['matched_fraction']:.1%} (threshold: ≥{mg['threshold']:.0%})"
            f" bad_normalized={len(mg.get('bad_normalized_rows', []))}"
            f" → {'PASS' if g2_ok else 'FAIL'}"
        )
        if mg["unmatched_families"]:
            print(
                f"  unmatched families ({len(mg['unmatched_families'])}) — "
                "candidates for Phase 5B alias work:"
            )
            for name in mg["unmatched_families"]:
                print(f"    {name}")
        if mg.get("bad_normalized_rows"):
            print(
                f"  FAIL: {len(mg['bad_normalized_rows'])} 'normalized'-stamped row(s) "
                "fail token-boundary re-validation — run: govbudget influence restamp"
            )
            for client, fk in mg["bad_normalized_rows"][:10]:
                print(f"    client={client!r} family_key={fk!r}")
    gates_ok = gates_ok and g2_ok

    # Gate 3: influence mart content + honesty
    ig = influence_gate5a(config.DUCKDB_PATH)
    g3_ok = ig["ok"]
    print(
        f"gate 3 influence: families_with_both={ig['distinct_families_with_both']}"
        f" (threshold: ≥{ig['threshold_families']})"
        f" negative_rows={ig['negative_lobbying_rows']}"
        f" bad_columns={len(ig['bad_columns'])}"
        f" → {'PASS' if g3_ok else 'FAIL'}"
    )
    for sub, ok in ig["sub_checks"].items():
        if not ok:
            print(f"  FAIL sub-check: {sub}")
    if ig["bad_columns"]:
        print(f"  causation columns found: {ig['bad_columns']}")
    gates_ok = gates_ok and g3_ok

    # Gate 4: mention coverage + referential integrity
    mng = mention_gate5a(mentions_path, filings_path)
    g4_ok = mng["ok"]
    if "reason" in mng:
        print(f"gate 4 mentions: {mng['reason']} → FAIL")
    else:
        print(
            f"gate 4 mentions: total={mng['total_mentions']}"
            f" distinct_pe_bli={mng['distinct_pe_bli']}"
            f" orphans={mng['orphan_mentions']}"
            f" → {'PASS' if g4_ok else 'FAIL'}"
        )
    gates_ok = gates_ok and g4_ok

    print("verify-phase5a:", "PASS" if gates_ok else "FAIL")
    sys.exit(0 if gates_ok else 1)


def cmd_influence_restamp(args) -> None:
    """Re-stamp match_method on existing lda_filings.parquet using current tier logic."""
    from govbudget.influence.lda import restamp_filings

    filings_path = config.PARQUET_DIR / "influence" / "lda_filings.parquet"
    if not filings_path.exists():
        print(f"influence restamp: no filings parquet at {filings_path}")
        sys.exit(1)

    print(f"influence restamp: reading {filings_path} ...")
    counts = restamp_filings(filings_path, config.DUCKDB_PATH)
    print("influence restamp: BEFORE tier counts:")
    for mm, n in sorted(counts["before"].items()):
        print(f"  {mm}: {n}")
    print("influence restamp: AFTER tier counts:")
    for mm, n in sorted(counts["after"].items()):
        print(f"  {mm}: {n}")
    print(f"influence restamp: done → {filings_path}")


def cmd_influence(args) -> None:
    import json

    import duckdb

    from govbudget.influence.lda import pull_top_families
    from govbudget.influence.mentions import build_program_terms, find_mentions

    years = [int(y.strip()) for y in args.years.split(",")]
    out_dir = config.PARQUET_DIR / "influence"
    filings_path, activities_path, lobbyists_path = pull_top_families(
        config.DUCKDB_PATH,
        out_dir=out_dir,
        top_n=args.top_n,
        years=years,
    )
    print(f"influence pull: filings={filings_path} activities={activities_path} lobbyists={lobbyists_path}")

    # --- Mentions extraction ---
    # Load activities from the just-written parquet
    acon = duckdb.connect()
    rows = acon.execute(
        f"select filing_uuid, description from read_parquet('{activities_path}')"
    ).fetchall()
    acon.close()
    activities = [{"filing_uuid": r[0], "description": r[1]} for r in rows]

    # Load programs from duckdb (read-only)
    pcon = duckdb.connect(str(config.DUCKDB_PATH), read_only=True)
    programs = pcon.execute("select pe_bli, title from dim_programs").fetchall()
    pcon.close()

    program_terms = build_program_terms(programs)
    mentions = find_mentions(activities, program_terms)
    print(f"influence pull: {len(mentions)} program-mention rows across "
          f"{len({m['pe_bli'] for m in mentions})} distinct programs")

    # Write lda_program_mentions.parquet
    mentions_path = out_dir / "lda_program_mentions.parquet"
    mcon = duckdb.connect()
    try:
        mcon.execute(
            "create table _m (filing_uuid varchar, pe_bli varchar,"
            " matched_term varchar, description_snippet varchar)"
        )
        mcon.executemany(
            "insert into _m values (?,?,?,?)",
            [(m["filing_uuid"], m["pe_bli"], m["matched_term"], m["description_snippet"])
             for m in mentions],
        )
        mcon.execute(f"copy _m to '{mentions_path}' (format parquet, compression zstd)")
    finally:
        mcon.close()
    print(f"influence pull: mentions -> {mentions_path}")


def cmd_dossiers(args) -> None:
    """Phase 5B-3 dossier pipeline (7a: fetch; 7b: submit/collect/gate)."""
    if args.dossiers_action == "fetch":
        from govbudget.dossiers.research import fetch_research

        summary = fetch_research(
            config.DUCKDB_PATH,
            snapshots_dir=config.RESEARCH_DIR / "snapshots",
            aliases_csv=config.ROOT / "data-seeds" / "search_aliases.csv",
            limit=args.limit,
        )
        print(
            f"dossiers fetch: {summary['feeds_fetched']} feeds,"
            f" {summary['items_seen']} items, {summary['matches']} matches,"
            f" {summary['snapshots']} snapshots"
            f" -> {config.RESEARCH_DIR / 'snapshots'}"
        )
    elif args.dossiers_action == "submit":
        from govbudget.dossiers.batch import submit

        summary = submit(
            duckdb_path=config.DUCKDB_PATH,
            site_json_dir=config.SITE_DIR / "json",
            snapshots_dir=config.RESEARCH_DIR / "snapshots",
            categories_csv=config.ROOT / "data-seeds" / "program_categories.csv",
            raw_dir=config.RESEARCH_DIR / "dossiers-raw",
            cost_cap=args.cost_cap,
            limit=args.limit,
        )
        print(
            f"dossiers submit: batch {summary['batch_id']}"
            f" ({summary['requests']} requests,"
            f" est ${summary['estimated_usd']:.2f}) — run `dossiers collect`"
            " once the batch ends"
        )
    elif args.dossiers_action == "collect":
        from govbudget.dossiers.batch import collect

        summary = collect(
            raw_dir=config.RESEARCH_DIR / "dossiers-raw",
            out_dir=config.SITE_DIR / "json" / "dossiers",
            poll_interval=args.poll_interval,
        )
        if not summary["ok"]:
            sys.exit(1)
    elif args.dossiers_action == "gate":
        from govbudget.dossiers.gate import (
            dim_programs_pe_set,
            dossier_gate,
            pre_batch_check,
            print_gate,
        )
        from govbudget.dossiers.research import top50

        programs = top50(config.DUCKDB_PATH)
        dim_pe = dim_programs_pe_set(config.DUCKDB_PATH)
        if args.pre:
            res = pre_batch_check([p[0] for p in programs], dim_pe)
            status = "PASS" if res["ok"] else f"FAIL (missing: {res['missing']})"
            print(f"dossier gate --pre: {res['count']} pe_blis ∈ dim_programs: {status}")
            sys.exit(0 if res["ok"] else 1)
        res = dossier_gate(
            config.SITE_DIR / "json" / "dossiers",
            config.SITE_DIR / "json" / "citations.json",
            config.RESEARCH_DIR / "snapshots" / "index.json",
            config.ROOT / "data-seeds" / "program_categories.csv",
            programs,
            dim_programs_pe=dim_pe,
        )
        print_gate(res)
        sys.exit(0 if res["ok"] else 1)


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


def cmd_verify_phase5b1(args) -> None:
    from govbudget.verify_phase5b1 import (
        citation_gate5b1,
        coverage_report5b1,
        integrity_gate5b1,
    )

    site_dir = config.SITE_DIR
    gates_ok = True

    # Gate 1: citation re-derivation (100% required)
    cg = citation_gate5b1(site_dir)
    g1_ok = cg["ok"]
    if cg.get("reason"):
        print(f"gate 1 citations: {cg['reason']} → FAIL")
    else:
        print(
            f"gate 1 citations: sampled={cg['sampled']} passed={cg['passed']}"
            f" failures={len(cg['failures'])} → {'PASS' if g1_ok else 'FAIL'}"
        )
        for fid, reason in cg["failures"][:10]:
            print(f"  FAIL {fid}: {reason}")
    gates_ok = gates_ok and g1_ok

    # Gate 2: integrity checks
    ig = integrity_gate5b1(site_dir)
    g2_ok = ig["ok"]
    if ig.get("reason"):
        print(f"gate 2 integrity: {ig['reason']} → FAIL")
    else:
        checks_str = " ".join(f"{k}={'PASS' if v else 'FAIL'}" for k, v in ig["checks"].items())
        print(
            f"gate 2 integrity: {checks_str}"
            f" → {'PASS' if g2_ok else 'FAIL'}"
        )
        for failure in ig["failures"]:
            print(f"  FAIL: {failure}")
    gates_ok = gates_ok and g2_ok

    # Gate 3: coverage (non-gating)
    cr = coverage_report5b1(site_dir)
    total = cr.get("total_details", 0)
    print(
        f"gate 3 coverage (non-gating): total={total}"
        f" unique={cr.get('unique', 0)}"
        f" ambiguous={cr.get('ambiguous_first', 0)}"
        f" zero_amount={cr.get('zero_amount', 0)}"
        f" unresolved={cr.get('unresolved', 0)}"
        f" uncited_datasets={len(cr.get('uncited_datasets', []))}"
    )
    if cr.get("uncited_datasets"):
        print(f"  uncited_datasets (deferred to 5B-2+): {cr['uncited_datasets']}")

    print("verify-phase5b1:", "PASS" if gates_ok else "FAIL")
    sys.exit(0 if gates_ok else 1)


def cmd_export_site(args) -> None:
    from govbudget.export_site import export_site, refresh_usaspending_ids

    if getattr(args, "refresh_usaspending_ids", False):
        print("Refreshing USAspending recipient ID cache...")
        cache = refresh_usaspending_ids(duckdb_path=config.DUCKDB_PATH)
        n_resolved = sum(1 for v in cache.values() if v is not None)
        n_null = sum(1 for v in cache.values() if v is None)
        print(f"Recipient ID cache: {len(cache)} entries, {n_resolved} resolved, {n_null} null")

    out = export_site(
        config.PG_DSN, config.DUCKDB_PATH, out_dir=config.SITE_DIR,
        pdf_base_url=config.PDF_BASE_URL,
    )
    print(
        f"export-site: {out['datasets']} datasets, {out['citations']} citations,"
        f" {out['pdfs']} pdfs, {out['workbooks']} workbooks,"
        f" {out['skipped_unresolved']} unresolved, {out['skipped_zero_amount']} zero-amount"
        f" -> {config.SITE_DIR}"
    )


def cmd_verify_phase5b2(args) -> None:
    """Run the phase 5B-2 gate suite via `npm --prefix site run verify`."""
    repo_root = Path(__file__).resolve().parents[3]
    site_dir = repo_root / "site"
    result = subprocess.run(
        ["npm", "--prefix", str(site_dir), "run", "verify"],
        cwd=str(repo_root),
    )
    sys.exit(result.returncode)


def cmd_verify_phase5b3(args) -> None:
    """Run the phase 5B-3 gate suite: dossier_gate + npm verify (gates 1-12)."""
    from govbudget.verify_phase5b3 import cmd_verify_phase5b3 as _run

    _run(args)


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
    j.add_argument("action", choices=["scrape", "acquire", "load-rollups", "extract", "export-facts", "crosswalk", "provenance-pages"])
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

    v5a = sub.add_parser("verify-phase5a", help="phase 5A acceptance gates (lobbying influence)")
    v5a.set_defaults(func=cmd_verify_phase5a)

    es = sub.add_parser("export-site", help="export typed site artifacts + citations + documents")
    es.add_argument(
        "--refresh-usaspending-ids",
        action="store_true",
        default=False,
        dest="refresh_usaspending_ids",
        help="refresh USAspending recipient profile ID cache before exporting "
             "(POST api/v2/recipient/ for each parent_uei; skip-if-cached; "
             "default: offline-safe, cache-only)",
    )
    es.set_defaults(func=cmd_export_site)

    v5b1 = sub.add_parser("verify-phase5b1", help="phase 5B-1 acceptance gates (citation export)")
    v5b1.set_defaults(func=cmd_verify_phase5b1)

    v5b2 = sub.add_parser(
        "verify-phase5b2",
        help="phase 5B-2 acceptance gates (site render, citations, a11y, search, perf)",
    )
    v5b2.set_defaults(func=cmd_verify_phase5b2)

    v5b3 = sub.add_parser(
        "verify-phase5b3",
        help="phase 5B-3 acceptance gates (dossier artifacts + feed/district/filing/og/animation gates)",
    )
    v5b3.set_defaults(func=cmd_verify_phase5b3)

    st = sub.add_parser("states", help="phase 4 state/local pilot ingestion")
    st.add_argument(
        "action",
        choices=["acquire-ca", "acquire-ct", "population"],
        help="acquire-ca: CA budget+checkbook+ACFR; acquire-ct: CT checkbook; population: Census PEP",
    )
    st.add_argument("--fy", default="FY25", help="FI$Cal fiscal year tag (default: FY25)")
    st.add_argument("--max-mb", type=float, default=None, dest="max_mb",
                    help="Max department file size in MB to download (default: no cap = full capture)."
                         " Pass e.g. --max-mb 5 for debugging only.")
    st.set_defaults(func=cmd_states)

    inf = sub.add_parser("influence", help="phase 5A lobbying data pipeline")
    inf_sub = inf.add_subparsers(dest="influence_action", required=True)
    inf_pull = inf_sub.add_parser("pull", help="pull LDA filings for top-N defense families")
    inf_pull.add_argument("--top-n", type=int, default=100, dest="top_n",
                          help="Number of top families by obligation to query (default: 100)")
    inf_pull.add_argument("--years", default="2024,2025,2026",
                          help="Comma-separated filing years (default: 2024,2025,2026)")
    inf_pull.set_defaults(func=cmd_influence)
    inf_restamp = inf_sub.add_parser(
        "restamp",
        help=(
            "Re-stamp match_method on existing lda_filings.parquet using the current "
            "tier logic; no network calls, no re-pull."
        ),
    )
    inf_restamp.set_defaults(func=cmd_influence_restamp)

    dos = sub.add_parser("dossiers", help="phase 5B-3 dossier research pipeline")
    dos_sub = dos.add_subparsers(dest="dossiers_action", required=True)
    dos_fetch = dos_sub.add_parser(
        "fetch",
        help="pull verified RSS feeds, match top-50 programs, snapshot matching"
             " articles (robots-honoring, <=1 req/s/host)",
    )
    dos_fetch.add_argument(
        "--limit", type=int, default=None,
        help="max article snapshots to fetch (smoke runs); default: no cap",
    )
    dos_fetch.set_defaults(func=cmd_dossiers)
    dos_submit = dos_sub.add_parser(
        "submit",
        help="estimate (Batch rates, count_tokens), cost-gate, and create the"
             " top-50 dossier batch; batch_id -> data/research/dossiers-raw/",
    )
    dos_submit.add_argument(
        "--limit", type=int, default=50,
        help="number of programs to submit (smoke runs use 2); default 50",
    )
    dos_submit.add_argument(
        "--cost-cap", type=float, default=50.0,
        help="abort without creating a batch when the estimate exceeds this"
             " (USD); raising it above $50 is the operator confirmation",
    )
    dos_submit.set_defaults(func=cmd_dossiers)
    dos_collect = dos_sub.add_parser(
        "collect",
        help="poll the submitted batch, archive raw results (committed),"
             " write parsed dossiers to data/site/json/dossiers/",
    )
    dos_collect.add_argument(
        "--poll-interval", type=float, default=60.0,
        help="seconds between batch status polls; default 60",
    )
    dos_collect.set_defaults(func=cmd_dossiers)
    dos_gate = dos_sub.add_parser(
        "gate",
        help="cited-or-absent dossier gate (zero unresolvable citations,"
             " >=80%% warehouse-cited corpus-wide, categories cover top-50)",
    )
    dos_gate.add_argument(
        "--pre", action="store_true",
        help="run only the pre-batch assertion (top-50 pe_blis ∈ dim_programs)",
    )
    dos_gate.set_defaults(func=cmd_dossiers)

    args = p.parse_args(argv)
    args.func(args)
