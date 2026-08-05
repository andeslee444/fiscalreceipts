# PM Review Sprint 3 — Reach & Durability (P1-8, P2-1..P2-8, coverage page) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Standing rules: commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit paths only; never
> weaken gates (fix the page/data); TDD; sequential execution; `.env` never printed;
> new gate legs ship with recorded proof-can-fail in
> `docs/superpowers/reviews/5c-gates-pre-failure.txt`. Gate 1 is build-freshness —
> build AFTER committing and re-verify at final HEAD.

**Spec:** `docs/superpowers/specs/2026-07-30-pm-review.md` — §P1-8 (feeds), §P2-1..§P2-8,
and §Coverage ("the honesty is right, the roadmap is missing"). Sprints 1 (trust) and 2
(usability/credibility) are COMPLETE + live. Suite is **24 gates**; keep 24/24 green.

**Carried-forward obligations (from Sprint 2's own findings — do these, they are not
optional polish):**
- **Backlog #31 — a mobile-viewport gate leg.** Three mobile blockers reached judging
  because every browser-driving gate runs at desktop width. This sprint ADDS that leg
  (Task 1) so P2 work can't reintroduce the class.
- Deferred judge nits now in scope where they touch P2 items: search alias-token
  highlighting, palette bottom-edge scrim, the circular `/district/` DARPA
  parenthetical, `/companies/` addend-equation overflow at 390, addends default
  open/closed consistency, SEC accession numbers on `/families/`, the Vertex
  name-inferred flag question.

**Key design decisions (locked):**
- **P1-8 feeds** are the highest-ROI item in the spec ("the site that tells you when a
  program's budget moves, with the receipt attached"). Static-export constraint: emit
  real files at build time — `/rss.xml` (whole feed), `/feed.xml` alias, per-event-type
  feeds, and per-program / per-company watch feeds for the sets that already have
  pages. Every item carries **dollar magnitudes, not just percentages** (§P1-8's other
  half) and a fact permalink. Atom + RSS both; `<link rel=alternate>` discovery on the
  relevant pages.
- **P2-1 page weight**: do NOT ship a client-side virtualization rewrite of `/years/`.
  Prefer (a) trimming what ships in the initial document, (b) server-side chunking with
  the full set behind the existing CSV + Data Explorer (both already exist and are
  linked), (c) measure before/after in the gate. Target: `/years/` well under ~9 MB and
  `/programs/` under ~4.8 MB; state the achieved numbers honestly rather than claiming
  a round target.
- **P2-8 rounding**: derivation strips must be reproducible from what the reader can
  see — show unrounded inputs (or state the rounding) wherever a derived figure is
  displayed alongside its inputs.
- **Coverage page**: publish current coverage numbers (all build-derived, never
  authored — the §P1-5 rule), the specific blocker per feature, and a dated target.
  The crosswalk gap is a *methodology* limit (account codes too coarse outside DARPA's
  clean structure) — say so plainly; that converts a weakness into a credibility asset.
  Reframe `/flow/`'s default view to lead with the two-rivers finding rather than the
  1.3%-of-dollars bridge.

---

### Task 1: Mobile-viewport gate leg (backlog #31) — FIRST, and built failing
Extend a browser-driving gate with a 390px leg over a sample of built pages: assert
`document.body.scrollWidth === clientWidth` (no page-level horizontal overflow) AND
that each money-bearing table's primary value column is within the viewport. Prove it
can fail by reverting one of Sprint 2's card treatments in a scratch build → FAIL →
restore `cmp`-clean → record. This must be green before the P2 work starts so the
P2 work is protected by it.

### Task 2: Feeds (§P1-8)
`/rss.xml` + `/feed.xml` + per-event-type + per-program/per-company watch feeds; items
carry `$X → $Y (+N%)` and a `/fact/{id}` permalink; discovery links; a gate leg
asserting the feeds exist, are valid XML, and that every item's magnitude pair matches
the underlying fact (proof-can-fail).

### Task 3: Page weight (§P2-1) + `/years/` default sort (§P2-2)
Measured reduction per the locked decision; default `/years/` to descending FY26 total
(or data density) so the flagship decade view doesn't open on a screenful of dashes;
mobile: the 33 column-toggle chips must not precede the data. Gate leg pins the
measured budget so it can't silently regress.

### Task 4: Chart accessibility (§P2-3) + amber-banner language (§P2-6)
Accessible names + short descriptions on every chart; a "view as table" toggle beside
each (data is already tabular); Sankey collision detection or leader lines; a distinct
calm visual language for honest scope disclosure vs caution-about-a-number, and the
`<h1>` before any coverage banner. Extend the a11y gate accordingly.

### Task 5: Display polish (§P2-4, §P2-5, §P2-7, §P2-8) + deferred nits
Title-case company display names with the raw registry string kept as provenance;
OG descriptions written rather than raw prose (and on the canonical basis);
`0` vs `<0.05` vs `—` in the years matrix; reproducible derivation strips; plus the
deferred judge nits listed above.

### Task 6: Coverage page + `/flow/` reframe (§Coverage)
Per the locked decision. All numbers build-derived; gate leg asserts they equal their
sources (the §P1-5 pattern).

### Task 7: Loop + judge + deploy
Full loop (pytest, export-site, build, 24+ gates, vitest, tsc, verify-lineage,
assembly); visual judging at **390 and 1440** (mobile is now first-class — Sprint 2
failed judging on exactly this); fix round if median <4; deploy + R2 sync;
live-verify (`/rss.xml` 200 and valid, feed item magnitudes, `/years/` weight +
default sort, coverage page); ROADMAP + push both remotes.
