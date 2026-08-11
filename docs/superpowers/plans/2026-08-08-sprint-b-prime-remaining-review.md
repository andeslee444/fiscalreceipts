# Sprint B′ — The Rest of the Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Standing rules (MANDATORY, apply to every task):
> commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; explicit paths only,
> never `git add -A`; TDD; **never weaken a gate or an eval to make something pass
> — fix the page or the data**; every new gate leg ships with recorded
> proof-can-fail in `docs/superpowers/reviews/5c-gates-pre-failure.txt` under a
> dated heading, verbatim FAIL and PASS, never paraphrased; **the suite is 24
> gates and must stay 24** — attach legs to existing gates; **check for leg-letter
> collisions before choosing one**; gate 1 pins `git_head`, so build AFTER
> committing and re-verify at final HEAD; **never launch a background process and
> stop to wait for it** — run builds in the foreground; `.env` is gitignored.
> **Do not deploy** — deploy is `./scripts/launch/deploy.sh`, run by the controller.

**Goal:** Close the remaining defects from the 2026-08-07 review that make the site
say something untrue, plus the one gap that two of five reviewers called individually
disqualifying.

**Architecture:** Sprint A′ closed the six P0s. This closes the two live Tier-1 wrong
numbers (fused program keys, the HHI contradiction), extends A′'s disclosure work to
the rollup pages the review correctly said it never reached, and ships a masthead.
Ordered cheapest-and-most-certain first, so the sprint is shippable after any task.

**Tech Stack:** Python 3.12/uv, DuckDB, dbt; Next.js 16 static export, React 19,
Tailwind v4, Playwright; gate suite under `site/scripts/gates/`.

**Current state:** branch `sprint-a-prime-claim-citation` at `e8fa447`, deployed and
live, 24/24 gates, 1,551 pytest, 949 vitest. Sprint B′ branches from there.

> **The prescribed code below is a starting point, not gospel.** Every one of Sprint
> A′'s seven tasks found a defect in its prescribed code — a regex matching its own
> prescribed fix, a gate letter colliding with a live leg, units off 1000×, a
> grain-mismatched fail-proof, a file needing no change, a misattributed regression,
> and a negation window that would have deleted a legitimate edge. The **measured
> figures** below were reproduced against the shipped warehouse on 2026-08-08 and are
> reliable; the **code** was written without being executed. Gather evidence, replace
> with something **tighter** (never looser), and disclose any substitution in the code
> comment, the proof-can-fail record, AND the commit message.

---

## What this plan deliberately does NOT cover

Open, and staying open. Named so "the review is addressed" is an honest claim:

- **768–1023px horizontal overflow** — real, every page, but it is a layout task that
  belongs with the drawdown plan's C1 (the `max-w-*` spine), not bolted onto a
  correctness sprint. Note it is a *different* defect from C1 and closing C1 will not
  close it.
- **`/glossary/`, `/years/` chart, dark mode, `/fact/{id}/` trailing slash,
  `/agency/` index, CSV fact IDs, citation-dialog `aria-modal`** — usability and
  mechanics, none of which makes the site state a falsehood. One usability sprint.
- **Award-data staleness, RTX $238.6B vs $184.0B, partial-year lobbying series** —
  each needs its own investigation before it can be specified.
- **#54 / #55** (A′'s own filed gaps: the reconciliation label reaching only
  `/program/*`, and Lockheed's missing F-35 pending alias curation).

---

## Findings corrected during planning

Two review claims did not survive verification. Recorded because a plan that repeats
a wrong premise inherits it:

**"Agency totals are computed on a different basis than the rows beneath them"** —
**not reproducible.** Measured 2026-08-08, headers equal the sum of their rendered
rows exactly, FY2024 and FY2026:

```
org    FY24 header(M)   sum rows(M)     diff
F         76,086.623     76,086.623    0.000
A         55,456.672     55,456.672    0.000
N         40,438.644     40,438.644   -0.000
OSD       10,600.446     10,600.446   -0.000
MDA       15,760.574     15,760.574   -0.000
```

