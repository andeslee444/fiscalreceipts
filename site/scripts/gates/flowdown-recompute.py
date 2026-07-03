#!/usr/bin/env python3
"""flowdown-recompute.py — G9 lake-recompute helper (Phase 5H).

Reads a JSON request file (argv[1]) and answers on stdout. Everything is
recomputed INDEPENDENTLY from the parquet lake — the same dedup / mapping
rules as the fct_flow_edges mart, duplicated here by design so drift between
the mart, the exporter and this helper is a real failure.

Request:
{
  "budget": true,                       → full per-level value dicts from
                                          jbook_budget_lines (title IS NOT
                                          NULL, amount_type=fy_2026_total)
  "spend_fys": [2025, 2017],            → per FY: total + per-level dicts
                                          RESTRICTED to the requested keys
  "spend_keys": {"2025": {"sub": [...], "office": [...], "family": [...]}},
  "class_totals": true,                 → per (fy, competed_class) totals
                                          over the whole contracts lake
  "crosswalk_pes": ["0601101E", ...]    → sum of budget value over these PEs
                                          + the expected PE set from the site
                                          bundle's fct_budget_to_awards
}
"""

import json
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[3]
LAKE = REPO / "data" / "parquet"
SITE = REPO / "data" / "site"

BUDGET_SQL = f"""
select
    case when organization is null or organization = '' then 'CLASSIFIED'
         else organization end as comp,
    account,
    coalesce(budget_activity, '?') as ba,
    pe_bli,
    sum(try_cast(amount_thousands as double)) as amt
from read_parquet('{LAKE}/jbooks/budget_lines.parquet')
where title is not null and amount_type = 'fy_2026_total'
group by 1, 2, 3, 4
"""

CLASS_CASE = """
case
    when extent_competed = 'FULL AND OPEN COMPETITION' then 'full_and_open'
    when extent_competed = 'FULL AND OPEN COMPETITION AFTER EXCLUSION OF SOURCES'
        then 'set_aside'
    when extent_competed in ('COMPETED UNDER SAP', 'FOLLOW ON TO COMPETED ACTION',
                             'COMPETITIVE DELIVERY ORDER') then 'other_than_full'
    else 'not_competed'
end
"""

SPEND_BASE = f"""
select
    coalesce(nullif(c.awarding_sub_agency_name, ''), 'UNKNOWN SUB-AGENCY') as sub,
    coalesce(nullif(c.awarding_sub_agency_name, ''), 'UNKNOWN SUB-AGENCY') || '|' ||
        coalesce(nullif(c.awarding_office_name, ''), 'UNKNOWN OFFICE') as office,
    coalesce(
        x.family_key,
        upper(coalesce(nullif(c.recipient_parent_name, ''),
                       nullif(c.recipient_name, ''))),
        nullif(c.recipient_uei, ''),
        'UNKNOWN RECIPIENT'
    ) as family,
    try_cast(c.federal_action_obligation as double) as obligation
from read_parquet('{LAKE}/contracts/*/*.parquet', hive_partitioning=true) c
left join read_parquet('{LAKE}/entities/entity_xwalk.parquet') x
    on x.recipient_uei = nullif(c.recipient_uei, '')
where c.fy = ?
"""


def main() -> None:
    req = json.loads(Path(sys.argv[1]).read_text())
    con = duckdb.connect()
    out: dict = {}

    if req.get("budget"):
        rows = con.execute(BUDGET_SQL).fetchall()
        comp: dict[str, float] = {}
        acct: dict[str, float] = {}
        ba: dict[str, float] = {}
        prog: dict[str, float] = {}
        pe_vals: dict[str, float] = {}
        total = 0.0
        for c, a, b, pe, amt in rows:
            amt = amt or 0.0
            total += amt
            comp[c] = comp.get(c, 0.0) + amt
            k2 = f"{c}|{a}"
            acct[k2] = acct.get(k2, 0.0) + amt
            k3 = f"{c}|{a}|{b}"
            ba[k3] = ba.get(k3, 0.0) + amt
            k4 = f"{c}|{a}|{b}|{pe}"
            prog[k4] = prog.get(k4, 0.0) + amt
            pe_vals[pe] = pe_vals.get(pe, 0.0) + amt
        out["budget"] = {
            "total": total,
            "component": comp,
            "appropriation": acct,
            "budget_activity": ba,
            "program": prog,
        }
        pes = req.get("crosswalk_pes")
        if pes is not None:
            out["crosswalk"] = {
                "sum": sum(pe_vals.get(pe, 0.0) for pe in pes),
                "unknown_pes": [pe for pe in pes if pe not in pe_vals],
            }
            b2a = SITE / "data" / "fct_budget_to_awards.parquet"
            if b2a.exists():
                expected = {
                    r[0] for r in con.execute(
                        f"select distinct pe_bli from read_parquet('{b2a}')"
                    ).fetchall()
                }
                out["crosswalk"]["expected_pes"] = sorted(
                    expected & set(pe_vals.keys())
                )

    spend_keys = req.get("spend_keys", {})
    if req.get("spend_fys"):
        out["spend"] = {}
        for fy in req["spend_fys"]:
            keys = spend_keys.get(str(fy), {})
            rows = con.execute(
                f"select sub, office, family, sum(obligation), count(*)"
                f" from ({SPEND_BASE}) group by 1, 2, 3",
                [fy],
            ).fetchall()
            total = 0.0
            sub_d: dict[str, float] = {}
            office_d: dict[str, float] = {}
            family_d: dict[str, float] = {}
            for sub, office, family, amt, _n in rows:
                amt = amt or 0.0
                total += amt
                sub_d[sub] = sub_d.get(sub, 0.0) + amt
                office_d[office] = office_d.get(office, 0.0) + amt
                family_d[family] = family_d.get(family, 0.0) + amt
            out["spend"][str(fy)] = {
                "total": total,
                "sub": {k: sub_d.get(k, 0.0) for k in keys.get("sub", [])},
                "office": {k: office_d.get(k, 0.0) for k in keys.get("office", [])},
                "family": {k: family_d.get(k, 0.0) for k in keys.get("family", [])},
                "n_sub": len(sub_d),
                "n_office": len(office_d),
                "n_family": len(family_d),
            }

    if req.get("class_totals"):
        rows = con.execute(f"""
            select cast(fy as integer), {CLASS_CASE},
                   sum(try_cast(federal_action_obligation as double))
            from read_parquet('{LAKE}/contracts/*/*.parquet',
                              hive_partitioning=true)
            group by 1, 2
        """).fetchall()
        ct: dict[str, dict[str, float]] = {}
        for fy, cls, amt in rows:
            ct.setdefault(str(fy), {})[cls] = amt or 0.0
        out["class_totals"] = ct

    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
