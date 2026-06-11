"""Phase 5A acceptance gates: lobbying influence layer.

Gates (CLI: verify-phase5a):
  1. provenance_gate5a  — every row in lda_filings has a non-empty uuid AND url;
                          at least 1 row present.
  2. match_gate5a       — of the top-50 families by obligation (same ordering as
                          pull_top_families), ≥80% have ≥1 filing row matched
                          (match_method != 'none'). Reports unmatched families
                          for Phase 5B alias work.
  3. influence_gate5a   — in fct_influence: (a) ≥30 distinct families with both
                          lobbying dollars > 0 AND obligations > 0; (b) no
                          negative lobbying values; (c) honesty check: no column
                          in fct_influence, fct_program_lobbying, or dim_lobbyists
                          contains 'caused', 'because', or 'won_due'.
  4. mention_gate5a     — ≥10 program-mention rows across ≥3 distinct pe_bli;
                          every mention's filing_uuid resolves to a filing row
                          that has a non-empty url (zero orphans).

All DuckDB connections opened read_only=True.
"""
from pathlib import Path

import duckdb

# Tokens forbidden in mart column names (no causation language).
_BAD_TOKENS = ("caused", "because", "won_due")

# Tables to audit for causation language.
_MART_TABLES = ("fct_influence", "fct_program_lobbying", "dim_lobbyists")

# Number of top families to check in match_gate5a (same top-N as pull_top_families default).
_MATCH_TOP_N = 50

# Thresholds
_MATCH_THRESHOLD = 0.80
_MIN_FAMILIES_WITH_BOTH = 30
_MIN_MENTION_ROWS = 10
_MIN_MENTION_PE_BLI = 3


def provenance_gate5a(filings_parquet_path: Path) -> dict:
    """Gate 1: every row in lda_filings has a non-empty uuid AND non-empty url.

    PASS iff zero violations and at least 1 row.

    Returns dict with keys:
        ok: bool
        total_filings: int
        violations: int  — rows with empty uuid or empty url
        reason: str      — present only when ok is False due to missing file or empty data
    """
    filings_parquet_path = Path(filings_parquet_path)
    if not filings_parquet_path.exists():
        return {
            "ok": False,
            "total_filings": 0,
            "violations": 0,
            "reason": f"file missing: {filings_parquet_path}",
        }

    con = duckdb.connect()
    total = con.execute(
        f"select count(*) from read_parquet('{filings_parquet_path}')"
    ).fetchone()[0]

    if total == 0:
        con.close()
        return {
            "ok": False,
            "total_filings": 0,
            "violations": 0,
            "reason": "lda_filings.parquet is empty",
        }

    violations = con.execute(
        f"select count(*) from read_parquet('{filings_parquet_path}') "
        f"where filing_uuid is null or filing_uuid = '' "
        f"   or url is null or url = ''"
    ).fetchone()[0]
    con.close()

    return {
        "ok": violations == 0,
        "total_filings": total,
        "violations": violations,
    }


def match_gate5a(duckdb_path: Path, filings_parquet_path: Path) -> dict:
    """Gate 2: of top-50 families by obligation, ≥80% have ≥1 matched filing.

    'Matched' means the filing carries that family's family_key_guess with
    match_method != 'none'.  Families with zero filings or only 'none'-method
    filings are considered unmatched.

    The top-50 selection mirrors pull_top_families:
        select family_key, display_name from dim_entities
        order by total_obligation desc nulls last
        limit 50

    Returns dict with keys:
        ok: bool
        top_n: int                   — how many families were evaluated
        matched_count: int
        matched_fraction: float      — matched_count / top_n
        threshold: float             — always 0.80
        unmatched_families: list[str] — display_names of unmatched families
    """
    duckdb_path = Path(duckdb_path)
    filings_parquet_path = Path(filings_parquet_path)

    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        families = con.execute(
            "select family_key, display_name from dim_entities "
            "order by total_obligation desc nulls last "
            f"limit {_MATCH_TOP_N}"
        ).fetchall()
    finally:
        con.close()

    if not families:
        return {
            "ok": False,
            "top_n": 0,
            "matched_count": 0,
            "matched_fraction": 0.0,
            "threshold": _MATCH_THRESHOLD,
            "unmatched_families": [],
            "reason": "dim_entities is empty — run govbudget build first",
        }

    # Load matched family keys from filings (match_method != 'none')
    fcon = duckdb.connect()
    if filings_parquet_path.exists():
        matched_keys = set(
            r[0]
            for r in fcon.execute(
                f"select distinct family_key_guess from read_parquet('{filings_parquet_path}') "
                f"where match_method is not null and match_method <> 'none' "
                f"  and family_key_guess is not null and family_key_guess <> ''"
            ).fetchall()
        )
    else:
        matched_keys = set()
    fcon.close()

    matched = []
    unmatched = []
    for family_key, display_name in families:
        if family_key in matched_keys:
            matched.append(display_name)
        else:
            unmatched.append(display_name)

    top_n = len(families)
    matched_count = len(matched)
    matched_fraction = matched_count / top_n if top_n else 0.0

    return {
        "ok": matched_fraction >= _MATCH_THRESHOLD,
        "top_n": top_n,
        "matched_count": matched_count,
        "matched_fraction": round(matched_fraction, 4),
        "threshold": _MATCH_THRESHOLD,
        "unmatched_families": unmatched,
    }


