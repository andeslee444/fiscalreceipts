# Tri-Persona Review Remediation — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close everything three independent audience reviews found, in an order
that puts false claims before missing features.

**Architecture:** Five waves. Waves run **serially** — every one ends in a
`next build`, and concurrent builds have already produced two fictional gate
failures and one `pkill`'d process in this project. Within a wave, work is one
agent unless the files are provably disjoint.

**Spec:** the three reviews (layman / reporter / analyst) delivered 2026-08-27,
summarised inline below. Every figure here was reproduced by the orchestrator
against the warehouse or the live site before being written down.

---

## Global Constraints

- **24 gates.** Add legs to existing gates; never a 25th. `grep -c "gateResults.push" site/scripts/verify.mjs` → `24`.
- **Proof-can-fail** on every new leg: verbatim FAIL against a genuinely broken
  artifact, then verbatim PASS, both into `docs/superpowers/reviews/5c-gates-pre-failure.txt`.
- **Never weaken** a gate, threshold, ceiling, eval or test to make something pass.
- **No ceiling raises.** `/data/` ~330 bytes gzip headroom, `/companies/families/` ~495,
  `/methodology/` ~745. Re-measure with the gate's own logic: import `PAGE_WEIGHT_BUDGET`,
  `zlib.gzipSync(buf,{level:9})`, **raw-heaviest** for `dir:` entries.
- **Build AFTER committing** — gate 1 pins `git_head`. dbt is
  `uv run dbt build --project-dir dbt --profiles-dir dbt`; export is
  `uv run python -m govbudget export-site`.
- Commit `--author="Andes Lee <andes.lee444@gmail.com>"`, explicit `git add <path>`,
  never `git add -A`. Do not push or deploy. Do not edit `ROADMAP.md` (orchestrator serialises).
- **No new hard-coded literals** for figures that have a derived source. A stale
  literal is the defect this project keeps finding (`measured:`, "~6% headroom",
  the SBIR/STTR category that appears on zero rows).

---

## The finding that organises everything

All three reviewers, working independently with different jobs, found defects of
**one shape: a true, correctly-cited number wearing a false label.** The 24-gate
suite checks *number ↔ citation* exhaustively and *claim ↔ evidence* nowhere.

The `/agency/` case is the sharpest and gets its own treatment in Wave 2: every
figure is true and cited, and the falsehood is produced by **sorting** correct
but unevenly-covered values against each other. There is no wrong number to catch.

---

## Wave 1 — false claims currently live  ⟵ IN FLIGHT

Owned by the running P0 agent. Listed for completeness; do not duplicate.

| Item | State |
|---|---|
| `/coverage/` said missing volumes "do not exist publicly" | **DONE** `01af3f8` (orchestrator) |
| Reconciliation qualifier absent from feed / RSS / `/years/` / homepage movers | in flight |
| Reconciliation strip credits reconciliation money to "advance procurement" | in flight |
| `/programs/` "$385.3B FY2026 request" omits procurement+RDT&E scope | in flight |
| `/methodology/` "Failures do not get published" vs 9,828 published `reconciled=false` rows | in flight |
| `/agency/` ranks by ingestion completeness, not spending | in flight |

---

## Wave 2 — the two badges that are wrong at scale

**Verified:** `fully_reconciled = bool_and(reconciled)` (`dim_programs.sql`) includes
the `AllPriorYears` scenario, which is **100% unreconciled by design** (3,267 of
3,267 rows; `accuracy_gate` excludes it from scope). Result: 344 programs read
"Fully Reconciled"; **1,343 read "Partial Reconciliation" although every in-scope
scenario ties**; 52 read the same badge with a genuine failure. A reader cannot
tell 1,343 from 52, the term is undefined on the page and absent from `/glossary/`.

**Also verified:** FY2024 "Enacted" is the **request with CR adjustments** —
cell `K2` of the PB2025 workbook reads `"FY 2024 PB Request with CR Amounts*"`,
and **98.2% of FY2024 "Enacted" values are byte-identical to the FY2024 request**
(1,736 of 1,767). The program-page citation panel discloses this correctly one
click deep. `/years/` **loses the qualifier entirely** — and `/years/` is the
surface where cross-program "asked vs got" analysis happens.
`EXTENDED_MEASURE_LABEL["enacted-request"]` already exists in `basis.ts` and never renders.

- [ ] Exclude `AllPriorYears` from the badge predicate; distinguish "no in-scope
      failure" from "has an in-scope failure". Define the term on the page and in
      `/glossary/`.
- [ ] Surface the enacted-request qualifier on `/years/` column headers, cells and
      CSV export. A `†` on the header closes it.
- [ ] Gate: a measure label rendered on a figure must match the `amount_type` behind
      it. Proof-can-fail against the current build.

---

## Wave 3 — the newcomer cliff

