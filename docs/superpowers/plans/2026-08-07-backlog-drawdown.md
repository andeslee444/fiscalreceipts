# Backlog Drawdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Standing rules (MANDATORY, apply to every task):
> commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit paths only,
> never `git add -A`; TDD; **never weaken a gate or an eval to make something pass
> — fix the page or the data**; every new gate leg ships with recorded
> proof-can-fail in `docs/superpowers/reviews/5c-gates-pre-failure.txt` under a
> dated heading; gate 1 is build-freshness, so build AFTER committing and
> re-verify at final HEAD; the suite is **24 gates** and must stay 24/24;
> `.env` is gitignored — never print or commit its values; **do not deploy** —
> deploy is `./scripts/launch/deploy.sh` and is run by the controller.

**Goal:** Drive the ROADMAP backlog to zero open *defects*, close the items that
are already superseded, and leave only consciously-deferred feature work — with a
gate behind every fix so nothing on this list can silently return.

**Architecture:** Four sprints ordered by risk-to-ship, not by item number.
Sprint A is ledger truth plus small integrity fixes that need no API spend.
Sprint B is two data-model corrections. Sprint C is a design pass that is blocked
on one owner decision. Sprint D is the expensive, long-horizon expansion work.
Each sprint ends green and deployable on its own.

**Tech Stack:** Python 3.12/uv, DuckDB, dbt, Postgres (psycopg), pdfplumber;
Next.js 16 static export, React 19, Tailwind v4, Playwright; gate suite under
`site/scripts/gates/`.

**Current state:** HEAD `702ecda`, 24/24 gates, deployed and live. 1,514 pytest ·
899 vitest · verify-phase5 PASS (eval 47/48, citations 43/43).

---

## Scope note — this plan deliberately does NOT cover

These are open in the ROADMAP and stay open. They are **feature work, not
defects**, and each deserves its own spec rather than a line in a drawdown plan.
Listing them here so "the backlog is clear" is an honest claim afterwards:

- **#7** FEC → congressional-marks → money-out chain
- **#8** Refresh automation (monthly USAspending, quarterly LDA, annual J-book)
- **#9** Resolution-memory for the review queue
- **#10** SAM entity extract / Splink entity-resolution upgrade
- **#15** District choropleth + entity-graph visualisation

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `docs/superpowers/ROADMAP.md` | the ledger; every task closes or amends an entry | all |
| `docs/superpowers/reviews/5c-gates-pre-failure.txt` | proof-can-fail record | A2, A5, B1, B2, C1 |
| `site/scripts/gates/render-static.mjs` | `CURRENCY_RE`; prose/currency sweeps | A2 |
| `site/scripts/gates/prose-allowlist.mjs` | anchored mirror of `CURRENCY_RE` | A2 |
| `data-seeds/title_overrides.csv` | **new** — published source-title corrections | A3 |
| `src/govbudget/export_site.py` | applies title overrides; agency sums; page notes | A3, B1, B2 |
| `evals/phase5_questions.yaml` | q022 wording | A4 |
| `src/govbudget/verify_phase5.py` | citation-recompute retry | A5 |
| `dbt/models/marts/dim_programs.sql` | per-org grain | B1 |
| `site/src/app/program/[peBli]/page.tsx` | "not in the FY2026 request" note | B2 |
| `site/src/app/globals.css` + route files | layout spine | C1 |
| `site/scripts/gates/measure.mjs` | **new** — chars-per-line + spine leg | C1 |

---

# SPRINT A — ledger truth and integrity fixes

No API spend. Ships in one deploy.

---

### Task A1: Close the four items that are already done or moot

Four backlog entries describe work that is finished, superseded, or unreachable.
Leaving them open makes the backlog lie about itself — the same defect class this
project keeps finding in its own pages.

**Files:**
- Modify: `docs/superpowers/ROADMAP.md`

- [ ] **Step 1: Verify #4 is superseded (historical J-book backfill)**

```bash
uv run python -c "
import duckdb; con=duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
r=con.execute('select fiscal_year, count(*) from fct_budget_lines group by 1 order by 1').fetchall()
print(', '.join(f'PB{y}={n:,}' for y,n in r))
"
```
Expected: ten editions `PB2017 … PB2026`, all non-zero. #4 asked for PB2025/PB2024;
Phase 5E loaded PB2017–PB2026. Mark `✅ SUPERSEDED 2026-08-07 by Phase 5E` with
the edition list as evidence.

- [ ] **Step 2: Verify #6's three sub-items individually**

```bash
ls dbt/models/marts/fct_family_obligations_by_year.sql   # per-family obligations-by-year
ls dbt/models/marts/fct_feed_events.sql                  # feed/event mart
uv run python -c "
import duckdb; con=duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
print([c[0] for c in con.execute('describe dim_geography').fetchall()])
"
```
The first two exist. **The third is the open question:** #6 says `dim_geography`
lacks a `fiscal_year`/`pe_bli` breakdown for district drill-down. If the describe
output shows both columns, close #6 entirely. If it does not, close the two mart
sub-items and **re-file the `dim_geography` half as its own numbered entry** —
do not close an item whose third clause is still true.

