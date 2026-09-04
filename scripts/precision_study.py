"""Held-out precision study for the published link tiers (ROADMAP #72).

draw   : stratified random sample per method from PUBLISHED links, written as
         evidence packets (same shape the verification workflows consume).
load   : ingest adjudicator verdicts JSON -> link_precision_samples.
report : precision per method (confirmed / judged).
"""
import json, random, sys
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[1]
DSN = "postgresql://localhost/govbudget"
METHODS = ("fpds-ap+account", "fpds-ap", "announcement+lexicon", "subaward+lexicon",
           "account+subagency")

def draw_sample(dsn: str, per_method: int = 60, seed: int = 20260904) -> list[dict]:
    rng = random.Random(seed)
    out = []
    with psycopg.connect(dsn) as pg:
        for m in METHODS:
            rows = pg.execute(
                "select award_piid, pe_bli, recipient_name, rationale from budget_line_awards"
                " where method=%s and confidence in ('high','medium')"
                " order by award_piid, pe_bli", (m,)).fetchall()
            if not rows:
                continue
            pick = rows if len(rows) <= per_method else rng.sample(rows, per_method)
            out += [{"method": m, "piid": r[0], "pe_bli": r[1],
                     "recipient": r[2], "rationale": r[3]} for r in sorted(pick)]
    return out

def load_verdicts(dsn: str, sample_id: str, verdicts_path: Path) -> int:
    v = json.load(open(verdicts_path))          # [{piid, pe_bli, method, verdict, reason}]
    with psycopg.connect(dsn) as pg:
        pg.cursor().executemany(
            """insert into link_precision_samples
               (sample_id, award_piid, pe_bli, method, verdict, reason, adjudicated_at)
               values (%s,%s,%s,%s,%s,%s, now())
               on conflict (sample_id, award_piid, pe_bli) do update set
                 verdict=excluded.verdict, reason=excluded.reason, adjudicated_at=now()""",
            [(sample_id, x["piid"], x["pe_bli"], x["method"], x["verdict"], x.get("reason")) for x in v])
        pg.commit()
    return len(v)

def precision_by_method(dsn: str) -> dict[str, tuple[int, int]]:
    with psycopg.connect(dsn) as pg:
        rows = pg.execute(
            "select method, count(*) filter (where verdict='confirmed'),"
            " count(*) filter (where verdict is not null)"
            " from link_precision_samples group by method").fetchall()
    return {m: (c, n) for m, c, n in rows}

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "draw":
        s = draw_sample(DSN)
        out = ROOT / "data/research/precision" / "sample_packets.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        json.dump(s, open(out, "w"), indent=0)
        print(f"{len(s)} packets -> {out}")
    elif cmd == "load":
        print("loaded", load_verdicts(DSN, sys.argv[2], Path(sys.argv[3])))
    elif cmd == "report":
        for m, (c, n) in precision_by_method(DSN).items():
            print(f"{m:<24} {c}/{n} = {100*c/max(n,1):.1f}%")
