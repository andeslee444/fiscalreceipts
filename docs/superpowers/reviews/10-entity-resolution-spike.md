# ROADMAP #10 — SAM extract / Splink: a sizing spike

**Verdict: this is a naming defect, not a resolution defect, and neither SAM.gov
nor Splink fixes it.** The linkage in the flagship case is perfect — all 15
members of the `ROCKWELL COLLINS AUSTRALIA` family share one parent UEI, and
that UEI is genuinely RTX's parent registration. What is wrong is the *string*
that registration carries. SAM.gov is where that string comes from, so
ingesting SAM reproduces the error rather than correcting it. Splink matches
names probabilistically; `ROCKWELL COLLINS AUSTRALIA PTY LIMITED` and
`RTX CORP` share no characters, so Splink would not have proposed the link
either.

**The number that decides it:** **15 of the 200 published company families —
$255.2B, 9.7% of published family dollars — carry a name chosen by an argmax
that beat its runner-up by less than 15%.** The flagship won by **3.1%**. So
did **RTX itself, at 6.5%** — in a marginally different data window the site's
#4 family would be titled `RAYTHEON COMPANY` instead of `RTX`. The label is not
a fact the pipeline reads; it is the winner of a near-tie the pipeline never
tells anyone it held.

Measured at HEAD `40d3e9c` against `data/parquet/entities/entity_xwalk.parquet`
(129,375 UEIs, 114,806 families, $3,875.9B) and the FY2017–2026 contracts ∪
assistance lake.

---

## 1. The measured blast radius

The site publishes the **top 200 families** by obligation
(`export_site.py:7258`, `:9479`), $2,633.6B, floor $1.91B. Everything below is
scoped to that published set, because that is the set a reader can see.

| Population | Families | Dollars | Share of published |
|---|---|---|---|
| Published families (top 200) | 200 | $2,633.6B | 100% |
| Label won its argmax by **<25%** | 23 | $280.2B | 10.6% |
| Label won its argmax by **<15%** | **15** | **$255.2B** | **9.7%** |
| Label won its argmax by **<10%** | 11 | $241.6B | 9.2% |
| Label won its argmax by **<5%** | 5 | $35.0B | 1.3% |
| Label names **no member** of the family and shares **no word** with the member holding the money | 25 | $167.8B | 6.4% |

The two criteria overlap in 8 families ($50.9B) — the ones that are both
implausible on their face and decided by a coin flip. `ROCKWELL COLLINS
AUSTRALIA` is one of them.

The **fifteen** near-tie labels, in full:

```
family_key                              $B   margin  won                              over
RTX                                 183.97     6.5%  RTX CORP                         RAYTHEON COMPANY
ROCKWELL COLLINS AUSTRALIA           19.47     3.1%  ROCKWELL COLLINS AUSTRALIA PTY…  RAYTHEON COMPANY
MACANDREWS FORBES HOLDINGS            7.13     6.8%  MACANDREWS & FORBES HOLDINGS…    KPS CAPITAL PARTNERS, LP
FRANCISCO PARTNERS MANAGEMENT         6.86     4.8%  FRANCISCO PARTNERS MANAGEMENT…   DELL TECHNOLOGIES INC.
SERCO GROUP                           6.53     7.6%  SERCO GROUP PLC                  SERCO INC
NOVETTA SOLUTIONS                     4.90     5.5%  NOVETTA SOLUTIONS, LLC           ACCENTURE PUBLIC LIMITED COMPANY
DELOITTE FINANCIAL ADVISORY SERVICES  4.10    14.0%  DELOITTE FINANCIAL ADVISORY SE…  DELOITTE TOUCHE TOHMATSU LIMITED
S OIL                                 3.69    13.6%  S-OIL CORPORATION                S-OIL CORPORATION
WICO                                  3.41    12.6%  WICO LIMITED                     GENERAL DYNAMICS CORP
HIG CAPITAL MANAGEMENT                3.41     2.2%  HIG CAPITAL MANAGEMENT, INC.     IRON BOW TECHNOLOGIES, LLC
USF HOLDING                           3.31     2.6%  USF HOLDING CORP.                US FOODS HOLDING CORP.
APM TERMINALS PACIFIC                 2.40    13.0%  APM TERMINALS PACIFIC LLC        A.P. MØLLER OG HUSTRU CHASTINE…
TESORO REFINING MARKETING             2.15     9.3%  TESORO REFINING & MARKETING CO   TESORO CORPORATION
L3 TECHNOLOGIES                       1.97     3.1%  L3 TECHNOLOGIES, INC.            L-3 COMMUNICATIONS HOLDINGS, INC.
DELOITTE TOUCHE TOHMATSU              1.95    10.0%  DELOITTE TOUCHE TOHMATSU LIMITED DELOITTE FINANCIAL ADVISORY SE…
```

