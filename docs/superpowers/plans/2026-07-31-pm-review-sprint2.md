# PM Review Sprint 2 — Usability & Credibility (P1-2..P1-11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Standing rules: commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit paths only; never
> weaken gates (fix data); TDD; sequential execution; `.env` never printed/committed;
> new gate checks ship with recorded proof-can-fail in
> `docs/superpowers/reviews/5c-gates-pre-failure.txt`.

**Spec:** `docs/superpowers/specs/2026-07-30-pm-review.md` §P1-2..§P1-11 (per-finding
detail + repro paths are there; this plan sequences them). Sprint 1 (P0s + P1-1 +
gate 23) is COMPLETE + live (2026-07-31). Suite is 23 gates; keep 23/23 green
throughout.

**Verified premise carried from Sprint 1 triage:** the `/data/` Explorer's
`dim_programs` parquet is STALE (326 rows = the 5B-2-era count) vs the warehouse's
1,739 — worse than the PM knew (P1-5). Diagnose the Explorer-dataset export path,
not just the copy.

**Key design decisions (locked):**
- **P1-3 rename table:** hand-curated `data-seeds/entity_family_events.csv`
  (family, from_name, to_name, event ∈ rename|acquisition, effective_date,
  source_url, note) for the top families (Raytheon→RTX, L3+Harris→L3Harris,
  Rockwell Collins→Collins→RTX, Orbital ATK→Northrop, Sikorsky→Lockheed, …
  ~10-15 well-documented events; source_url = official press release/SEC — rendered
  as explicit external references, NOT warehouse citations; the page states its
  method plainly). `/companies/` merges affected rows into one family line
  (combined obligations, both registry names shown); the events table gets its own
  page linked from /companies/ + /methodology/. SAM.gov high-confidence promotion
  is NOT in scope (needs the deferred SAM extract — note honestly on the page).
  Uniform "medium" chips: suppress per-row when uniform; state method once in the
  table header.
- **P1-2 card generation:** dossier programs (50) hoist the dossier's first 1-2
  "what it is" sentences (already fact-cited). Non-dossier full-tier programs get a
  field-generated sentence from J-book facts (account title, appropriation,
  exhibit family, org — no LLM, no invention). Rollup tier keeps its honest tail.
- **P1-9 workbook drawer:** adopt the PDF tier's unit pattern
  (`5,565,655 USD thousands (= $5.57B)`); server-side (build-time) HTML cell
  preview — a small table of the cited cells + ~2 surrounding rows from the
  workbook data already in the lake (emit into the citation payload or a sidecar;
  measure size impact); per-cell arithmetic line (`O839 a + O840 b + O841 c = sum`);
  tabular-nums + slashed-zero font-feature for cell refs/PE codes/hashes
  (`font-feature-settings: "zero"` — verify the mono font supports it, else pick a
  rendering that disambiguates); dedupe the double "Official source" link; full
  SHA + copy control; document title + edition line (reuse `documentTitleFromUrl`).
- **P1-5 canonical corpus block:** one shared component/source-of-truth constant
  (counts derived from the build data, never hardcoded) rendered on /programs/,
  /years/, /methodology/, /data/; Explorer dataset manifest gains per-dataset
  scope descriptions; STALE parquet root-cause fixed in the export path so
  Explorer datasets are emitted from the CURRENT warehouse every export (+ a
  freshness check: Explorer dataset rowcounts vs warehouse at export time —
  loud failure on drift).
- **Gate additions (lightweight, proof-can-fail):** (a) sort-audit leg — every
  data table ships a deterministic default sort (assert the rendered order of the
  lobbying table + filing years desc on sampled pages); (b) corpus-consistency
  check at export — the canonical block's numbers equal programs.json/years/
  methodology counts.

---

### Task 1: Search pack (P1-4)
`site/src/lib/search.ts` + search components (+ exporter if the index payloads
need fields): (1) alphanumeric normalization both sides ("F35"→F-35, B21, KC46,
F15EX — programs tier); (2) ranking blend: exact/near name match still wins, then
blend FY26 magnitude + document-hit count so "Sentinel" ranks GBSD above Sentinel
Mods; (3) alias table (`site/src/lib/aliases.ts` or data-seed): Sentinel↔GBSD↔
LGM-35A, Raider↔B-21, JSF↔F-35, visible "also known as" chips in results;
(4) lobbying filing titles "Client — Registrant, YYYY QN" (fix at the search-index
emit; also fixes the /filing/ page title if it shares the source) + the
"identifiersTotal" missing-separator bug. Vitest incl. the PM's exact repros;
search-eval (G5) must stay ≥ its floor.

### Task 2: Data-truth pack (P1-5)
Root-cause + fix the stale Explorer parquets (export path emits current marts;
freshness check loud); canonical corpus block component + adoption on the four
pages; dataset scope descriptions in the Explorer manifest; corpus-consistency
export check (proof-can-fail). Update methodology wording where counts were
hardcoded.

### Task 3: Formatter/sort pack (P1-6, P1-7)
`formatAmount` family: roll over to `$X.XXT` at ≥1T (unit tests at boundaries);
explicit `FY2017–FY2026` ranges on every aggregate KPI (district, companies,
company pages — audit for range-less aggregates); merge the duplicate CO-05-style
district cards (one card, one label, honest sub-label); table sort audit —
deterministic default sort on every table (lobbying filings desc by year/quarter;
audit all tables, fix + test); sort-audit gate leg (proof-can-fail).

### Task 4: Workbook drawer pack (P1-9)
Per the locked design above. Pytest for the exporter payload additions (cell
preview data), vitest for the drawer rendering; keep cite-shard size growth
measured and reported (the preview lives in the payload — if shards balloon,
move previews to a per-fact sidecar fetched on open).

### Task 5: Cards + entities pack (P1-2, P1-3, P1-10, P1-11 + Sprint-1 leftovers)
Dossier-hoisted WHAT-IT-IS cards + field-generated fallback; the family-events
seed + /companies/ merge + events page + chip suppression; GAO department-level
label ("Department-level designation — not specific to this program", visually
de-emphasized); /programs/ text filter + Org sort + CSV export (mirror /years/
patterns); raw-org badge sweep (`serviceOrgName` at remaining raw-code render
sites incl. the program header badge row); footnote inline preview in the panel
(the Sprint-1 judge nit).

### Task 6: Loop + judge + deploy
Full loop (pytest, export-site, build, 23/23 + new legs, vitest, tsc,
verify-lineage, assembly); visual judging (3 opus judges, median ≥4): search
results w/ alias chips, a dossier-hoisted card, /companies/ merged family +
events page, workbook drawer w/ cell preview, /programs/ filter; fix round if
needed; deploy + R2 sync; live-verify the PM's Sprint-2 repro rows (F35 search,
Raytheon/RTX one family, dim_programs Explorer count = warehouse count, $3.66T,
lobbying sort, workbook drawer unit line); ROADMAP + push both remotes.
