# Backlog Completion — PM Roadmap and Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement Wave 1 task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close every remaining backlog item that earns its cost, and say plainly
which ones do not and why.

**Architecture:** Three waves ordered by dependency and by trust-per-dollar, not by
entry number. Wave 1 is free and unblocked. Wave 2 is quality work three judging
panels asked for. Wave 3 needs new data. Everything else is deferred on the record.

**Tech Stack:** Python 3.12/uv · DuckDB · dbt · Next.js 16 static export · React 19 ·
Tailwind v4 · Playwright · 24-gate verify suite

**Spec:** This document. Source facts: `docs/superpowers/ROADMAP.md` status markers
(`grep -n '\*\*Status: '`), `docs/superpowers/plans/2026-08-24-sprint-d-cost-and-dependencies.md`.

---

## Global Constraints

Copied verbatim from project rules. Every task's requirements implicitly include these.

- **The gate suite stays at 24 gates.** Add *legs* to existing gates. Never a 25th.
  Verify with `grep -c "gateResults.push" site/scripts/verify.mjs` → `24`.
- **Proof-can-fail is mandatory.** Every new leg must be run against a broken artifact
  FIRST, its verbatim FAIL captured, then fixed, then verbatim PASS captured. Both go
  into `docs/superpowers/reviews/5c-gates-pre-failure.txt`. A leg never seen to fail is
  not a gate.
- **Never weaken a gate, threshold, ceiling, or eval to make something pass.**
- **Page-weight ceilings:** raising one is a deliberate act justified in the same breath
  as the change that needs it. Never pre-emptively.
- **Build AFTER committing** — gate 1 pins `git_head`.
- **Commit as** `--author="Andes Lee <andes.lee444@gmail.com>"`. Explicit `git add <path>`
  only, NEVER `git add -A`. `.env` is gitignored; never print or commit its values.
- **Owner standing decision:** publish the smaller TRUE number over the bigger false
  one, and label the change a correction.
- **Deploy** only via `./scripts/launch/deploy.sh`, and only when instructed.

## A note on why this plan does not prescribe code

The repo's own process note records that **eleven times**, a plan's prescribed code was
wrong while its measured figures held up — "the code was never executed before being
written down." The writing-plans skill asks for literal code in every step. Where I have
verified a value, path, or command, it is written literally below. Where the
implementation must be traced against live data, this plan gives the **contract and the
gate** instead of invented code, and says so at that step. That is deliberate, and it is
the project instruction winning over the skill's default.

---

## PM Roadmap — all 16 open items

### Wave 1 — free, unblocked, no owner decision (THIS PLAN)

| # | Item | Why now |
|---|---|---|
| #55 | Flagship alias curation | Worksheet exists (215 rows). Two *live* defects: JASSM routes 10 mention rows to the wrong PE; 5 families collapse onto one page. |
| #19 + #1 | LDA re-pull | Blocker was false; cost is <$1. Curation must land first so seed edits ride the same ripple at zero extra cost. |
| #32(a) | Renumber forward-pointer note | Entry itself scoped this half as "small and independently shippable"; never shipped. |

### Wave 2 — quality, after Wave 1 lands

| # | Item | Why later |
|---|---|---|
| #42 | Layout spine | 10 distinct `max-w` values across 44 pages. Real, but a design pass — wants a settled site to measure against. |
| #43 | Fact-ID chip weight | Owner decision. Recommendation below; implementation is ~1 task once decided. |

### Wave 3 — new data, larger

| # | Item | Cost |
|---|---|---|
| #30 | Program-level GAO | Free, independent, public reports behind a precision gate. |
| #28 | Decade-only coverage pages | Free editorial; sequence after #32(a) so the "no FY2026 request" note is written once. |
| #29 | Lineage Phase 2 | (b)(c)(d) free. **(a) LLM extraction ~$10–20 full, ~$2 pilot — the only real spend in the entire backlog.** #32(b) folds in here. |

### Deferred — a decision, not an oversight

