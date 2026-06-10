"""Build the UEI -> canonical-family crosswalk parquet from the award lake.

Family preference: parent_name (name-first, not parent_uei-first) because
cross-parent-UEI merges need the NAME level — two parent UEIs whose names
normalize identically (e.g. Boeing's 'THE BOEING COMPANY' vs 'BOEING COMPANY,
THE (INC)') must resolve to the same canonical family key. family_key() in
entities.py remains the generic helper (prefers parent UEI); this module uses
name-first preference deliberately and records the distinction here.
"""
from pathlib import Path

import duckdb

from govbudget.entities import normalize_name


def build_entity_xwalk(*, award_glob: str, out_path: Path) -> Path:
    con = duckdb.connect()
    try:
        rows = con.execute(
            f"""
            select recipient_uei,
                   max(recipient_name) as recipient_name,
                   max(recipient_parent_uei) as parent_uei,
                   max(recipient_parent_name) as parent_name,
                   sum(try_cast(federal_action_obligation as double)) as total_obligation
            from read_parquet('{award_glob}', union_by_name=true)
            where recipient_uei is not null and recipient_uei <> ''
            group by recipient_uei
            """
        ).fetchall()
        out: list[tuple] = []
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
