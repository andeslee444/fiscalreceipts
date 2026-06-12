# 5B-3 Recon Artifacts (verified live 2026-06-12)

Load-bearing snippets the 5B-3 plan references. Every query ran against
`data/duckdb/govbudget.duckdb` (read_only) with the row counts shown; probes
against api.usaspending.gov ran live. Implementers reuse these VERBATIM
(adapting only dbt ref()/source() syntax).

## A. Feed-event SQL (fct_feed_events inputs)

```sql
-- yoy_swing: 100 candidates at these thresholds. MUST filter the junk row.
select pe_bli, organization, fy2025_total, fy2026_total, fy2526_change, fy2526_pct_change
from fct_budget_trajectory
where pe_bli <> '9999999999' and organization <> ''
  and fy2025_total >= 50000            -- $50M, amounts are THOUSANDS
  and fy2526_pct_change is not null and abs(fy2526_pct_change) >= 50
order by abs(fy2526_change) desc;
-- top: ('1203154SF','F',244121,7696916,+7452795,+3052.91%) "Long Range Kill Chains"
-- fy2025_total is null on ~half of rows → mart should COALESCE(fy_2025_total, fy_2025_enacted)
-- at the budget_lines pivot level if recall matters; document whichever is chosen.

-- zeroed_fy2026: 87 programs. "Zeroed" = NULL (304 nulls vs 2 literal zeros).
select pe_bli, organization, fy2025_total
from fct_budget_trajectory
where pe_bli <> '9999999999'
  and coalesce(fy2025_total, 0) > 0 and coalesce(fy2026_total, 0) = 0
order by fy2025_total desc;
-- top: 0603766E DARPA $866.5M; 0602716E $641.9M; 0605828F $503.0M

-- concentration_shift: per-(pe_bli, fiscal_year) HHI. Window-in-aggregate is a
-- DuckDB BinderException — shares MUST be materialized in a CTE first.
with prog_family_year as (
  select b.pe_bli, t.fiscal_year,
         coalesce(x.family_key, t.recipient_uei) as family_key,
         sum(t.obligation) as dollars
  from fct_award_transactions t
  join (select distinct award_piid, pe_bli
        from fct_budget_to_awards where confidence = 'high') b
    on t.award_id_piid = b.award_piid
  left join entity_xwalk x on t.recipient_uei = x.recipient_uei
  where t.obligation > 0                       -- positive-only shares (documented bias)
  group by 1, 2, 3
), shares as (
  select pe_bli, fiscal_year, dollars,
         100.0 * dollars / sum(dollars) over (partition by pe_bli, fiscal_year) as share_pct
  from prog_family_year
)
select pe_bli, fiscal_year, sum(share_pct * share_pct) as hhi, sum(dollars) as matched_dollars
from shares group by 1, 2
having sum(dollars) >= 5000000;                -- $5M floor: recent-year matches are thin
-- sample 0603760E: HHI 2521 (2023) → 5453 (2024) → 7457 (2025)

-- new_entrant (weak signal — long-tail filler, $1M floor):
with fam_year as (
  select x.family_key, min(t.fiscal_year) as first_fy, sum(t.obligation) as total_obl
  from fct_award_transactions t
  join entity_xwalk x on t.recipient_uei = x.recipient_uei
  where t.obligation > 0 group by 1
)
select * from fam_year where first_fy >= 2024 and total_obl >= 1000000;
-- FY2024: 108 families/$242.7M; FY2025: 78/$29.6M (top LR COSTANZO $14.8M)
```

## B. District + family-year marts