| # | Item | Why not |
|---|---|---|
| #7 | FEC → CongressionalAddDetail | Largest remaining build. Adds a new *claim type* (money-in → marks) whose evidentiary bar is higher than anything shipped; the site's credibility is currently built on primary budget documents. Not worth opening that front until Waves 1–3 are done. |
| #8 | Refresh automation | Genuinely valuable, but needs ops decisions (where it runs, who is paged) that no engineering plan can settle. |
| #9 | Review-queue resolution memory | Internal tooling. Zero user-facing trust value. Cheapest to do when someone is next in `reconcile.py` anyway. |
| #10 | SAM extract / Splink | Entity-resolution upgrade; large, and current resolution is not a top complaint. |
| #15 | Choropleth + entity graph | Visualization polish. `/district/` already publishes the numbers. |
| #6, #14 | PARTIAL remainders | #6's `dim_geography` grain and #14's dim_programs half are both scoped out by their own entries. |

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `docs/curation/roadmap-55-flagship-alias-worksheet.csv` | Curated `pick` column filled | 1 |
| `dbt/seeds/program_aliases.csv` | Seed rows for ratified aliases | 2 |
| `site/scripts/gates/basis.mjs` | Gate 23 leg — alias resolves to its ratified PE | 2 |
| `src/govbudget/influence/lda.py` | LDA pull (unchanged; invoked) | 3 |
| `src/govbudget/verify_phase5a.py:62` | `_MATCH_THRESHOLD` raise, measured not guessed | 3 |
| `src/govbudget/export_site.py` | Renumber forward/backward pointer payload | 4 |
| `site/src/app/program/[peBli]/` | Renders the pointer note | 4 |
| `site/scripts/gates/program-skeleton.mjs` | Gate 21 leg — retired PE must carry a pointer | 4 |

---

## Task 1: Draft the #55 alias picks, with evidence, for owner ratification

**Files:**
- Modify: `docs/curation/roadmap-55-flagship-alias-worksheet.csv` (fill `pick`, `curator_notes`)
- Create: `docs/curation/roadmap-55-ratification.md` (the ask, one screen)

**Interfaces:**
- Consumes: the worksheet's 215 rows / 72 terms, columns `alias_term`, `candidate_pe_bli`,
  `candidate_title`, `org`, `fy2026_total_thousands`, `resolves_today`, `seed_conflict`.
- Produces: a `pick` value (`y` / `n` / `ambiguous`) on every row, and a ratification doc
  listing ONLY the rows where a human must choose.

**Framing correction this task exists to make:** #55 was filed as needing "domain
judgment", and I repeated that. It is mostly not judgment. *Sentinel* → LGM-35A is a
matter of public record, not taste: the program of record is `0605238F` Ground Based
Strategic Deterrent EMD, whose title contains no "Sentinel" at all, which is exactly why
substring matching lands on *Sentinel Mods*. Rows like that are **researchable**. Rows
like RAM (89 candidates) are genuinely ambiguous. Separating the two is the work.

- [ ] **Step 1: Classify every row into researchable vs ambiguous**

Run, and read the output before deciding anything:

```bash
cd /Users/andeslee/Documents/Cursor-Projects/GovBudget
python3 -c "
import csv,collections
rows=list(csv.DictReader(open('docs/curation/roadmap-55-flagship-alias-worksheet.csv')))
by=collections.defaultdict(list)
for r in rows: by[r['alias_term']].append(r)
for t,rs in sorted(by.items(), key=lambda kv:-len(kv[1])):
    print(f'{t:<22} {len(rs):>3} candidates | conflict={rs[0][\"seed_conflict\"]}')
"
```

- [ ] **Step 2: Fill `pick` for the sole-match and clear-winner terms**

Rule, applied uniformly and written into `curator_notes` for each row:
`y` when the candidate is the program of record for that popular name; `n` otherwise;
`ambiguous` when two or more candidates are defensible. Do NOT guess: if the program of
record cannot be established from the corpus plus the candidate titles, mark `ambiguous`.
Every `y` must carry a one-line reason naming *why that PE and not its siblings*.

- [ ] **Step 3: Write the ratification doc**

`docs/curation/roadmap-55-ratification.md` contains ONLY the `ambiguous` terms, one
block each: the alias, every candidate with title/org/FY2026 dollars, what resolves
today, and a recommended pick with its reasoning. The owner ticks or overrides. Terms
resolved in Step 2 are listed as a single count, not re-litigated.

- [ ] **Step 4: Verify no `pick` column is empty**

```bash
python3 -c "
import csv
rows=list(csv.DictReader(open('docs/curation/roadmap-55-flagship-alias-worksheet.csv')))
blank=[r for r in rows if not (r.get('pick') or '').strip()]
print('rows:',len(rows),'| blank picks:',len(blank))
assert not blank, blank[:3]
print('OK')
"
```

Expected: `blank picks: 0` then `OK`.

- [ ] **Step 5: Commit**

```bash
git add docs/curation/roadmap-55-flagship-alias-worksheet.csv docs/curation/roadmap-55-ratification.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "docs(curation): draft #55 alias picks; isolate what actually needs a human"
```

---

## Task 2: Seed the ratified aliases, and gate that they resolve

**Files:**
- Modify: `dbt/seeds/program_aliases.csv`
- Modify: `site/scripts/gates/basis.mjs` (new leg on the existing leg-family — NOT a new gate)
- Modify: `docs/superpowers/reviews/5c-gates-pre-failure.txt`

