# Sprint C — Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Standing rules (MANDATORY, apply to every task):
> commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; **use
> `git commit -F <file>`** — backticks inside `-m` get eaten by the shell;
> explicit paths only, never `git add -A`; TDD; **never weaken a gate to make
> something pass**; new gate legs ship with recorded proof-can-fail in
> `docs/superpowers/reviews/5c-gates-pre-failure.txt` under a dated heading,
> verbatim FAIL and PASS, never paraphrased; **the suite is 24 gates and must
> stay 24** — attach legs to existing gates, and **check for leg-letter
> collisions first**; gate 1 pins `git_head`, so build AFTER committing and
> re-verify at final HEAD; **never launch a background process and stop to wait
> for it** — run builds in the foreground; **do not run `verify-phase5`** (it
> costs ~$0.85/run, controller only); `.env` is gitignored. **Do not deploy.**

**Goal:** Close the gap between a site that is correct and a site that is usable.
Nothing here fixes a falsehood — Sprints A′, B′ and drawdown A did that. Every item
is a thing a returning reader hits and cannot get past.

**Architecture:** Seven independent surface fixes, ordered by how often a real reader
meets them. No shared state; any task can ship alone. Two need new gate legs (the
permalink form and the responsive band) because both are regressions that would
otherwise return silently.

**Tech Stack:** Next.js 16 static export, React 19, Tailwind v4, Playwright; Python
3.12/uv exporter; gate suite under `site/scripts/gates/`.

**Current state:** `main` at `3caa5e4`, deployed and live. 1,571 pytest · 966 vitest ·
24/24 gates · verify-phase5 PASS (47/48, citations 43/43).

> **The prescribed code in this plan is a hypothesis, not gospel.** Across the three
> prior sprints, **seven** tasks contained a defective prescription — a regex matching
> its own prescribed fix; a gate letter colliding with a live leg; units off 1000×; a
> grain-mismatched fail-proof; a "blind" sweep that actually fired and truncated; a
> re-key that reported "corpus count unchanged" as success while dropping $5.74B; and
> a citation retry that re-ran a frozen SQL string through a pure function of that
> string, provably incapable of ever helping while shipping green tests. The recurring
> shape is that **the symptom was observed correctly and the cause was inferred rather
> than traced.** The *measured figures* below were reproduced live on 2026-08-13; the
> *code* was not executed. Verify before trusting, replace with something tighter
> (never looser), and disclose any substitution in the code comment, the proof-can-fail
> record, AND the commit message.

---

## Verified live on 2026-08-13 (production, HEAD `3caa5e4`)

```
/glossary/                404          "total obligational" on /methodology/:  0 occurrences
/agency/                  404          "TOA" on /methodology/:                 4 (all inside the
/contact/                 404                                                     corrections table)
/fact/{id}                200
/fact/{id}/               404   ← the site sets trailingSlash: true everywhere else
/years/                   2 <svg>, both icons (w-3.5, 20px) — no chart
globals.css               0 prefers-color-scheme rules
programs CSV header       8 columns, none is a fact id or permalink
layout.tsx:75             container mx-auto ...   layout.tsx:87  hidden md:flex
```

---

## What this plan deliberately does NOT cover

