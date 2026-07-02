# Phase 5C — UX Trust Journey & Measurable Website Goals

**Date:** 2026-07-02
**Status:** Approved (user directive 2026-07-02: "create clear goals that the website must accomplish that are measurable, either through code or visually … modern and professionally animated, source backed … write the spec, execute, and then codereview and visually verify all elements on the site that map to the user workflow")
**Depends on:** Phases 0–5B-4 (all complete; verify-phase5 exit 0, live eval 45/45; site live at https://govbudget.vercel.app)

---

## 1. Mission statement (the goal behind the goals)

> **A skeptical reader can verify any number on the site down to the primary source in
> seconds — and repeat the analysis themselves.**

This is the original problem (four disconnected silos — budget intent, actual spend,
beneficiaries, oversight — connected by nobody with per-number provenance) expressed as
a user experience. The free site is the credibility engine for the future paid analyst
platform: every goal below should make an analyst think *"if the free layer is this
rigorous, the paid layer is worth paying for."*

Phase 5C makes the site **deliver** that mission as a journey, not just possess it as
features — and makes every claim about the journey **measurable in code or by visual
judges**.

## 2. Evidence base (why these goals, why now)

From the 2026-07-02 three-reader audit (data inventory / site-as-built / spec promises):

- The killer interaction (click number → J-book PDF page opens with the figure
  highlighted) exists but is **staged nowhere** — home leads with search + static stats.
- The connected graph exists in data but **breaks in navigation**: `/district/` and
  `/filings/` have zero inbound nav links; `/feed/` is home-teaser only; filing mentions
  link out to lda.senate.gov instead of to our own filing pages; feed `new_entrant`
  cards render a raw `family_key` with no company link; home's stat numbers link nowhere.
- **Coverage cliffs are silent**: follow-the-dollar on 17/326 programs, dossiers on
  50/326, company award tables on ~18/200 families, districts 106/435, CA FY2025-only,
  FY2026 partial-year.
- Persona features named in specs but absent: **copy-as-footnote** (journalists),
  **printable dossier** (Hill staffers).
- Degraded states are silent: without R2 assets the explorer/downloads/PDF panel fail
  quietly (panel has a fallback; explorer and downloads do not); Pagefind tier-2 search
  returns nothing in dev with no notice.
- Motion exists (category heroes, follow-the-dollar) but there is **no motion system**:
  no shared tokens, no documented durations/easings, inconsistent hover/entrance
  behavior, `prefers-reduced-motion` handling ad hoc.

## 3. The goals (all measurable)

Each goal states: **Why → UX contract → Measure (code gate or visual judge)**.
Standing rule inherited from the roadmap: *every new gate ships with a test proving it
can fail* — and gates G1–G3 must demonstrably fail against the pre-5C build.

### Goal 1 — Receipt moment in 30 seconds

- **Why:** Per-number provenance is the moat; a differentiator the visitor never
  experiences isn't one.
- **UX contract:** The home page stages one featured, provocative cited number above
  the fold with an explicit invitation (e.g. "see the page it's printed on"). Clicking
  it opens the citation panel with the PDF page + highlight. Citation affordances read
  as invitations (visible chip on first paint, not hover-only discovery). Receipts mode
  gets a first-visit introduction (one-time dismissible coach mark, localStorage).
- **Measure:**
  - **G4 (code, Playwright):** from `/`, a citation panel displaying a rendered PDF
    page (or its explicit degraded fallback) opens in ≤ 2 clicks. Gate fails if the
    path requires scroll-hunting (target must be above the fold at 1440 and 390).
  - **V1 (visual judges):** rubric question "Would a skeptical journalist believe this
    site's numbers within 30 seconds — and could they say why?" median ≥ 4/5.

### Goal 2 — The connected graph has no dead ends

- **Why:** "The product is the connected graph" (spec §1). A graph you can't traverse
  in the UI doesn't exist for the user.
- **UX contract:** Header/footer IA exposes every surface: header gains **Districts**
  and **Feed**; footer gains **Filings** and keeps Downloads/Methodology/About. Home
  stat numbers become links (programs → /programs/, companies → /companies/, citations
  → /methodology/#verification, agencies → home grid anchor). Filing mentions on
  program/company pages link to internal `/filing/{uuid}/` pages (external
  lda.senate.gov link stays as the canonical co-link). Feed `new_entrant` cards link to
  their `/company/{slug}/` page when the family has one. Companies index gains
  filter/sort parity with the other tables. Agency breadcrumb no longer points at
  /programs/.
- **Measure:**
  - **G1 link-graph gate (code, new npm gate):** crawls the static export; asserts
    (a) zero orphaned indexes — every index page has ≥ 1 inbound link from
    header/footer/home; (b) all 12 page types reachable from `/` within ≤ 3 clicks;
    (c) every rendered entity reference that has a page links to it (feed family_keys,
    filing mentions, stat numbers). **Must fail against the pre-5C build** (proof
    recorded in the gate's test).

### Goal 3 — Honest about limits at the point of use

- **Why:** Honesty is a stated differentiator, and correct refusal is a scored skill
  (5/45 eval questions are REFUSE). Honesty that lives only on /methodology/ is
  honesty the user never sees.
- **UX contract:** Every partial surface renders an inline scope note with a
  "why →" link to the relevant methodology anchor (the feed's per-card "why?" pattern,
  generalized): follow-the-dollar (17/326), dossiers (50/326), company award tables
  (~18/200), district lens (106 districts, high-confidence links only), CA FY2025-only,
  FY2026 partial-year anywhere FY2026 totals render. Empty sections explain absence
  ("No district data — this program's awards haven't been crosswalked at high
  confidence") instead of disappearing.
- **Measure:**
  - **G2 coverage-banner gate (code, new npm gate):** a declarative coverage manifest
    (`site/src/lib/coverage.ts`) lists every partial surface with its numerator/
    denominator source; the gate renders affected pages and asserts the scope note is
    present and its numbers match the data (no hardcoded "17" that rots). Must fail
    pre-5C.
  - **V2 (visual judges):** "Does any chart/table imply completeness it doesn't have?"
    — must find none.

### Goal 4 — Each audience completes its job and leaves with an artifact

- **Why:** Spec-named audiences: journalists, Hill staffers, contractor-BD analysts
  (first paying segment), academics, citizens. A marketing surface succeeds when every
  visit ends in a takeaway (footnote, CSV, share card, one-pager, permalink).
- **UX contract:**
  - **Copy-as-footnote** button in the citation panel: one click copies a formatted
    citation (`"Program Element 0601101E, FY2025 enacted $293.145M — FY2026 DoD J-book,
    R-1, p.N; sha256:…; retrieved YYYY-MM-DD; govbudget.vercel.app/program/0601101E/"`).
  - **Print-clean dossier**: `@media print` stylesheet for program pages (nav/panel
    chrome hidden, citations render as footnotes) — the Hill-staffer one-pager.
  - Persona entry: home section routing the three primary jobs without insider nouns
    ("Verify a number", "See what a district builds", "Track who's winning contracts").
- **Measure:**
  - **G5 persona walkthroughs (agent-simulated, Playwright):** five scripted journeys
    run against the built site (journalist: land → find program → copy footnote;
    staffer: land → district → program → print preview renders one-pager; BD analyst:
    land → feed → new entrant → company lobbying-vs-obligations; academic: land →
    downloads → data dictionary; citizen: land → search plain term → dossier → share
    card meta present). Each asserts completion in ≤ 6 interactions.
  - **V3 (visual judges):** score each journey's legibility to a non-expert, ≥ 4/5.

### Goal 5 — Lead with the "so what": intent vs. outcome

- **Why:** Raw data is USAspending's job; ours is connecting intent to outcome. The
  analysis surfaces exist (feed 290 events, trajectory deltas, concentration, lobbying
  context) but ride below the fold or outside nav.
- **UX contract:** Program pages answer three questions above the fold at 1440:
  *what is this* (title + plain-language summary line), *what changed* (trajectory
  delta with cite), *who gets the money* (top recipient/concentration line with cite).
  Home leads with a real finding (rotating from feed top events), not only counts.
  Feed in primary nav (Goal 2). Influence stays correlational — "lobbied $X while
  receiving $Y", never causal phrasing (existing rule, now judge-checked).
- **Measure:**
  - **G6 above-the-fold gate (code, Playwright):** on 10 sampled program pages at
    1440×900 and 390×844, the three answer elements are present within the initial
    viewport (data-testid contract).
  - **V4 (visual judges):** "Does the page tell me something or just show me
    something?" ≥ 4/5; zero causal-language findings on influence surfaces.

### Goal 6 — Modern, professionally animated — with a motion system

- **Why:** User directive: "modern and professionally animated." Professional motion =
  restrained, consistent, purposeful; it stages the receipt moment and the
  follow-the-dollar story, it never decorates for its own sake (standing honesty rule:
  animations decorate real data, never substitute for it).
- **UX contract:** A single motion system (`site/src/lib/motion.ts` + CSS custom
  properties): duration tokens (fast 150ms / base 220ms / slow 320ms / story 600ms+
  for follow-the-dollar), one easing family (standard/decelerate/accelerate), stagger
  utilities for list entrances, shared hover/focus treatment for interactive cite
  chips and cards, citation-panel slide-in + PDF-page crossfade, scroll-triggered
  section reveals (IntersectionObserver, once, compositor-only transform/opacity).
  Category heroes and follow-the-dollar adopt the same tokens. **Global
  `prefers-reduced-motion: reduce` support**: all non-essential motion collapses to
  opacity ≤ 150ms; story animations render their final frame.
- **Measure:**
  - **G7 motion gate (code):** static scan — every transition/animation in src uses
    motion tokens (no ad-hoc durations outside the token file); reduced-motion CSS
    block present; animations restricted to transform/opacity (compositor-only
    allowlist, existing 5B-3 rule extended site-wide).
  - **V5 (visual judges, screenshots + short screen recordings):** new rubric
    dimension "motion design & modernity" — consistency, restraint, purpose — median
    ≥ 4/5 across home, program (dossier + flow), feed, panel-open interaction.

### Goal 7 — Instant, self-service, and never silently broken

- **Why:** Zero-backend is both the trust story and the scaling story. Degraded states
  currently fail silently (explorer/downloads without assets; dev-mode deep search).
- **UX contract:** Every asset-dependent surface renders an explicit, styled fallback
  when assets are unreachable (explorer: "data files unavailable — see downloads
  mirror note"; downloads: per-card unavailable state; PDF panel: existing fallback
  kept). Search UI hints when deep search is unavailable. Performance budgets hold.
- **Measure:**
  - **G3 degraded-mode gate (code, Playwright):** serve the build with `/assets`
    blackholed; assert every asset-dependent surface shows its explicit fallback (no
    blank sections, no unhandled console errors). Must fail pre-5C.
  - Existing LHCI + perf + a11y gates stay green (budgets unchanged).

## 4. Verification program (how 5C itself is judged)

1. **Evaluator-first sequencing:** build G1, G2, G3 first and record their failure
   against the pre-5C build; then implement until all gates green.
2. **Full gate suite:** existing 12 npm gates + G1–G7 + pytest/vitest suites.
3. **Visual judging:** 3 independent opus vision judges, rubric = existing 5B
   dimensions + V1–V5 above, screenshots at 390/768/1440 plus panel-open and
   follow-the-dollar recordings; median ≥ 4 per dimension; two rounds max then fix
   loop.
4. **Final code review:** opus whole-implementation review (established per-phase
   pattern).
5. **Live verification via computer use** (user-directed): after deploy to
   https://govbudget.vercel.app — drive the five persona journeys and the receipt
   moment in a real browser via the Chrome/computer-use tooling; verify every
   goal-mapped element on the live site; console/network clean; document with
   screenshots. R2 note: until R2 assets land, the PDF panel/explorer/downloads legs
   of the live pass verify the **Goal 7 fallbacks** instead of full fidelity, and the
   full-fidelity legs run against the local build; re-verify live after R2 upload.

## 5. Implementation punch list (mapped to goals)

| # | Change | Goal | Size |
|---|---|---|---|
| 1 | G1/G2/G3 gates built first, failing | 2,3,7 | M |
| 2 | Header/footer IA: + Districts, Feed (header), Filings (footer); agency breadcrumb fix | 2 | S |
| 3 | Home: clickable stats; featured receipt moment above fold; finding-led lede from feed; persona entry row | 1,4,5 | M |
| 4 | Internal filing links from program/company mention lists (keep external co-link) | 2 | S |
| 5 | Feed new-entrant → company links | 2 | S |
| 6 | Companies table filter/sort parity | 2 | S |
| 7 | Coverage manifest + inline scope notes + explained empty states | 3 | M |
| 8 | Copy-as-footnote in citation panel | 4 | S |
| 9 | Print stylesheet (program one-pager) | 4 | S |
| 10 | Program page above-the-fold answer block (what/changed/who) | 5 | M |
| 11 | Motion system: tokens, easings, stagger, panel/PDF transitions, scroll reveals, reduced-motion; adopt in heroes/flow/cards/chips | 6 | L |
| 12 | Degraded-mode fallbacks: explorer, downloads, search hint | 7 | S |
| 13 | G4–G7 gates + persona walkthrough scripts + judge rubric extension | 1,4,5,6 | M |
| 14 | Deploy + live computer-use verification pass + fix loop | all | M |

## 6. Non-goals (recorded, not forgotten)

- District **choropleth map** (promised in vision; data too thin at 106 districts /
  17 programs to be honest — revisit when crosswalk coverage grows; backlog).
- Interactive **entity-graph visualization** for company family trees (backlog).
- New data ingestion (PB2025 book-diff, more states, subaward mart) — separate phases.
- Accounts / saved searches / alerts (paid-layer features).
- Product rename/domain (still tabled; all copy stays name-neutral where possible).

## 7. Acceptance (phase exit)

Phase 5C is done when: G1–G7 green (with recorded pre-5C failures for G1/G2/G3),
existing gate suite green, visual judges ≥ 4 median on all dimensions including
motion, opus code review clean, deployed to production, and the live computer-use
verification pass completes the five persona journeys + receipt moment with zero
broken elements (degraded-mode legs acceptable until R2 assets land).