**Interfaces:**
- Consumes: Task 1's `pick == 'y'` rows.
- Produces: seeded aliases such that searching the popular name reaches the ratified PE.

**Contract, not prescribed code.** The seed file's exact column order and the alias
lookup's join must be read from `dbt/seeds/program_aliases.csv` and the model that
consumes it before writing a row. Do not infer the schema from this plan.

- [ ] **Step 1: Capture the FAILING state first**

Before seeding, assert the defect: JASSM's alias mentions currently attach to
`0603000D8Z` (*Joint Munitions Advanced Technology*, OSD) rather than the JASSM PE.
Write the gate leg so it reports that, run it, and paste the verbatim failure into
`5c-gates-pre-failure.txt`. If the leg passes before the fix, the leg is wrong — fix the
leg, not the record.

- [ ] **Step 2: Add the ratified rows to the seed**

One row per `pick == 'y'`. No row for `ambiguous` — an unratified alias is worse than no
alias, because it produces a confident wrong answer, which is the defect class this
whole project exists to remove.

- [ ] **Step 3: Rebuild dbt and re-run the leg**

```bash
cd /Users/andeslee/Documents/Cursor-Projects/GovBudget
uv run dbt build --select program_aliases+ 2>&1 | tail -20
```

- [ ] **Step 4: Confirm gate count unchanged and capture PASS**

```bash
grep -c "gateResults.push" site/scripts/verify.mjs   # must print 24
```

Paste the verbatim PASS into `5c-gates-pre-failure.txt` beneath the FAIL.

- [ ] **Step 5: Commit**

```bash
git add dbt/seeds/program_aliases.csv site/scripts/gates/basis.mjs docs/superpowers/reviews/5c-gates-pre-failure.txt
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(aliases): seed the ratified flagship names, gated (#55)"
```

---

## Task 3: Run the LDA re-pull and measure the match rate

