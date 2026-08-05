"""Build the UEI -> canonical-family crosswalk parquet from the award lake.

Family preference: parent_name (name-first, not parent_uei-first) because
cross-parent-UEI merges need the NAME level — two parent UEIs whose names
normalize identically (e.g. Boeing's 'THE BOEING COMPANY' vs 'BOEING COMPANY,
THE (INC)') must resolve to the same canonical family key. family_key() in
entities.py remains the generic helper (prefers parent UEI); this module uses
name-first preference deliberately and records the distinction here.

Two properties this module exists to hold, both learned the hard way
(PM Sprint 3 Task 5b, 2026-08-05):

1. THE PARENT IS A PAIR, NOT TWO COLUMNS.  A recipient's parent changes over a
   decade — reorganisations, divestitures, sloppy registrations.  Aggregating
   recipient_parent_uei and recipient_parent_name with INDEPENDENT max() takes
   the uei from one transaction and the name from another and emits a pair that
   exists on no transaction anywhere.  Over FY2017-2026 that invented 6,342
   chimeric parents and moved $210B of Lockheed Martin into a family named
   'SIKORSKY SUPPORT SERVICES' and $88B of Electric Boat into one named 'WICO'.
   The pair is therefore chosen WHOLE, by the obligation dollars behind it.

2. THE AWARD UNIVERSE IS THE ONE THE SITE CITES.  award_glob covers contracts
   AND assistance because every consumer (fct_family_obligations_by_year,
   fct_agency_concentration) and every minted entity citation reads
   fct_award_transactions, which is their union.  A crosswalk built over a
   narrower universe makes dim_entities.total_obligation unreproducible from
   the query the page publishes beside it.

Both selections are fully ordered (dollars, then transaction count, then the
strings themselves) so the build is deterministic and reproducible.
"""
from collections.abc import Sequence
from pathlib import Path

import duckdb

from govbudget.entities import normalize_name

# Whole-pair parent selection + dollar-dominant recipient name.  Ranked by
# obligation dollars, then transaction count, then the strings — a total order,
# so two runs over the same lake produce byte-identical output.
_PICK_SQL = """
with tx as (
    select recipient_uei,
           nullif(recipient_name, '')        as recipient_name,
           nullif(recipient_parent_uei, '')  as parent_uei,
           nullif(recipient_parent_name, '') as parent_name,
           try_cast(federal_action_obligation as double) as obligation
    from read_parquet({globs}, union_by_name=true)
    where recipient_uei is not null and recipient_uei <> ''
),
totals as (
    select recipient_uei, sum(obligation) as total_obligation
    from tx group by recipient_uei
),
parent_pairs as (
    -- grouped on the PAIR: only combinations that really occur survive
    select recipient_uei, parent_uei, parent_name,
           sum(obligation) as dollars, count(*) as n
    from tx
    where parent_uei is not null or parent_name is not null
    group by recipient_uei, parent_uei, parent_name
),
parent_pick as (
    select recipient_uei, parent_uei, parent_name from (
        select *, row_number() over (
            partition by recipient_uei
            order by dollars desc nulls last, n desc,
                     parent_name nulls last, parent_uei nulls last
        ) as rn
        from parent_pairs
    ) where rn = 1
),
name_counts as (
    select recipient_uei, recipient_name,
           sum(obligation) as dollars, count(*) as n
    from tx where recipient_name is not null
    group by recipient_uei, recipient_name
),
name_pick as (
    select recipient_uei, recipient_name from (
        select *, row_number() over (
            partition by recipient_uei
            order by dollars desc nulls last, n desc, recipient_name
        ) as rn
        from name_counts
    ) where rn = 1
)
select t.recipient_uei,
       n.recipient_name,
       p.parent_uei,
       p.parent_name,
       t.total_obligation
from totals t
left join name_pick   n on n.recipient_uei = t.recipient_uei
left join parent_pick p on p.recipient_uei = t.recipient_uei
order by t.recipient_uei
"""


def build_entity_xwalk(*, award_glob: str | Sequence[str], out_path: Path) -> Path:
    globs = [award_glob] if isinstance(award_glob, str) else list(award_glob)
    if not globs:
        raise ValueError("build_entity_xwalk: award_glob is empty")
    glob_literal = "[" + ", ".join("'" + g.replace("'", "''") + "'" for g in globs) + "]"
    con = duckdb.connect()
    try:
        rows = con.execute(_PICK_SQL.format(globs=glob_literal)).fetchall()
        # First pass: assign family + method; confidence starts as 'high' for
        # parent-derived methods, 'medium' for recipient/self methods.
        raw: list[tuple] = []
        for uei, rname, puei, pname, total in rows:
            if pname and normalize_name(pname):
                family, method = normalize_name(pname), "parent_name"
            elif puei:
                family, method = puei, "parent_uei"
            elif rname and normalize_name(rname):
                family, method = normalize_name(rname), "recipient_name"
            else:
                family, method = uei, "self_uei"
            confidence = "high" if method in ("parent_name", "parent_uei") else "medium"
            raw.append((uei, rname, puei, pname, family, method, confidence, total))

        # Second pass: families spanning >1 distinct parent_uei via name-merge
        # are cross-parent merges and must be downgraded to 'medium'.
        from collections import defaultdict
        family_parent_ueis: dict[str, set[str]] = defaultdict(set)
        for uei, rname, puei, pname, family, method, confidence, total in raw:
            if puei:
                family_parent_ueis[family].add(puei)
        cross_parent_families = {
            fam for fam, ueis in family_parent_ueis.items() if len(ueis) > 1
        }

        out: list[tuple] = []
        for uei, rname, puei, pname, family, method, confidence, total in raw:
            if family in cross_parent_families:
                confidence = "medium"
            out.append((uei, rname, puei, pname, family, method, confidence, total))
        con.execute(
            "create table _x (recipient_uei varchar, recipient_name varchar,"
            " parent_uei varchar, parent_name varchar, family_key varchar,"
            " method varchar, confidence varchar, total_obligation double)"
        )
        con.executemany("insert into _x values (?,?,?,?,?,?,?,?)", out)
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        con.execute(f"copy _x to '{out_path}' (format parquet, compression zstd)")
    finally:
        con.close()
    return out_path