```sql
-- fct_district_programs DOLLAR grain (confidence='high' ONLY — medium fans out
-- 14.7 pe_bli/PIID = 9.26x dollar multi-count): 267 rows, 106 districts, 17 programs.
select t.pop_state, t.pop_district, b.pe_bli, b.program_title, b.organization,
       count(distinct t.transaction_key) as transaction_count,
       count(distinct t.award_id_piid)   as award_count,
       count(distinct t.recipient_uei)   as recipient_count,
       sum(t.obligation)                 as total_obligation
from fct_award_transactions t
join (select distinct award_piid, pe_bli, program_title, organization
      from fct_budget_to_awards where confidence = 'high') b
  on t.award_id_piid = b.award_piid
where t.pop_district is not null
group by 1, 2, 3, 4, 5;
-- top: ('CO','CO-05','0603760E', …, $846.9M). A separate BREADTH grain may use
-- all-confidence rows but MUST carry mapped_via_account=true and NO dollar column.

-- fct_family_obligations_by_year: 365,457 rows; entity_xwalk UNIQUE on
-- recipient_uei (87,579) → no fan-out. Covers 94.2% of dollars.
select x.family_key, t.fiscal_year,
       sum(t.obligation) as total_obligation,
       count(*) as transaction_count,
       count(distinct t.recipient_uei) as uei_count
from fct_award_transactions t
join entity_xwalk x on t.recipient_uei = x.recipient_uei
group by 1, 2;
```

## C. Top-50 dossier selection (MUST stay within dim_programs)

A naive top-50 over fct_budget_trajectory yields only 6 pe_blis with program
pages (the rest are service lines: '2013' N $11.1B, 'RECONCIL1' DEFW…). The
dossier set is:

```sql
select p.pe_bli, p.title, p.org, t.fy2026_total
from dim_programs p
join fct_budget_trajectory t
  on t.pe_bli = p.pe_bli and t.organization = workbook_org(p.org)  -- python-side translate
order by t.fy2026_total desc nulls last
limit 50;
```
dossier_gate asserts all 50 pe_blis ∈ dim_programs BEFORE any Batch submission.

## D. Staging permalink columns (raw parquet verified)

Raw contracts parquet has `usaspending_permalink` + `contract_award_unique_key`;
assistance has `usaspending_permalink` + `assistance_award_unique_key` (all FY
partitions). There is NO `generated_award_id` column. stg_contracts/stg_assistance
are a POSITIONAL UNION — add `usaspending_permalink` and alias the per-dataset
unique key to one shared name (`award_unique_key`) at the SAME position in BOTH
files, updating the load-bearing column-order comments.

## E. USAspending probes (live)

- v1 filter API is DEAD (`POST /api/v1/references/filter/` → 500 for all bodies).
- v2 works and is deterministic:
  `POST api/v2/references/filter/ {"filters":{...},"version":"2020-06-01"}` →
  `{"hash":"9afe…"}`; `POST api/v2/references/hash/ {"hash"}` returns the stored
  filter; `usaspending.gov/search/?hash={h}` resolves (SPA — returns 200 for ANY
  path; validate via API only). Hash retention undocumented → the DURABLE
  citation artifact is `{endpoint, query_body}`; the hash URL is convenience.
- Recipient profile: `POST api/v2/recipient/ {"keyword": "<UEI>"}` → id like
  `a43aff3e-…-C` → `usaspending.gov/recipient/{id}/latest`. Pick the P (parent)
  level. Per family: choose the non-null parent_uei of the member row with max
  total_obligation (1,331 families have >1 parent_uei; 236 rows null — emit null
  profile id and skip the link).

## F. CT SoQL per-figure citation

`states/connecticut.py build_soql_url()` hardcodes the full GROUP BY query with
only a fiscal_year `$where`. A per-figure citation needs select/where overrides:
`$select=sum(amount) as total`, `$where=fiscal_year='FY 2025' AND
expense_category in (<IN-list from dbt seed state_category_map.csv for the
comparable_category>)`. Citation pins {url, captured value, retrieved_at} —
data.ct.gov updates nightly; gates verify shape + recorded value, never live.
CA is NOT Socrata (Azure blob CSVs, per-file URLs discarded during aggregation)
→ CA tier = pointer-page URL + coverage note (file+sha upgrade on backlog).

