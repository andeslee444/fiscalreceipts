# PM Review Sprint 1 — Trust (P0-1..P0-5, P1-1, CI gates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Standing rules: commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit paths only; never
> weaken gates — every new gate leg ships with recorded proof-it-can-fail in
> `docs/superpowers/reviews/5c-gates-pre-failure.txt`; TDD; sequential execution
> (shared warehouse + git index + site build); `.env` never printed/committed.

**Spec:** `/Users/andeslee/Downloads/fiscalreceipts-feedback-2026-07-30.md` (the PM
review — P0 section + §Systemic Fix are the acceptance bar; copy it to
`docs/superpowers/specs/2026-07-30-pm-review.md` in Task 0 so it is versioned).

**Goal:** eliminate the basis-collision class of defect (same program+year+label,
different values, no explanation), make facts addressable, unify the footnote
contract, and gate all three so they cannot regress.

**Verified premises (2026-07-30 spot-check):** ATA000 sidecar carries both bases
(decade/workbook 5,565,655 k$ TOA vs detail 5,247.070 M$ Net Procurement for FY24;
FY25 4,972,514 vs 4,489.93; FY26 4,086,744 vs 3,555.503); `/fact/{id}` and
`/rss.xml` 404; the P-40 advance-procurement bridge row is NOT parsed as a detail
scenario (so the reconciliation strip states the definitional difference as
methodology copy + both receipts; it asserts arithmetic only where facts back it).

**Key design decisions (locked):**
- **Basis vocabulary (site-wide, two values + edition):** `toa` = R-1/P-1 workbook
  Total Obligation Authority (USD thousands); `jbook-detail` = R-2/P-40 J-book
  detail rows (USD millions). Every rendered figure gains `data-basis`,
  `data-fy`, `data-measure` attributes and a small always-visible basis chip
  (e.g. `P-1 TOA · PB2026`).
- **Canonical basis for KPI cards / homepage hero / OG cards / feed = `toa`**
  (PM call: "it is what Congress provides"), with the `jbook-detail` value shown
  in a reconciliation strip when it differs.
- **Fact permalinks:** `/fact/{id}` served via a `vercel.json` rewrite (emitted
  into `site/out/`) to a client-resolving page that fetches the cite-shard and
  renders value+basis+source+hash+parent link. `#fact-{id}` anchors scroll,
  highlight, and open the drawer on any page. ONE public id per figure: the
  citation fact id (the drawer id); the Receipts-mode chip shows the same id.
  (Full per-fact SSG pages deferred — 134k extra files; documented in the
  methodology "permalinks" note.)
- **Absence-reason taxonomy** for "—": `not-published` (edition lacks the row) /
  `not-ingested` / `classified` / `no-comparison` — rendered as distinct short
  labels, never a bare dash, on the summary cards.

---

### Task 0: Version the spec
Copy the PM review into `docs/superpowers/specs/2026-07-30-pm-review.md`; commit.

### Task 1: CI gate trio — built FIRST, failing (§Systemic Fix)
**Files:** new `site/scripts/gates/basis.mjs` (gate 23) wired into
`site/scripts/verify.mjs`; extend `site/scripts/gates/render-static.mjs`
(footnote golden files); `tests` for the gate helpers.
- Leg (a) **intra-page one-label-one-basis:** parse every built
  `out/program/*/index.html`; group `[data-amount]` figures by
  `(data-entity, data-fy, data-measure)`; FAIL any group with >1 distinct
  numeric value unless every member sits inside `[data-reconciliation]`.
  Also FAIL any `[data-amount]` figure missing `data-basis|data-fy|data-measure`
  on program pages (attribute-presence leg).
- Leg (b) **summary/detail agreement:** each summary card's value must appear in
  the page's detail facts (same basis); a card rendering an absence label must
  have NO non-null detail fact for that (fy, measure, any basis) — else FAIL.
- Leg (c) **footnote completeness:** golden-file one footnote per citation tier
  (pdf, workbook, derived); assert fields: program, fiscal year, row/field name,
  value with unit, document title, locator (page or sheet+cells), sha256,
  retrieved date, fact permalink.
- Run against the CURRENT build → legs (a) and (b) FAIL on `/program/ATA000/`
  (the verified collisions) and leg (c) FAILS on the missing unit/FY/permalink.
  Record verbatim in the pre-failure doc. Commit failing gate + record.