The small FY2026-only negatives (A −210,039k, OSD −19,281k, DTRA −2,230k) are the
drawdown plan's **#45 org-grain** issue, not this one.

**What IS live** is the review's own closing sentence: *"the site already ships a
reconciliation strip that explains precisely this TOA-vs-J-book difference on program
pages. It simply isn't applied to rollups."* The site's FY24 figure is the P-40
project-detail basis, and `fct_budget_lines.fy_2024_actuals` is higher for 142
programs — F-35 5,247.070 vs 5,565.655 (gap 318.585), B-21 1,562.693 vs 2,270.693
(gap 708.000), F-15EX 2,511.061 vs 2,739.061 (gap 228.000), corpus-wide **$11.06B**.
Program pages disclose this: 1,395 of 1,739 carry a `fully_reconciled: false` badge
and a reconciliation strip. **Agency rollups do not.** That narrow gap is Task B′4.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `docs/superpowers/ROADMAP.md` | ledger | all |
| `docs/superpowers/reviews/5c-gates-pre-failure.txt` | proof-can-fail | B′1, B′2, B′4 |
| `dbt/models/marts/dim_programs.sql` + `fct_budget_trajectory.sql` | collision key | B′1 |
| `dbt/tests/assert_program_key_unique.sql` | **new** | B′1 |
| `src/govbudget/export_site.py` | program identity; agency reconciliation | B′1, B′4 |
| `site/src/app/program/[peBli]/page.tsx` | URL contract for split keys | B′1 |
| `site/scripts/gates/basis.mjs` | leg: one row, one account | B′1 |
| `site/src/app/page.tsx` | HHI gloss + year scope | B′2 |
| `site/src/components/feed-headline.tsx` | HHI card wording | B′2 |
| `site/scripts/gates/feed.mjs` | leg: HHI claim matches destination | B′2 |
| `site/src/app/about/page.tsx` | masthead | B′3 |
| `site/src/app/agency/[org]/page.tsx` | reconciliation disclosure | B′4 |

---

### Task B′0: File the sprint in the ROADMAP

**Files:** Modify `docs/superpowers/ROADMAP.md`

- [ ] **Step 1: File #56–#59, continuing from #55**

```markdown
- **#56** Program keys collide across appropriation accounts, fusing unrelated
  programs into one row and one page. Measured PB2026: 12 keys span >1
  `account_title`; `9999999999` is the intentional classified sentinel and 5 have no
  page, leaving **6 live fused pages** — 2210, 3010, 3050, 3215, 3302, 4217.
  `/program/3010/` renders $2.62B under "Shipboard Tactical Communications", an OPN
  line worth $20.9M, fused with LPD Flight II (SCN, $2.6B reconciliation). Every
  constituent cell is correctly cited and the sum is arithmetically right — the
  defect is in the grouping key, which no arithmetic assertion can reach.
- **#57** The homepage HHI gloss contradicts the page it links to. The lede renders a
  per-YEAR concentration card ("HHI=8662 (2020)") glossed "a near-monopoly
  concentration score" and links to `/program/0601101E/`, whose pooled HHI is
  **505.5** across 165 families — rendered as "Competitive". Separately the 2,500
  cutoff at `page.tsx:134` is labelled "near-monopoly"; DOJ/FTC call 2,500 "highly
  concentrated", and four equal firms produce exactly 2,500. The gloss sits above 84
  HHI cards.
- **#58** No masthead. `/about/` names no person, organisation, funder or contact;
  `/contact/` and `/team/` 404; the CC0 licence exists only inside JSON-LD, invisible
  on the rendered page. Two of five reviewers called this individually blocking — a
  standards desk will not let a reporter attribute a defense-procurement story to an
  anonymous site.
- **#59** The reconciliation disclosure stops at program pages. 1,395 of 1,739
  programs carry `fully_reconciled: false` and a reconciliation strip explaining the
  P-40 vs P-1 difference; agency rollups sum those same figures and say nothing.
  Corpus-wide the FY24 column is $11.06B below `fy_2024_actuals` across 142 programs
  (F-35 gap 318.585M, B-21 708.000M, F-15EX 228.000M).
```