def influence_gate5a(duckdb_path: Path) -> dict:
    """Gate 3: fct_influence content + honesty checks.

    (a) ≥30 distinct families with BOTH lobbying dollars > 0 (income or expenses)
        AND obligations > 0.
    (b) No negative lobbying values (income or expenses).
    (c) Honesty check: no column name in fct_influence, fct_program_lobbying, or
        dim_lobbyists contains 'caused', 'because', or 'won_due'.

    PASS iff all three sub-checks pass.

    Returns dict with keys:
        ok: bool
        distinct_families_with_both: int
        threshold_families: int       — always 30
        negative_lobbying_rows: int
        bad_columns: list[str]        — offending "table.column" strings
        sub_checks: dict              — per-check ok booleans
    """
    duckdb_path = Path(duckdb_path)
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        # (a) families with both lobbying and obligations
        distinct_with_both = con.execute(
            """
            select count(distinct family_key)
            from fct_influence
            where (lobbying_income_usd > 0 or lobbying_expense_usd > 0)
              and obligations_usd > 0
            """
        ).fetchone()[0]

        # (b) negative lobbying values
        negative_rows = con.execute(
            """
            select count(*)
            from fct_influence
            where lobbying_income_usd < 0 or lobbying_expense_usd < 0
            """
        ).fetchone()[0]

        # (c) honesty check — audit information_schema.columns for all three mart tables
        bad_columns = []
        token_filter = " or ".join(
            f"lower(column_name) like '%{tok}%'" for tok in _BAD_TOKENS
        )
        rows = con.execute(
            f"""
            select table_name, column_name
            from information_schema.columns
            where lower(table_name) in ({', '.join(repr(t) for t in _MART_TABLES)})
              and ({token_filter})
            order by table_name, column_name
            """
        ).fetchall()
        bad_columns = [f"{tbl}.{col}" for tbl, col in rows]

    finally:
        con.close()

    a_ok = distinct_with_both >= _MIN_FAMILIES_WITH_BOTH
    b_ok = negative_rows == 0
    c_ok = len(bad_columns) == 0

    return {
        "ok": a_ok and b_ok and c_ok,
        "distinct_families_with_both": distinct_with_both,
        "threshold_families": _MIN_FAMILIES_WITH_BOTH,
        "negative_lobbying_rows": negative_rows,
        "bad_columns": bad_columns,
        "sub_checks": {
            "families_with_both": a_ok,
            "no_negative_lobbying": b_ok,
            "no_causation_columns": c_ok,
        },
    }


def mention_gate5a(
    duckdb_path: Path,
    mentions_parquet_path: Path,
    filings_parquet_path: Path,
) -> dict:
    """Gate 4: program-mention coverage and referential integrity.

    Checks:
    - ≥10 total mention rows.
    - ≥3 distinct pe_bli values.
    - Zero orphan mentions: every mention's filing_uuid must resolve to a filing
      row that has a non-empty url.

    PASS iff all checks pass.

    Returns dict with keys:
        ok: bool
        total_mentions: int
        distinct_pe_bli: int
        orphan_mentions: int         — mentions whose filing_uuid has no url in filings
        reason: str                  — present only when a required file is missing
    """
    mentions_parquet_path = Path(mentions_parquet_path)
    filings_parquet_path = Path(filings_parquet_path)

    missing = []
    if not mentions_parquet_path.exists():
        missing.append(str(mentions_parquet_path))
    if not filings_parquet_path.exists():
        missing.append(str(filings_parquet_path))
    if missing:
        return {
            "ok": False,
            "total_mentions": 0,
            "distinct_pe_bli": 0,
            "orphan_mentions": 0,
            "reason": f"file missing: {', '.join(missing)}",
        }

    con = duckdb.connect()
    total_mentions = con.execute(
        f"select count(*) from read_parquet('{mentions_parquet_path}')"
    ).fetchone()[0]

    distinct_pe_bli = con.execute(
        f"select count(distinct pe_bli) from read_parquet('{mentions_parquet_path}')"
    ).fetchone()[0]

    # Orphan check: mentions whose filing_uuid is absent from filings or whose
    # corresponding filing has an empty url.
    orphan_mentions = con.execute(
        f"""
        select count(*)
        from read_parquet('{mentions_parquet_path}') m
        left join (
            select filing_uuid, url
            from read_parquet('{filings_parquet_path}')
            where url is not null and url <> ''
        ) f on f.filing_uuid = m.filing_uuid
        where f.filing_uuid is null
        """
    ).fetchone()[0]
    con.close()

    return {
        "ok": (
            total_mentions >= _MIN_MENTION_ROWS
            and distinct_pe_bli >= _MIN_MENTION_PE_BLI
            and orphan_mentions == 0
        ),
        "total_mentions": total_mentions,
        "distinct_pe_bli": distinct_pe_bli,
        "orphan_mentions": orphan_mentions,
    }