`margin` = for the family's **dominant member**, `(d1 − d2) / d1` over its
distinct `(recipient_parent_uei, recipient_parent_name)` registrations in the
lake, ranked by obligation dollars — precisely the ranking
`entity_graph.py::_PICK_SQL parent_pick` uses to choose the family name. The
last two rows are the same firm on both sides of its own coin flip.

### The "named after a non-dominant member" framing does not describe the defect

Asked literally, the answer is 764 families / $1,091.1B. That number should not
be used. Its population is dominated by labels that are **correct**:

```
label==dominant member's own name       109,349 families   $2,135.4B
label matches NO member name              4,693 families   $  649.4B
label==a NON-dominant member's name         764 families   $1,091.1B
```

The $1,091.1B bucket is led by `GENERAL DYNAMICS` ($188.7B, dominant member
Electric Boat Corporation), `RTX` ($184.0B, dominant member Raytheon Company),
`NORTHROP GRUMMAN` ($121.9B, dominant member Northrop Grumman Systems
Corporation), `BAE SYSTEMS`, `L3HARRIS TECHNOLOGIES`. A family label *should*
differ from its dominant member's legal name — that is what a corporate family
is. And `ROCKWELL COLLINS AUSTRALIA` is **not in this bucket at all**: no member
of that family is named Rockwell Collins Australia. The label comes only from
the parent registration.

**This kills the cheap fix before it is proposed.** "Name a family by its
dominant member" would rename `GENERAL DYNAMICS` → `ELECTRIC BOAT CORPORATION`,
`NORTHROP GRUMMAN` → `NORTHROP GRUMMAN SYSTEMS CORPORATION`, and `RTX` →
`RAYTHEON COMPANY`. It is not a smaller job than entity resolution; it is a
regression applied to 109,349 families that are currently right.

---

## 2. The failure mode, with evidence

### 2a. The linkage is correct and the label is a source string

All 15 members of the family carry the **same** `parent_uei`, `EGAVSJTA2D81`,
and the same `parent_name`. In the raw lake that UEI has exactly one name, on
every one of its 43,164 transactions:

```
recipient_parent_uei='EGAVSJTA2D81'
  → ROCKWELL COLLINS AUSTRALIA PTY LIMITED   43,164 tx   $56.94B   118 distinct recipient UEIs
```

The source is not noisy here. It is *consistent and wrong*. There is no
clustering, blocking, or scoring problem to solve: the members are already one
group, keyed on one identifier, and that identifier's registered legal name is
an Australian subsidiary of RTX being used as RTX's parent record.

### 2b. RTX has three parent registrations, and the label is the winner of a near-tie

`XSV6AZJ6SDJ7` (RAYTHEON COMPANY, $18.93B — 97.3% of the family) carries three
distinct parent pairs over the decade:

```
ROCKWELL COLLINS AUSTRALIA PTY LIMITED   $6.581B   1,303 tx   FY2023-2026   ← wins
RAYTHEON COMPANY                         $6.379B   1,327 tx   FY2017-2020
RTX CORP                                 $5.974B   1,793 tx   FY2020-2026
```

$202M separates first from second, out of $18.9B. The whole family's name turns
on 1.1% of its own money. By fiscal year the story is a clean registration
history that the argmax flattens:

```
FY2017-2019  RAYTHEON COMPANY                        $5.446B
FY2020       RAYTHEON COMPANY $0.933B / RTX CORP $0.168B
FY2021-2022  RTX CORP                                $2.592B
FY2023       RTX CORP $2.055B / ROCKWELL COLLINS AUSTRALIA $0.177B
FY2024-2025  ROCKWELL COLLINS AUSTRALIA              $6.404B
FY2026       RTX CORP $1.159B / ROCKWELL COLLINS AUSTRALIA $0.000B
```

