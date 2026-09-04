"""Deterministic candidate mining for the J-book program-name lexicon.

For each PE, harvest candidate program-name strings from detail_narratives:
  - narrative/project TITLES (highest signal: a title names the PE's own work)
  - acronym definitions in bodies: "Long Name (ACRO)"
  - system designators in titles/bodies: F-35, CH-53K, DDG 1000, AN/SPY-6 ...
Each candidate carries a quote (the title itself, or +-120 chars of body
context) so downstream LLM validation and the peer session's verification can
grade the evidence chain without re-reading the corpus.

Exclusions per the cross-session contract (2026-09-01): synthetic '-L<n>'
rollup keys are skipped outright; collision pe_blis (dim_programs >1 row) are
kept but stamped ambiguous_key=true.

Output: data/research/lexicon/candidates/chunk_NN.json  (~80 PEs per chunk)
"""
import json
import re
from collections import defaultdict
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "research" / "lexicon"

SYNTHETIC = re.compile(r"-L\d+$")
ACRO_DEF = re.compile(
    r"\b([A-Z][A-Za-z0-9&/.-]*(?:[ -][A-Z0-9][A-Za-z0-9&/.-]*){1,7})\s+\(([A-Z]{2,10}[0-9]{0,3})\)"
)
DESIGNATOR = re.compile(
    r"\b(?:AN/[A-Z]{3}-\d{1,3}[A-Z]?|[A-Z]{1,4}-\d{1,4}[A-Z]?|(?:DDG|CVN|SSN|SSBN|LPD|LHA|LCS|FFG|T-AO)\s?\d{2,4})\b"
)
TITLE_JUNK = re.compile(
    r"^(accomplishments|plans|title|description|articulat|congressional|program change|"
    r"other program funding|acquisition strategy|performance metrics|n/a|none)\b", re.I)


def main() -> None:
    con = duckdb.connect()
    rows = con.execute("""
        select pe_bli, org, kind, title, body, document_id
        from read_parquet('data/parquet/jbooks/detail_narratives.parquet')
    """).fetchall()
    warehouse = duckdb.connect(str(ROOT / "data/duckdb/govbudget.duckdb"), read_only=True)
    collisions = {r[0] for r in warehouse.execute(
        "select pe_bli from dim_programs group by pe_bli having count(*) > 1").fetchall()}
    display = {r[0] for r in warehouse.execute(
        "select distinct pe_bli from dim_programs").fetchall()}
    warehouse.close()

    per_pe: dict[str, dict] = defaultdict(lambda: {"candidates": {}})
    n_skipped = 0
    for pe, org, kind, title, body, doc_id in rows:
        if not pe or SYNTHETIC.search(pe) or pe not in display:
            n_skipped += 1
            continue
        slot = per_pe[pe]
        slot["org"] = org
        cands = slot["candidates"]

        def add(name: str, source: str, quote: str, doc=doc_id):
            name = " ".join(name.split())
            if len(name) < 3 or len(name) > 90:
                return
            key = name.lower()
            c = cands.setdefault(key, {"name": name, "sources": [], "quotes": []})
            if len(c["quotes"]) < 3:
                c["sources"].append(source)
                c["quotes"].append({"q": quote[:220], "doc_id": doc})

        t = (title or "").strip()
        if t and not TITLE_JUNK.match(t):
            add(t, "title", t)
            for m in DESIGNATOR.finditer(t):
                add(m.group(0), "designator-title", t)
        b = body or ""
        for m in ACRO_DEF.finditer(b):
            ctx = b[max(0, m.start() - 60):m.end() + 60]
            add(f"{m.group(1)} ({m.group(2)})", "acronym-def", ctx)
            add(m.group(2), "acronym", ctx)
        for m in DESIGNATOR.finditer(b[:4000]):
            ctx = b[max(0, m.start() - 90):m.end() + 90]
            add(m.group(0), "designator-body", ctx)

    pes = sorted(per_pe)
    print(f"{len(pes)} PEs with candidates ({n_skipped} rows skipped); "
          f"{sum(len(per_pe[p]['candidates']) for p in pes):,} raw candidates")

    chunks_dir = OUT / "candidates"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    CH = 80
    for i in range(0, len(pes), CH):
        chunk = {}
        for pe in pes[i:i + CH]:
            slot = per_pe[pe]
            chunk[pe] = {
                "org": slot.get("org"),
                "ambiguous_key": pe in collisions,
                "candidates": sorted(slot["candidates"].values(), key=lambda c: c["name"]),
            }
        with open(chunks_dir / f"chunk_{i//CH:02d}.json", "w") as f:
            json.dump(chunk, f, indent=0)
    print(f"wrote {(len(pes)+CH-1)//CH} chunks to {chunks_dir}")


if __name__ == "__main__":
    main()
