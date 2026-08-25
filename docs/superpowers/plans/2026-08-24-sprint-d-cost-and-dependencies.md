# Sprint D — cost derivation, dependency map, sequencing

**Status:** research only. Nothing was spent, no API was called, no pull was run,
no warehouse or site artifact was rebuilt. Every number below is either read out
of a committed artifact or computed offline from one.

**Why this exists:** the Sprint D budget line in
`2026-08-07-backlog-drawdown.md` is a single number — *"the original batch was
~$28.6"* (lines 931 and 1021) — with no derivation anywhere in the repo. This
project exists to catch exactly that shape of figure. It is wrong, and the
premise it is attached to is wrong in a more consequential way.

---

## 1. The cost of the LDA re-pull + dossier regeneration

### 1.1 Inputs, each with a source

| Input | Value | Source |
|---|---|---|
| Model | `claude-opus-4-8` (Claude Opus 4.8) | `src/govbudget/dossiers/batch.py:46`; confirmed as `message.model` in all 14 archived API results |
| List price | $5.00 in / $25.00 out per MTok | Anthropic model table (Opus 4.8 row), via the `claude-api` skill |
| Batch discount | 50% → **$2.50 / $12.50** | Batch API; every archived result carries `usage.service_tier == "batch"` |
| Cache read | 0.1× base → $0.50, batched **$0.25** | prompt-caching rates |
| Cache write, 1h TTL | 2× base → $10.00, batched **$5.00** | `build_requests` sets `cache_control: {type: ephemeral, ttl: "1h"}` on the system block |
| `MAX_OUTPUT_TOKENS` | 16,000 | `batch.py:47` |
| `BUNDLE_TOKEN_CAP` | 40,000 | `batch.py:48` |
| Dossiers in scope | **50** | `data/site/json/dossiers/*.json` |
| Ground truth | **14** archived results carrying exact `usage` | `data/research/dossiers-raw/*.json` |

The other 38 committed raw dossiers carry a `provenance` marker instead of a
`usage` block — they were authored by Claude Code subagents in phase 5G-dossiers,
not through the Batch API, so they cost nothing on the API bill.

### 1.2 What the shipped estimator would print

`estimate_cost()` assumes **output = the full `MAX_OUTPUT_TOKENS`** for every
dossier. Run offline against today's live top-50 (chars/4 heuristic counter,
`client=None`, zero API calls):

```
N=50   total input 326,563 tok (mean 6,531)
ESTIMATOR TOTAL = $10.82
```

With a real `count_tokens` counter it would print about **$11.2** — the
heuristic under-counts real input by a measured 1.41× in aggregate (§1.4).

### 1.3 What it will actually be billed

The 14 archived results give exact billed token counts:

| | mean | median | max |
|---|---|---|---|
| input tokens | 14,279 | 13,983 | 39,573 |
| **output tokens** | **1,686** | 1,920 | **2,348** |

Output is the whole story: the estimator assumes 16,000 output tokens per
dossier; no dossier has ever produced more than 2,348. The estimator over-states
the output side by **~9.5×**, and output is 92% of its total.

Billed cost of those 14 at Batch Opus 4.8 rates (input + output + cache read +
1h cache write): **$0.8531 total, $0.0609/dossier**, ranging $0.0047–$0.1250.

### 1.4 Projection to all 50

Calibrating the offline heuristic against the 12 measured PEs that are still in
today's top-50 gives real/heuristic = 1.41 aggregate (1.43 median). Applying that
to today's 50 bundles, with the measured 1,686-token mean output and one 1h cache
write for the batch:

| Scenario | Total | Per dossier |
|---|---|---|
| Aggregate calibration (1.41×) | **$2.12** | $0.042 |
| Conservative calibration (2.0×) | **$2.55** | $0.051 |
| **Absolute ceiling** — all 50 hit `max_tokens=16,000` | **$11.07** | $0.221 |

### 1.5 So the $28.60 is not derivable