The layman review's exit moment, verbatim: *"the site is a filing cabinet, not an
answer."* Three cheap changes, ranked by readers retained.

- [ ] **`WHO GETS IT` on program pages.** `/program/ATA000/` says "No award linkage
      at high confidence" while **"Lockheed" appears 29 times on the same page**
      (verified). USAspending does not publish the program element on award records,
      so the crosswalk covers **24 of 1,753 programs (1.4%)** and always will. Make
      the box a tiered answer, not a dead end — name the companies whose lobbying
      filings cite the program, explicitly labelled as *not* proof of contract award.
- [ ] **Homepage hero.** Currently opens on `HHI=3820 (2022) — the program's pooled,
      all-years HHI can differ`. Replace with a fixed plain-English sentence; move the
      anomaly to `/feed/`. Also: the intro tooltip covers the headline at ≤1280px.
- [ ] **Glossary reachable.** Linked twice per page, both in the footer, never from a
      term. Put it in the nav; link `TOA`, `P-40`, `PE`, `HHI`, agency codes to their entries.
      Add "actuals / enacted / request" — the three most load-bearing words on the site
      and absent from the glossary.
- [ ] **`/feed/` sorts by budget-line code.** It opens on a $46.7M change because
      `0101213F` sorts first. Sort by dollar magnitude.

---

## Wave 4 — analyst gaps that are cheap

- [ ] `/downloads/` links are `/assets/data/*.parquet` and **404 without JavaScript**
      (rewritten client-side from `config.json`). Copy-link, `curl` and scripted
      fetch all get a 404. Emit absolute asset-host URLs server-side.
- [ ] `budget_lines_decade` (32,642 rows) is queryable on `/data/` and **absent from
      `/downloads/`**; `fct_district_totals` likewise.
- [ ] Document the **`Add`/`Non-Add` P-1 filter**. It is the single most important
      aggregation decision on the site and is stated nowhere; an analyst summing the
      workbook naively gets $221.3B against the site's $205.0B and concludes the site
      is wrong.
- [ ] Corpus headline is stated four ways (1,755 / 1,743+2,005 / 1,753 / 2,016). Each
      is right for its own denominator; nothing says so.
- [ ] `/years/` missing from `sitemap.xml`. No agency page for DEFW ($5.65B) or DHA ($970M).
- [ ] `/coverage/` lineage rule says an edge needs a sentence naming **BOTH** endpoints;
      **33 of 49 (67%) quote a sentence naming one**, the other coming from the
      narrative's own PE. The edges are sound — the *rule as written* is not the rule
      enforced. Fix the sentence.

---

## Wave 5 — the ingestion that closes the biggest gap

**25 FY2026 justification volumes are downloaded and unparsed** — Navy 11 of 13,
Army 10 of 20, Air Force 4 of 11 — including the Navy shipbuilding book carrying
Virginia, Columbia and DDG-51. Extracted XML is already on disk under
`data/raw_docs/fy2026/{n,a,f}/xml/`.

This is ~$75.4B of FY2026 request across ~206 Navy program pages that currently
tell readers their justification carries no R-2/P-40 detail — true of this build,
false of the public record. It is also what makes `/agency/`'s ranking wrong.

- [ ] Ingest, one service at a time, verifying reconciliation after each.
- [ ] Re-check `/agency/` ranking and per-org coverage after each service lands.
- [ ] Then revisit Wave 1's `/coverage/` prose — it should shrink as the backlog does.

---

## Deferred, with reasons

- **PDF page preview never loads** ("Loading page 55…" forever; no network request
  attempted, no console error). Reproduced only in automated Chrome — **confirm in a
  real browser first**. If real, it is high priority: it is the exact affordance where
  a reporter would catch a bad citation.
- **RTX $238.6B** includes "Rockwell Collins Australia Pty Limited — $19.5B",
  implausible on its face. Disclosed as name-inferred, medium confidence, with visible
  component arithmetic — honest, but a reporter citing the total inherits it.
- **Search ranking**: "submarine" returns Submarine Batteries first and Virginia Class
  last. Ranked by name-prefix, not magnitude.
- `run-mobile-leg.mjs` standalone crash (chip `task_08cdaf37`) — gate fine, runner broken.
- `#29(d)`, `#28` (624 decade-only pages), `#29(a)` (approved LLM extraction) — the
  pre-existing queue, resumed after Wave 3.

---

## Self-review

**Coverage:** every finding from all three reviews is placed in a wave or the
deferred list with a reason. Nothing is dropped silently.

**No placeholders:** each item names the file or surface, the measured evidence,
and what "done" means. Where a figure came from a reviewer rather than the
orchestrator's own check, the step says *verify first*.

**Ordering rationale:** Waves 1–2 are false claims, 3 is retention, 4 is cheap
analyst debt, 5 is the expensive fix that dissolves several earlier items. Wave 5
deliberately runs last so the prose corrections in Wave 1 are not written twice.