Also record, under #59, that the review's "header on a different basis than its rows"
framing was **checked and is not reproducible** — headers equal their rows exactly —
so #59 is scoped to the disclosure gap, not to a wrong total.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "docs(roadmap): file #56-#59 — the rest of the 2026-08-07 review" \
  -m "Two Tier-1 wrong numbers, the masthead, and the rollup disclosure gap. Records that the review's agency-basis framing did not survive verification: headers equal their rows exactly; the live gap is that program-page reconciliation disclosure never reached the rollups, which is what the review's own closing sentence said." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task B′1: #56 — program keys collide across appropriation accounts

`/program/3010/` is live and renders **$2.62B** under the title *"Shipboard Tactical
Communications"* — an Other Procurement, Navy communications line worth **$20.9M** —
because an unrelated Shipbuilding & Conversion line, *LPD Flight II* ($2.6B FY2026
reconciliation), shares the key `3010`. An apples-to-oranges YoY *inside a single row*.

Measured PB2026 (verified 2026-08-08):

```
key     accounts                                                    live page?
0145    Procurement of Ammunition, Navy/MC || Aircraft Proc, Navy       no
1045    Shipbuilding & Conversion, Navy   || National Sea-Based Det Fd  no
1350    Procurement of Ammunition, Navy/MC || Weapons Proc, Navy        no
2101    Weapons Proc, Navy                 || Procurement, Marine Corps no
2210    Other Proc, Navy                   || Weapons Proc, Navy       YES
2292    Weapons Proc, Navy                 || Procurement, Marine Corps no
3010    Other Proc, Navy                   || Shipbuilding & Conv, Navy YES
3050    Other Proc, Navy                   || Shipbuilding & Conv, Navy YES
3215    Other Proc, Navy                   || Weapons Proc, Navy       YES
3302    Other Proc, Navy                   || Weapons Proc, Navy       YES
4217    Other Proc, Navy                   || Weapons Proc, Navy       YES
9999999999  (12 accounts)  ← INTENTIONAL classified sentinel, NOT a collision
```

Rendered today: `3010` $2.62B, `3050` $2.13B, `2210` $358.3M.

**`1045` is not a collision** and must not be "fixed" as one: it is COLUMBIA Class
Submarine, one program whose account changed (National Sea-Based Det Fd in FY2024 →
Shipbuilding & Conversion from FY2025 on). Assert the two cases separately.

**Files:**
- Modify: `dbt/models/marts/dim_programs.sql`, `dbt/models/marts/fct_budget_trajectory.sql`
- Create: `dbt/tests/assert_program_key_unique.sql`
- Modify: `dbt/models/marts/schema.yml`
- Modify: `src/govbudget/export_site.py`
- Modify: `site/src/app/program/[peBli]/page.tsx`
- Modify: `site/scripts/gates/basis.mjs`

- [ ] **Step 1: Reproduce, and record the before-table**

```bash
uv run python - <<'PY'
import duckdb, json
con = duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
have = {r['pe_bli'] for r in json.load(open('data/site/json/programs.json'))}
for pe, n, a in con.execute("""
  select pe_bli, count(distinct account_title) n, string_agg(distinct account_title,' || ') a
  from fct_budget_lines where account_title is not null and fiscal_year = 2026
  group by 1 having count(distinct account_title) > 1 order by 1""").fetchall():
    print(f"{pe:12s} n={n} page={pe in have}  {a[:80]}")
PY
```

- [ ] **Step 2: Decide the URL contract — this is the task's real design choice**

`/program/3010/` is a **live 200 today**. Splitting the key changes what that URL
means. Three coherent options; pick one, write the reasoning into the commit:

- **(a) Composite slug** — `/program/3010-OPN/` and `/program/3010-SCN/`; the bare
  `/program/3010/` becomes a disambiguation stub listing both. Most honest, most
  URLs changed, needs redirects.
