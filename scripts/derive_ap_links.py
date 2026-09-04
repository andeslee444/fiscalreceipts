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

from collision_keys import (
    member_for_award,
    partition_split_keys,
    raise_on_contradictory_accounts,
)

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


# ---------------------------------------------------------------------------
# The member-attribution guard both loaders run before they write (ROADMAP #70
# fix round 1). Shared here rather than in collision_keys.py, which owns the
# pure resolution rule and no SQL — the same reason fed_accounts_from_codes
# lives here and is imported by load_announcement_links.
# ---------------------------------------------------------------------------


def stored_member_claims(cur) -> dict[tuple, str | None]:
    """Every published link's unique key → the member account it names.

    Read INSIDE the load transaction and AFTER this loader deleted its own
    rows, so what remains is the other evidence route's standing claims. The
    unique key's fiscal_year is an int column; normalize so a loader carrying
    it as text compares equal instead of silently never matching (a guard that
    can never fire is worse than no guard).
    """
    cur.execute(
        "select pe_bli, exhibit, fiscal_year, award_piid, account"
        " from budget_line_awards where account is not null"
    )
    return {
        (pe_bli, exhibit, int(fiscal_year), award_piid): account
        for pe_bli, exhibit, fiscal_year, award_piid, account in cur.fetchall()
    }


def incoming_member_claims(rows) -> list[tuple[tuple, str | None]]:
    """The same shape for the rows about to be written. Both loaders build the
    13-column budget_line_awards tuple: pe_bli, exhibit, fiscal_year,
    organization, award_piid, …, account."""
    return [((r[0], r[1], int(r[2]), r[4]), r[12]) for r in rows]


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


def link_rows_for_award(
    *, ap_code, piid, recipient_name, recipient_uei, award_accounts,
    obligation, candidates, line_meta, account_split,
) -> list[tuple]:
    """The budget_line_awards rows ONE AP-tagged award produces.

    candidates  the verified J-book lines mapped to this award's AP code.
    line_meta   {(pe_bli, account_or_None): {fed_accounts, org, exhibit}} —
                keyed (pe_bli, None) for an ordinary line and
                (pe_bli, account) once per member of an account-split key.
    account_split  {pe_bli: {account, ...}} for the shared keys an account
                can resolve (ROADMAP #70; see collision_keys).

    A line on a shared key is a candidate for THIS award only when the
    award's own funding accounts name exactly one of its members
    (collision_keys.member_for_award); otherwise the line is dropped for this
    award and the remaining candidates are unaffected. Every other line
    behaves exactly as it did before #70 and carries account=None: for a
    pe_bli that names one program, `resolved` is `candidates` element for
    element and the rationale's `matched/candidates` denominator is
    unchanged.
    """
    resolved: list[tuple[dict, str | None]] = []
    for s in candidates:
        pe_bli = s["pe_bli"]
        members = account_split.get(pe_bli)
        if members is None:
            resolved.append((s, None))
            continue
        account = member_for_award(
            {a: line_meta[(pe_bli, a)]["fed_accounts"] for a in members},
            award_accounts,
        )
        # No account evidence, or evidence naming BOTH programs that share
        # this code: the link would be a claim about a program the award may
        # have nothing to do with. Not published, at any tier.
        if account is not None:
            resolved.append((s, account))

    if not resolved:
        return []

    matched = [
        (s, account) for s, account in resolved
        if line_meta[(s["pe_bli"], account)]["fed_accounts"] & award_accounts
    ]
    conf, method = tier_for(len(matched))
    chosen = matched if matched else resolved  # low: audit trail only
    rows = []
    for s, account in chosen:
        m = line_meta[(s["pe_bli"], account)]
        rationale = (f"FPDS acquisition program {ap_code}; mapping {s['match_kind']}"
                     f" (2-lens verified); account narrowing"
                     f" {len(matched)}/{len(resolved)} lines")
        if account:
            rationale += f"; shared BLI code resolved to account {account}"
        rows.append((s["pe_bli"], m["exhibit"], 2026, m["org"], piid,
                     recipient_name, recipient_uei, obligation, method, conf,
                     len(matched), rationale, account))
    return rows


