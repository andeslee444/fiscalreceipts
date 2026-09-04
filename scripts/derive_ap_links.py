"""Leg 1 derivation: turn verified (acquisition program -> J-book line) mappings
into award-level links, narrowed per award by funding account.

Tiers (deterministic, conservative):
  medium  the award's funding accounts select >=1 verified line of its
          program (program identity from FPDS AP code, mapping verified by
          two adversarial lenses, money color confirmed) — the award is
          program-pinned, but which specific line (production vs
          modification vs research) paid is not provable from account data
          alone: sibling lines often share one appropriation account. A
          held-out study measured the earlier "unique matched line" high
          tier at 34/60 = 56.7% (17 of 26 refutations were exactly this
          sibling-line ambiguity), and that tier was withdrawn 2026-09-04.
  low     accounts select none of the program's lines (e.g. O&M money on an
          MDAP) — NOT published; retained for audit

Only lines present in dim_programs (the site's display universe) may publish.
Inserts into budget_line_awards with method 'fpds-ap' (medium/low); the
adjudication overlay does not apply to these rows (they are evidence-graded
at creation).

Usage: uv run python scripts/derive_ap_links.py [--dry-run]
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import duckdb
import psycopg

# Catch-all budget lines ("Items Less Than $5 Million", "Ordnance Items <$5M",
# "Other Support Aircraft") are aggregates, not programs: a link asserting an
# award executes "Items Less Than $5 Million" is content-free, and the $ in
# the title trips the site's currency-in-prose sweep. Never link targets.
CATCHALL_TITLE = re.compile(r"(less than|under|<)\s*\$|^other\b|^miscellaneous", re.I)

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
DSN = "postgresql://localhost/govbudget"
AGENCY_BY_LETTER = {"D": "097", "N": "017", "A": "021", "F": "057", "M": "017"}


def fed_accounts_from_codes(accounts) -> set[str]:
    """Map raw budget_lines.account codes (e.g. '1319N') to lake-style
    federal account keys ('097-1319') via AGENCY_BY_LETTER.

    Shared with load_announcement_links.py so both the FPDS-account path and
    the announcement money-color guard derive "which appropriation funds
    this line" the same way.
    """
    fed = set()
    for account in accounts:
        if account and account[-1:].isalpha():
            num, letter = account[:-1], account[-1].upper()
            pref = AGENCY_BY_LETTER.get(letter)
            if pref:
                fed.add(f"{pref}-{num}")
    return fed


def tier_for(matched_count: int) -> tuple[str, str]:
    """Confidence tier + method for an FPDS-tagged award given how many of
    its program's verified lines its funding accounts matched.

    The earlier "exactly one match -> high" tier is withdrawn (2026-09-04):
    a held-out precision study measured it at 34/60 = 56.7%, driven mostly
    by sibling lines sharing one appropriation account. Any account match
    now publishes at medium under the single method 'fpds-ap'; zero matches
    stays low (unpublished, audit-only).
    """
    if matched_count >= 1:
        return "medium", "fpds-ap"
    return "low", "fpds-ap"


def main() -> int:
    dry = "--dry-run" in sys.argv
    res = json.load(open(RESEARCH / "adjudication" / "leg1_result.json"))
    surviving = res["surviving"]

    # per-line account codes + org + exhibit from postgres budget_lines
    pg = psycopg.connect(DSN)
    line_meta: dict[str, dict] = {}
    for pe_bli in {s["pe_bli"] for s in surviving}:
        rows = pg.execute(
            "select distinct account, organization, exhibit from budget_lines"
            " where pe_bli=%s and account is not null", (pe_bli,),
        ).fetchall()
        orgs, exhibits = set(), set()
        for account, org, exhibit in rows:
            orgs.add(org); exhibits.add(exhibit or "")
        fed = fed_accounts_from_codes(account for account, _, _ in rows)
        line_meta[pe_bli] = {"fed_accounts": fed, "orgs": orgs,
                             "exhibit": sorted(exhibits)[0] if exhibits else "",
                             "org": sorted(orgs)[0] if orgs else ""}

    con = duckdb.connect(str(ROOT / "data" / "duckdb" / "govbudget.duckdb"), read_only=True)
    display = {r[0] for r in con.execute("select distinct pe_bli from dim_programs").fetchall()}
    # Collision keys (E1): dim_programs publishes >1 row for these pe_bli —
    # two different programs share the numeric BLI (e.g. '3010' is Shipboard
    # Tactical Communications in 1810N AND LPD Flight II in 1611N). A link on
    # the bare key is ambiguous between them, and account narrowing above
    # unions BOTH programs' accounts, so a "high" here could attribute an
    # award to the wrong program. Excluded until account-qualified program
    # pages exist (E3 owner call). 2026-09-01.
    collisions = {r[0] for r in con.execute(
        "select pe_bli from dim_programs group by pe_bli having count(*) > 1"
    ).fetchall()}
    con.close()
    display -= collisions
    print(f"excluded {len(collisions)} collision keys from link targets")
    titles = pg.execute("select pe_bli, title from budget_lines where title is not null").fetchall()
    catchall = {pe for pe, t in titles if CATCHALL_TITLE.search(t or "")}
    display -= catchall
    print(f"excluded {len(catchall & set(pe for pe, _ in titles))} catch-all titled lines from link targets")

    import re as _re
    synthetic = _re.compile(r"-L\d+$")
    lines_by_ap: dict[str, list] = defaultdict(list)
    for s in surviving:
        # Synthetic page-line rollup keys ({account}-{org}-L{n}) are export
        # artifacts, not budget lines a reader can visit — linking awards to
        # them produced feed cards with no destination page (gate 8, 2026-09-01).
        if synthetic.search(s["pe_bli"]):
            continue
        if s["pe_bli"] in display:
            lines_by_ap[s["ap_code"]].append(s)
    print(f"verified mappings on display-universe lines: "
          f"{sum(len(v) for v in lines_by_ap.values())} across {len(lines_by_ap)} programs")

    lake = duckdb.connect()
    awards = lake.execute(f"""
        select dod_acquisition_program_code ap, award_id_piid,
               any_value(recipient_name), any_value(recipient_uei),
               max(federal_accounts_funding_this_award) accts,
               sum(try_cast(federal_action_obligation as double)) ob
        from read_parquet('{ROOT}/data/parquet/contracts/fy=*/*.parquet', union_by_name=true)
        where dod_acquisition_program_code in ({",".join("'"+a.replace("'","''")+"'" for a in lines_by_ap)})
          and award_id_piid is not null and award_id_piid <> ''
        group by 1, 2
    """).fetchall()
    lake.close()
    print(f"AP-tagged awards in lake for verified programs: {len(awards)}")

    out_rows = []
    tiers = defaultdict(int)
    for ap, piid, rname, ruei, accts, ob in awards:
        award_accounts = set((accts or "").split(";"))
        cands = lines_by_ap[ap]
        matched = [s for s in cands
                   if line_meta[s["pe_bli"]]["fed_accounts"] & award_accounts]
        conf, method = tier_for(len(matched))
        chosen = matched if matched else cands  # low: audit trail only, never published
        tiers[conf] += 1
        for s in chosen:
            m = line_meta[s["pe_bli"]]
            rationale = (f"FPDS acquisition program {ap}; mapping {s['match_kind']}"
                         f" (2-lens verified); account narrowing"
                         f" {len(matched)}/{len(cands)} lines")
            out_rows.append((s["pe_bli"], m["exhibit"], 2026, m["org"], piid,
                             rname, ruei, ob, method, conf, len(matched), rationale))

    print(f"award-level tier distribution: {dict(tiers)}")
    print(f"link rows to upsert: {len(out_rows)}")
    if dry:
        for r in out_rows[:5]:
            print("  sample:", r[0], r[4], r[9], r[11][:70])
        return 0

    with pg:
        cur = pg.cursor()
        cur.execute("delete from budget_line_awards where method like 'fpds-ap%'")
        cur.executemany(
            """insert into budget_line_awards
               (pe_bli, exhibit, fiscal_year, organization, award_piid,
                recipient_name, recipient_uei, matched_obligation, method,
                confidence, score, rationale)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (pe_bli, exhibit, fiscal_year, award_piid)
               do update set confidence=excluded.confidence,
                             method=excluded.method, score=excluded.score,
                             rationale=excluded.rationale,
                             matched_obligation=excluded.matched_obligation""",
            out_rows,
        )
    # `with pg:` closes the connection on exit (psycopg3) — count on a fresh one
    with psycopg.connect(DSN) as pg2:
        n = pg2.execute("select confidence, count(*) from budget_line_awards"
                        " where method like 'fpds-ap%' group by 1").fetchall()
    print("loaded:", n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
