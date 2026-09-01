"""Derive per-pair adjudicated confidence from award-level verdicts and load
migration 010's award_pe_adjudications table.

Inputs (data/research/):
  adjudication_pairs.json           piid -> {recipient, links: {pe: current_conf}}
  adjudication_award_evidence.json  piid -> lake evidence (sub_agency, ...)
  adjudication/workflow_result.json the adjudicate-award-pe-links workflow return
                                    (results[], pins_surviving[], refutations{})

Pair-tag derivation (conservative by construction — publish the smaller true number):
  award 'pinned' with surviving pin on THIS pe  -> high   (pinned-here)
  award 'pinned', this pe proposed but refuted  -> medium/low (pin-refuted)
  award 'pinned' elsewhere (surviving)          -> low    (pinned-elsewhere:<pes>)
  award 'pinned' but ALL pins refuted           -> treated as darpa_unpinned
  'darpa_unpinned'                              -> medium (unpinned-pool)
  'not_darpa'                                   -> low    (account-only)
  'contradicted'                                -> reject (contradicted)
  'insufficient'                                -> low    (insufficient-evidence)

Usage: uv run python scripts/load_award_adjudications.py [--dry-run]
"""
import csv
import json
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
DSN = "postgresql://localhost/govbudget"


def darpaish(piid: str, evidence: dict) -> bool:
    sub = (evidence.get("sub_agency") or "").lower()
    return piid.startswith("HR0011") or "advanced research projects" in sub


def main() -> int:
    dry = "--dry-run" in sys.argv
    pairs = json.load(open(RESEARCH / "adjudication_pairs.json"))
    ev = json.load(open(RESEARCH / "adjudication_award_evidence.json"))
    wf = json.load(open(RESEARCH / "adjudication" / "workflow_result.json"))

    verdicts = {r["piid"]: r for r in wf["results"]}
    surviving = set(wf["pins_surviving"])  # "piid|pe"

    missing = [p for p in pairs if p not in verdicts]
    if missing:
        print(f"FATAL: {len(missing)} awards missing a verdict: {missing[:10]}")
        return 1

    rows = []
    for piid, p in sorted(pairs.items()):
        v = verdicts[piid]
        verdict = v["verdict"]
        best = set(v.get("best_pes") or [])
        alive = {pe for pe in best if f"{piid}|{pe}" in surviving}
        if verdict == "pinned" and not alive:
            verdict_eff = "darpa_unpinned" if darpaish(piid, ev[piid]) else "not_darpa"
        else:
            verdict_eff = verdict
        for pe in p["links"]:
            basis = v.get("basis") or ""
            evq = (v.get("evidence") or "")[:400]
            note = (v.get("note") or "")[:400]
            lenses = None
            if verdict_eff == "pinned":
                if pe in alive:
                    conf, reason, lenses = "high", "pinned-here", 2
                elif pe in best:
                    conf = "medium" if darpaish(piid, ev[piid]) else "low"
                    reason = "pin-refuted"
                else:
                    conf, reason = "low", "pinned-elsewhere:" + ",".join(sorted(alive))
            elif verdict_eff == "darpa_unpinned":
                conf, reason = "medium", "unpinned-pool"
            elif verdict_eff == "not_darpa":
                conf, reason = "low", "account-only"
            elif verdict_eff == "contradicted":
                conf, reason = "reject", "contradicted"
            else:  # insufficient
                conf, reason = "low", "insufficient-evidence"
            rows.append((piid, pe, conf, verdict, reason, basis, evq, note, lenses))

    out_csv = RESEARCH / "adjudication" / "adjudicated_pairs.csv"
    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["award_piid", "pe_bli", "adjudicated_confidence", "award_verdict",
                    "pair_reason", "basis", "evidence", "note", "refuter_lenses_passed"])
        w.writerows(rows)

    from collections import Counter
    dist = Counter(r[2] for r in rows)
    print(f"{len(rows)} pairs derived -> {out_csv.name}; tags: {dict(dist)}")

    # precision of the previously published high tier
    prev_high = [(piid, pe) for piid, p in pairs.items() for pe, c in p["links"].items() if c == "high"]
    confirmed = sum(1 for piid, pe in prev_high
                    if next(r for r in rows if r[0] == piid and r[1] == pe)[2] == "high")
    print(f"previous high tier: {confirmed}/{len(prev_high)} confirmed high "
          f"({100 * confirmed / len(prev_high):.1f}% measured precision)")

    if dry:
        return 0
    with psycopg.connect(DSN) as pg:
        pg.execute("delete from award_pe_adjudications where method='hand-adjudication-v1'")
        pg.cursor().executemany(
            """insert into award_pe_adjudications
               (award_piid, pe_bli, adjudicated_confidence, award_verdict,
                pair_reason, basis, evidence, note, refuter_lenses_passed)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (award_piid, pe_bli) do update set
                 adjudicated_confidence=excluded.adjudicated_confidence,
                 award_verdict=excluded.award_verdict,
                 pair_reason=excluded.pair_reason,
                 basis=excluded.basis, evidence=excluded.evidence,
                 note=excluded.note,
                 refuter_lenses_passed=excluded.refuter_lenses_passed""",
            rows,
        )
        pg.commit()
        n = pg.execute("select count(*) from award_pe_adjudications").fetchone()[0]
    print(f"loaded {n} adjudication rows into postgres")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