- **(b) Largest keeps the bare URL** — the dominant line stays at `/program/3010/`,
  the other gets a composite slug, and each page links to its sibling. Fewest broken
  links; arbitrary about which program "owns" the key.
- **(c) Do not split the page; split the ROW** — one page per key, but the money
  table renders one section per account with no cross-account total, and the title
  becomes "2 programs share key 3010". Smallest change, keeps every URL, but leaves
  a page whose title cannot name one program.

**Prefer (a)** unless the redirect story is genuinely hard: it is the only option
where a URL means exactly one program. Whichever you choose, `generateStaticParams`,
the sitemap, `linkgraph` (gate 13), and the corpus counts all move — enumerate every
consumer before starting and record the enumeration in the commit.

- [ ] **Step 3: Write the dbt assertion FIRST**

`dbt/tests/assert_program_key_unique.sql` — two separate assertions, because the
`1045` case is legitimate:

```sql
-- (1) Within ONE edition, a program key must not span multiple appropriation
--     accounts: that is two programs fused under one title.
-- (2) A key whose account CHANGES BETWEEN editions is a migration, not a
--     collision (1045 COLUMBIA moved National Sea-Based Det Fd -> SCN) and is
--     explicitly allowed.
-- The classified sentinel 9999999999 is excluded by name, not by threshold.
select
    pe_bli,
    fiscal_year,
    count(distinct account_title) as n_accounts,
    string_agg(distinct account_title, ' || ') as accounts
from {{ ref('fct_budget_lines') }}
where account_title is not null
  and pe_bli <> '9999999999'
group by 1, 2
having count(distinct account_title) > 1
```

- [ ] **Step 4: Run it and watch it FAIL**

```bash
uv run dbt test --project-dir dbt --profiles-dir dbt --select assert_program_key_unique
```

Expected: **FAIL** naming the 11 keys. Record verbatim. (Note A′5 found dbt needs
`--project-dir`/`--profiles-dir` from the repo root — `profiles.yml` uses a relative
duckdb path.)

- [ ] **Step 5: Re-key, rebuild, re-run**

Key the program grain on `(account, pe_bli)` in `dim_programs` and
`fct_budget_trajectory`. Rebuild and re-run the assertion until PASS.

```bash
uv run dbt build --project-dir dbt --profiles-dir dbt --select dim_programs+ fct_budget_trajectory+
uv run dbt test --project-dir dbt --profiles-dir dbt --select assert_program_key_unique
```

- [ ] **Step 6: Gate leg — one rendered row, one account**

Add to `basis.mjs` (pick a free letter — a–g are taken as of Sprint A′; confirm and
say which): no rendered program row or program page may aggregate figures whose
citation records name more than one `account_title`. Non-vacuity: fail if it resolves
fewer than 100 program pages. Prove it fails against a pre-fix build. Record verbatim.

- [ ] **Step 7: Verify and commit**

```bash
uv run python -m govbudget export-site && uv run pytest
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
npx vitest run && npx tsc --noEmit && npx eslint .
```

Check `/program/3010/` (or its successors) now renders $20.9M under the OPN title and
$2.6B under LPD Flight II, separately. Commit with the before/after for all six live
keys and the URL decision.

---

### Task B′2: #57 — the HHI gloss contradicts its own destination

**Files:**
- Modify: `site/src/app/page.tsx` (the gloss at ~line 131-138)
- Modify: `site/src/components/feed-headline.tsx`
- Modify: `site/scripts/gates/feed.mjs`
- Modify: `site/src/app/methodology/page.tsx` (HHI bands)

- [ ] **Step 1: Reproduce both halves**

```bash
uv run python - <<'PY'
import json
cards = [c for c in json.load(open('data/site/json/feed.json'))['cards']
         if c.get('figure_units') == 'hhi']
print(f"{len(cards)} hhi cards; first 3:")
for c in cards[:3]:
    print(f"  {c['figure_value']:.0f}  {c.get('program_url')}  {c['headline'][:70]}")
rows = json.load(open('data/site/json/programs.json'))
r = [x for x in rows if x['pe_bli'] == '0601101E'][0]
print("destination page hhi:", r['hhi'])
PY
```