- [ ] **Step 3: Verify #13 is moot (Mistral OCR fallback)**

#13 proposed OCR for scanned/legacy J-books. Phase 5E established that every era
PB2017–PB2026 embeds structured `.zzz` XML, so extraction is deterministic and no
OCR path was ever needed. Confirm no ingestion path references OCR:

```bash
grep -rniE "ocr|mistral|document.ai" src/govbudget/ | grep -v test | head
```
Expected: no hits. Mark `✅ MOOT 2026-08-07 — every ingested era embeds .zzz XML;
OCR was never on the critical path.` If a *future* source lacks XML, this returns
as a new entry with that source named.

- [ ] **Step 4: Close #26 as contingent-not-applicable**

#26 mints a `request_vs_request` fact for dead PE `0605230F` *if* a feed claim ever
covers request-vs-request swings. Confirm the feed's event types still exclude it:

```bash
uv run python -c "
import json,collections
c=json.load(open('data/site/json/feed.json'))['cards']
print(dict(collections.Counter(x['event_type'] for x in c)))
"
```
Expected: `yoy_swing`, `concentration_shift`, `new_entrant`, `request_vs_actuals_gap`
— no request-vs-request type. Mark `⏸ CONTINGENT — not applicable while the feed
scopes to request-vs-actuals; re-open with the event type that needs it.`

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "docs(roadmap): close #4, #6, #13, #26 — superseded, moot, or contingent" \
  -m "Each closed with the command that proves it, not by assertion." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A2: `CURRENCY_RE` cannot see trillions (new entry — file as #46)

**Why this matters now:** `site/scripts/gates/render-static.mjs:180` reads

```js
const CURRENCY_RE = /\$[\d,]+(\.\d+)?\s*[BMK]?/g;
```

`[BMK]` has no `T`. PM Sprint 2 added a trillions formatter (`$3657.4B` → `$3.66T`),
so the site now *emits* a magnitude the negative-currency sweep and the prose
allowlist cannot match. No `$…T` token exists in the current build, which is
exactly why it is invisible — this is a hole waiting for its first tenant.

**Files:**
- Modify: `site/scripts/gates/render-static.mjs:180`
- Modify: `site/scripts/gates/prose-allowlist.mjs:43` (the anchored mirror)
- Modify: `docs/superpowers/reviews/5c-gates-pre-failure.txt`
- Modify: `docs/superpowers/ROADMAP.md` (add #46, closed in the same commit)

- [ ] **Step 1: Prove the hole, before touching the regex**

Plant a trillions figure in a page the sweep covers, then run the gate:

```bash
node -e "
const f='site/out/methodology/index.html'; const fs=require('fs');
const h=fs.readFileSync(f,'utf8');
fs.writeFileSync(f+'.bak', h);
fs.writeFileSync(f, h.replace('</main>', '<p>Planted for #46: a bare -\$1.2T token.</p></main>'));
"
cd site && node scripts/gates/render-static.mjs 2>&1 | grep -iE "1.2T|currency" | head
```
Expected: **no finding** — the gate is blind to it. Record this verbatim as the
"would have passed before" arm.

- [ ] **Step 2: Widen both regexes**

`render-static.mjs:180`:
```js
const CURRENCY_RE = /\$[\d,]+(\.\d+)?\s*[TBMK]?/g;
```
Apply the identical change to the anchored mirror in `prose-allowlist.mjs:43`.
**Both must change together** — the allowlist pattern is documented as the anchored
form of this regex, and a mismatch means a legal allowlist entry stops matching.

- [ ] **Step 3: Re-run with the plant still in place**

```bash
cd site && node scripts/gates/render-static.mjs 2>&1 | grep -iE "1.2T" | head
```
Expected: **FAIL** naming the `$1.2T` token. Record verbatim.

- [ ] **Step 4: Restore and confirm clean**

```bash
mv site/out/methodology/index.html.bak site/out/methodology/index.html
cmp site/out/methodology/index.html <(git show HEAD:site/out/methodology/index.html 2>/dev/null) || true
cd site && node scripts/gates/render-static.mjs 2>&1 | tail -3
```
Expected: PASS. (`site/out/` is gitignored; if `git show` has no copy, rebuild and
`cmp` against the fresh build instead.)

- [ ] **Step 5: Add a unit test so the two regexes can never drift apart**

Create `site/scripts/gates/__tests__/currency-re.test.mjs`:
```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const magnitudes = (src) => src.match(/\[([TBMK]+)\]\?/)?.[1] ?? "";

describe("CURRENCY_RE magnitude coverage", () => {
  it("covers T, B, M and K", () => {
    const src = readFileSync("scripts/gates/render-static.mjs", "utf8");
    for (const m of ["T", "B", "M", "K"]) expect(magnitudes(src)).toContain(m);
  });

  it("prose-allowlist's anchored mirror covers the same magnitudes", () => {
    const a = magnitudes(readFileSync("scripts/gates/render-static.mjs", "utf8"));
    const b = magnitudes(readFileSync("scripts/gates/prose-allowlist.mjs", "utf8"));
    expect([...b].sort()).toEqual([...a].sort());
  });
});
```

- [ ] **Step 6: Verify and commit**

```bash
cd site && npx vitest run scripts/gates/__tests__/currency-re.test.mjs
cd .. && git add site/scripts/gates/render-static.mjs site/scripts/gates/prose-allowlist.mjs \
  site/scripts/gates/__tests__/currency-re.test.mjs \
  docs/superpowers/reviews/5c-gates-pre-failure.txt docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(gates): the currency sweep could not see trillions (#46)" \
  -m "Sprint 2 added a \$T formatter; CURRENCY_RE matched only [BMK], so the one
magnitude the site newly emits was the one magnitude the sweep ignored. Both the
regex and its anchored allowlist mirror are widened, with a test pinning them
together." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A3: #39 — a published titles-override table

`Joint Hypersonic Technology Development &Transition` (PE `0603183D8Z`) is missing
the space after its ampersand. The string is verbatim from the source workbook and
propagates to `programs.json`, `search_quick.json`, `feed.json` and
`years_matrix.json`.

**The constraint that makes this non-trivial:** a display-time regex cannot be
allowed to mangle `RDT&E`, `HM&E`, `S&T`, `D&UP` or `R&D`. So the fix is
**source-side and enumerated**, not a rule — and the override list is **published**,
so a corrected title is visibly a correction rather than a silent edit.

**Files:**
- Create: `data-seeds/title_overrides.csv`
- Modify: `src/govbudget/export_site.py`
- Modify: `site/src/app/methodology/page.tsx` (publish the list)
- Test: `tests/test_title_overrides.py`

- [ ] **Step 1: Create the seed, with provenance columns**

`data-seeds/title_overrides.csv`:
```csv
pe_bli,source_title,display_title,reason,verified_on
0603183D8Z,Joint Hypersonic Technology Development &Transition,Joint Hypersonic Technology Development & Transition,Source workbook omits the space after the ampersand; no other change.,2026-08-07
```

- [ ] **Step 2: Write the failing test**

`tests/test_title_overrides.py`:
```python
from govbudget.export_site import apply_title_override, load_title_overrides


def test_override_applies_to_the_listed_pe():
    ov = load_title_overrides()
    assert apply_title_override("0603183D8Z", "Joint Hypersonic Technology Development &Transition", ov) == \
        "Joint Hypersonic Technology Development & Transition"


def test_override_does_not_touch_an_unlisted_pe():
    ov = load_title_overrides()
    assert apply_title_override("0601101E", "Defense Research Sciences", ov) == "Defense Research Sciences"


def test_override_refuses_when_the_source_title_has_changed():
    """If the workbook is corrected upstream, the override must stop applying
    rather than silently rewrite a title it no longer matches."""
    ov = load_title_overrides()
    fixed = "Joint Hypersonic Technology Development & Transition"
    assert apply_title_override("0603183D8Z", fixed, ov) == fixed
```

- [ ] **Step 3: Run it and watch it fail**

```bash
uv run pytest tests/test_title_overrides.py -v
```
Expected: `ImportError: cannot import name 'apply_title_override'`.

- [ ] **Step 4: Implement in `src/govbudget/export_site.py`**

```python
import csv
from functools import lru_cache
from pathlib import Path

TITLE_OVERRIDES_CSV = Path(__file__).resolve().parents[2] / "data-seeds" / "title_overrides.csv"


@lru_cache(maxsize=1)
def load_title_overrides() -> dict[tuple[str, str], str]:
    """(pe_bli, source_title) -> display_title.

    Keyed on the SOURCE title as well as the PE so an upstream correction
    silently disarms the override instead of rewriting a title it no longer
    describes.
    """
    if not TITLE_OVERRIDES_CSV.exists():
        return {}
    with TITLE_OVERRIDES_CSV.open(newline="", encoding="utf-8") as fh:
        return {
            (row["pe_bli"], row["source_title"]): row["display_title"]
            for row in csv.DictReader(fh)
        }


def apply_title_override(pe_bli: str, title: str, overrides: dict[tuple[str, str], str]) -> str:
    return overrides.get((pe_bli, title), title)
```

Then call it at every point the exporter emits a program title — `programs.json`,
`program_details`, `search_quick.json`, `feed.json`, `years_matrix.json`. Find them
with `grep -n "title" src/govbudget/export_site.py` and route each through
`apply_title_override`. Applying it in one shared helper is preferable to five call
sites if the exporter already has one.

- [ ] **Step 5: Run the tests**

```bash
uv run pytest tests/test_title_overrides.py -v
```
Expected: 3 passed.

- [ ] **Step 6: Publish the list on `/methodology/`**

Add a short subsection under the corrections material that renders every row of
`title_overrides.csv` — PE, source title, displayed title, reason, date. Read it
through the same `data.ts` path other build-derived content uses; **do not hardcode
the row.** One override today, and the section must render zero rows gracefully.

- [ ] **Step 7: Re-export, rebuild, verify, commit**

```bash
uv run python -m govbudget export-site
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
cd .. && uv run pytest
grep -c "Development &Transition" site/out/programs/index.html   # expect 0
```

```bash
git add data-seeds/title_overrides.csv src/govbudget/export_site.py \
  tests/test_title_overrides.py site/src/app/methodology/page.tsx docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(titles): published override table fixes the &Transition space (#39)" \
  -m "Source-side and enumerated rather than a display regex, which could not be
made safe against RDT&E / HM&E / S&T / D&UP / R&D. Keyed on (pe_bli, source_title)
so an upstream correction disarms the override. The list renders on /methodology/
so a corrected title is visibly a correction." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A4: #34 — q022's instruction contradicts its own ground truth

q022 asks for the MDA HHI and instructs *"Report both values as integers, exactly
as the SQL returns them (e.g. 2068, not 2068.0)."* That was written when
`round(hhi, 1)` happened to return an integral 2068. The Task 5b crosswalk rebuild
moved MDA's HHI to **2118.5**, so the instruction now tells the analyst to truncate
a genuinely fractional value. It answers `2118` against an expected `2118.5` and is
scored wrong — the only miss in the 47/48 run.

**This is an eval-wording defect, not an analyst failure.** The intent is *"do not
add or drop decimal places"*.

**Files:**
- Modify: `evals/phase5_questions.yaml` (q022 `question` text ONLY)

- [ ] **Step 1: Record the current wording and expected answer**

```bash
grep -A12 "id: q022" evals/phase5_questions.yaml
```
Note the exact `expected` value. **It must not change.**

- [ ] **Step 2: Amend the question text only**

Replace the instruction sentence with:

> `Report both values exactly as the SQL returns them — do not add or drop decimal places (e.g. 2068, not 2068.0; 2118.5, not 2118).`

**Do not touch** `expected`, `answer_sql`, or `tolerance`. This follows the
established eval-repair pattern: when a question underspecifies against its own
`answer_sql`, amend the question TEXT and nothing else.

- [ ] **Step 3: Re-run the live eval**

```bash
uv run python -m govbudget verify-phase5
```
Expected: accuracy **48/48**, citations 43/43, `verify-phase5: PASS`.
This costs roughly one live eval run (~$0.60) and must be run through the CLI —
never hand-write or substitute an answer.

If q022 still misses, **stop and report**: the wording was not the cause and the
item needs re-diagnosis rather than another wording pass.

- [ ] **Step 4: Commit with the run recorded**

```bash
git add evals/phase5_questions.yaml docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(eval): q022 said 'as integers' about a fractional HHI (#34)" \
  -m "Wording written when round(hhi,1) returned an integral 2068; the Task 5b
crosswalk rebuild moved MDA to 2118.5. Question TEXT amended only — expected,
answer_sql and tolerance untouched. Live re-run: <paste result>." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A5: #36 — a 100% bar sampled once from a nondeterministic agent

`verify-phase5` failed one sprint run at citation 42/43 because q011 returned the
right answer through literal/echo SQL, leaving `touched_tables` empty. An immediate
re-run of the same gate, same build, same data scored 43/43. The same question has
flaked twice before, for two different reasons.

**The bar is right — a citation that does not resolve is not a citation. Do NOT
lower the threshold.** The problem is that a single sample of an LLM agent gated at
exactly 100% fails intermittently for reasons unrelated to the build, which either
stalls releases or teaches operators to re-run until green. The second is worse.

**Files:**
- Modify: `src/govbudget/verify_phase5.py`
- Modify: `docs/superpowers/reviews/5c-gates-pre-failure.txt`
- Test: `tests/test_verify_phase5_retry.py`

- [ ] **Step 1: Decide the mechanism, and record why**

Two options are sanctioned by the backlog entry:
- **(a)** Bounded retry of the citation-recompute step for a question that scored
  *correct* but whose SQL was a literal echo — max 2 attempts, and the retry is
  **recorded in the run artifact**.
- **(b)** Best-of-N with per-attempt detail persisted.

Prefer **(a)**: it is narrower, it retries only the demonstrably-flaky step rather
than the whole answer, and it cannot mask a genuinely wrong answer because it only
triggers when accuracy already passed. State the choice in the commit message.

- [ ] **Step 2: Write the failing test**

`tests/test_verify_phase5_retry.py`:
```python
from govbudget.verify_phase5 import resolve_citation_with_retry


class FakeRecompute:
    """First call yields an empty touched_tables (the q011 flake); second succeeds."""

    def __init__(self, results):
        self.results = list(results)
        self.calls = 0

    def __call__(self, question_id):
        self.calls += 1
        return self.results.pop(0)


def test_retries_once_when_touched_tables_is_empty():
    rec = FakeRecompute([{"touched_tables": []}, {"touched_tables": ["fct_award_transactions"]}])
    out = resolve_citation_with_retry("q011", rec, max_attempts=2)
    assert out["touched_tables"] == ["fct_award_transactions"]
    assert out["retried"] is True
    assert rec.calls == 2


def test_does_not_retry_when_the_first_attempt_resolves():
    rec = FakeRecompute([{"touched_tables": ["dim_programs"]}])
    out = resolve_citation_with_retry("q004", rec, max_attempts=2)
    assert out["retried"] is False
    assert rec.calls == 1


def test_gives_up_after_max_attempts_and_reports_failure():
    rec = FakeRecompute([{"touched_tables": []}, {"touched_tables": []}])
    out = resolve_citation_with_retry("q011", rec, max_attempts=2)
    assert out["touched_tables"] == []
    assert out["retried"] is True
    assert rec.calls == 2
```

- [ ] **Step 3: Run it and watch it fail**

```bash
uv run pytest tests/test_verify_phase5_retry.py -v
```
Expected: `ImportError: cannot import name 'resolve_citation_with_retry'`.

- [ ] **Step 4: Implement**

```python
def resolve_citation_with_retry(question_id, recompute, max_attempts=2):
    """Retry ONLY the citation-recompute step, and only when it came back empty.

    A citation that does not resolve is still a failure — this does not lower the
    bar. It distinguishes 'the agent echoed a literal on this sample' from 'the
    build has no citation', which a single sample cannot. Every retry is recorded.
    """
    result = recompute(question_id)
    if result.get("touched_tables"):
        return {**result, "retried": False, "attempts": 1}
    for attempt in range(2, max_attempts + 1):
        result = recompute(question_id)
        if result.get("touched_tables"):
            return {**result, "retried": True, "attempts": attempt}
    return {**result, "retried": True, "attempts": max_attempts}
```

Wire it into the citation gate, and persist `retried` / `attempts` per question into
the eval-run JSON under `data/research/eval-runs/`. **A retried pass must be visible
in the artifact** — an invisible retry is indistinguishable from a lowered bar.

- [ ] **Step 5: Run the tests**

```bash
uv run pytest tests/test_verify_phase5_retry.py -v
```
Expected: 3 passed.

- [ ] **Step 6: Proof-can-fail — the retry must not rescue a real failure**

Point the recompute at a question whose citation genuinely cannot resolve (use a
fabricated question id, or stub the recompute to always return empty). Confirm the
gate still FAILS after both attempts, and that the artifact records
`attempts: 2, retried: true`. Record verbatim FAIL and PASS runs.

- [ ] **Step 7: Verify and commit**

```bash
uv run pytest
uv run python -m govbudget verify-phase5
```

```bash
git add src/govbudget/verify_phase5.py tests/test_verify_phase5_retry.py \
  docs/superpowers/reviews/5c-gates-pre-failure.txt docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(eval): bounded, recorded retry for the citation-recompute flake (#36)" \
  -m "The 100% citation bar is unchanged. What changed is that one sample of a
nondeterministic agent no longer decides it: the recompute step retries at most
twice, only when it returned empty, only when accuracy already passed, and every
retry is persisted in the run artifact so a retried pass is never mistaken for a
clean one." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A6: Sprint A close — full loop and deploy

- [ ] **Step 1: Full loop**

```bash
uv run pytest
uv run python -m govbudget verify-lineage
cd site && npx vitest run && npx tsc --noEmit && npx eslint .
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
cd .. && uv run python -m govbudget verify-phase5
```
Run `verify-phase5` **serialized** — it binds port 4173 and contends with
`verify-phase5b3` if both run at once (`EADDRINUSE` presents as a spurious
assembly FAIL).

- [ ] **Step 2: Deploy and push**

```bash
./scripts/launch/deploy.sh
cd .. && git push origin main
SPLIT=$(git subtree split --prefix=GovBudget | tail -1)
git push govbudget "$SPLIT":refs/heads/main
```
`deploy.sh` syncs R2 before pages and runs the live-asset check automatically.

---

# SPRINT B — data-model corrections

---

### Task B1: #45 — `dim_programs` carries one org per PE

`agencies.json`'s `fy2026_total_thousands` is component-grain **by design** — an
agency total is an agency-grain question, and summing program totals would credit
OSD with DMACT's, DTRA's and DoDEA's money. But it iterates `dim_programs`, which
carries ONE org per PE, so a shared BLI's components under a *different* org are
absent from that org's page entirely.

Measured gap: DCSA missing BLI 20's 2,230; DMACT BLI 30's 7,258; DTRA BLI 30's
12,023; DHRA BLI 500's 3,797 — **$25.3M across four agencies**. Not a wrong number
(those pages do not list the PE either, so the total is consistent with what they
show) but an understatement with no note.

**Files:**
- Modify: `dbt/models/marts/dim_programs.sql`
- Create: `dbt/tests/assert_dim_programs_org_grain.sql`
- Modify: `dbt/models/marts/schema.yml`
- Modify: `src/govbudget/export_site.py` (agency sum + the call-site note)

- [ ] **Step 1: Reproduce the gap before changing anything**

```bash
uv run python - <<'PY'
import duckdb
con = duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
print(con.execute("""
  select organization, pe_bli, sum(amount_thousands) k
  from fct_budget_lines
  where pe_bli in ('20','30','500') and amount_type='fy_2026_total' and title is not null
  group by 1,2 order by 2,1
""").fetchall())
PY
```
Record the component rows. These are the four agencies whose pages omit them.

- [ ] **Step 2: Decide the grain, and write the decision down**

This is a **dimension change, not an aggregate fix**, and it moves which agency page
lists a shared BLI. Two coherent options:
- **(a)** `dim_programs` gains a per-org grain — one row per (PE, org). Every consumer
  must then declare which grain it wants. Task #37 already established the *program*
  grain lives in `fct_program_trajectory`, so this is the complementary org view.
- **(b)** Keep `dim_programs` at PE grain and give the agency sum its own org-grain
  source.

**Prefer (b)** unless inspection shows `dim_programs` already has org-grain consumers:
it leaves the PE-grain contract (URLs, `generateStaticParams`, corpus counts) untouched,
and #37 set the precedent that the fix belongs in a purpose-built model rather than by
re-graining a dimension other things depend on. **Enumerate every `dim_programs`
consumer before choosing**, and record the enumeration in the commit.

- [ ] **Step 3: Write the dbt assertion first**

`dbt/tests/assert_dim_programs_org_grain.sql` — every (PE, org) component that has
FY2026 money appears in exactly one agency's total, and the sum of all agency totals
equals the sum of all component rows:

```sql
with components as (
    select organization, pe_bli, sum(amount_thousands) as k
    from {{ ref('stg_budget_lines') }}
    where amount_type = 'fy_2026_total' and title is not null
    group by 1, 2
),
agency_totals as (
    select organization, sum(k) as agency_k from components group by 1
)
select 'component dollars missing from every agency total' as failure,
       (select sum(k) from components) as component_sum,
       (select sum(agency_k) from agency_totals) as agency_sum
where (select sum(k) from components) <> (select sum(agency_k) from agency_totals)
```

- [ ] **Step 4: Run it against the current build and watch it fail**

```bash
cd dbt && uv run dbt test --select assert_dim_programs_org_grain
```
Expected: FAIL, with the $25.3M discrepancy. Record verbatim.

- [ ] **Step 5: Implement the chosen option, then re-run**

```bash
cd dbt && uv run dbt build && uv run dbt test --select assert_dim_programs_org_grain
```
Expected: PASS.

- [ ] **Step 6: Remove the call-site note that documented the gap**

`export_site.py` carries a written-down note about this understatement (added by
Task #37). Once the gap is closed, **delete the note** — a stale caveat describing a
fixed defect is its own small lie.

- [ ] **Step 7: Verify the four agency pages changed, and commit**

```bash
uv run python -m govbudget export-site
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify
```
Check `/agency/DCSA/`, `/agency/DMACT/`, `/agency/DTRA/`, `/agency/DHRA/` now include
their shared-BLI components. Commit with the before/after totals in the message.

---

### Task B2: #32a — a retired program element must not end silently

This is the small, independently-shippable half of #32. PB2026 renumbered program
elements at scale (Army 115 retired / 33 new, Air Force 77/36, Navy 69/14, OSD 18/9,
DARPA 14/8). Nothing links a retired PE to its successors, so a reader who followed
*Defense Research Sciences* for a decade hits a page that **simply stops at FY2025
with no forward pointer**.

The full `pe_remap` edge type is Task D2. This task ships the honest interim: the
page says what is true.

**This is verified against the primary source.** `data/raw_docs/fy2026/dod/r1_display.xlsx`
shows the FY2026 cells for retired lines are genuinely BLANK — the parser is correct,
and an earlier "coverage artifact" hypothesis was investigated and refuted. The page
note must therefore say *"does not appear in the FY2026 request"* — **never**
"zeroed", "cancelled", or "terminated", which is exactly the false claim the 87
withdrawn feed cards made.

**Files:**
- Modify: `src/govbudget/export_site.py` (emit a `not_in_fy2026` flag per program)
- Modify: `site/src/app/program/[peBli]/page.tsx`
- Modify: `site/scripts/gates/render-static.mjs` (assert the note, and its wording)

- [ ] **Step 1: Count the eligible set**

```bash
uv run python - <<'PY'
import duckdb
con = duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
print(con.execute("""
  with fy25 as (select distinct pe_bli from fct_budget_lines
                where amount_type like 'fy_2025%' and coalesce(amount_thousands,0) > 0),
       fy26 as (select distinct pe_bli from fct_budget_lines where amount_type like 'fy_2026%')
  select count(*) from fy25 where pe_bli not in (select pe_bli from fy26)
""").fetchone())
PY
```
Record the number. It sizes the note's blast radius and is the gate's non-vacuity floor.

- [ ] **Step 2: Emit the flag from the exporter**

Add `not_in_fy2026: bool` to each program's `program_details` sidecar, computed as
"has FY2025 money and no FY2026 row of any amount_type". Do **not** compute it in the
page from rendered values.

- [ ] **Step 3: Render the note, in the calm scope register**

Use the `ScopeNote` component and `data-note-kind="scope"` — this is honest scope
disclosure, not a caution about a number (gate 2 `(nk)` pins that vocabulary). Wording:

> **This program element does not appear in the FY2026 request.** Its last figure in
> our corpus is FY2025. The FY2026 workbook cells for this line are blank rather than
> zero, which usually means the line was renumbered or consolidated rather than
> defunded — we do not yet publish the link to its successor.

- [ ] **Step 4: Gate leg, built failing first**

Extend `render-static.mjs`: every program page whose sidecar carries
`not_in_fy2026: true` must render the note; no page without the flag may render it;
and the note must **not** contain the words `zeroed`, `cancelled`, or `terminated`.
Prove it fails by stripping the note from one built page and by planting the word
`cancelled` in another. Record verbatim FAIL and PASS.

- [ ] **Step 5: Verify and commit**

```bash
uv run python -m govbudget export-site
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify
```

---

### Task B3: Sprint B close — loop and deploy

Same commands as Task A6.

---

# SPRINT C — the layout design pass

**BLOCKED on an owner decision. Do not start Task C1 until C0 is answered.**

---

### Task C0: #43 — the Fact-ID default is the owner's call

All three judges on the second panel reported that the blue monospace hash is
visually louder than the dollar value beside it, that it wraps on wider figures
(giving `/programs/` an alternating 63/90px row rhythm), and that toggling it off
*"proves the underlying table design is much better."*

**This is not a defect to fix unilaterally.** The default was set deliberately in PM
Sprint 1 §P1-1 — *"the site is named Fiscal Receipts; its receipts are not opt-in"* —
and flipping it reverses a recorded product decision.

- [ ] **Step 1: Put the three options to the owner, with the constraint**

- **Keep ON, quieter** — smaller, lower contrast, no fill. Preserves the product
  stance; the figure becomes the loudest thing in its cell.
- **Reveal on hover/focus** — receipts present but not competing. Weakens the stance
  on touch devices, where there is no hover.
- **Default OFF**, dotted underline carries the signal. Cleanest tables; reverses
  §P1-1 outright.

Whichever is chosen, the invariant is: **the figure should be the loudest thing in
its own cell.**

- [ ] **Step 2: Record the decision in the ROADMAP entry before implementing**

---

### Task C1: #42 + #43 — the layout spine and the reading measure, together

Measured `h1` left offsets at 1440: **96** (`/flow/`, `/years/`), **160**
(`/programs/`, `/companies/`), **224** (nine pages), **288** (`/`, `/filing/`),
**352** (`/methodology/`) — six distinct `max-w-*` values across nineteen route files,
against a header whose wordmark is pinned at 96. Navigating Programs → Feed → Flow
slides the page sideways each time, and on 12 of 14 pages the title does not align
with the brand.

**Why these two items are one task:** the obvious fix for #42 makes a second reported
defect worse. The same panel measured explanatory prose at **136–165 characters per
line** on `/coverage/`, `/companies/families/`, `/program/` and `/`. Widening those
containers to align them pushes an already-over-long measure further. Solve both or
neither.

**Files:**
- Modify: `site/src/app/globals.css` (two container classes)
- Modify: all nineteen route files under `site/src/app/`
- Create: `site/scripts/gates/measure.mjs`
- Modify: `site/scripts/gates/a11y.mjs` or `render-live.mjs` (host the leg)

- [ ] **Step 1: Measure the current state and record it**

Script the `h1` left offset and the median characters-per-line of the main prose
block for all nineteen routes at 1440. Save as the before-table. **Do not skip this**
— "it looks aligned now" is not a result.

- [ ] **Step 2: Define exactly two containers**

- `.container-wide` — for matrices and charts, aligned to the header wordmark at 96.
- `.container-prose` — for explanatory text, capped so the rendered measure lands at
  **70–75 characters**.

A page may use both: wide for its table, prose for its explanation. It may not
introduce a third.

- [ ] **Step 3: Write the gate leg FIRST, and watch it fail**

`site/scripts/gates/measure.mjs`, at 1440:
- every route's `h1` left offset is one of the two declared values (fail on a third);
- every prose block's median rendered characters-per-line is ≤ 78 (measured from
  rendered text and box width, not from source);
- non-vacuous: fails if it resolves zero prose blocks on a page that must have one.

Run it against the current build. Expected: **FAIL** naming all five offsets and the
136–165 cpl blocks. Record verbatim — this is the proof-can-fail, and it is real
shipped state rather than a plant.

- [ ] **Step 4: Convert the routes, one commit per group of related routes**

Work through the nineteen files. After each group, re-run the leg and watch the
offset list shrink. Do not batch all nineteen into one commit.

- [ ] **Step 5: Apply the C0 decision to the Fact-ID chip**

- [ ] **Step 6: Re-judge at 390 and 1440**

3 independent opus judges, median ≥4 at both widths, judges blind to each other.
This task changes every page on the site; the gate proves alignment, only judging
proves it reads better. If median <4, fix and re-judge.

- [ ] **Step 7: Verify, deploy, push**

---

# SPRINT D — expansion

Expensive, long-horizon, API-consuming. Each task is independently shippable; none
blocks another except D2 → D3.

---

### Task D1: #1 + #19 — the LDA re-pull, as ONE unit

Curated aliases for Booz Allen, ADS Tactical, Vertex (V2X fka) and Shell E&P are
committed and spelling-verified against the live API, but **staged, not effective**:
those filings were never returned by the original pull's query strings, so they only
match at the next `govbudget influence pull`.

**Why this must run as one unit:** the re-pull can change filing amounts, and **fact
identity includes amount**, so it can orphan the 50 static dossier claims that cite
lobbying facts. Starting the warehouse mutation without the repair path available
leaves dossiers broken with no way back.

- [ ] **Step 1** — `govbudget influence pull`
- [ ] **Step 2** — dbt marts + mentions rebuild
- [ ] **Step 3** — `export-site`
- [ ] **Step 4** — dossier-citation check; list every orphaned claim
- [ ] **Step 5** — regenerate orphaned dossiers (needs the Anthropic API)
- [ ] **Step 6** — measure the live match rate
- [ ] **Step 7** — raise `match_gate5a` to 0.85 **only if the measured rate supports
      it**, with boundary tests. A premature raise was reverted once already; do not
      repeat it.

Budget: dossier regeneration is the expensive step (the original batch was ~$28.6).

---

### Task D2: #32b — the `pe_remap` edge type

The modelling half of #32. A `pe_remap` / `restructured_into` edge, evidence-tiered
exactly like the existing Stated and Inferred classes:

- **Stated** where a PB2026 R-2 narrative names the predecessor PE.
- **Inferred** where budget-activity + account + money conservation make a mapping
  likely — dashed, labelled "candidate (unverified)", **never summed**.

DARPA is the clean development case: 16 PEs, only 2 carried through, and the FY2026
total *rose* $4.15B → $4.92B, so money conservation is testable end to end.

Extend `verify-lineage` with a leg per tier. Ship the Stated tier alone if the
Inferred one cannot be made honest.

---

### Task D3: #29 — lineage Phase 2

Four independent pieces, each with its own honesty gate. Ship in this order:

- **(b) multi-edition citations** — unblocks the 28 pre-2026 stated edges dropped in
  5I for cite-shard resolvability under the PB2026 fence. No API cost. Do this first.
- **(a) LLM extraction** over the ~1,950 prose transfers that name a move but no
  adjacent PE code, gated on an extraction-precision check. Uses the API.
- **(c) lineage Sankey** — reuse the `/flow/` renderer; identities as nodes over time.
  Must meet the chart contract: accessible name, description, table view.
- **(d) cross-appropriation** (RDT&E ↔ Procurement) money-color lineage.

Two dormant 5I code notes to fold in when they become live:
- when `portion_amount` extraction lands, `has_split` in `_emit_lineage` must also
  flag a partial-transfer chain truncation, so the funding line is always explainable;
- `_load_lineage_for_export`'s `fiscal_year or 0` coercion should skip and log an
  unparseable fy rather than emit a `fy:0` edge.

---

### Task D4: #30 — program-level GAO ingestion

Program pages currently show only the DEPARTMENT-level GAO designation, correctly
labelled and de-emphasised. Missing is the program-specific tier — GAO's Weapon
Systems Annual Assessment (GAO-25-107569 and predecessors) and program-specific
reports. On the F-35 the absence is conspicuous.

Ingest GAO reports keyed to weapon programs; crosswalk report → `pe_bli` (title/PE
match, **gated on a precision check like every other crosswalk**); render
program-specific findings ABOVE the department note with the emphasis the department
note gave up; cite each to its report page.

Until it lands, the page's current statement is the honest one.

---

### Task D5: #28 — decade-only pages (decide before building)

A large set of PEs carry FY2017–2025 detail but no FY2026 `budget_lines` row, so they
generate no `/program/` page — history exists but isn't browsable. The audit estimated
~271 agency PEs; a looser cut is larger.

**This is an editorial decision, not a data defect.** These PEs are legitimately absent
from FY2026. Verify the exact eligible set and its editorial value **before** building.
If taken: a "decade-only" page tier (or fold into the rollup tier with an explicit
"no FY2026 request" note), gated for citation-completeness like every other tier.

Note this interacts with **B2**, which already adds the "does not appear in the FY2026
request" note to pages that *do* exist, and with **D2**, which would give these pages a
successor link. Sequence D5 after both, or the note gets written twice.

---

## Self-review

**Spec coverage.** Every open ROADMAP item is assigned: #1/#19 → D1; #4/#6/#13/#26 →
A1; #28 → D5; #29 → D3; #30 → D4; #32 → B2 (note) + D2 (edges); #34 → A4; #36 → A5;
#39 → A3; #42/#43 → C0/C1; #45 → B1; the unfiled `CURRENCY_RE` hole → A2 (filed as
#46). Items #7, #8, #9, #10, #15 are explicitly out of scope and named at the top.
#40 and #41 are already fixed and need no task.

**Known gap, stated rather than hidden.** A1 Step 2 may re-file part of #6 if
`dim_geography` still lacks the `fiscal_year`/`pe_bli` breakdown. That re-filed item
has no task in this plan, because whether it exists is not yet known.

**Dependencies.** C1 is blocked on C0 (owner). D3 assumes D2's edge type. D5 should
follow B2 and D2. Everything in Sprint A is independent.

**Cost.** A4 and A5 each need a live eval run (~$0.60). D1 needs dossier regeneration
(~$28.6 at the original batch size). D3(a) needs extraction over ~1,950 narratives.
Sprints A, B and C cost nothing beyond compute.