RTX registered the Australian UEI as its parent for two years and **reverted in
FY2026**. The site is displaying a registration the registrant has already
corrected, because the argmax has no notion of "current".

### 2c. `confidence=high` cannot see this, by construction

Every member reads `high`. That is not an oversight — `entity_graph.py:127-138`
downgrades to `medium` only when a family spans **more than one** `parent_uei`
(a cross-parent name-merge). This family spans exactly one, so it keeps `high`.
The confidence field grades *merge* risk. It has never graded *label* risk, and
there is no gate that does: `verify_phase2.entity_gate` checks only that
`method` is not `self_uei` over the top 1,000, and `golden_gate` checks the
Boeing and HII merges. Nothing checks what a family is called.

### 2d. The registry-name pathology is not the same as UEI fragmentation

RTX's group is registered under three parent UEIs, and the recipients overlap
almost completely:

```
EGAVSJTA2D81 (118 children)  ∩  PPLZG8J3N9D4 / RTX CORP (192) = 112
EGAVSJTA2D81                 ∩  KLW3ZYL15493 / RAYTHEON COMPANY (88) = 52
PPLZG8J3N9D4                 ∩  KLW3ZYL15493 = 67
```

Because each recipient picks one dominant pair, those 118 children scatter into
8 families totalling $239.8B: `RTX $183.0B`, `RAYTHEON $34.5B`, `ROCKWELL
COLLINS AUSTRALIA $19.5B`, and five smaller. That fragmentation is a real,
separate defect — and one the curated seed **already fixes** for this family
(§4). It does not, however, explain the bad string. Merging the eight fragments
still leaves you choosing a name for the merged whole.

---

## 3. Would Splink help? No — and the headroom is measurable

Splink is probabilistic **record linkage**: block, compare fields, score, merge.
Three reasons it is the wrong instrument for the defect in hand:

1. **It cannot see this link.** The evidence tying `ROCKWELL COLLINS AUSTRALIA
   PTY LIMITED` to `RTX CORP` is a shared child set (112/118), not string
   similarity. That is graph co-membership, not fuzzy matching. Any comparison
   function over names scores this pair at zero.
2. **It does not produce labels.** Even a perfect linker outputs clusters. The
   published artefact is a *name*, and every cluster still needs one chosen from
   the same set of bad strings.
3. **Its actual addressable headroom is small.** Upper-bounding name-similarity
   merges by the most permissive plausible rule — one family's normalized token
   sequence is a strict prefix of another's — across all 2,766 families ≥$100M:

   ```
   103 candidate pairs, smaller side sums $30.0B
   TEXTRON $14.26B ~ TEXTRON SYSTEMS $2.77B
   NORTHROP GRUMMAN $121.91B ~ NORTHROP GRUMMAN INNOVATION SYSTEMS $1.31B
   VECTRUS $14.07B ~ VECTRUS SYSTEMS $0.77B
   KBR $16.17B ~ KBR WYLE SERVICES $0.69B
   ```

   $30.0B is the ceiling on what better *name* matching can move. Compare it to
   the $255.2B of published dollars whose problem is the name being wrong rather
   than unmatched. Splink is aimed at the smaller number.

For completeness, the alternative that *is* in the right family of techniques —
deterministic clustering of parent UEIs by shared children — was measured:

```
parent UEIs sharing ≥3 children with ≥50% overlap
  → 233 clusters spanning >1 family, 322 families absorbed, $125.6B relabelled
sensitivity: ≥2/≥50% → $136.0B · ≥2/≥80% → $80.5B · ≥5/≥50% → $93.3B · ≥2/any → $188.1B
```