Expected: card `8662` → `/program/0601101E/`, whose page HHI is **505.5** over 165
families. Both are true; they are different measures (one year vs pooled) sharing one
name.

- [ ] **Step 2: Fix the threshold label**

`page.tsx:134` currently reads:

```tsx
                  {lede.figure_value >= 2500
                    ? "a near-monopoly concentration score"
                    : "a high supplier-concentration score"}
```

2,500 is the DOJ/FTC **"highly concentrated"** boundary — four equal firms produce
exactly 2,500, which no one calls a near-monopoly. Use the actual band vocabulary
(<1,500 unconcentrated; 1,500–2,500 moderately concentrated; >2,500 highly
concentrated), and reserve any stronger word for a genuinely extreme value if you use
one at all. Mirror the same bands on `/methodology/` so the site has one definition.

- [ ] **Step 3: Scope the card to what it measures**

The card says "award concentration HHI=8662 (2020)" and the gloss then speaks as if it
describes the program. Make the year and the measure explicit in the gloss, so a
reader who clicks through and sees 505.5 understands both numbers — e.g. name it as
that year's concentration, distinct from the program's pooled figure.

- [ ] **Step 4: Gate leg — a claim must match its destination**

Add to `feed.mjs`: when a feed card's headline or gloss makes a concentration claim
and links to a program page, the claim's band must not contradict the band of the
figure that page renders. Non-vacuity: fail if it resolves zero HHI cards (there are
84). Prove it fails against the current build — it should, on all 84. Record verbatim.

This is the sprint's most transferable leg: it is the first gate that checks a claim
against **the page it points at** rather than against its own source.

- [ ] **Step 5: Verify and commit**

---

### Task B′3: #58 — a masthead

The cheapest high-value item in the whole review. Two of five reviewers refused to
treat the site as citable without it. `/about/` has no mailto, no organisation, no
funder, no repo link; `/contact/` and `/team/` 404; the CC0 licence lives only in
JSON-LD.

**This task needs owner input before it can be finished — see Step 1.**

**Files:** `site/src/app/about/page.tsx`, `site/src/app/layout.tsx` (footer)

- [ ] **Step 1: Collect the facts from the owner — do NOT invent them**

**STOP and ask.** A masthead is a set of claims about real people and organisations,
and every one must come from the owner. Required: publisher/author name as it should
appear; organisation, if any; a working contact address; funding disclosure (including
"unfunded personal project" if that is the truth); the repo URL if public; and
confirmation the data licence is CC0 1.0.

**Under no circumstances fabricate, guess, or placeholder any of these.** An invented
affiliation or funder on a defense-spending site is a far worse defect than the
missing page. If the owner has not answered, report BLOCKED and stop.

- [ ] **Step 2: Build the page from the supplied facts**

Render publisher/editor, funding, contact, repo and the licence visibly on `/about/`,
and put the contact plus licence in the footer. Make the existing "To report an
error… We will investigate and respond" sentence actionable by putting a real address
next to it.

- [ ] **Step 3: Verify and commit** — check `/contact/` either exists or `/about/`
      clearly serves that role, and that the licence is visible in rendered HTML, not
      only JSON-LD.

---

### Task B′4: #59 — reconciliation disclosure never reached the rollups

Program pages disclose the P-40 vs P-1 difference: 1,395 of 1,739 carry
`fully_reconciled: false` plus a reconciliation strip. Agency pages sum those same
figures and say nothing. Corpus-wide the FY24 column sits **$11.06B** below
`fy_2024_actuals` across **142** programs.

**Scope carefully: the totals are not wrong.** Headers equal their rows exactly
(verified). What is missing is the disclosure that already exists one level down.