### Task 2: Exporter — basis threading + summary union + canonical TOA
**Files:** `src/govbudget/export_site.py` (+ pytest in `tests/jbooks/`).
- Every emitted figure payload gains `basis` (`toa`|`jbook-detail`), `fy`,
  `measure` (`actuals|enacted|request|total|change`), and `edition`.
- Summary cards (answer strip + Budget Figures) compute from the UNION of
  workbook + detail facts, preferring `toa`; when only detail exists, use it
  (labeled). Absence-reason enum replaces bare null.
- Homepage hero, OG-card values, and feed superlatives switch to `toa` and gain
  the corpus scope qualifier string (P0-5): "largest single R&D or procurement
  program element in our corpus (1,741 lines; excludes personnel, O&M, …)".
- Reconciliation payload per (fy, measure) where both bases exist and differ:
  `{toa: {v, fid}, detail: {v, fid}, delta}` for the strip.
- WHO-GETS-IT fallback: when crosswalk is empty but the program has a dossier
  with cited key-players claims, emit `named_primes` (name + fact_id) for the
  card ("Named in the J-book: … — uncrosswalked").

### Task 3: Site — basis chips, reconciliation strip, summary cards, hero
**Files:** `site/src/components/` (cite.tsx passthrough attrs; new
`reconciliation-strip.tsx`; program-figures/answer-strip updates; home hero),
`site/src/lib/data.ts` types; vitest.
- `<Cite>` renders `data-basis/fy/measure` + the small basis chip (always
  visible, muted, ≤12px is FORBIDDEN — use 12px+ per P1-1).
- `[data-reconciliation]` strip: "$5.25B net procurement (P-40) · $5.57B total
  obligation authority (P-1) — TOA includes advance procurement" with both
  values as their own `<Cite>`s; methodology link.
- Summary cards use the Task-2 union payload + absence labels; WHO-GETS-IT
  renders named primes when present.
- Homepage hero: canonical TOA value + scope qualifier (also OG description).

### Task 4: Unified footnote formatter (P0-3)
**Files:** `site/src/lib/footnote.ts` (new, single formatter), used by
`citation-panel/panel.tsx`; vitest golden tests (same goldens as gate leg (c)).
- Fixed field set both tiers + Chicago/AP/BibTeX/JSON variants (small menu).
- Uses document TITLE (from the citation payload's official metadata), unit,
  fiscal year, row/field name, fact permalink.

### Task 5: Fact addressability (P0-4)
**Files:** new `site/src/app/fact/page.tsx` (client resolver), `vercel.json`
emitted into `out/` by the build (rewrite `/fact/:id` → `/fact/?id=:id` — a
static-export-compatible pattern; verify Vercel rewrite syntax against the
static deploy), `#fact-{id}` handler (small client util on figure pages),
Receipts-chip id unification (chip shows the citation fact id = drawer id),
supersede display on the resolver (if the shard marks superseded, show the
correction + link). vitest + a linkgraph/gate leg asserting the footnote
permalink pattern resolves (fetch the rewrite locally via `vercel dev`-less
check: assert vercel.json present + resolver page built; live check post-deploy).

### Task 6: P1-1 — citation affordance visibility
**Files:** cite.tsx / globals.css / receipts-mode component; vitest + a11y gate.
- Underline contrast ≥3:1 (measure with the a11y gate's contrast helper; add a
  gate assertion), hover/focus state, provenance chips ≥12px, legend ≥12px.
- Receipts mode ON by default for first-time visitors (persisted opt-out),
  relabeled "Show fact IDs"; chip id = drawer id (Task 5).

### Task 7: Loop until green + judge + deploy
- Full: pytest, export-site, `npm run build`, 23-gate verify (incl. gate 23
  PASSING now — the P0-1/P0-2 collisions resolved), vitest, tsc,
  verify-lineage, verify-phase5 assembly.
- Visual judging (3 opus judges, median ≥4): program page with reconciliation
  strip + basis chips (does the two-basis story read clearly?), summary cards
  with absence labels, homepage hero with qualifier, fact resolver page.
- Deploy drill + R2 sync; live-verify: `/fact/bb54b165` resolves (200 via
  rewrite), footnote contains unit+FY+permalink, ATA000 shows reconciliation
  strip and card/table agreement, hero shows qualified TOA claim.
- ROADMAP row + push origin + subtree sync.

---

Sprint 2 (P1-2..P1-11) and Sprint 3 (P1-8 RSS, P2s, coverage page) follow as
separate plans after Sprint 1 ships.