Its top clusters are sane (`RTX+RAYTHEON+ROCKWELL COLLINS AUSTRALIA` $238.6B;
`BOEING+HOPE GROUP`; `GENERAL DYNAMICS+WICO+CSRA`; `L3HARRIS+VERTEX+L3
TECHNOLOGIES+AEROJET`) — and it also over-merges on ownership *history*:
`AMENTUM + JACOBS ENGINEERING + AECOM + PAE` into one $40.0B cluster, because
those children genuinely changed owners between 2020 and 2024. Any UEI-graph
merge needs a temporal guard, which is more design than the payoff justifies
today (§5, Option B).

---

## 4. What SAM.gov would add

**Nothing is implemented today.** SAM appears in this repo only as prose: a
column description (`dbt/models/marts/schema.yml:7`), site copy
(`export_site.py:1032`), a methodology paragraph (`docs/methodology.md:119`),
and the Phase-2 deferral note. `grep -ri "sam_entity|sam_registry|uei_registry|
SAM_KEY|samgov"` over `src/ dbt/ data-seeds/ scripts/` returns zero hits;
`api.data.gov` appears exactly once, in that deferral. The stated blocker
reproduces verbatim (`plans/2026-06-10-phase2-beneficiary-graph.md:9`): *"SAM
extract DEFERRED — requires a user-registered api.data.gov key (account
creation is the user's action)"*.

**What SAM would add, honestly:**

- **The name: nothing.** `recipient_parent_name` in USAspending *is* the SAM
  registration name. Fetching it from SAM directly returns
  `ROCKWELL COLLINS AUSTRALIA PTY LIMITED` again. SAM is the origin of the
  defect, not its remedy. This is the single most important finding in the
  spike, and it inverts the premise of the backlog entry.
- **Hierarchy: something, at a cost.** SAM's entity-hierarchy fields (ultimate
  parent UEI, entity structure) could merge the three RTX parent UEIs without
  the shared-children heuristic. But the curated seed already merges them by
  hand for the ten families that carry the published dollars, and the
  shared-children rule reproduces the same cluster at zero external dependency.
- **A live methodology defect it exposes.** `docs/methodology.md:119` tells
  readers *high confidence* means "SAM.gov records a common registered parent
  name for the subsidiaries." 152 of the 200 published families ($1,152.3B)
  display that tier. The sentence is defensible in provenance (the column is
  SAM-sourced) but it is used on screen as a reassurance, and the flagship case
  is the counter-example: SAM *does* record a common registered parent name here,
  and it is wrong. The tier grades merge safety, not name truth, and the copy
  should say so.

---

## 5. What the site actually shows, and therefore what is worth building

Established by tracing the exporter and grepping the built HTML.

- The route is `/companies/families/`, titled "Company renames & acquisitions".
- Merged-family headings come from the **curated seed**
  `data-seeds/entity_family_events.csv` (`family` column →
  `entity_families.resolve_families` → `export_site.py:8520`). RTX is already
  curated: `site/out/companies/families/index.html` renders
  `data-curated-family="rtx"` … `RTX` … `$238.6B` … "combined across 4 registry
  names". **That total is exactly the shared-children cluster of §3.** So the
  `/companies/` headline dollars are already in the right family.
- **Member rows and company pages are not.** Those always read
  `dim_entities.display_name` = `max(coalesce(parent_name, recipient_name))
  filter (rn=1)` (`dbt/models/marts/dim_entities.sql:8`). Live in the built
  site:

  ```
  site/out/companies/families/index.html
    data-member-key="ROCKWELL COLLINS AUSTRALIA" …
    "display_name":"ROCKWELL COLLINS AUSTRALIA PTY LIMITED","total_obligation":19467475672.87,
    "uei_count":15,"worst_confidence":"high","has_page":true

  site/out/company/rockwell-collins-australia/index.html
    <title>Rockwell Collins Australia Pty Limited | Fiscal Receipts</title>
    <h1>Rockwell Collins Australia Pty Limited</h1>
    Registered name in the award data: ROCKWELL COLLINS AUSTRALIA PTY LIMITED.
  ```

- The curated seed **cannot** fix this. It renames only merged rows with ≥2
  resolved members (`export_site.py:8522`), and never touches an individual
  `family_key`'s own page. The seed's own note (row 5) says so explicitly and
  defers to this spike.