**Files:** `src/govbudget/export_site.py`, `site/src/app/agency/[org]/page.tsx`,
`site/scripts/gates/basis.mjs`

- [ ] **Step 1: Measure the per-agency gap**

```bash
uv run python - <<'PY'
import json, duckdb
rows = json.load(open('data/site/json/programs.json'))
con = duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
wh = {r[0]: r[1] for r in con.execute(
    "select pe_bli, sum(amount_thousands)/1000 from fct_budget_lines"
    " where amount_type='fy_2024_actuals' group by 1").fetchall()}
from collections import defaultdict
g = defaultdict(lambda: [0.0, 0.0, 0])
for r in rows:
    s = r.get('fy2024_actual_millions') or 0
    w = wh.get(r['pe_bli'], 0) or 0
    g[r['org']][0] += s; g[r['org']][1] += w
    if abs(w - s) > 0.001: g[r['org']][2] += 1
for org, (s, w, n) in sorted(g.items(), key=lambda x: -(x[1][1] - x[1][0])):
    if n: print(f"  {org:6s} site {s:12,.3f}  actuals {w:12,.3f}  gap {w-s:10,.3f}  ({n} programs)")
PY
```

Record the table. It sizes the note and is the gate's non-vacuity floor.

- [ ] **Step 2: Emit the agency-level reconciliation figures**

Add to each agency's sidecar: the count of its programs with
`fully_reconciled: false`, and the FY24 gap in millions. Compute in Python, not in the
page.

- [ ] **Step 3: Render the same disclosure program pages already carry**

On `/agency/{org}/`, in the `ScopeNote` register (`data-note-kind="scope"`), reuse the
existing reconciliation vocabulary — do not invent a second one. State how many of the
agency's programs do not fully reconcile and what the FY24 figure excludes. Link to
the `/methodology/` section that explains the P-40 vs P-1 difference.

- [ ] **Step 4: Gate leg**

Any agency page whose sidecar reports ≥1 non-reconciling program must render the
disclosure. Non-vacuity: fail if it resolves fewer than 20 agency pages. Prove it
fails, record verbatim.

- [ ] **Step 5: Verify and commit**

---

### Task B′5: Sprint close

- [ ] **Step 1: Full loop at final HEAD** (commit everything FIRST — gate 1 pins `git_head`)

```bash
uv run pytest
uv run python -m govbudget verify-lineage
uv run python -m govbudget export-site
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify        # 24/24
cd .. && uv run python -m govbudget verify-phase5b3                   # serialized, binds 4173
```

- [ ] **Step 2: Extend the `/methodology/` corrections table** with any figure this
      sprint moved (the fused-key programs at minimum), following the 2026-08-08 table's
      format. Remember the page-weight ceiling was re-baselined to 128,000 / 34,500 —
      if the table pushes past it again, re-baseline with the reason recorded, and do
      **not** trim disclosure to fit.

- [ ] **Step 3: Close #56–#59 in the ROADMAP** with the verification evidence, and
      file anything this sprint did not close rather than leaving it implied.

- [ ] **Step 4: Report to the controller — do NOT deploy.**

---

## Self-review

**Spec coverage.** Review Tier-1 wrong numbers → B′1 (#56), B′2 (#57). Credibility
blocker → B′3 (#58). Rollup disclosure gap → B′4 (#59). Everything else from the
review is named in the "does NOT cover" section with a reason.

**Two review claims were falsified during planning** and are recorded above rather than
inherited: agency headers do equal their rows, and `1045` is a legitimate
account migration, not a collision. Both would have produced wrong work.

**Dependencies.** None between tasks. B′3 is **blocked on owner input** and must stop
rather than invent facts. B′1 is the largest and touches the URL contract; do it first
while the sprint has the most room.

**Cost.** Zero API spend. B′1 needs a dbt rebuild; everything else is compute.

**Risk.** B′1's URL change is the only outward-facing break in the sprint —
`/program/3010/` is a live 200 and six pages move. Redirects and the sitemap must be
part of that task, not an afterthought.
