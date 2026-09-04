"""Load wave-verified announcement-derived (award, PE) links into budget_line_awards.

Evidence chain per link: an official defense.gov daily Contracts announcement
names BOTH the contract number and the program; the program name is one the
PE's own J-book narrative owns (lexicon 'own' entry with verbatim quote);
the pair survived agent triage AND an adversarial refute pass. Published at
'high' with method 'announcement+lexicon'; rationale carries the article
provenance (id/date/url) so the citation panel can point at the source.

Exclusions mirror derive_ap_links.py: display-universe only, no collision
keys (dim_programs >1 row), no synthetic -L rollup keys.

Usage: uv run python scripts/load_announcement_links.py <wave_result.json>... [--dry-run]
"""
import json
import re
import sys
from pathlib import Path

import duckdb
import psycopg

# Catch-all budget lines ("Items Less Than $5 Million", "Ordnance Items <$5M",
# "Other Support Aircraft") are aggregates, not programs: a link asserting an
# award executes "Items Less Than $5 Million" is content-free, and the $ in
# the title trips the site's currency-in-prose sweep. Never link targets.
CATCHALL_TITLE = re.compile(r"(less than|under|<)\s*\$|^other\b|^miscellaneous", re.I)

ROOT = Path(__file__).resolve().parents[1]
DSN = "postgresql://localhost/govbudget"
ANN_URL = "https://www.defense.gov/News/Contracts/Contract/Article/{id}/"


def main() -> int:
    dry = "--dry-run" in sys.argv
    paths = [a for a in sys.argv[1:] if not a.startswith("--")]
    surviving = []
    for path in paths:
        surviving.extend(json.load(open(path))["surviving"])

    con = duckdb.connect(str(ROOT / "data/duckdb/govbudget.duckdb"), read_only=True)
    display = {r[0] for r in con.execute("select distinct pe_bli from dim_programs").fetchall()}
    collisions = {r[0] for r in con.execute(
        "select pe_bli from dim_programs group by pe_bli having count(*) > 1").fetchall()}
    con.close()
    synthetic = re.compile(r"-L\d+$")
    with psycopg.connect(DSN) as pg0:
        titles = pg0.execute("select pe_bli, title from budget_lines where title is not null").fetchall()
    catchall = {pe for pe, t in titles if CATCHALL_TITLE.search(t or "")}
    display -= catchall

    # article provenance per (piid, pe) from the wave packets
    prov = {}
    for d in sorted((ROOT / "data/research/announcements").glob("wave*_chunks")):
        for f in sorted(d.glob("chunk_*.json")):
            for p in json.load(open(f)):
                prov.setdefault((p["piid"], p["pe_bli"]), p)

    pairs = []
    skipped = {"not_display_or_catchall": 0, "collision": 0, "synthetic": 0}
    for s in surviving:
        pe, piid = s["pe_bli"], s["piid"]
        if synthetic.search(pe): skipped["synthetic"] += 1; continue
        if pe in collisions: skipped["collision"] += 1; continue
        if pe not in display: skipped["not_display_or_catchall"] += 1; continue
        pairs.append((piid, pe, s.get("reason", "")))
    print(f"surviving {len(surviving)} -> publishable {len(pairs)}; skipped {skipped}")

    # lake evidence for recipients/obligations
    piids = sorted({p for p, _, _ in pairs})
    lake = duckdb.connect()
    lake.execute("create temp table want(piid varchar)")
    lake.executemany("insert into want values (?)", [(p,) for p in piids])
    ev = {r[0]: r[1:] for r in lake.execute(f"""
        select award_id_piid, any_value(recipient_name), any_value(recipient_uei),
               sum(try_cast(federal_action_obligation as double))
        from read_parquet('{ROOT}/data/parquet/contracts/fy=*/*.parquet', union_by_name=true)
        where award_id_piid in (select piid from want) group by 1""").fetchall()}
    lake.close()

    pg = psycopg.connect(DSN)
    line_meta = {}
    for pe in {pe for _, pe, _ in pairs}:
        r = pg.execute("select min(exhibit), min(organization) from budget_lines where pe_bli=%s", (pe,)).fetchone()
        line_meta[pe] = (r[0] or "", r[1] or "")

    rows = []
    for piid, pe, reason in pairs:
        rname, ruei, ob = ev.get(piid, (None, None, None))
        if rname is None:
            # the lake does not hold this PIID (formatting variant or pre-FY17
            # award): a link the site cannot back with transactions is not
            # published — counted below, never inserted with a null recipient
            continue
        p = prov.get((piid, pe), {})
        aid = p.get("article_id")
        rationale = (f"defense.gov contract announcement {aid} ({p.get('date')}): "
                     f"program '{p.get('program_name')}' named for this award "
                     f"[match basis: {p.get('match_basis') or 'exact-name'}]; "
                     f"J-book narrative owns it ({p.get('lexicon_doc')}); "
                     f"triage+adversarial refute survived — {reason[:160]}; "
                     f"url={ANN_URL.format(id=aid)}")
        ex, org = line_meta[pe]
        # Subaward-derived evidence is one hop removed (a sub's description
        # says what the prime is for): publishes at MEDIUM under its own
        # method so the tier states the evidence species.
        if (p.get("match_basis") or "") == "subaward-description-exact":
            method, conf = "subaward+lexicon", "medium"
            rationale = rationale.replace("defense.gov contract announcement None (None)",
                                          f"FSRS subaward {p.get('subaward_number')} ({p.get('subawardee')})")
        else:
            method, conf = "announcement+lexicon", "high"
        rows.append((pe, ex, 2026, org, piid, rname, ruei, ob, method, conf, 2, rationale))
    print(f"rows to upsert: {len(rows)}; distinct PEs: {len({r[0] for r in rows})}; "
          f"skipped for no lake evidence: {len(pairs) - len(rows)}")
    if dry:
        for r in rows[:3]: print("  sample:", r[0], r[4], r[5], "|", r[11][:110])
        return 0
    with pg:
        cur = pg.cursor()
        cur.execute("delete from budget_line_awards where method in ('announcement+lexicon','subaward+lexicon')")
        cur.executemany(
            """insert into budget_line_awards
               (pe_bli, exhibit, fiscal_year, organization, award_piid, recipient_name,
                recipient_uei, matched_obligation, method, confidence, score, rationale)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (pe_bli, exhibit, fiscal_year, award_piid) do update set
                 confidence=excluded.confidence, method=excluded.method,
                 score=excluded.score, rationale=excluded.rationale,
                 matched_obligation=excluded.matched_obligation""", rows)
    with psycopg.connect(DSN) as pg2:
        print("loaded:", pg2.execute("select method, confidence, count(*) from budget_line_awards"
                                     " where method in ('announcement+lexicon','subaward+lexicon') group by 1,2").fetchall())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