- **The key split** (#56 remainder) — 5–9 days, or 2–3 for the middle path. Puts
  Tomahawk, LPD Flight II and Medium Landing Ship back on the site. Its own sprint.
- **#54** — the reconciliation label reaching only `/program/*`.
- **Sprint D expansion** — LDA re-pull, lineage Phase 2, GAO program-level ingestion.
- **#6** — `dim_geography`'s missing `fiscal_year`/`pe_bli` breakdown.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `docs/superpowers/ROADMAP.md` | ledger | all |
| `site/src/app/glossary/page.tsx` | **new** — term definitions | C1 |
| `site/src/lib/glossary.ts` | **new** — one definition per term, shared | C1 |
| `site/public/vercel.json` | `/fact/{id}/` rewrite | C2 |
| `site/scripts/gates/linkgraph.mjs` | leg: permalink accepts both forms | C2 |
| `site/src/app/agency/page.tsx` | **new** — agency index | C3 |
| `site/src/components/programs-table.tsx` | CSV fact ids | C4 |
| `site/src/app/years/page.tsx` + a chart component | totals chart | C5 |
| `site/src/app/layout.tsx` | nav breakpoint / container | C6 |
| `site/scripts/gates/mobile.mjs` | leg: no h-scroll 768–1023 | C6 |
| `site/src/app/globals.css` | dark palette | C7 |

---

### Task C0: File the sprint

- [ ] **Step 1: Add #60–#66 to `docs/superpowers/ROADMAP.md`**, each with the live
      evidence from the table above. Number from the next free id (last used: #59).
      Note explicitly that **none of these is a correctness defect** — the site says
      nothing untrue; these are reachability and comprehension gaps.

- [ ] **Step 2: Commit** (message via `-F`).

---

### Task C1: #60 — `/glossary/`, and TOA expanded at least once

**The measured gap is not the one the review reported.** It said "TOA appears 0 times
on `/methodology/`". Today it appears **4 times** — but every occurrence is inside the
2026-08-08 corrections table ("P-1 TOA" → "R-1 TOA"), and **"total obligational"
appears zero times anywhere**. So the term is used as a label roughly 80,000 times
sitewide and expanded nowhere.

**Files:** create `site/src/app/glossary/page.tsx`, `site/src/lib/glossary.ts`;
modify `site/src/app/layout.tsx` (footer link), `site/src/app/methodology/page.tsx`.

- [ ] **Step 1: Enumerate the terms from what the site actually stamps**, not from a
      guess. At minimum: TOA, P-1, R-1, R-2, P-40, PE, BLI, PB20xx, J-book, Non-Add,
      discretionary vs reconciliation, HHI, place of performance. Grep the built HTML
      for each and record how many pages use it — a term used on 3 pages is a
      different priority from one used on 1,993.

- [ ] **Step 2: One definition per term, in `site/src/lib/glossary.ts`.** A single
      exported map, so the glossary page and any inline hover both read the same
      string. The project has been bitten three times by paired constants drifting
      (`CURRENCY_RE`/allowlist mirror, `BASIS_LABEL`/gate copy, `CORPUS_SCOPE_TAIL`) —
      do not create a fourth.

- [ ] **Step 3: Render `/glossary/`** with an `id` anchor per term so a chip can deep
      link to `#toa`. Add a footer link.

- [ ] **Step 4: Expand TOA on first use on `/methodology/`** — one parenthetical
      ("total obligational authority") plus a link to the glossary entry.

- [ ] **Step 5: Verify** the new route builds and appears in the sitemap, and that
      gate 1's page-count assertions still pass (they are data-driven off
      `programs.json` etc., but a new singleton route may need registering — check
      `build.mjs`'s core-pages list).

- [ ] **Step 6: Commit.**

---

### Task C2: #61 — `/fact/{id}/` 404s on the trailing slash

The one URL designed to be pasted into someone else's footnote, and it breaks under
the trailing slash the rest of the site trains you to expect (`next.config` sets
`trailingSlash: true`). Verified live: `/fact/3134a6e0` → 200, `/fact/3134a6e0/` → 404.

The rewrite lives in `site/public/vercel.json` (shipped into `out/`) and serves
`/fact/` for every `/fact/{id}` request; the client resolver parses the id from
`location.pathname`.

**Files:** modify `site/public/vercel.json`, `site/src/app/fact/fact-resolver.tsx`,
`site/scripts/gates/linkgraph.mjs`.

- [ ] **Step 1: Read the existing rewrite** and work out why the slashed form misses.
      Do not guess — print the current rule.

- [ ] **Step 2: Accept both forms.** The resolver must strip a trailing slash before
      parsing the id, or it will resolve `3134a6e0/` and fail.

- [ ] **Step 3: Gate leg.** Pick a free letter in `linkgraph.mjs` (say which and how
      you confirmed it). Assert that for a sampled fact id, both `/fact/{id}` and
      `/fact/{id}/` resolve to the same fact. **This cannot be checked against `out/`
      alone** — the rewrite is a Vercel-layer behaviour. Either assert the
      `vercel.json` rule shape statically, or drive it through the local static server
      the live gates already use. Say which you chose and what it does and does not
      prove.

- [ ] **Step 4: Prove it fails**, restore, record verbatim. **Commit.**

---

### Task C3: #62 — `/agency/` index

`/agency/{org}/` pages exist and are linked from program pages, but `/agency/` itself
404s and there is no "Agencies" entry in the nav. A reader who trims the URL — the
commonest way to discover a section — gets nothing.

**Files:** create `site/src/app/agency/page.tsx`; modify `site/src/app/layout.tsx`.

- [ ] **Step 1:** List the 23 agencies from `agencies.json` with program count and
      FY2026 total, sorted by total. Every figure a real `<Cite>` — the sidecar
      already carries `fy2026_fact_id_derived`.

- [ ] **Step 2:** Decide whether "Agencies" earns a nav slot or a footer link. The
      header already overflows between 768–1023 (Task C6) — **do not add a nav item
      before C6 lands**, or you will make that worse. Sequence accordingly and say
      what you did.

- [ ] **Step 3:** Verify, commit.

---

### Task C4: #63 — CSV exports drop the fact ids

Header today is exactly:
`pe_bli,org,org_name,title,fy2024_actual_toa_usd_thousands,fy2026_request_toa_usd_thousands,fy2026_disc_toa_usd_thousands,fy2026_reconciliation_toa_usd_thousands`

No fact id, no permalink, no basis, no edition, no retrieval date — while the DOM
carries `data-fact-id` on every figure. The provenance chain, which is the entire
product thesis, is severed the moment data enters a spreadsheet.

**Files:** modify `site/src/components/programs-table.tsx`, `site/src/lib/programs-row.ts`.

- [ ] **Step 1:** Add `fy2024_fact_id`, `fy2026_fact_id` and a `permalink` column
      (`https://fiscalreceipts.com/fact/{id8}`). The row type already carries
      `fy24Fid`/`fy26Fid`.

- [ ] **Step 2: Watch page weight.** `/programs/` is at a 278,000-byte gzip ceiling
      and was 677 bytes under it as of `756620b`. Fact ids are already in the payload
      (`fy24Fid`/`fy26Fid`), so the CSV builder should cost nothing at page level —
      **verify that**, and if it does grow, report the number rather than raising the
      ceiling.

- [ ] **Step 3:** A vitest case pinning that a CSV row's permalink resolves to the
      same fact id the rendered chip carries. **Commit.**

---

### Task C5: #64 — `/years/` is called "Budget over time" and has no chart

Verified: 2 `<svg>` elements, both icons (`w-3.5`, `20px`). The page is a 1,741-row
matrix behind 39 column-toggle chips. The commonest citizen question about defense
spending is "up or down?", and this page's name promises exactly that.

**Files:** modify `site/src/app/years/page.tsx`; likely a new chart component.

- [ ] **Step 1:** A totals-per-year line at the top, matrix below. Reuse the existing
      chart vocabulary — there is a `chart-figure.tsx` and a `decade-trajectory.tsx`
      already; do not invent a third.

- [ ] **Step 2: The chart contract applies** — accessible name, description, and a
      table view (gate 6 a11y and the charts gate both check this). Read
      `site/scripts/gates/charts.mjs` first and satisfy it deliberately.

- [ ] **Step 3:** Every plotted total must be cited, and the series must come from
      `years_matrix.json`, never recomputed in the page.

- [ ] **Step 4: Page weight** — `/years/` has a 45,000/9,000 budget in
      `PAGE_WEIGHT_BUDGET`. An SVG of 10 points is small, but measure. **Commit.**

---

### Task C6: #65 — every page scrolls sideways between 768 and 1023px

Mechanism confirmed by construction: `layout.tsx:75` is
`container mx-auto flex h-14 items-center px-4 gap-4 min-w-0`, and the desktop nav at
`layout.tsx:87` is `hidden md:flex`. Tailwind's `container` clamps `max-width` to the
*current* breakpoint, so anywhere in 768–1023 the header box is pinned to 768px while
the nav needs more. The nav switches on at exactly the width the container clamps.

**Files:** modify `site/src/app/layout.tsx`; modify `site/scripts/gates/mobile.mjs`.

- [ ] **Step 1: Measure first.** Script `document.documentElement.scrollWidth` at 375,
      768, 900, 1000, 1024 and 1280 on `/` and `/programs/`. Record the table. The
      review reported +167px at 768; confirm or correct it.

- [ ] **Step 2: Fix.** Either move the desktop nav to `lg:` so the hamburger covers
      768–1023, or replace `container` with `w-full max-w-screen-xl`. Prefer whichever
      leaves the wordmark aligned; state which and why.

- [ ] **Step 3: Gate leg** in `mobile.mjs` (which currently tests 390 only): no page
      may have `scrollWidth > clientWidth` at 768, 900 or 1000. Non-vacuity: fail if it
      resolves zero pages. Prove it fails on the pre-fix build, record verbatim.

- [ ] **Step 4:** Commit. **C3 may add its nav item after this lands, not before.**

---

### Task C7: #66 — no dark mode

`globals.css` has **0** `prefers-color-scheme` rules and no `color-scheme` meta; the
only dark token is `@custom-variant dark (&:is(.dark *))`, a Tailwind declaration
nothing applies. The site is light-only, for a product whose core use is reading dense
numeric tables for long stretches.

**Files:** modify `site/src/app/globals.css`, `site/src/app/layout.tsx`.

- [ ] **Step 1:** Define the dark palette by redefining the existing CSS custom
      properties under `@media (prefers-color-scheme: dark)`. Do not introduce a second
      token vocabulary.

- [ ] **Step 2: Contrast is a gate, not a preference.** Sprint 1 set the underline
      contrast at 4.95:1 and gate 6 (a11y) enforces WCAG. Every token pair must clear
      AA in dark as well as light — run the a11y gate, do not eyeball it.

- [ ] **Step 3:** Add `<meta name="color-scheme" content="light dark">` so form
      controls and scrollbars follow.

- [ ] **Step 4:** Verify gate 6 passes in both schemes if the harness supports forcing
      one; if it does not, say so plainly rather than implying coverage you do not
      have. **Commit.**

---

### Task C8: Sprint close

- [ ] **Step 1:** Commit everything FIRST (gate 1 pins `git_head`), then:

```bash
uv run pytest
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
cd .. && uv run python -m govbudget verify-phase5b3               # serialized, binds 4173
```

- [ ] **Step 2:** Close #60–#66 in the ROADMAP with the evidence, and file anything
      this sprint did not close rather than leaving it implied.

- [ ] **Step 3:** Report to the controller. **Do NOT deploy.**

---

## Self-review

**Spec coverage.** Every remaining review finding that is a usability gap is assigned:
glossary → C1; permalink → C2; agency index → C3; CSV provenance → C4; years chart →
C5; responsive band → C6; dark mode → C7.

**One measured correction to the review, recorded rather than inherited:** it reported
"TOA: 0 occurrences" on `/methodology/`. There are 4 — all inside the corrections
table added on 2026-08-08. The real gap is that the term is never *expanded*
("total obligational" = 0 sitewide), which C1 fixes.

**Dependency.** C6 before C3 — adding a nav item to a header that already overflows
would deepen the defect C6 exists to fix. Everything else is independent.

**Cost.** Zero API spend. No `verify-phase5` run needed; `verify-phase5b3` covers the
build-dependent assembly for free.

**Risk.** C7 is the only task that can silently regress something invisible: a dark
palette that passes a build but fails contrast for a real reader. Its acceptance is the
a11y gate, not a screenshot.