**Files:**
- Invoke: `src/govbudget/influence/lda.py` (no modification expected)
- Modify: `src/govbudget/verify_phase5a.py:62` (`_MATCH_THRESHOLD`) — only if measurement supports it
- Modify: `docs/superpowers/ROADMAP.md` (#19, #1 status)

**Interfaces:**
- Consumes: Task 2's seeded aliases.
- Produces: refreshed LDA data; a measured match rate.

**Verified premises — do not re-litigate, but do re-verify before acting:**
- The pull is a **free**, unauthenticated public API (`lda.senate.gov/api/v1`).
- `fact_id_lda_filing` hashes `(filing_uuid, role)` only. **Amount is not an input** —
  the "orphans the 50 dossier claims" premise is false.
- Exactly **1** of the 432 distinct dossier fact_ids is an `lda_filing`, and its claim
  quotes no dollar figure. Worst-case repair ≈ $0.07.

- [ ] **Step 1: Run the pull**

- [ ] **Step 2: Measure the actual match rate**

`_MATCH_THRESHOLD` is `0.80` today and #19 contemplates raising it to `0.85`. **Measure
before moving it.** If the measured rate does not clear 0.85 with margin, leave the
threshold alone and record the measurement. Raising a threshold the data does not support
is weakening a gate in the opposite direction — it would fail on honest data.

- [ ] **Step 3: Confirm the single lda_filing dossier fact still resolves**

```bash
cd /Users/andeslee/Documents/Cursor-Projects/GovBudget
python3 -c "
import json,glob
ids=set()
def w(o):
    if isinstance(o,dict):
        f=o.get('fact_id')
        if isinstance(f,str): ids.add(f)
        for v in o.values(): w(v)
    elif isinstance(o,list):
        for v in o: w(v)
for f in glob.glob('data/site/json/dossiers/*.json'): w(json.load(open(f)))
import collections
k=collections.Counter()
for s in glob.glob('data/site/json/cite-shards/*.json'):
    d=json.load(open(s))
    for fid,rec in (d.items() if isinstance(d,dict) else []):
        if fid in ids: k[rec.get('kind') or rec.get('dataset') or '?']+=1
print(dict(k))
"
```

Expected: `lda_filing` count is `1` and total resolved is `432`. A drop means the pull
orphaned something — stop and investigate before committing.

- [ ] **Step 4: Full suite**

```bash
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify
```

Expected: `overall: PASS`, exit 0, 24/24.

- [ ] **Step 5: Commit, and update #19/#1 status markers to CLOSED with the measured rate**

---

## Task 4: #32(a) — a retired program element must point forward

**Files:**
- Modify: `src/govbudget/export_site.py` (pointer payload on the program sidecar)
- Modify: `site/src/app/program/[peBli]/` (render it)
- Modify: `site/scripts/gates/program-skeleton.mjs` (gate 21 leg)
- Modify: `docs/superpowers/reviews/5c-gates-pre-failure.txt`

**Interfaces:**
- Consumes: `fct_budget_lines` (`pe_bli`, `fiscal_year`, `amount_type`, `amount_thousands`).
- Produces: a per-program flag + note for PEs with FY2024/FY2025 money and no FY2026 figure.

**Scope fence — read this before writing anything.** #32 has two halves. This task is
the SMALL one the entry itself calls "independently shippable": a reader who followed
*Defense Research Sciences* for a decade currently hits a page that stops at FY2025 with
no forward pointer. This task adds the **honest note** — "this program element has no
FY2026 request in PB2026; it was not necessarily cancelled, and PB2026 renumbered program
elements at scale." It does NOT build successor edges. That is #32(b) and folds into #29.

**Do not assert a successor.** The corpus cannot currently prove *Defense Research
Sciences* → *Emerging Opportunities*. Naming one would be a fabricated citation — the
exact defect species this codebase keeps closing. The note states absence and its
context; it does not guess.

- [ ] **Step 1: Measure the affected population**

```bash
cd /Users/andeslee/Documents/Cursor-Projects/GovBudget
uv run python -c "
import duckdb
c=duckdb.connect('data/duckdb/govbudget.duckdb',read_only=True)
q='''
with fy as (
  select pe_bli,
         max(case when amount_type like '%2026%' and amount_thousands>0 then 1 else 0 end) has26,
         max(case when (amount_type like '%2024%' or amount_type like '%2025%')
                   and amount_thousands>0 then 1 else 0 end) had_prior
  from fct_budget_lines group by pe_bli
)
select count(*) from fy where has26=0 and had_prior=1
'''
print('retired PEs (prior money, no FY2026):', c.execute(q).fetchone()[0])
"
```

Record the number. It is the gate leg's expected population and the note's blast radius.

- [ ] **Step 2: Write the gate 21 leg FIRST, and watch it fail**

Contract: every program page whose PE has prior-year money and no FY2026 figure must
carry the pointer note (a stable `data-` hook, matching the file's existing convention —
read `program-skeleton.mjs` for how legs there assert, do not invent a shape). Run it
against the current build. It must fail on the full population measured in Step 1.
Paste verbatim into `5c-gates-pre-failure.txt`.

- [ ] **Step 3: Emit the flag from the exporter, render the note, re-run**

- [ ] **Step 4: Full suite + gate count**

```bash
grep -c "gateResults.push" site/scripts/verify.mjs   # 24
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify
```

- [ ] **Step 5: Commit, and mark #32 as PARTIAL** — half (a) closed, half (b) explicitly
      handed to #29. Do not mark #32 CLOSED.

---

## Wave 2 preview — #43 recommendation

The entry's own marker reads *"OPEN — awaiting the owner decision this entry asks for."*
Three judging panels asked for the Fact-ID chip to be **subordinate to the figure it
annotates**; Sprint 1 deliberately shipped it default-ON as a trust feature. Both are
right about different things.

**Recommendation: keep chips ON, reduce their visual weight.** The trust argument is
about *availability* — a reader must be able to see that every figure is cited. The panel
argument is about *hierarchy* — the chip must not out-shout the number. Those do not
conflict. Turning chips OFF by default would trade a real trust property for a styling
problem that styling can fix. `receipts-toggle.tsx:51` stays `useState(true)`; the chip
gets subordinate treatment.

This is a recommendation, not a decision. It needs the owner's yes.

---

## Self-Review

**Spec coverage.** All 16 open/partial items are placed: 3 in Wave 1 (tasked in full),
2 in Wave 2, 3 in Wave 3, 6 deferred with named reasons, plus #6/#14 PARTIAL remainders
scoped out by their own entries. No item is unaccounted for.

**Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N". Three steps
deliberately give a *contract* rather than code (Task 2 Step 2, Task 4 Steps 2–3); each
says so explicitly and states what must be read first. That is the project's anti-pattern
rule overriding the skill's default, argued above, not an omission.

**Type consistency.** `pick` values (`y`/`n`/`ambiguous`) are used identically in Task 1
Steps 2/4 and Task 2 Step 2. `_MATCH_THRESHOLD` is named once, with its file and line.
`fact_id_lda_filing`'s inputs are stated once and not restated differently.

**Known risk.** Task 3 depends on a live third-party API. If `lda.senate.gov` is
unavailable, Tasks 1–2 and 4 still stand alone and ship; Task 3 retries later.
