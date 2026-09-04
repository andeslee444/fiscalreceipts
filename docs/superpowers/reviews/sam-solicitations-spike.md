# SAM.gov solicitations — a negative result (spike, 2026-09-04)

**Outcome: solicitation text does not carry DoD program-element (PE) codes at
a usable rate, and there is no acquisition lane here.** Direct PE-code
queries against SAM.gov's live search index return zero for all five sampled
codes. Prose queries built from unambiguous procurement program names (KC-46A,
Virginia class, GMLRS) return hundreds to hundreds of thousands of hits, but a
full-text regex scan of 75 of those hits' description bodies — plus two
complete archived FBO-era solicitation pages fetched from the Wayback Machine
(including a real Army RFI, Lethal Miniature Aerial Missile System,
`W31P4Q19R0031`, with substantial technical prose) and the FBO portal
homepage capture — found **zero** PE-code-shaped tokens anywhere. This is
consistent with the prior finding that PE numbers appear in only 15 of ~20M
award descriptions and 0 of 1.6M subaward descriptions: the folk method of
citing a PE code doesn't show up in the text DoD contracting offices actually
publish, at any layer probed so far.

This document exists so the path is not re-probed from scratch.

## The question

Prior probe notes (another session) found the official, key-gated SAM.gov
Opportunities API (`api.sam.gov`) out of reach without credentials, but
noted that `sam.gov/api/prod/sgs/v1/search` — the unauthenticated endpoint
that backs the SAM.gov website's own search box — answers without a key.
Bare PE-code queries against it returned 0; loose queries were noise. The
question this spike closes out: does solicitation text, either on live
SAM.gov or in the FBO-era archive (SAM.gov's predecessor, reachable via the
Wayback Machine), expose PE codes at a rate that would justify building a
PE→solicitation join into the crosswalk?

## Method

- Script: `scripts/probe_sam_solicitations.py`. Read-only, no credentials, no
  CAPTCHA bypass. User-Agent `fiscalreceipts-spike/1.0 (research probe;
  contact: andes.lee444@gmail.com)`, ≥1s between requests. Every request and
  response summary (params, HTTP status, `totalElements`, sample titles, and
  any PE-code-shaped hits found in scanned text) is appended to
  `data/research/sam_spike/probe_log.jsonl` (32 log entries from the final
  run, including retries).
- Step 1 is the task brief's probe code verbatim, run unmodified:
  `q="0604800F"`, `q="\"0604800F\""`, `q="F-35 EMD"`, and
  `q="program element 0604800F"` against `index=opp` on
  `https://sam.gov/api/prod/sgs/v1/search/`.
- Step 2 extends the same bare / quoted / `"program element X"` pattern
  across four more PE codes spread over services: `0604262N` (V-22, Navy),
  `0603286E` (DARPA), `0605018A` (IPPS-A, Army), `0101126F` (B-1B, Air
  Force).
- Step 3 runs three procurement BLI titles as prose — `"KC-46A"`, `"Virginia
  class"`, `"GMLRS"` — at `is_active=false` (historical) and `is_active=true`
  (active only), `size=10`, and regex-scans every returned record's
  `descriptions[].content` + `title` for PE-code-shaped tokens
  (`\b\d{7}[A-Z]\b` — matches the 7-digit + service-letter shape of all five
  sampled codes, not just those five literally).
- Step 3b runs the bare phrase `"program element"` at `size=25` and scans the
  same way, to check whether the folk phrase itself co-occurs with an actual
  code even when not anchored to one of our five samples.
- Step 4 is the brief's exact Wayback CDX probe:
  `http://web.archive.org/cdx/search/cdx?url=fbo.gov/index*&filter=statuscode:200&limit=20`,
  with up to 2 archived snapshots fetched and scanned.
- Step 4b extends the CDX probe to target individual FBO **notice-detail**
  pages rather than the homepage (`url=fbo.gov&matchType=domain&filter=
  original:.*mode=form.*s=opportunity.*`), since `fbo.gov/index*` only
  matches FBO's portal homepage, not solicitation content. Two clean
  (non-malformed) rows fetched and scanned.
- 503s from the Internet Archive during the probing window (`web.archive.org`
  intermittently returned "Temporarily Offline") were retried with
  exponential backoff (2s/4s/8s, 3 attempts); this is IA-side and resolved on
  retry, not evidence of a blocked path.

## Findings

**1. Bare and quoted PE-code queries return zero, for every code sampled.**
All five: `0604800F`, `0604262N`, `0603286E`, `0605018A`, `0101126F` — bare
and double-quoted, `is_active=false` — return `totalElements: 0`. Ten queries,
zero hits, no exceptions across services (Air Force, Navy, DARPA, Army).