def main() -> int:
    dry = "--dry-run" in sys.argv
    res = json.load(open(RESEARCH / "adjudication" / "leg1_result.json"))
    surviving = res["surviving"]

    con = duckdb.connect(str(ROOT / "data" / "duckdb" / "govbudget.duckdb"), read_only=True)
    display = {r[0] for r in con.execute("select distinct pe_bli from dim_programs").fetchall()}
    # Shared BLI codes (E1): dim_programs publishes >1 row for these pe_bli —
    # two different programs share the numeric code (e.g. '3010' is Shipboard
    # Tactical Communications in 1810N AND LPD Flight II in 1611N).
    #
    # ROADMAP #70 (2026-09-04): the ACCOUNT-split keys are link targets again.
    # Sprint E Task E3 already publishes one page per member, so the missing
    # piece was never the URL — it was that a link named the bare code, which
    # names both programs. It now carries the ONE account its own evidence
    # identifies (see link_rows_for_award), and an award whose money names
    # both members or neither links nothing, exactly as before.
    #
    # The ORGANIZATION-split keys ('20', '30', '500' — one account 0300D,
    # different organizations) stay excluded: their members share an account,
    # so account narrowing cannot tell them apart at all.
    split_rows = con.execute(
        "select pe_bli, account from dim_programs"
        " where pe_bli in (select pe_bli from dim_programs"
        "                  group by pe_bli having count(*) > 1)"
    ).fetchall()
    con.close()
    account_split, org_split = partition_split_keys(split_rows)
    display -= org_split
    print(f"excluded {len(org_split)} organization-split collision keys from"
          f" link targets: {sorted(org_split)}")
    print(f"admitted {len(account_split)} account-split collision keys as"
          f" account-qualified link targets: {sorted(account_split)}")

    # per-line account codes + org + exhibit from postgres budget_lines,
    # keyed (pe_bli, None) for an ordinary line and (pe_bli, account) once per
    # member of an account-split key — see link_rows_for_award.
    pg = psycopg.connect(DSN)
    line_meta: dict[tuple[str, str | None], dict] = {}
    for pe_bli in {s["pe_bli"] for s in surviving}:
        rows = pg.execute(
            "select distinct account, organization, exhibit from budget_lines"
            " where pe_bli=%s and account is not null", (pe_bli,),
        ).fetchall()
        for key, own in (
            [((pe_bli, None), rows)]
            + [((pe_bli, a), [r for r in rows if r[0] == a])
               for a in sorted(account_split.get(pe_bli, ()))]
        ):
            orgs = {org for _a, org, _e in own}
            exhibits = {exhibit or "" for _a, _o, exhibit in own}
            line_meta[key] = {
                "fed_accounts": fed_accounts_from_codes(a for a, _, _ in own),
                "orgs": orgs,
                "exhibit": sorted(exhibits)[0] if exhibits else "",
                "org": sorted(orgs)[0] if orgs else "",
            }

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
    gains = defaultdict(int)          # ROADMAP #70: rows per account-split key
    # (award, shared-code line) pairs the account evidence could not attribute
    # to ONE member — the award's money named both programs, or neither.
    unattributable = defaultdict(int)
    for ap, piid, rname, ruei, accts, ob in awards:
        award_accounts = set((accts or "").split(";"))
        rows = link_rows_for_award(
            ap_code=ap, piid=piid, recipient_name=rname, recipient_uei=ruei,
            award_accounts=award_accounts, obligation=ob,
            candidates=lines_by_ap[ap], line_meta=line_meta,
            account_split=account_split,
        )
        if rows:
            tiers[rows[0][9]] += 1
        for r in rows:
            if r[12]:
                gains[(r[0], r[12])] += 1
        for s in lines_by_ap[ap]:
            if s["pe_bli"] in account_split and not any(
                r[0] == s["pe_bli"] for r in rows
            ):
                unattributable[s["pe_bli"]] += 1
        out_rows.extend(rows)

    print(f"award-level tier distribution: {dict(tiers)}")
    print(f"link rows to upsert: {len(out_rows)}")
    print(f"account-split key gains (pe_bli, account): "
          f"{dict(sorted(gains.items()))}")
    print(f"account-split (award, line) pairs no account evidence could"
          f" attribute to one member: {dict(sorted(unattributable.items()))}")
    if dry:
        for r in out_rows[:5]:
            print("  sample:", r[0], r[4], r[9], r[11][:70])
        for r in [x for x in out_rows if x[12]][:5]:
            print("  split-key sample:", r[0], r[12], r[4], r[9])
        return 0

    with pg:
        cur = pg.cursor()
        cur.execute("delete from budget_line_awards where method like 'fpds-ap%'")
        # ROADMAP #70 fix round 1: `account` is not part of the unique key, so
        # the upsert below would happily move a link the announcement route
        # already published from one member's page to the other's. Stop first
        # — the raise aborts this transaction, so the delete above is rolled
        # back too and the corpus is left exactly as it was.
        raise_on_contradictory_accounts(
            stored_member_claims(cur),
            incoming_member_claims(out_rows),
            loader="derive_ap_links",
        )
        cur.executemany(
            """insert into budget_line_awards
               (pe_bli, exhibit, fiscal_year, organization, award_piid,
                recipient_name, recipient_uei, matched_obligation, method,
                confidence, score, rationale, account)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (pe_bli, exhibit, fiscal_year, award_piid)
               do update set confidence=excluded.confidence,
                             method=excluded.method, score=excluded.score,
                             rationale=excluded.rationale,
                             matched_obligation=excluded.matched_obligation,
                             account=excluded.account""",
            out_rows,
        )
    # `with pg:` closes the connection on exit (psycopg3) — count on a fresh one
    with psycopg.connect(DSN) as pg2:
        n = pg2.execute("select confidence, count(*) from budget_line_awards"
                        " where method like 'fpds-ap%' group by 1").fetchall()
        split = pg2.execute(
            "select pe_bli, account, confidence, count(*)"
            " from budget_line_awards where method like 'fpds-ap%'"
            " and account is not null group by 1,2,3 order by 1,2,3"
        ).fetchall()
    print("loaded:", n)
    print("loaded on shared BLI codes:", split)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
