"""Held-out precision study for the published link tiers (ROADMAP #72).

draw   : stratified random sample per method from PUBLISHED links, written as
         evidence packets (same shape the verification workflows consume).
load   : ingest adjudicator verdicts JSON -> link_precision_samples.
report : precision per method (confirmed / judged), counted under the tier
         each sampled link publishes under TODAY (see precision_by_method).

TODO (ROADMAP #72 backlog, raised by the 2026-09-04 final review, finding C2):
link_precision_samples needs a `rubric` column, and strata adjudicated under
DIFFERENT rubrics must never be reported side by side as one "precision"
number. The 2026-09-04 run proved why: every `account+subagency` verdict
reason confirms the MECHANICAL rule fired (account 097-0400, sub-agency DARPA,
PIID prefix HR0011) while every other stratum was judged on program
ATTRIBUTION — did this award pay for this program. The two questions produce
incomparable numbers, and 60/60 against the first one reads as certainty about
the second. Until the column exists, export_site._UNRUBRICKED_PRECISION_STRATA
names the offending stratum by hand and /methodology/ publishes it as
UNMEASURED. Adding a stratum to the draw obliges you to state its rubric.
"""
import json, random, sys
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[1]
DSN = "postgresql://localhost/govbudget"
# Draw strata. `fpds-ap+account` is kept so an old sample_id still reproduces,
# but the tier was withdrawn 2026-09-04 (zero rows) and draw_sample skips any
# stratum with no published rows, so a fresh draw never touches it.
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

def precision_by_method(dsn: str, sample_id: str | None = None
                        ) -> dict[str, tuple[int, int]]:
    """{published method: (confirmed, judged)} for ONE study run.

    Twin of export_site._link_precision_block — keep the two in step (see that
    docstring for the full reasoning; tests/test_export_site_link_precision.py
    asserts they agree on the same fixture).

    Two corrections from the 2026-09-04 final review:
      C1  tally by the method the link publishes under TODAY, not the one it
          carried at draw time. `fpds-ap+account` was withdrawn hours after
          the draw and its links now publish as `fpds-ap`; grouping by the
          drawn method printed a figure for a tier no reader can meet and a
          flattering one for the tier that absorbed it. Rows no longer
          published at high/medium drop out of both numerator and denominator.
      I1  read ONE sample_id (the latest by default), never pool runs — a
          re-measurement must replace the number it corrects, not average
          into it.
    """
    with psycopg.connect(dsn) as pg:
        if sample_id is None:
            row = pg.execute(
                "select max(sample_id) from link_precision_samples"
                " where verdict is not null").fetchone()
            sample_id = row[0] if row else None
        if not sample_id:
            return {}
        rows = pg.execute(
            "select b.method, count(*) filter (where s.verdict='confirmed'),"
            " count(*)"
            " from link_precision_samples s"
            " join budget_line_awards b"
            "   on b.award_piid = s.award_piid and b.pe_bli = s.pe_bli"
            " where s.sample_id = %s and s.verdict is not null"
            "   and b.confidence in ('high', 'medium')"
            " group by b.method", (sample_id,)).fetchall()
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
        # This report is the AUDIT view: every stratum, including the ones the
        # site does not publish a figure for. Marked so an operator reading it
        # never mistakes an unpublished number for one on /methodology/.
        unpublished = {"account+subagency"}   # == export_site._UNRUBRICKED_PRECISION_STRATA
        for m, (c, n) in sorted(precision_by_method(DSN).items()):
            tail = "  [NOT PUBLISHED — different rubric, see module docstring]" \
                if m in unpublished else ""
            print(f"{m:<24} {c}/{n} = {100*c/max(n,1):.1f}%{tail}")