**2. `"program element {CODE}"` at `is_active=all` is not a working query —
it's an API bug in the brief's own probe pattern, not a content signal.** All
five instances (the original plus four extended) return HTTP 400 Bad
Request. `is_active` only accepts `true`/`false`; `all` 400s reliably
(confirmed as a positive control: `is_active=true` on other queries returns
200 normally). This means the brief's fourth test case never actually probed
anything — worth knowing before anyone reuses that query shape.

**3. Prose queries on unambiguous program names return real hits, but noisy
ones.** `F-35 EMD` → 3,730 results, top hit "F135 ECU EMD" (the F135 engine's
Electronic Control Unit — EMD here reads as an unrelated acronym collision,
not "Engineering and Manufacturing Development"). `KC-46A` → 215
(`is_active=false`) / 4 (`true`). `Virginia class` → 288,114 / 3,397 — three
orders of magnitude noisier than KC-46A, because "class" and "Virginia" both
match broadly (shower-door and emergency-call-list notices show up). `GMLRS`
→ 101 / 1. The bare phrase `"program element"` → 688,268 results, top hits
are NASA Research Announcement amendments — the engine does not appear to
enforce exact-phrase matching on quoted input (a very literal two-word AND/OR
match, not the "PE code in context" signal the brief's test intended).

**4. Zero PE-code-shaped tokens in 75 scanned solicitation-description
records.** Every hit from findings 1 and 3 whose response included
description text (75 records total, across `F-35 EMD`, the six BLI-title
queries, and the `"program element"` phrase query) was regex-scanned for the
general PE-code shape (7 digits + a service letter — not limited to the five
sampled codes). Zero matches.

**5. Zero PE-code-shaped tokens in real archived FBO solicitation text,
including a genuine DoD RFI.** The brief's literal Wayback CDX query
(`fbo.gov/index*`) only matches FBO's portal homepage — not useful
solicitation content, and its one distinct archived capture (2008-09-25,
6,342 bytes) has none, as expected. The extended CDX query targeting
notice-detail URLs (`mode=form&s=opportunity`) found real archived
solicitations, confirming the mechanism (Wayback → FBO notice text) works:
a NASA "Human Landing System" solicitation (`NNH19ZCQ001K_APP-E`,
2019-07-25, 48,611 bytes) and an Army "Request for Information for the
Lethal Miniature Aerial Missile System (LMAMS)" (`W31P4Q19R0031`, Army
Contracting Command, 2019-09-20, 37,132 bytes) — a substantive, real DoD
acquisition document with technical and access-control prose. Neither
contains a PE-code-shaped token.

**6. What's actually indexed here is the notice summary, not the
solicitation package.** The `sgs/v1/search` record schema (`_id`, `_index`,
`descriptions`, `title`, `solicitation`, `psc`, `naics`, `pointOfContacts`,
etc.) has no attachment or resource-link field — the searchable/scannable
text is the notice synopsis, not attached SOW/PWS/RFP documents, which on
live SAM.gov require either the key-gated `api.sam.gov` Opportunities API or
manual download via the (JS-rendered, account-gated for some material)
sam.gov opportunity page. This spike could not and did not check attachment
text.

## What would change the verdict

- A sampled solicitation's **attachment** (SOW/PWS/RFP PDF, not the notice
  synopsis) is checked and found to carry PE codes at a nontrivial rate —
  requires either an `api.sam.gov` key or manual download, both out of scope
  for this unauthenticated spike.
- A much larger, DoD-agency-filtered sample of archived FBO notice-detail
  pages (dozens to hundreds, not 2) turns up PE codes — CDX has no full-text
  search, so this would mean either blind sampling at volume or finding a
  bulk FBO archive dump (e.g., a data.gov historical extract) rather than
  page-by-page Wayback fetches.
- SAM.gov ships a genuine phrase-search or field-level query (e.g.
  `program_element:0604800F`) that this ad hoc `sgs/v1/search` endpoint
  doesn't expose — worth a five-minute recheck if SAM.gov's search UI or API
  visibly changes, but not worth actively monitoring for.

## Implications

- This closes the loop opened by the File D/File C findings
  (`docs/superpowers/reviews/filec-program-activity-spike.md`) and the prior
  award/subaward description grep (15/~20M, 0/1.6M): PE codes are not a folk
  citation convention that shows up in the text government systems actually
  publish and index — not in award descriptions, not in subaward
  descriptions, not in solicitation notice text (live or FBO-archived), and
  not in one real DoD RFI's full body. No acquisition-lane join is justified
  from this evidence.
- The one door this spike did **not** close: attachment/package text behind
  `api.sam.gov` or manual download. That stays a documented unknown, not a
  finding — nobody should claim "solicitations never mention PE codes,"
  only "the notice text and search index don't, in this sample."
- Practical note for anyone reusing this endpoint: `is_active` takes
  `true`/`false` only (`all` 400s), and quoted phrases are not exact-phrase
  matches — both are worth knowing before building anything on
  `sgs/v1/search`.