## G. Batch API submission (anthropic 0.109.1)

```python
from anthropic import Anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

client = Anthropic()  # needs ANTHROPIC_API_KEY in env — fail loudly if absent
batch = client.messages.batches.create(requests=[
    Request(
        custom_id=f"dossier-{pe_bli}",
        params=MessageCreateParamsNonStreaming(
            model="claude-opus-4-8",
            max_tokens=16000,
            system=[{"type": "text", "text": SHARED_PREAMBLE,
                     "cache_control": {"type": "ephemeral", "ttl": "1h"}}],
            output_config={"format": {"type": "json_schema", "schema": DOSSIER_SCHEMA}},
            messages=[{"role": "user", "content": bundle}],
        ),
    ) for pe_bli, bundle in jobs
])
# poll: client.messages.batches.retrieve(batch.id).processing_status == "ended"
# results: client.messages.batches.results(batch.id) → r.result.type ∈ succeeded|errored|…
```
Cost estimator: Batch-discounted Opus rates ($2.50 in / $12.50 out per MTok);
input counted via `client.messages.count_tokens()` per request (never tiktoken);
output assumed full max_tokens. 50 dossiers ≈ $22 if bundles are trimmed
(largest program_details are 270–373KB ≈ 70–95k tokens — TRIM: narratives in
full, top-25 mentions/awards, trajectory, feed events; cap bundle ≤40k tokens).
Print per-dossier estimate; require operator confirmation above $50.

DOSSIER_SCHEMA shape (cited-or-absent): every section is
`{"claims": [{"text": str, "citation": {"fact_id": str} | {"url": str}}]}`
with `additionalProperties: false` throughout; sections what_it_is /
why_it_matters / players (required) + recent_developments (may be empty —
warehouse-only dossiers are VALID; most programs will have few/no news
snapshots and that's fine).

## H. OG cards + animations

```js
// satori 0.26.0 + @resvg/resvg-js 2.6.2 — fonts MANDATORY (vendor Inter-SemiBold.ttf)
const svg = await satori({ type: "div", props: { style: {…}, children: […] } },
  { width: 1200, height: 630, fonts: [{ name: "Inter", data: font, weight: 600 }] });
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
```

```css
/* compositor-only hero animation + kill switch */
@keyframes drift { from { transform: translate3d(0,0,0); } to { transform: translate3d(40px,-24px,0); } }
.swarm-dot { animation: drift 6s ease-in-out infinite alternate; will-change: transform; }
@media (prefers-reduced-motion: reduce) { .hero-anim * { animation: none !important; } }
```
SVG in server components: `<desc>` never `<title>` (hydration trap).

## I. Misc verified facts

- Measured build: 8.12s/556 pages; pagefind 0.55s. 4,258 filing pages ≈ +60–90s.
- 1,170 of 4,258 filings have zero program mentions → noindex those.
- RSS verified: DefenseNews, Breaking Defense, The War Zone, USNI News,
  Air & Space Forces, DefenseScoop, C4ISRNET. Janes: NO public RSS. Inside
  Defense/Defense Daily: paywalled (teaser-only citations). Honest UA, robots
  obeyed, ≤1 req/s/host, snapshots {url, retrieved_at, sha256, text}.
- Program page baseline: out/program/0601101E/index.html = 244KB; shared
  _next/static = 1.46MB. Animation gate compares CHUNK SETS within one build
  (animated vs non-animated program pages reference identical script sets;
  CSS contains the reduced-motion query) — never cross-build byte diffs.
- citations.json is 22.3MB at build — derived rows scope to rendered surfaces.
- verify_phase5b1.py has THREE per-kind extension sites: the re-derivation
  dispatch (~175-182), the kind classifier (~430-436), and the hardcoded
  set-invariant tuple (~532) — all three must gain the new kinds.
- fct_state_per_capita already carries spend_source_url + pop_source_url.
