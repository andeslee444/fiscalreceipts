#!/usr/bin/env python3
"""volumes-recompute.py — gate 14 leg (cv) / leg (cr) helper.

Answers, on stdout as JSON, the ONE question the coverage gate cannot answer
in Node: of the FY2026 justification volumes SITTING IN THIS REPO, how much
has the ingestion actually parsed?

Why this exists. /coverage/ published, for months, that the program pages
without R-2/P-40 detail were missing it because "the services publish no
matching R-2/P-40 justification" and that "the missing volumes do not exist
publicly". Both sentences were false at the moment they shipped: the volumes
were downloaded, in this repository, unparsed. Every NUMBER on that page was
recomputed and correct; the false claim rode in the prose beside them, where
no number-vs-citation gate could see it.

So this leg checks a CLAIM DIRECTION against the world, not a figure against
its citation.

INGESTED MEANS THE CONTENT, NOT THE FILENAME (corrected 2026-08-29). The
first version of this script reconciled `rel_path` presence in
documents.parquet against the raw tree, and while five of the six Navy
procurement appropriations went unparsed that was a faithful proxy: an
absent filename meant absent facts. It stopped being one the moment those
books were parsed. The services publish the SAME justification book under
several volume covers — the FY2026 Army RDT&E Vol 4 PDFs for budget
activities 6, 7, 8 and 9 embed one byte-identical master XML between them,
as do the four Air Force RDT&E volumes and the Navy APN and OPN
budget-activity books. Only one of each set is registered as a document,
because registering more would load the identical master several times over
(dedup_service_master_dups). Counting the other covers as "unparsed volumes"
would make /coverage/ confess a backlog that does not exist and would make
/agency/ name whichever service happens to print the most duplicate covers
as its most-understated row — the correction rotting into the opposite
error, which is precisely what leg cv's symmetry exists to prevent.

So a file on disk is INGESTED when the lake carries the justification book
it embeds:

  on disk    = every file under data/raw_docs/fy2026/{org}/ whose extension
               is one the ingestion actually consumes (derived from the
               extensions present in documents.parquet — never a literal
               list, so a new source format cannot silently escape the
               reconciliation)
  registered = rel_path values in data/parquet/jbooks/documents.parquet
               for fiscal_year 2026
  duplicate  = not registered, but the sha256 of the master justification
               XML it embeds equals that of a REGISTERED file in the same
               org — the same book under another cover, already parsed
  unparsed   = neither: content this repo holds and has not loaded

Verified independently before this rule was written (2026-08-29), by
comparing the union of ProgramElement/LineItem identities across EVERY
justification XML each of the 20 duplicate volumes embeds — not only the
one `pick_book_xml` selects — against the registered twin's master: 0 of 20
carry a single fact identity the parsed twin does not. Army Vol 4 BA-9
carries 66 identities; its BA-6 twin carries the same 66.

Read from the RAW download tree and the STAGED lake — both upstream of
site_meta, programs_excluded.json and every sidecar /coverage/ renders from.
Reading any of those here would make the leg tautological: the exporter
would be marking its own homework.

Output:
{
  "fiscal_year": 2026,
  "on_disk": 81, "ingested": 81, "duplicate": 20, "unparsed": 0,
  "by_org": {"n": {"on_disk": 13, "registered": 7, "duplicate": 6,
                   "ingested": 13, "unparsed": 0}, ...},
  "unparsed_orgs": [],
  "sample_unparsed": []
}

`unparsed_orgs` is sorted; `sample_unparsed` is capped so a gate failure
message stays readable.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

FISCAL_YEAR = "2026"
SAMPLE_CAP = 12

# The justification-book XML families the loader consumes. A duplicate is
# established on these files only — the companion spreadsheets every book
# ships (Exhibit_P-1D, R3_overview, Delivery_Schedule_Wall_Chart) are the
# same bytes in every volume and would make every book look like every
# other one.
_BOOK_PREFIXES = ("U_RDTE_", "U_PROCUREMENT_", "PROC_", "RDTE_")


def _repo_root() -> Path:
    # site/scripts/gates/ -> site/scripts -> site -> repo root
    return Path(__file__).resolve().parents[3]


def _xml_dir(pdf: Path) -> Path:
    """The extraction dir for one PDF: the per-document dir when it exists,
    else the legacy shared org-level one. Same precedence
    govbudget.jbooks.attachments.resolve_xml_dir uses; re-derived here rather
    than imported so this helper stays runnable against a raw tree alone."""
    per_doc = pdf.parent / f"{pdf.stem}__xml"
    return per_doc if per_doc.is_dir() else pdf.parent / "xml"


def _book_shas(pdf: Path) -> frozenset[str]:
    """sha256 of the MASTER justification-book XML(s) this PDF embeds.

    Master (`_MJB_`) first, volume (`_JB_`) only if the book ships no master,
    and every book XML as a last resort — the same precedence
    `govbudget.jbooks.attachments.pick_book_xml` applies, because the master
    is the file the loader consumes and therefore the file whose presence in
    the lake decides whether this PDF's facts are loaded. A SET rather than
    one pick, so an org folder holding both an R-2 and a P-40 book (the
    defense-wide agencies do) is compared on both.

    Volume-level `_JB_` files are deliberately NOT part of the comparison
    when a master exists: sibling volumes carry DIFFERENT `_JB_` bytes (Army
    Vol 4 BA-6 ships a 912,919-byte one, BA-9 a 391,949-byte one) while
    sharing one 3,557,451-byte master, so requiring byte equality on them
    would call every duplicate unparsed. That they add no facts is not
    assumed: it was measured once, per file, over the union of
    ProgramElement/LineItem identities in EVERY justification XML each of the
    20 duplicates embeds — 0 of 20 carried an identity its parsed twin's
    master does not (2026-08-29)."""
    d = _xml_dir(pdf)
    if not d.is_dir():
        return frozenset()
    books = [x for x in sorted(d.glob("*.xml"))
             if x.name.upper().startswith(_BOOK_PREFIXES)]
    if not books:
        return frozenset()
    for marker in ("_MJB_", "_JB_"):
        marked = [x for x in books if marker in x.name]
        if marked:
            books = marked
            break
    return frozenset(hashlib.sha256(x.read_bytes()).hexdigest() for x in books)


def main() -> int:
    root = _repo_root()
    raw_dir = root / "data" / "raw_docs" / f"fy{FISCAL_YEAR}"
    docs_pq = root / "data" / "parquet" / "jbooks" / "documents.parquet"

    # A checkout without the raw tree or the staged lake cannot answer the
    # question. Say so explicitly rather than reporting a fabricated zero —
    # "unparsed: 0" is exactly the answer that would let the false claim back
    # onto the page.
    if not raw_dir.is_dir():
        print(json.dumps({"__skip__": f"no raw_docs tree at {raw_dir}"}))
        return 0
    if not docs_pq.exists():
        print(json.dumps({"__skip__": f"no documents.parquet at {docs_pq}"}))
        return 0

    try:
        import duckdb
    except ImportError as e:  # pragma: no cover - environment guard
        print(json.dumps({"__error__": f"duckdb unavailable: {e}"}))
        return 0

    con = duckdb.connect()
    try:
        pq = str(docs_pq).replace("'", "''")
        rows = con.execute(
            f"select rel_path from read_parquet('{pq}')"
            f" where fiscal_year = '{FISCAL_YEAR}' and rel_path is not null"
        ).fetchall()
    finally:
        con.close()

    registered = {r[0] for r in rows}
    # The extensions the ingestion demonstrably consumes, derived rather than
    # listed: today {.pdf, .xlsx}. A .csv source added upstream would join the
    # reconciliation automatically instead of being quietly exempt from it.
    exts = {os.path.splitext(p)[1].lower() for p in registered if os.path.splitext(p)[1]}
    if not exts:
        print(json.dumps({"__error__": "documents.parquet holds no FY2026 rel_paths"}))
        return 0

    by_org: dict[str, dict[str, int]] = {}
    unparsed_files: list[str] = []
    duplicate_total = 0
    on_disk_total = 0

    for org_dir in sorted(p for p in raw_dir.iterdir() if p.is_dir()):
        org = org_dir.name
        files = sorted(
            f for f in org_dir.iterdir()
            if f.is_file() and f.suffix.lower() in exts
        )
        if not files:
            continue
        rel_of = {f: f"fy{FISCAL_YEAR}/{org}/{f.name}" for f in files}
        # Books this org already has in the lake, by embedded-XML sha set.
        parsed_shas: set[str] = set()
        for f in files:
            if rel_of[f] in registered:
                parsed_shas |= _book_shas(f)

        n_registered = n_duplicate = 0
        missing: list[str] = []
        for f in files:
            if rel_of[f] in registered:
                n_registered += 1
                continue
            shas = _book_shas(f)
            if shas and shas <= parsed_shas:
                n_duplicate += 1
            else:
                missing.append(rel_of[f])

        by_org[org] = {
            "on_disk": len(files),
            "registered": n_registered,
            "duplicate": n_duplicate,
            "ingested": n_registered + n_duplicate,
            "unparsed": len(missing),
        }
        unparsed_files.extend(missing)
        duplicate_total += n_duplicate
        on_disk_total += len(files)

    print(
        json.dumps(
            {
                "fiscal_year": int(FISCAL_YEAR),
                "on_disk": on_disk_total,
                "ingested": on_disk_total - len(unparsed_files),
                "duplicate": duplicate_total,
                "unparsed": len(unparsed_files),
                "by_org": by_org,
                "unparsed_orgs": sorted(
                    o for o, v in by_org.items() if v["unparsed"] > 0
                ),
                "sample_unparsed": sorted(unparsed_files)[:SAMPLE_CAP],
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