$28.60 is **13.5× the realistic bill** and **2.6× the absolute ceiling** under
the pipeline's current caps. It is even above what the estimator itself would
print. It appears exactly twice in the repo — both in the backlog-drawdown plan,
introduced by commit `5bac852` — and nowhere else; there is no batch record, log,
or prior plan behind it.

Best reconstruction (**unverified**): 50 × (≈34.4k input × $5/MTok + 16,000
output × $25/MTok) = $28.6 — i.e. **full list price with the Batch 50% discount
omitted**, near-cap bundles, and a full 16k output. The pipeline has never
submitted at list price: `submit()` goes through `client.messages.batches.create`
and every archived result reports `service_tier: "batch"`.

### 1.6 The larger correction: the re-pull does not require 50 regenerations

ROADMAP #19 and plan task D1 both rest on this premise:

> *"the re-pull can change filing amounts, and fact identity includes amount, so
> it can orphan the 50 static dossier claims that cite lobbying facts."*

Both halves are false.

**(a) Amount is not part of fact identity.** `export_site.py:92-99`:

```python
def fact_id_lda_filing(filing_uuid: str, role: str) -> str:
    return hashlib.sha256(f"lda_filing_amount|{filing_uuid}|{role}".encode()).hexdigest()[:16]
```

The hash is over `(filing_uuid, role)`. A changed filing amount changes
`recorded_value`, not the `fact_id` — the citation still resolves. (Mention-grain
`fact_id_lda(filing_uuid, pe_bli, matched_term)` is likewise amount-free.)

**(b) One claim is exposed, not fifty.** Across all 50 dossiers there are **686
claims** citing **432 distinct fact_ids**. By kind:

| kind | count |
|---|---|
| workbook | 162 |
| jbook_narrative | 120 |
| derived | 89 |
| jbook_pdf | 60 |
| **lda_filing** | **1** |

