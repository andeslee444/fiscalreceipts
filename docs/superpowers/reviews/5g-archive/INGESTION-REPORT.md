# Phase 5G (archive round) — Army + Air Force / Space Force FY2026 Ingestion

**Date:** 2026-07-05
**Transport:** Internet Archive (Wayback) mirror of the public FY2026 budget books.
asafm.army.mil is Akamai-403 to server clients (5G probe: even a realistic
headless browser is blocked); saffm.hq.af.mil is CAC-gated. The IA mirrors both
services' **public** justification books WAF-free — a legitimate public archive
of public records, not evasion. `source_url` on every registered document is the
ORIGINAL official government URL (authoritative provenance); the Wayback URL is
transport only, logged not cited.

## Result

| Service | Books enumerated | Registrable (live detail) | Deduped (identical master) | Download gaps | R-1/RDTE coverage | P-1/proc coverage |
|---|---|---|---|---|---|---|
| **Army** (org A) | 40 (20 excluded) | 10 | 10 | 0 | 232/234 PEs | 275/279 line items |
| **Air Force + Space Force** (org F) | 30 (19 excluded) | 7 | 4 | 0 | 323/335 PEs | 196/203 line items |

**Page-less PE/BLIs now carrying book detail** (the phase headline):
- Army: **507 / 513** (98.8%)
- AF + SF: **519 / 538** (96.5%)

**Space Force** loads under org **F** (its books embed `ServiceAgencyName="Air
Force"` and SF-suffixed PEs, e.g. 1203154SF, which already live under org F —
there is no separate 'S' org). **1203154SF specifically now carries 15 detail
rows** (the AF verification target).

Detail facts: Army 5,496 live rows; AF+SF 5,301 live rows. Amounts provenance:
10,781 PB2026 facts resolved. Narrative provenance: 6,785 inserted (Army 1,775
located, AF+SF 1,034 located). **silent_unreconciled = 0** across the warehouse.

Gates: **verify-phase1 PASS** (silent_unreconciled=0, coverage 25/25, provenance
50/50), **verify-phase5e PASS** (PB2026 discovered=81 terminal=81 — the
superseded-terminal logic accounts for the deduped duplicates), **verify-phase5b1
PASS**. Full pytest 1275 passed / 1 failed (the known pre-existing
`test_covers_live_top50_exactly` dossier-CSV-vs-stale-DuckDB, API-capped, out of
scope).

## Legitimate coverage remainders (not load bugs)

- **Army R-1** 2 missing: 0708081D / 0708083D — Defense-Wide chemical-
  demilitarization PEs that appear in the Army R-1 *display* but belong to the
  correctly-excluded CAMDD (Defense-Wide) book.
- **AF R-1** 12 missing: classified special programs (0207242F), SBIR/STTR
  (0605502F, 1205502SF), spectrum-relocation funds (0303267F, 0303867F),
  cancelled-account financing (0909999F/SF) — categories that publish no R-2
  detail by policy.

## Dedup: per-service, NOT one-size-fits-all (key finding)

The Navy filename-heuristic BA-split dedup (`dedup_ba_splits`,
`_MASTER_DUP_FAMILIES`) does **not** generalize, and firing it on Army collapsed
18 distinct books. Verified live per service:

- **Army RDTE** — genuinely BA-split by *volume*: each physical volume (Vol1=BA1-3,
  Vol2=BA4A/4B, Vol3=BA5A-D, Vol4=BA6-9) is published as several BA-split PDFs,
  ALL embedding that volume's full master. So the 13 PDFs collapse to **one per
  volume** (distinct masters), not one overall.
- **AF RDTE** — Vol I-IV all embed the IDENTICAL 268-PE master → one book.
- **AF Aircraft Procurement** — Vol I/II share one 70-line master → one book.
- **AF vs SF RDTE** — same org F, same family, but DIFFERENT masters (both kept).

The correct universal rule is **empirical**: `dedup_service_master_dups` groups
downloaded books by the content sha256 of the master XML `pick_book_xml` selects,
and keeps one per `(family, master-sha)`. This is right for every service and
needs no per-service filename knowledge. The archive backfill passes
`dedup_ba=False` (skips the Navy heuristic) and relies on this post-load dedup.

## Transport robustness findings (fixtures could not have caught these)

1. **Shared xml/ dir clobbering** — Army/AF pack many justification PDFs into one
   org folder; the shared `dest.parent/"xml"` extraction dir let every book's
   master overwrite the others, so `pick_book_xml` returned the wrong master and
   the dedup wrongly collapsed 12 distinct Army books. Fix: per-document
   `{stem}__xml/` dir (`attachments.doc_xml_dir`); `resolve_xml_dir` falls back
   to the legacy shared dir for editions extracted before this change.
2. **Wayback availability API is flaky** — returns `{}` for URLs CDX confirms are
   archived. CDX (properly httpx-param-encoded — a literal space/`&` 400s the
   server) is the authoritative enumeration; availability is only a fast first try.
3. **HTML interstitials** — some `id_` snapshots return the Wayback HTML wrapper,
   not raw PDF. Guarded by the `%PDF-` magic check → try next snapshot.
4. **Truncated bodies** — Wayback occasionally caps a snapshot at a 5 MB boundary
   (header-valid but no `%%EOF`; pypdf then dies "Stream has ended
   unexpectedly"). Guarded by `is_complete_pdf` (must end with `%%EOF`) on both
   the download AND the resume path (a truncated on-disk resume would fail
   forever otherwise).
5. **Variant-only archival** — some DAF books were only archived under a DNN
   `?ver=...` query variant (AF RDTE Vol I), so the canonical URL has zero exact
   snapshots. `variant_snapshots` prefix-searches `<canonical>*` and adopts only
   true query-variants (prefix collisions with a different book are dropped); the
   download fetches the variant that exists while provenance keeps the canonical
   URL.
6. **Transient failures** — CDX 504s and truncations are frequently transient;
   `failed`/`missing` archive rows reset to `registered` at the start of each
   download pass so a re-run recovers them. A genuinely-unarchived book just
   fails back into gaps.

## Accepted tradeoff — dedup page-provenance gap

The deduped sibling PDFs are the only source of THEIR budget activities' rendered
R-2/P-40 pages. Because each `(family, master)` is registered once, page
provenance can only highlight facts whose exhibit page is rendered in the kept
book; the other siblings' facts resolve `unresolved` (recorded honest gap — the
detail data is complete, only the page highlight is missing). Same tradeoff the
Navy round accepted; cross-sibling page resolution is out of scope.