- Crucially: **the page slug is derived from `family_key`, not from
  `display_name`** (`export_site.py:8432`, `:8484`, `:8581`, `:8885` —
  `family_key.lower().replace(" ", "-")`), and entity fact IDs are
  `fact_id_derived("entity", family_key, …)` (`:3486`). Changing a display name
  therefore changes **no URL, no fact ID, no `query_body`, and no dollar**.

That asymmetry is what sizes the work.

---

## 6. Sized recommendation

### Option A — display-name alias seed (recommended, small)

A `data-seeds/entity_display_aliases.csv` keyed on `family_key`, carrying
`display_name`, `evidence`, `source_url`, `note`, validated the way
`entity_families.py` validates its seed, and consumed at the one place
`display_name` is produced (`dim_entities.sql`) or read.

- **Scope:** 25 rows covers every top-200 family whose label names no member and
  shares no word with the member holding the money ($167.8B). 8 rows covers the
  subset that is also a coin-flip win ($50.9B). 1 row fixes the flagship.
- **Blast radius on the build:** display strings only. No `family_key`, no slug,
  no fact ID, no citation `query_body`, no `total_obligation`. Gate 23 leg (d)'s
  1,877 published queries are untouched.
- **Ship with it:** a `verify` leg that fails when a published family's label
  won its parent-registration argmax by <15% and has no alias row. That leg
  reproduces the shipped defect (`ROCKWELL COLLINS AUSTRALIA`, 3.1%) and would
  have caught it before publication. It also flags `RTX` at 6.5% — which is
  correct behaviour: that label is right today by luck, and should be pinned.
- **Cost:** one dbt expression, one seed + validator, one gate leg, one rebuild.
  Roughly a day, plus editorial time to source 25 names.
- **Buys:** the false claim goes away, the fragility becomes visible and gated,
  and nothing that is currently right moves.

### Option B — parent-UEI clustering in the pipeline (large, deferred)

Merge parent UEIs by shared children with a temporal guard, then name each
cluster from its dominant fragment.

- **Blast radius:** 322 families absorbed, $125.6B relabelled at ≥3/≥50%. Every
  affected `family_key` changes → slugs change → fact IDs change → published
  `query_body` statements change → gate 23 leg (d) must be re-run against a
  fully rebuilt site, and the `/company/{slug}/` URL space breaks.
- **Known hazard, measured:** ownership history over-merges. `AMENTUM + JACOBS +
  AECOM + PAE` collapse into one $40.0B cluster; those are distinct public
  companies today. A temporal guard is mandatory and is the bulk of the design.
- **Buys:** correctness for families the curated seed has not reached. But the
  seed already covers the ten that carry the published dollars, so the marginal
  gain is in the tail.
- **Verdict:** not now. Revisit if the curated seed exceeds ~40 families, i.e.
  when hand-curation stops being cheaper than the pipeline change.

### Option C — Splink (do not build)

$30.0B ceiling on name-similarity merges above $100M, versus $255.2B of
mislabelling it cannot address and a flagship case it cannot see. The existing
deterministic normalizer plus the curated seed already occupy this space, and
the Phase-2 golden gate (Boeing, HII) passes. **Close #10's Splink half as a
deliberate non-goal.**

### Rules that were tested and rejected

Recorded so they are not re-proposed.

| Rule | Fixes flagship? | Dollars relabelled | Verdict |
|---|---|---|---|
| Name family by its dominant member's own name | partly (→ `RAYTHEON COMPANY`) | — | **Reject.** Regresses 109,349 correct families; renames `GENERAL DYNAMICS` → `ELECTRIC BOAT CORPORATION`. |
| Pick parent pair by latest FY, tie-break on dollars | **No** (Rockwell has a $0.000B FY2026 row, so it ties at FY2026 and wins on total dollars) | $1,088.2B | **Reject.** Does not fix it *and* destabilises a trillion dollars of labels. |
| Pick parent pair by dollars **within** the latest FY | Yes (whole family → `RTX CORP`) | $1,213.8B | **Reject as a global rule.** Correct here, but re-keys 7,789 recipients and $1.21T; that is Option B's blast radius with none of its guards. |
| Detect inverted hierarchies via parent/child cycles | No (`EGAVSJTA2D81` is never a recipient, so no cycle) | — | Real but tiny: 76 directed pairs, 4 families ≥$1B. Not worth a gate on its own. |

