#!/usr/bin/env python3
"""programs-excluded-recompute.py — gate 23 leg (h4) helper (#56 addendum).

Answers, on stdout as JSON, a question basis.mjs cannot answer in Node
without either DB access or a tautological re-read of the artifact under
test: "does every (pe_bli, title) with FY2026 money in the WAREHOUSE that is
absent from programs.json also appear in programs_excluded.json?"

Reads fct_budget_lines DIRECTLY from the duckdb warehouse — never
programs.json's or programs_excluded.json's own upstream reasoning (that
would make the gate tautological: it would only ever confirm the exporter
agrees with itself). programs.json and programs_excluded.json are read only
as the two SHIPPED ARTIFACTS being checked — membership sets, not logic.

The universe grain is (pe_bli, title): a program KEY (pe_bli) can be present
in the index (one program under that key won a #56 re-key) while a
DIFFERENT, unrelated program sharing the same key is still fully absent —
title is what actually identifies which program a row describes when a key
collides; pe_bli alone does not.

Output:
{
  "n_universe_pairs": <int>,           # distinct (pe_bli, title) pairs with FY2026 money
  "n_index_pe_blis": <int>,
  "n_disclosed": <int>,                # rows in programs_excluded.json
  "undisclosed": [                     # THE FAILURE LIST — must be empty
    {"pe_bli", "title", "amount_thousands", "why"}
  ],
  "falsely_disclosed": [               # ROADMAP #69 — the CONVERSE list,
                                       # also must be empty: money declared
                                       # absent from the index that is in fact
                                       # published by the index
    {"pe_bli", "title", "amount_thousands", "why"}
  ],
  "resolved_known_keys": [...],        # of the 10 #56 keys, which this
                                        # recompute independently confirmed
                                        # ARE correctly disclosed
}
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[3]
DUCKDB_PATH = REPO / "data" / "duckdb" / "govbudget.duckdb"
PROGRAMS_JSON = REPO / "data" / "site" / "json" / "programs.json"
PROGRAMS_EXCLUDED_JSON = REPO / "data" / "site" / "json" / "programs_excluded.json"

# #56: the ten pe_bli values known (as of the 2026-08-11 warehouse) to
# coincidentally span two real appropriation accounts within one edition.
# 9999999999 is the intentional classified sentinel — never one of these.
KNOWN_COLLISION_KEYS = {
    "0145", "1350", "2101", "2210", "2292",
    "3010", "3050", "3215", "3302", "4217",
}

TOL = 0.5  # USD thousands — float accumulation only


def main() -> int:
    for required in (DUCKDB_PATH, PROGRAMS_JSON, PROGRAMS_EXCLUDED_JSON):
        if not required.exists():
            print(json.dumps({"__error__": f"missing {required}"}))
            return 0

    programs = json.loads(PROGRAMS_JSON.read_text(encoding="utf-8"))
    index_pe_blis = {p["pe_bli"] for p in programs}
    # Task E3 (Sprint E, ROADMAP #67): index_fy26_by_pe used to be a
    # {pe_bli: fy2026_total} dict comprehension — for the 8 genuine
    # appropriation-account collisions, programs.json now carries TWO
    # entries sharing one pe_bli (E1's re-grain + this task's split pages),
    # so that comprehension silently kept only whichever entry iterated
    # last and this script would then wrongly flag the OTHER title as
    # undisclosed even though it is now a real, published page. Indexing by
    # (pe_bli, title) instead — titles are always sourced from budget_lines
    # (dim_programs.sql's matched/synth branches both read b.title), so
    # they match fct_budget_lines' own title exactly and this key is
    # unambiguous for every program, split or not.
    index_fy26_by_pair = {
        (p["pe_bli"], p["title"]): (p.get("trajectory") or {}).get("fy2026_total") or 0.0
        for p in programs
    }

    disclosed = json.loads(PROGRAMS_EXCLUDED_JSON.read_text(encoding="utf-8"))
    disclosed_pairs = {(row["pe_bli"], row["title"]) for row in disclosed}

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    try:
        rows = con.execute(
            "select pe_bli, title, sum(amount_thousands) as amt"
            " from fct_budget_lines"
            " where amount_type = 'fy_2026_total' and title is not null"
            "   and pe_bli <> '9999999999'"
            " group by pe_bli, title"
        ).fetchall()
        # ROADMAP #69: the (account, organization) slot count per key — the
        # discriminator between "this key spans two REAL programs" (>1 slot;
        # #56/#67's account axis and #45's organization axis, where one side
        # genuinely loses and must be disclosed) and "this key is one program
        # whose money spans several budget activities" (exactly 1 slot, where
        # every title belongs to the same page and disclosing any of them as
        # absent is false). Read here, not inferred from the artifacts.
        slot_rows = con.execute(
            "select pe_bli, count(distinct coalesce(account, '~')"
            "   || '|' || coalesce(organization, '~')) as n_slots"
            " from fct_budget_lines"
            " where amount_type = 'fy_2026_total' and title is not null"
            "   and pe_bli <> '9999999999'"
            " group by pe_bli"
        ).fetchall()
        # §P0-4: WHAT EXHIBITS IS THE DENOMINATOR MADE OF?
        #
        # /programs/ publishes "$228.7B of the $385.3B FY2026 request (59.4%)".
        # Both figures are cited and correct. The LABEL is not: that $385.3B is
        # P-1 + R-1 and nothing else -- procurement and RDT&E -- while the
        # FY2026 DoD request is roughly twice it. A reader is told the site
        # covers 59.4% of "the FY2026 request" when it covers 59.4% of about a
        # quarter of defense spending.
        #
        # Emitted here rather than asserted in the gate, so the gate can
        # require the page to NAME the exhibits its denominator is built from
        # without either side hardcoding which ones those are. If an O&M
        # exhibit family is ever ingested, this list grows and the gate starts
        # requiring the page to say so.
        exhibit_rows = con.execute(
            "select exhibit, sum(amount_thousands) as amt,"
            "       count(distinct pe_bli) as pes"
            " from fct_budget_lines"
            " where amount_type = 'fy_2026_total' and exhibit is not null"
            " group by exhibit order by amt desc"
        ).fetchall()
    finally:
        con.close()

    by_pe: dict[str, dict[str, float]] = defaultdict(dict)
    for pe, title, amt in rows:
        by_pe[pe][title] = float(amt)
    slots_by_pe: dict[str, int] = {pe: int(n) for pe, n in slot_rows}

    undisclosed: list[dict] = []
    # Task E3 (Sprint E, ROADMAP #67): a KNOWN #56 key is "resolved" when
    # EVERY title under it is accounted for — either disclosed (the pre-E3
    # shape, still true for the 2 keys that stayed merged: 1350, 2101) OR
    # published as its own (pe_bli, title) index entry (the NEW shape for
    # the 8 genuine collisions this sprint splits — both titles now have
    # their own real page, so neither needs disclosing at all). The old
    # definition ("resolved iff the excluded side is disclosed") went stale
    # the moment a key stopped having an excluded side.
    accounted_titles: dict[str, set[str]] = defaultdict(set)

    for pe, by_title in by_pe.items():
        if pe not in index_pe_blis:
            # (a) whole pe_bli absent from the index — every title under it
            # must be disclosed.
            for title, amt in by_title.items():
                if (pe, title) not in disclosed_pairs:
                    undisclosed.append({
                        "pe_bli": pe, "title": title, "amount_thousands": amt,
                        "why": "pe_bli has no program page and this title is"
                               " not in programs_excluded.json",
                    })
                else:
                    accounted_titles[pe].add(title)
            continue

        if len(by_title) < 2:
            accounted_titles[pe].update(by_title)
            continue  # single title under this pe_bli: it IS the index entry

        # ROADMAP #69: a key with exactly ONE (account, organization) slot is
        # ONE program; its several titles are budget-activity sub-lines of it
        # (F-15EX carries one title in BA01/BA05/BA07; HCMC00 carries two,
        # only because the Air Force relabelled its BA-07 line "Post Prod").
        # When the index total already equals every one of those titles' money
        # summed, nothing under this key is absent from the index and nothing
        # under it may be disclosed as absent — see falsely_disclosed below.
        if slots_by_pe.get(pe, 1) == 1:
            pe_universe = sum(by_title.values())
            pe_index = sum(
                v for (p, _t), v in index_fy26_by_pair.items() if p == pe
            )
            if abs(pe_universe - pe_index) < TOL:
                accounted_titles[pe].update(by_title)
                continue

        # (b) pe_bli present, but does it cover EVERY title's money? A title
        # is covered when its OWN (pe_bli, title) pair is itself a published
        # index entry (Task E3: programs.json can now carry TWO entries
        # sharing this pe_bli, one per real account — each is checked on its
        # own exact title, never a single pe_bli-level total that could only
        # ever match one of them) — OR, same as case (a), explicitly
        # disclosed.
        for title, amt in by_title.items():
            index_amt = index_fy26_by_pair.get((pe, title))
            if index_amt is not None and abs(amt - index_amt) < TOL:
                accounted_titles[pe].add(title)
                continue  # this exact (pe_bli, title) IS a published page
            if (pe, title) not in disclosed_pairs:
                undisclosed.append({
                    "pe_bli": pe, "title": title, "amount_thousands": amt,
                    "why": f"pe_bli={pe!r} has a program page, but its index"
                           f" total ({index_amt}) does not cover this"
                           f" title's own money ({amt}), and this title is"
                           " not in programs_excluded.json",
                })
            else:
                accounted_titles[pe].add(title)

    # ROADMAP #69 — the CONVERSE of `undisclosed`, and the check nobody had:
    # is anything DECLARED absent from the index actually IN it? The shipped
    # defect answered yes for $429,581K — HCMC00's and JSE000's every FY2026
    # line was listed in programs_excluded.json with reason 'key_collision'
    # ("absent from the index because their pe_bli is already a different
    # program's page") while those exact dollars were simultaneously the two
    # pages' own published FY2026 totals. Both statements cannot be true, and
    # nothing checked the second one.
    falsely_disclosed: list[dict] = []
    for pe, by_title in by_pe.items():
        if pe not in index_pe_blis:
            continue
        if slots_by_pe.get(pe, 1) != 1:
            continue  # a genuine account/organization collision: a side really
            # can be absent, and disclosing it is correct
        pe_universe = sum(by_title.values())
        pe_index = sum(v for (p, _t), v in index_fy26_by_pair.items() if p == pe)
        if abs(pe_universe - pe_index) >= TOL:
            continue  # money really is missing under this key
        for title, amt in by_title.items():
            if (pe, title) in disclosed_pairs:
                falsely_disclosed.append({
                    "pe_bli": pe, "title": title, "amount_thousands": amt,
                    "why": f"programs_excluded.json says this line is absent"
                           f" from the index, but pe_bli={pe!r}'s published"
                           f" page(s) already total {pe_index} — every dollar"
                           f" of its {pe_universe} FY2026 universe, this line"
                           " included",
                })

    resolved_known_keys = {
        pe for pe in KNOWN_COLLISION_KEYS
        if pe in by_pe and accounted_titles.get(pe, set()) == set(by_pe[pe])
    }

    print(json.dumps({
        "n_universe_pairs": sum(len(t) for t in by_pe.values()),
        "n_index_pe_blis": len(index_pe_blis),
        "n_disclosed": len(disclosed_pairs),
        "undisclosed": undisclosed,
        "falsely_disclosed": falsely_disclosed,
        "resolved_known_keys": sorted(resolved_known_keys),
        # §P0-4 — the exhibit composition of the FY2026 dollar universe.
        "universe_by_exhibit": [
            {
                "exhibit": ex,
                "amount_thousands": float(amt),
                "pe_count": int(pes),
            }
            for ex, amt, pes in exhibit_rows
        ],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
