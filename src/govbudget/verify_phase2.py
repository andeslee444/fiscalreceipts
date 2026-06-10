"""Phase 2 acceptance gates (phase-gates doc): entity resolution, golden
family merges, geography coverage. Runs against the DuckDB mart file."""
from pathlib import Path

import duckdb


def entity_gate(duckdb_path: Path, *, top_n: int = 1000) -> dict:
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        resolved, total = con.execute(
            f"""
            with top as (
              select * from entity_xwalk
              order by total_obligation desc nulls last limit {int(top_n)}
            )
            select count(*) filter (where method in ('parent_name','parent_uei','recipient_name')
                                    and family_key is not null and family_key <> recipient_uei),
                   count(*)
            from top
            """
        ).fetchone()
    finally:
        con.close()
    return {
        "top_n": total,
        "resolved": resolved,
        "resolved_pct": round(100.0 * resolved / total, 1) if total else 0.0,
    }


def golden_gate(duckdb_path: Path) -> dict:
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        boeing = con.execute(
            "select count(distinct recipient_uei), count(distinct family_key)"
            " from entity_xwalk where parent_name ilike '%boeing%'"
            " and parent_name not ilike '%bell boeing%'"
        ).fetchone()
        hii = con.execute(
            "select count(distinct family_key) from entity_xwalk"
            " where parent_name ilike 'huntington ingalls%'"
        ).fetchone()
    finally:
        con.close()
    return {
        "boeing_ueis": boeing[0],
        "boeing_one_family": boeing[1] == 1,
        "hii_one_family": hii[0] == 1,
    }


def geography_gate(duckdb_path: Path) -> dict:
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        with_state, with_district = con.execute(
            """
            select count(*) filter (where pop_state is not null and pop_state <> ''),
                   count(*) filter (where pop_state is not null and pop_state <> ''
                                    and pop_district is not null and pop_district <> '')
            from fct_award_transactions
            """
        ).fetchone()
    finally:
        con.close()
    return {
        "with_state": with_state,
        "with_district": with_district,
        "resolved_pct": round(100.0 * with_district / with_state, 1) if with_state else 0.0,
    }