---

## 7. What did not reproduce

- **"`/families/` displays a family … totalling $19.47B across 15 members."**
  The dollars and members reproduce exactly. The route does not: it is
  `/companies/families/`, and there the $19.47B appears as a **member row of the
  curated RTX family**, which already combines $238.6B under the label `RTX`.
  The standalone mislabelled surfaces are the member row itself and
  `/company/rockwell-collins-australia/`. The claim is right about the harm and
  wrong about the location.
- **"How many families are named after a member that is NOT their dominant
  member?"** This framing does not describe the defect. `ROCKWELL COLLINS
  AUSTRALIA` names no member at all. The literal answer, 764 families /
  $1,091.1B, is dominated by *correct* parent labels and must not be quoted as a
  blast radius.
- **"$88B of Electric Boat into one named `WICO`" (ROADMAP #33).** The
  whole-pair fix landed and the $88B is gone. A `WICO` family survives at rank
  #101, $3.41B, dominant member `GENERAL DYNAMICS OTS (WILKES BARRE), LLC`,
  label winning by 12.6% over `GENERAL DYNAMICS CORP`. The fix reduced the
  defect by 96%; it did not eliminate it.
- **`confidence=high` on all 15 members** reproduces, and is not a bug. It means
  "this family spans one parent UEI", which is true. It has never meant the name
  is right.
- **ROADMAP #10's own text** reproduces: `entities.py:6` still carries the
  deferral, and no commit references the item. The Phase-2 deferral rationale
  (api.data.gov key is the user's action) also reproduces verbatim.

## 8. Unrelated live break found while tracing (not fixed here — read-only spike)

`data-seeds/entity_family_events.csv` row 5 carries `evidence=measured-contents`
(added by `710e101`, 2026-09-01). `entity_families.py:85` still declares
`EVIDENCE_KINDS = ("sourced", "name-inferred")`. Verified directly:

```
$ load_family_events(Path('data-seeds/entity_family_events.csv'))
FamilyEventsError: entity_family_events.csv:5: evidence 'measured-contents' not in
('sourced', 'name-inferred') — a row must declare whether its source names these
exact parties or whether we inferred the link
```

`export_site._resolved_entity_families` calls this outside its `try/except`
(`export_site.py:2456` vs the guard at `:2450`), so the next `export-site` run
raises. The published `site/out/` predates the edit. `site/src/lib/
entity-families.ts` has no `measured-contents` handler either. Whoever holds the
build should either widen `EVIDENCE_KINDS` (and the TS union) or revert the
cell — this spike changed nothing.

---

## Appendix — how each figure was produced

All read-only, at HEAD `40d3e9c`, `.venv/bin/python` + DuckDB 1.5.3.

- **Sources:** `data/parquet/entities/entity_xwalk.parquet`;
  `read_parquet(['data/parquet/contracts/fy=*/*.parquet',
  'data/parquet/assistance/fy=*/*.parquet'], union_by_name=true)`.
- **Published set:** top 200 `family_key` by `sum(total_obligation)` — the same
  ordering and limit as `export_site.py:7258`.
- **Margin:** per dominant member, group the lake on
  `(recipient_parent_uei, recipient_parent_name)`, sum
  `federal_action_obligation`, rank descending, `(d1 − d2) / d1`. Mirrors
  `entity_graph.py::_PICK_SQL parent_pick`.
- **Label buckets:** `normalize_name` imported from `src/govbudget/entities.py`
  and applied in Python (DuckDB UDFs need numpy, which is absent from `.venv`;
  no package was installed).
- **Splink headroom:** all families ≥$100M, token-sequence prefix containment
  within a shared first token; the smaller side's dollars summed.
- **Shared-children clustering:** distinct `(recipient_uei,
  recipient_parent_uei)` edges from the lake; union-find over parent UEIs
  joined when `shared ≥ k` and `shared / min(children) ≥ j`; families then
  regrouped by cluster root.
- **Site behaviour:** read from the built `site/out/` HTML and traced through
  `export_site.py`, `entity_families.py`, `site/src/lib/entity-families.ts`,
  `site/src/app/companies/families/page.tsx`.
