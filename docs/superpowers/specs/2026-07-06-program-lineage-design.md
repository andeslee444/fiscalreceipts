# Program Lineage — Following the Money Across Identity Changes

**Date:** 2026-07-06
**Status:** Approved (user: "There are a lot of program elements and projects that are
transferred, even though the funding is for the same thing… create an internal linkage
system that tracks these changes YoY"). Design decisions confirmed: **Gold + Inferred**
edge tiers; **family funding line summed over Stated 1:1 links only**.
**Depends on:** the ingested R-2/P-40 narratives (`detail_narratives`, 80,057 rows),
`fct_decade_series` (59,068), `fct_book_diff`, `dim_pe_titles`, the `/flow/` Sankey
renderer, the `/years/` matrix, the citation infrastructure.

## 1. The problem

A DoD program's *funded activity* persists, but its *program-element identity* does not.
Money moves between PE/BLI identities through well-understood mechanisms:

1. **Budget-activity maturation** (the largest source): a program is renumbered as it
   climbs the RDT&E ladder — BA-3 Advanced Technology Development → BA-4 Advanced
   Component Development → BA-5 System Development → BA-7 Operational Systems. `0603xxx`
   becomes `0604xxx` becomes `0605xxx`.
2. **Appropriation-color change**: dev→production moves the money from RDT&E to
   Procurement (a different exhibit).
3. **Realignments / transfers** (partial or full), stated in the "Program Change Summary".
4. **Restructures**: split (one PE → several), merge/consolidate (several → one), rename.
5. **Congressional adds, SBIR/STTR tax transfers, WCF transfers.**

Today the site shows each PE as an isolated row whose funding line drops to zero when it
is renumbered, and a "new" program appears — the exact confusion the user described. This
phase builds an **evidence-tiered lineage layer** so a user can follow one activity's
money across all its identities.

## 2. Feasibility — measured, not assumed (extraction probe, 2026-07-06)

Of ~2,038 narratives containing transfer language, a strict "verb + adjacent `PE ####`"
regex yields **~76 candidate edges / 38 distinct program links** (20 in FY2026 books) —
**gold-precision and clean** (e.g. `0603826D → 0604294D8Z`: *"transferred from PE
0603826D"*; `0602702E` consolidates `0602716E`+`0603766E`+`0603767E`). The other ~1,950
transfer sentences describe a move without a PE code adjacent to the verb (referent
elsewhere in the paragraph, or an appropriation like "transferred to O&M"). **Conclusion:
regex Stated edges are a small, rock-solid backbone; coverage comes from the deterministic
Inferred layer.**

## 3. Data model

New mart **`program_lineage`** — directed edges, one row per link:

| column | meaning |
|---|---|
| `from_pe_bli`, `to_pe_bli` | predecessor → successor identity |
| `fiscal_year` | the edition/FY the link is asserted in |
| `relation` | `matured_ba` · `realigned` · `split` · `merged` · `renamed` · `appropriation_transfer` |
| `portion_amount` | $ moved, when the book states it (nullable) |
| `confidence` | `stated` \| `inferred` |
| `evidence_fact_id` / `evidence_sentence` / `evidence_page` | for `stated` edges: the cited R-2/P-40 sentence + page (the same provenance contract as every other fact); NULL for `inferred` |
| `inference_basis` | for `inferred` edges: `ba_maturation_same_title` \| `funding_handoff` \| `title_continuity` |

New view **`program_family`** — connected components over **`stated` edges only** (Phase
1). Each family has a stable `family_id`, its member PE identities, and the ordered
timeline. Inferred edges are surfaced as candidate links but do **not** merge families.

## 4. Extraction (both deterministic, no API in Phase 1)

**Stated tier** — regex over `detail_narratives.body`: verb (`transferred|realigned|
previously (funded|budgeted)|formerly`) + directional preposition + `PE ####` token.
Each match becomes a `stated` edge citing the sentence + the narrative's page/fact_id.
Direction is derived from the preposition (`from`→predecessor, `to`→successor). TDD
against a hand-labeled sample; target ≥95% precision (a wrong lineage is worse than none —
same bar as every other cited fact). *(Phase 2 optional: LLM extraction over the ~1,950
prose transfers to mint more `stated` edges, each verified to resolve, gated on an
extraction-precision check — uses the API.)*

**Inferred tier** — deterministic, from the marts already built:
- `ba_maturation_same_title`: PE `06Nxxx…` and `06(N+1)xxx…` share a normalized title and
  adjacent budget activities, with the predecessor's request tapering as the successor's
  rises (read from `fct_decade_series` / `fct_budget_trajectory`).
- `funding_handoff`: a PE's request → 0 in edition E while a title-matching PE first
  appears in E (from `fct_book_diff`).
Emitted as `inferred` with `inference_basis`, **never** as fact.

## 5. Honesty rules (extends cited-or-absent to lineage)

1. **Stated = solid, cited.** Rendered as a solid link; clicking opens the exact sentence
   + page (existing citation panel). No stated edge ships without a resolvable citation.
2. **Inferred = dashed, "candidate (unverified)."** Visually distinct (dashed, amber),
   labeled, and behind an opt-in "show possible connections" affordance on first view.
   Never counted, never summed, never stated as fact.
3. **Family funding line sums only Stated 1:1 edges.** Pure renames / full transfers
   stitch into one continuous line. Splits, merges, and inferred links render as honest
   **branches/breaks** — the line ends where the evidence ends; the summed total is always
   defensible. Partial transfers (`portion_amount` present) never reparent the whole line.
4. **No fabricated continuity.** Where lineage is ambiguous the UI says so; it never
   invents a clean thread.

## 6. Surfaces

**Phase 1 (this spec):**
- **Lineage rail** on each program page (`data-section="lineage"`): a compact
  predecessor → THIS → successor timeline strip; solid=stated (cited), dashed=inferred;
  edge labels (`transferred from`, `BA-maturation`, `split → 41%`); each stated link cites
  its sentence. Renders only when the PE has ≥1 lineage edge; honest empty state otherwise.
- **Reconstructed program-family funding line**: the summed multi-year trend across the
  family's Stated 1:1 chain, with transfer-join and split-break markers (per §5.3). Every
  point is a `<Cite>` on the underlying decade-series fact.
- **Threaded `/years/` matrix**: rows in the same `program_family` get a connector/thread
  affordance so related identities read as one lineage rather than programs blinking in
  and out. No new columns; a grouping overlay.

**Phase 2 (separate spec, deferred):** a **lineage Sankey** (reuse the `/flow/` renderer)
— identities as nodes over time, dollar ribbons for transfers/splits/merges; and the
LLM-extracted Stated edges.

## 7. Verification (evaluator-first)

- **`lineage` gate (built first, proof-can-fail):**
  (a) every `program_lineage` row with `confidence='stated'` carries a resolvable
  `evidence_fact_id`/sentence that re-derives to the cited narrative (sample ≥30);
  (b) no rendered page presents an `inferred` edge without the dashed/"candidate" treatment
  (render-static scan);
  (c) the family funding line's summed value equals the sum of exactly its Stated-1:1
  members' decade-series facts (recompute ≥10 families from the lake) — a split/merge/
  inferred member in a summed total FAILS;
  (d) extraction precision: on the hand-labeled sample, stated-edge precision ≥95%.
- Full suite + a visual-judging round (does the rail read as honest? do dashed candidates
  read as clearly-unverified?). Live pass: a stated link opens the cited sentence in prod.

## 8. Non-goals

- LLM extraction and the lineage Sankey (Phase 2).
- Cross-appropriation (RDT&E↔Procurement) money-color lineage beyond what a stated
  narrative asserts (harder; later).
- Merging families on inferred edges (Phase 1 families are stated-only).
- Any auto-generated "this program is really that program" claim without a citation.