Exactly one claim — in `0607210D8Z` (Industrial Base Analysis and Sustainment) —
cites an LDA fact: `0010cfea95c30893`, filing
`57a5f526-d6e0-402e-9f23-d2d4bd696ce8`. Its text ("A 2025 Lockheed Martin filing
referenced the FY26 National Defense Authorization Act and issues relating to
acquisition and the industrial base") quotes no dollar figure, so a changed
amount does not even make the prose stale.

None of the 89 `derived` facts is influence-derived — they are budget-line sums
(`fy_2026_total`, `fy_2024_actuals`), YoY deltas, award obligations, and HHI. The
re-pull cannot move any of them.

**Therefore:** the only way an LDA re-pull breaks a dossier is if that one filing
disappears from the re-pulled result set. Repair cost if it does:
**regenerate one dossier ≈ $0.07.** If it doesn't: **$0.00.**

**The LDA pull itself is free.** `influence/lda.py` hits
`https://lda.senate.gov/api/v1` — a public, unauthenticated API with polite
rate-limiting. It costs wall-clock time, not money. Steps 2 and 3 of D1 (dbt
marts + mentions rebuild, `export-site`) are local compute.

### 1.7 Spend guards, caps, and cached-run mechanisms that already exist

| Mechanism | Where | What it does |
|---|---|---|
| **Pre-flight dollar cap** | `dossiers/batch.py` — `COST_CAP_USD = 50.0` | `submit()` estimates, prints per-dossier lines, and `SystemExit`s **before creating any batch** if the estimate exceeds the cap. `--cost-cap` overrides. **This is the only dollar-denominated guard in the codebase.** |
| **Cached-run / re-collect** | `data/research/dossiers-raw/` (committed) | `collect()` archives every raw result; `batch_meta.json` persists `batch_id`, per-bundle tokens, and the estimate. Paid artifacts are re-collectable without re-paying. 52 raw dossiers are committed today. |
| **No-key hard stop** | `common/anthropic_client.require_client` | Every API entry point (`dossiers submit/collect`, `analyst`, `verify-phase5` eval gate) `SystemExit`s when `ANTHROPIC_API_KEY` is absent. No key, no spend. |
| **Bounded retry** | `verify_phase5.resolve_citation_with_retry(max_attempts=2)` | At most one extra agent call per question. Bounded by attempts, **not dollars**; spend recorded as `citation_retry_total_cost_usd`. |
| **Reporting only, no cap** | `analyst/agent.py` `CostAccumulator` (Sonnet 4.6, $3/$15, cache read $0.30), `MAX_TURNS = 8` | Prints spend after each run. Does not stop one. |

**The eval gate has no dollar cap.** Empirically, from the 24 archived
48-question runs in `data/research/eval-runs/`, a full `verify-phase5` eval run
costs **$0.70–$0.88, median $0.79**. (The drawdown plan's "~$0.60" is low but the
right order of magnitude.)

**Gap worth closing, free:** give the eval gate the same pre-flight shape
`dossiers submit` already has — a printed estimate and a `--cost-cap` abort.

### 1.8 The monthly spend limit

**Not representable in this repo.** `.env` carries `ANTHROPIC_API_KEY` and four
R2 keys — no budget variable — and nothing under `src/` or `scripts/` reads one.
The monthly cap that was hit before (ROADMAP #22, raised by the user 2026-07-05)
is an **Anthropic Console organization/workspace setting**; the repo's only trace
of it is prose in ROADMAP #19 and #22. Recommendation: set an explicit workspace
spend limit in the Console so the ceiling is enforced where the spend happens,
not remembered in a markdown file.

---

## 2. Dependency map

```
#1  curated client aliases (STAGED, inert)
      │  REAL BLOCK — the staged aliases only match at the next pull
      ▼
#19 LDA re-pull ──┬─► match_gate5a raise to 0.85   (blocked: must measure live rate first)
                  ├─► dossier repair               (CONDITIONAL, ≤1 dossier, ≈$0.07 — not a blocking step)
                  └─► rides along: any program_aliases.csv edits land in the same
                      dbt/mentions/export ripple at zero extra cost
#55 flagship alias curation   OWNER work. Blocks nothing. Blocked by nothing. Free.
                              ↳ best done BEFORE #19 so it rides the same ripple.
#29 lineage Phase 2
    (b) multi-edition citations   FREE, independent, unblocks the 28 dropped pre-2026 stated edges
    (a) LLM extraction (~1,950)   PAID. Independent of #19. Gate on a precision check.
    (c) lineage Sankey            FREE. Renders whatever edges exist; more edges just improve it.
    (d) cross-appropriation       FREE (deterministic).
    └─ plan D2 (#32b pe_remap) is asserted upstream of D3 by the drawdown plan's own self-review.
#30 program-level GAO ingestion   FREE + independent. Public GAO reports; the report→pe_bli
                                  crosswalk is a deterministic title/PE match behind a precision
                                  gate — same shape as every other crosswalk. No API needed
                                  unless someone chooses an LLM crosswalk.
#28 decade-only pages             FREE. An editorial decision, not a data defect. Independent,
                                  but sequence after B2 and D2 or the "no FY2026 request" note
                                  gets written twice.
```

**What genuinely blocks what:** only two edges are real — #1 → #19, and #19 → the
match-gate raise. Everything else in the Sprint D set is independent, and
**everything except #29(a) and the conditional 1-dossier repair is free.**

**Sizing for #29(a), the one genuinely paid item left.** ~1,950 prose transfers
(`lineage/extract.py:4`). At Batch Opus 4.8 with a cached shared preamble, a full
pass is order **$10–20**; a 200-narrative precision-calibration slice is order
**$1.50–2**. These are order-of-magnitude only — the honest way to firm them up
is a `count_tokens` pass over the actual clause set, which is **not billed for
inference**, only rate-limited. Not run here.

---

## 3. Recommended sequencing

Ordered so the owner can approve a small first step instead of the whole sprint.

| Step | Work | API spend |
|---|---|---|
| **0** | **#55 curation** from `docs/curation/roadmap-55-flagship-alias-worksheet.csv` — 72 terms, 215 alias/candidate rows, owner ticks the `pick` column (see `docs/curation/README.md`) — plus the two seed defects that audit surfaced (§4). | **$0** |
| **1** | **#19 LDA re-pull as one unit**, carrying step 0's seed edits: `influence pull` → dbt marts + mentions → `export-site` → dossier-citation check → measure live match rate → raise `match_gate5a` to 0.85 **only if measured**. | **$0** (public API + local compute) |
| **1b** | If and only if filing `57a5f526-…` vanished: regenerate `0607210D8Z`. | **≤ $0.10** |
| **1c** | One confirming `verify-phase5` run. | **≈ $0.80** |
| **2** | Free lineage + coverage work in parallel: #29(b) multi-edition citations, #29(c) Sankey, #29(d) cross-appropriation, #30 GAO ingestion, #28 decision memo. | **$0** |
| **3** | **#29(a) LLM extraction — gated.** `count_tokens` sizing pass first (free), then a 200-narrative pilot behind a precision check, then the full pass only if precision holds. | ~$2 pilot, $10–20 full |
| **4** | Optional cleanup: give the eval gate `dossiers submit`'s pre-flight estimate + `--cost-cap`; set a workspace spend limit in the Anthropic Console. | **$0** |

**Recommended first step: steps 0 + 1 together — under $1 of API spend, and $0 of
it is required.** The two things Sprint D was being deferred for (a $28.60
regeneration bill and a 50-dossier orphaning risk) do not exist.

If a full 50-dossier regeneration is ever wanted for its own sake — refreshed
prose over the shifted corpus, not as re-pull repair — it costs **≈$2.12**, and
`dossiers submit` will print an estimate and stop at $50 before spending
anything.

---

## 4. Two shipped alias defects found while building the #55 worksheet

Free to fix; both are the same species as the Sentinel→"Sentinel Mods" problem
#55 describes, except these are already live.

1. **`JASSM → 0603000D8Z` is mis-targeted.** The seed sends JASSM to *Joint
   Munitions Advanced Technology* (OSD) — **10 live `alias` mention rows** on that
   page — while `0207325F` *Joint Air-to-Surface Standoff Missile (JASSM)* (Air
   Force) is the actual program element and picks up only 3 weaker `multi_token`
   rows. The seed's own note admits the reach ("pe_bli is Joint Munitions Advanced
   Technology which covers JASSM development").

2. **Five seeded aliases route a whole family to one PE.** `C-130J`, `Aegis`,
   `MQ-9`, `CV-22`, and `F-35` each have 3–5 sibling PEs whose titles also contain
   the alias, and the seed picks one. That may be the right editorial call
   (a canonical landing page) or it may be the false attribution #52 removed —
   it is an owner decision, and it is now visible in the worksheet's
   `seed_conflict` column (20 rows across 6 terms) rather than invisible in a CSV.

All 12 currently-seeded aliases are carried as terms in the worksheet so this
audit lives next to the decision rather than in a one-off query.

---

## 5. Method notes (so these numbers can be re-derived)

- Offline bundle estimate: `build_bundle` + `estimate_cost` with `client=None`,
  which forces the `chars/4` heuristic path in `make_token_counter` /
  `count_request_tokens`. No network, no key use.
- Ground-truth token counts: `message.usage` in `data/research/dossiers-raw/*.json`
  (14 files) and `estimated_usd` / `bundle_tokens` in the three archived
  `batch_meta.json` versions (`0de3b4c`, `031d61c`, `ff84667`).
- Eval costs: `scores[].cost_usd` + `citation_retry_total_cost_usd` summed per
  file over `data/research/eval-runs/*.json`.
- Dossier citation classification: every `dossier.*.claims[].citation.fact_id`
  looked up in `data/site/json/cite-shards/{fid[:2]}.json` for its `kind`.
- The `usage` blocks show the system preamble is prompt-cached at a 1h TTL
  (2,195–2,661 tokens, appearing as `cache_read_input_tokens` /
  `cache_creation_input_tokens`, not as `input_tokens`). The shipped estimator
  counts only `SHARED_PREAMBLE` (~1,111 real tokens) and not the JSON schema, so
  it under-states fixed overhead by ~1,350 tok/request — immaterial, because that
  overhead is cached at $0.25/MTok.
