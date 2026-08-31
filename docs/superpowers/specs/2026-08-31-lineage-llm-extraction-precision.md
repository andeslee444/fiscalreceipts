# ROADMAP #29(a) — LLM lineage extraction: the precision check, written first

**Date:** 2026-08-31 · **Status:** methodology fixed before any generation ran.

This document is deliberately written and committed **before** a single API call.
ROADMAP #30 reached 98.4% measured precision with one documented refusal because
its gate was designed first and then constrained the matcher. The same order is
used here. Everything below — the population, the verifier's refusal rules, the
adjudication key, the bar — is fixed in advance so that the measurement cannot be
rewritten around whatever the model happens to produce.

---

## 0. What the entry assumed, and what the corpus actually holds

The backlog entry sizes this work at "~1,950 prose transfers that name a move but
carry no adjacent PE code", pilot ~$2 and full pass ~$10–20. The first thing done
was to reproduce that number. It does not reproduce as a population of *extractable*
transfers, and the difference decides the whole design.

Measured over `detail_narratives` (all editions PB2017–PB2026, `not superseded`,
`xml_path not null` — the same universe `lineage/load.py` reads), split into
clauses by `extract.py`'s own `_SENT`:

| | count |
|---|---|
| narrative rows | 30,116 |
| clauses | 236,124 |
| clauses containing a transfer/rename/consolidation verb | 5,002 |
| … of those, with a `PE`/`program element`-prefixed code | 273 |
| … of those, **without** one | 4,729 (FY2026 alone: 1,756 — the entry's "~1,950") |

So the entry's population is real. What it is *made of* is the surprise. A hand
read of 40 random FY2026 members finds the overwhelming majority are not budget
identity moves at all:

* **technology / data transfer** — "Small Business Technology Transfer (STTR)",
  "enables the transfer of intelligence information across multiple domains",
  "transfer cognitive burden closer to the point of collection";
* **software or infrastructure migration** — "migration to a government DevSecOps
  framework", "DoDNet migration schedule";
* **within-PE project movement** — "efforts were realigned from Project EY7 … to
  Project/EY8", where both endpoints are projects inside one program element;
* **system renames, not budget-line renames** — "Next Generation Jammer Mid-Band
  (formerly known as Next Generation Jammer Increment 1)" names one system across
  two of its own marketing names, not two funded identities.

The subset that *is* a budget-identity move and *is* resolvable is much smaller,
and it is characterised precisely in §1.

## 1. The population that gets sent to a model

**Candidate clause** = a clause from the narrative universe above that

1. contains a transfer/rename verb, **and**
2. contains at least one token matching the program-element shape
   `\d{7}(?:[A-Z][A-Z0-9]{0,3})?` on non-alphanumeric boundaries.

Measured: **313 clauses**, of which **197** yield no directional match at all
under today's regex — the recall gap `extract.py:5` names. Distribution by how
many distinct PE-shaped tokens the clause carries: 1 token × 207, 2 × 91,
3 × 7, 5 × 8.

Condition (2) is the load-bearing one, and it is a refusal as much as a filter.
It says: **the model is never asked to name an endpoint the sentence does not
already contain.** Every clause the regex misses in this set misses it for a
mechanical reason, not a semantic one —

* *distance*: `_RULES` requires the code adjacent to the verb+preposition, and
  real prose interposes clauses — "transferred to Budget Activity-9 (BA-9)
  Program Element (PE) 0609277A";
* *prefix shape*: the rules require a bare `PE ` or `program element ` immediately
  before the code, so "Program Element (PE) 0609277A", "Program 0604009F",
  "(0609345A/A49)" and a bare "0609345A" are all invisible;
* *direction expressed without a preposition*: "Realignment starting FY 2026 to
  Lethal Semi-Autonomous Aerial Unmanned Sys-Eng Dev (0609345A/A49) funding line."

Reading a clause that contains its own endpoints is a comprehension task. Guessing
which program a bare English phrase refers to is a crosswalk task with a different
and much worse failure mode. This pass does only the first. §6 records the second
as an explicit, measured refusal.

## 2. The verifier — deterministic, and it runs after the model, not inside it

The model proposes; code disposes. A proposal only becomes a *candidate* (a row a
human then adjudicates) if it survives all of:

* **V1 verbatim endpoints.** Every PE code in the edge appears **verbatim** as a
  whole token in the cited clause, or is the narrating narrative's own `pe_bli`.
  A code that appears in neither is a fabrication and is dropped, not repaired.
* **V2 no `this`-pairing in a multi-code clause.** If the clause names two or more
  distinct PE-shaped codes, **both** endpoints must come from that set; the
  narrating PE may not supply one. This is the generalisation of the Defect-1
  subject-position guard, and it is what makes the 5I fabrication incident —
  rollup lines aggregating statements about *other* PEs, paired with `this` —
  structurally impossible here rather than merely unlikely.
* **V3 shape.** Both endpoints match the PE shape. **Numeric-only line items are
  refused** — see §6.1; this is not a shortcut, it is the only honest answer.
* **V4 grain.** The relation must be one of `realigned | renamed | split | merged`
  and must be a *budget identity* move. Project codes, effort names, system names
  and organisational names are not endpoints.
* **V5 no self-retraction.** `extract.py`'s own `_window_is_negated` is *imported*
  and re-applied to (clause, next clause). Not re-implemented — the repo has now
  recorded three defects caused by a predicate re-derived beside the thing it
  checks.
* **V6 no supersession.** `extract.py`'s own `superseded_reason` is imported and
  applied across the full multi-edition edge set.
* **V7 no self-loop**, and no pair the regex tier already mints (regex wins; one
  link is one edge).
* **V8 no `portion_amount`, ever.** `/lineage/` draws every ribbon at one constant
  width on the premise that no edge states an amount, and `verify-lineage` leg (i)
  and `lineage/flow.py` both *raise* if that premise breaks. A dollar figure in the
  sentence is evidence about the transfer, not a width to draw.

## 3. Ratification — nothing ships that a person did not sign

Candidates are written to `data-seeds/lineage_llm_edges.csv`, one row per proposed
edge, carrying `verdict ∈ {y, n}` plus the adjudicator's note. `lineage/load.py`
mints **only** verdict-`y` rows. An unadjudicated row is an error, not a default —
`load_ratified` raises on any verdict outside the set, exactly as
`oversight/gao_xwalk.py` does for the GAO crosswalk.

This is why the extractor may be a language model and the edge may still be a
fact: the model's job is recall over 313 clauses; the human's job is precision;
the gate's job is to prove the two never drift apart.

## 4. How precision is measured

**The question adjudicated,** per candidate, is exactly this: *does the cited
clause, read inside its own paragraph, assert that this program's money or effort
became that program's, in the direction the edge records?*

A `y` requires all four of:

1. it is a **budget identity** move (not technology transfer, not a within-PE
   project move, not a system rename);
2. the two endpoints are the two the clause names;
3. the **direction** matches;
4. the clause is not retracted by itself or its neighbour.

**Sample: all of it.** Every proposed edge in the pilot is adjudicated by hand —
not a sample of them. The population is small enough that a sample would buy
nothing but a wide confidence interval.

**The second source.** Precision is never scored against the extractor's own
confidence — that measures agreement with itself. Each candidate is adjudicated
against two independent things:

* **S1 — the paragraph.** The full narrative body around the clause, read
  verbatim. Direction errors and retractions hide at clause boundaries.
* **S2 — the counterparty's own book.** The other endpoint's title in
  `dim_pe_titles` and, where it exists, its own narrative. If the clause says
  "transferred to PE 0609345A, Lethal Semi-Autonomous Aerial Unmanned Sys-Eng
  Dev" and the warehouse's 0609345A is a different program, the edge is wrong
  however well-formed it looks. This is the direct analogue of #30's rule that
  every candidate be checked against "the budget line's own J-book narrative on
  that page, not its title".

**Precision = `y / (y + n)`** over adjudicated candidates. Verifier refusals are
**excluded from the denominator** — they never reach a reader — and reported
separately with a reason each, because the refusals are the part of this exercise
with the longest shelf life.

## 5. The bar, fixed now

Publish only if **both** hold:

* pilot precision **≥ 95%**, and
* every `n` is suppressible by a **rule that generalises** — a new verifier clause
  or a prompt constraint — not by a one-off blacklist entry.

If either fails, the pass stops and reports, and the smaller true edge set stands.
The owner's standing rule is to publish the smaller true number.

## 6. Refusals decided in advance (before any spend)

### 6.1 Numeric line-item endpoints — refused

Procurement prose does name budget lines: *"Starting in FY 2026 funding transfers
from Line Item (LI) 1350 to LI 1250 and continues through the outyears."* That is
a genuine identity move at the right grain. It is still refused, because **`pe_bli`
is not unique for numeric lines.** Measured on `dim_programs`: 1,936 rows,
**1,922 distinct `pe_bli`** — and the collisions are exactly here. `1350` is both
Navy account 1508N *Infantry Weapons Ammunition* and 1507N *Missile Industrial
Facilities*; `3050` is both 1810N *Ship Communications Automation* and 1611N
*Medium Landing Ship*; `2101` is *Tomahawk* in two accounts.

"LI 1250" therefore does not name one program page. Resolving it to one would be
the fabricated-endpoint defect wearing a citation — a true sentence pointing at the
wrong program. 432 of 1,936 corpus programs are numeric-only, so this refusal is
not a rounding error; it is the largest single thing this pass declines to do, and
it is declined on a measured ambiguity, not a hunch.

### 6.2 Title-only endpoints — out of scope for this pass

The ~4,400 clauses with a verb and no code would need an English-phrase → PE
crosswalk. Budget prose names systems and efforts far more often than program
elements, so that crosswalk's dominant error is confidently resolving a *system*
name to a *budget line* — again a true sentence with a false endpoint. It is a
separate matcher with a separate precision measurement, and it is not smuggled
into this one.

### 6.3 Project-to-project moves — refused

"…Project 623145 … transferred to 622403 …" is real and is not a program lineage
edge. The lineage layer's grain is `pe_bli`. V3's shape rule refuses most of these
mechanically; V4 refuses the rest.

### 6.4 Amounts — refused

Sentences do state dollars ("FY26 funding ($4.108M) … was transferred"). No
`portion_amount` is recorded from any of them. §2 V8 gives the reason: the
`/lineage/` diagram's uniform ribbon width is honest **only** while no edge carries
an amount, and two independent places raise if that stops being true. Recording an
amount here would silently turn a constant width into a lie about magnitude.

## 7. The gate

`verify-lineage` gains **leg (j) ratification**. The npm suite stays at 24 —
`verify-lineage` is its own CLI, as recorded for legs (g)/(h). Leg (j) asserts,
against the **live persisted table** and the **committed seed**:

* every `program_lineage` stated edge sourced from this pass traces to a
  verdict-`y` seed row;
* the seed row's clause is the edge's `evidence_sentence`, byte for byte;
* both endpoints appear verbatim in that clause, or are the narrating PE under
  V2's single-code condition — the anti-fabrication invariant, re-checked on what
  actually shipped rather than on what the extractor believed;
* no verdict-`n` row is present in the table;
* every seed row still corresponds to a clause that exists in the corpus (a stale
  row whose evidence moved is a FAIL, not a row to trust on inertia).

Legs (a) (f) (g) (h) (i) already apply to any new stated edge unchanged: it must
cite a narrative that re-derives, must not retract itself, must resolve in the
built cite-shards, must not be superseded, and must appear in the diagram with
`portion_amount` null.

**Non-vacuity is structural.** The population leg (j) checks *is* the shipped
llm-sourced stated set; an empty seed with llm-sourced edges present FAILS, and a
seed row the corpus no longer supports FAILS. The leg knows no literal count.

## 8. Cost

Model `claude-opus-5` via the Batch API at the 50% discount ($2.50 / $12.50 per
MTok). One request per clause, so a wrong clause cannot contaminate its neighbours.
`estimate_cost`-style pre-flight prints its basis; `COST_CAP_USD` is set to a real
ceiling and is not raised to make a batch fit. Because the extractable population
is 313 clauses rather than ~1,950 title-only ones, the expected spend is well under
the entry's $10–20 — that is a consequence of §1 and §6, not a target.
