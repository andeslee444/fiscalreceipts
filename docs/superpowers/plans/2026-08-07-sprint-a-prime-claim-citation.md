# Sprint A′ — Claim ↔ Citation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Standing rules (MANDATORY, apply to every task):
> commits `--author="Andes Lee <andes.lee444@gmail.com>"` + trailer
> `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (or the executing model);
> explicit paths only, never `git add -A`; TDD; **never weaken a gate or an eval to
> make something pass — fix the page or the data**; every new gate leg ships with
> recorded proof-can-fail in `docs/superpowers/reviews/5c-gates-pre-failure.txt`
> under a dated heading; gate 1 is build-freshness, so build AFTER committing and
> re-verify at final HEAD; **the suite is 24 gates and must stay 24/24 — every leg
> below attaches to an existing gate, none adds a new one**; `.env` is gitignored —
> never print or commit its values; **do not deploy** — deploy is
> `./scripts/launch/deploy.sh` and is run by the controller.

**Goal:** Close the six defects where a true, correctly-cited figure carries a false
label — and add the gate family that makes that class visible, so no future page can
reintroduce it.

**Architecture:** Every existing gate asks *does this number match its citation?* and
every one of these defects passes that check. This sprint adds the complementary
question — *does the sentence around the number say something the source supports?* —
as legs on gates 2 (render-static), 23 (basis), 12 (district) and `verify-lineage`,
plus one dbt assertion. Tasks are ordered cheapest-and-most-certain first, so the
sprint is shippable after any task. The owner decision is recorded: **where a figure
is currently large and false, publish the smaller true one.**

**Tech Stack:** Python 3.12/uv, DuckDB, dbt, pdfplumber; Next.js 16 static export,
React 19, Tailwind v4, Playwright; gate suite under `site/scripts/gates/`.

**Current state:** HEAD `5bac852`, 24/24 gates, deployed and live. Every defect below
was reproduced against the shipped warehouse and source on 2026-08-07 — the numbers in
each task are measured, not estimated.

> **The prescribed code in this plan is a starting point, not gospel — verify it before
> you trust it.** Learned the hard way on Task A′1: the regex this plan prescribed for
> leg (t) matched **its own prescribed fix text**, so the task as written could never
> have reached its own stated PASS, and against the full build it scored 2 true
> positives out of 3,172 hits. The measured *figures* in this plan were reproduced
> against the warehouse and are reliable. The *code* was written without being executed.
> When a prescribed snippet doesn't survive contact with real data, the right move is
> what A′1 did: gather programmatic evidence, replace it with something **tighter**
> (never looser — that would be weakening a gate), and disclose the substitution in the
> code comment, the proof-can-fail record, and the commit message. Do not silently
> conform to a spec you have evidence is wrong, and do not silently depart from one
> either.

---

## Relationship to the backlog-drawdown plan

This plan is **additive** to `docs/superpowers/plans/` backlog drawdown. That plan
drives the *ROADMAP* to zero; this one drives the *site's false claims* to zero. They
overlap on nothing. Recommended order: Sprint A′1–A′3 (one deploy, all cheap) →
existing Sprint A → A′4–A′7 → existing Sprint B onward.

Three corrections to the existing plan, verified 2026-08-07 — apply them when that
plan runs (Task A′0 files them):

| Existing step | Correction |
|---|---|
| A1 Step 2 (#6) | **The contingency fires.** `dim_geography` is `[pop_state, pop_district, transaction_count, total_obligation]` — no `fiscal_year`, no `pe_bli`. Close the two mart sub-items; re-file the `dim_geography` half. |
| A1 Step 3 (#13) | The grep is a false-positive generator: unanchored `ocr` matches So**cr**ata (14 hits). Use `grep -rniE "\bocr\b\|mistral\|document.?ai" src/govbudget/ \| grep -v test` — genuinely clean, 0 hits. |
| B2 Step 1 (#32a) | 190 PEs qualify, but only **165 have a `/program/` page**. A non-vacuity floor of 190 can never pass. Floor is 165. |
| A2 (#46) | The allowlist mirror is at `prose-allowlist.mjs:44`, not :43 (43 is its doc comment). |

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `docs/superpowers/ROADMAP.md` | ledger; every task files or closes an entry | all |
| `docs/superpowers/reviews/5c-gates-pre-failure.txt` | proof-can-fail record | A′1–A′7 |
| `site/src/app/page.tsx` | homepage top-movers caption | A′1 |
| `site/scripts/gates/render-static.mjs` | leg (t) tense/basis vocabulary; leg (u) index denominators | A′1, A′3 |
| `site/src/lib/basis.ts` | `BASIS_LABEL`; **new** `basisChipForExhibit` | A′2 |
| `site/src/lib/programs-row.ts` | carries `exhibitFamily` onto the row | A′2 |
| `site/scripts/gates/basis.mjs` | leg (d) exhibit-family agreement; leg (e) mandatory split | A′2, A′4 |
| `site/src/app/programs/page.tsx` | dollar denominator + true exclusion criterion | A′3 |
| `src/govbudget/export_site.py` | FY26 split fields; district totals; programs coverage | A′3, A′4, A′5 |
| `site/src/components/program-figures.tsx` | discretionary/reconciliation split chip | A′4 |
| `dbt/models/marts/fct_district_totals.sql` | **new** — award-distinct district grain | A′5 |
| `dbt/tests/assert_district_totals_no_double_count.sql` | **new** | A′5 |
| `site/src/components/district-table.tsx` | default sort; basis disclosure | A′5 |
| `site/scripts/gates/district.mjs` | leg (e) no-double-count | A′5 |
| `src/govbudget/influence/mentions.py` | ≥2-token / PE-literal match rule | A′6 |
| `dbt/tests/assert_program_mentions_evidence.sql` | **new** | A′6 |
| `src/govbudget/lineage/extract.py` | negation-aware extraction; per-edge fact ids | A′7 |
| `src/govbudget/verify_lineage.py` | leg (f) no negated stated edge | A′7 |

---

### Task A′0: File the six defects in the ROADMAP before fixing any of them

A fix with no ledger entry is invisible to the next reader, and this sprint closes six
things at once. File them first so each later commit closes a numbered item.

**Files:**
- Modify: `docs/superpowers/ROADMAP.md`

- [ ] **Step 1: Add six entries with their measured evidence**

Add under the open-items section, numbering from the next free id (the drawdown plan
claimed #46 for `CURRENCY_RE`, so start at **#47**):

```markdown
- **#47** Homepage calls the FY2026 request "enacted". `site/src/app/page.tsx:291-292`
  reads "between FY2025 and FY2026 enacted"; /methodology/, /years/ (FY26R) and every
  program page say request. The source workbook has no FY2026 enacted column.
- **#48** The basis chip says "P-1 TOA" on R-1 lines. `site/src/lib/basis.ts:12`
  hardcodes one label; `programs.json.exhibit_family` is rdte=1077 / procurement=664,
  so 1,077 of 1,741 (62%) are mislabelled. The correct value already ships.
- **#49** /programs/ publishes a row counter over a 59.3%-complete dollar universe.
  Columns sum to $228.46B against the site's own $385.3B FY2026 universe. Largest
  omissions: 9999999999 Classified $73.90B, 2013 Virginia Class $11.08B, 1045 COLUMBIA
  $10.92B. The stated exclusion ("not covered by the R-1/P-1 rollups") is false —
  COLUMBIA is a P-1 line and its own page says so.
- **#50** One-time reconciliation money is folded into every FY2026 "Request" figure.
  fy_2026_total $385.27B = disc $296.26B + reconciliation $89.01B. Against
  fy_2025_enacted $321.88B the headline basis reads +19.7% and the discretionary basis
  reads −8.0%. Long Range Kill Chains headlines +3052.9% on $1,916k of discretionary.
- **#51** District totals add one award once per matched program element.
  fct_district_programs joins on award_id_piid only, never pe_bli; the exporter sums
  those rows. Published $8.0111B vs $5.5787B award-distinct = 43.6% inflation
  ($2.432B). AK-00 publishes $1.05B from one $209.3M award (5.0×).
- **#52** "Program elements named in lobbying filings" are single-common-word matches.
  mentions.py emits a row on ONE title token ≥5 chars; the GENERIC_WORDS stoplist
  misses BASED, SERVICES (it lists singular SERVICE), ACQUISITION, ACTIVITIES,
  CHEMICAL. Aggregates (34,538 sitewide) carry no caveat.
- **#53** A "Stated · cited" lineage edge is built from a sentence that retracts it.
  /program/1203154SF/ asserts realigned → 1203609SF from "was erroneously transferred";
  both edges share one page-level fact_id 10a4acbaa3270c74.
```

- [ ] **Step 2: Record the owner decision in the ROADMAP, above the entries**

```markdown
> **Owner decision, 2026-08-07 (#49, #51, #52):** where a published figure is currently
> large and false, publish the smaller true one. District linkable dollars fall
> $8.01B → $5.58B; the lobbying mention count falls by whatever the evidence rule
> removes. These are corrections, and they ship labelled as corrections.
```

- [ ] **Step 3: Apply the four drawdown-plan corrections from the table above**

Amend the #6, #13, #32a and #46 entries in place with the verified facts. Do not close
#6 — its `dim_geography` clause is still true.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "docs(roadmap): file #47-#53 — the claim-vs-citation defect class" \
  -m "Six defects that pass every number-matches-citation gate because each is a true, correctly-cited figure wearing a false label. Each entry carries the query or line number that reproduces it. Also corrects four premises in the backlog-drawdown plan (#6 contingency fires, #13 grep false-positives on Socrata, #32a floor is 165 not 190, #46 mirror is line 44)." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task A′1: #47 — the homepage calls the request "enacted"

One word, on the most-read module, attached to the largest number on the site. The fix
is trivial; the gate is the point — nothing currently stops any page from describing a
request figure as enacted.

**Files:**
- Modify: `site/src/app/page.tsx:291-292`
- Modify: `site/scripts/gates/render-static.mjs`
- Modify: `docs/superpowers/reviews/5c-gates-pre-failure.txt`

- [ ] **Step 1: Write the gate leg FIRST, against the current build**

Add to `render-static.mjs`, as leg **(t) request-vs-enacted vocabulary**. Place it
beside the existing currency sweep and export it through the same `errors` array:

```js
/**
 * LEG (t) — request/enacted vocabulary (#47).
 *
 * FY2026 is a REQUEST in every edition this site ships; the source workbook has
 * no FY2026 enacted column. Any prose that puts "FY2026" and "enacted" in the
 * same clause asserts a legislative fact the corpus cannot support. This is a
 * claim-level check: the figures beside these words are correctly cited, which
 * is exactly why no other leg can see it.
 */
const ENACTED_FY26_RE =
  /FY\s*2026[^.<]{0,60}?\benacted\b|\benacted\b[^.<]{0,60}?FY\s*2026/i;

function checkRequestEnactedVocabulary(pageText, relPath) {
  const hit = pageText.match(ENACTED_FY26_RE);
  if (!hit) return null;
  return `${relPath}: prose couples FY2026 with "enacted" — FY2026 is a request in every shipped edition: ${JSON.stringify(hit[0].slice(0, 120))}`;
}
```

Call it for every page the sweep already walks, pushing any non-null result into
`errors`.

- [ ] **Step 2: Run the gate and watch it FAIL on real shipped state**

```bash
cd site && node scripts/gates/render-static.mjs 2>&1 | grep -iE "enacted" | head
```

Expected: **FAIL** naming `index.html` and the phrase `FY2025 and FY2026\n enacted`.
This is proof-can-fail against shipped state, not a plant — record it verbatim under a
dated heading in `docs/superpowers/reviews/5c-gates-pre-failure.txt`.

- [ ] **Step 3: Fix the caption**

`site/src/app/page.tsx:291-292`, replace:

```tsx
            Programs with the biggest funding swings between FY2025 and FY2026
            enacted, ranked by the size of the change in dollars with
```

with:

```tsx
            Programs with the biggest funding swings between FY2025 enacted and
            the FY2026 request, ranked by the size of the change in dollars with
```

- [ ] **Step 4: Rebuild and confirm the leg passes**

```bash
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
node scripts/gates/render-static.mjs 2>&1 | tail -5
```

Expected: PASS. Record the green run verbatim beneath the FAIL.

- [ ] **Step 5: Commit**

```bash
git add site/src/app/page.tsx site/scripts/gates/render-static.mjs \
  docs/superpowers/reviews/5c-gates-pre-failure.txt docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(home): FY2026 is a request, and now a gate says so (#47)" \
  -m "The word 'enacted' sat on the most-read module beside the largest number on the site, contradicting /methodology/, /years/ and every program page. Request-vs-enacted is the distinction this site's expert readers are hired to keep straight. Leg (t) fails on any prose coupling FY2026 with 'enacted' — it failed on shipped state before the fix." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task A′2: #48 — the basis chip says P-1 on R-1 lines

`P-1 TOA · PB2026` is stamped on roughly 80,000 figures. P-1 is the procurement
exhibit; R-1 is RDT&E. `programs.json` already carries `exhibit_family`
(**rdte 1077 / procurement 664**), so the correct label ships today and is discarded at
render time by a hardcoded constant.

**Files:**
- Modify: `site/src/lib/basis.ts:11-14`
- Modify: `site/src/lib/programs-row.ts`
- Modify: `site/scripts/gates/basis.mjs`
- Test: `site/src/lib/__tests__/basis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `site/src/lib/__tests__/basis.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { basisChipForExhibit } from "../basis";

describe("basisChipForExhibit", () => {
  it("labels an RDT&E line R-1", () => {
    expect(basisChipForExhibit("toa", "rdte")).toBe("R-1 TOA");
  });

  it("labels a procurement line P-1", () => {
    expect(basisChipForExhibit("toa", "procurement")).toBe("P-1 TOA");
  });

  it("labels a mixed aggregate with both exhibits", () => {
    expect(basisChipForExhibit("toa", "mixed")).toBe("P-1/R-1 TOA");
  });

  it("falls back to the mixed label when the exhibit is unknown", () => {
    // An unlabelled aggregate must not claim a single exhibit it cannot prove.
    expect(basisChipForExhibit("toa", null)).toBe("P-1/R-1 TOA");
  });

  it("leaves non-TOA bases alone", () => {
    expect(basisChipForExhibit("jbook-detail", "rdte")).toBe("P-40 detail");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd site && npx vitest run src/lib/__tests__/basis.test.ts
```

Expected: `SyntaxError` / `does not provide an export named 'basisChipForExhibit'`.

- [ ] **Step 3: Implement in `site/src/lib/basis.ts`**

Keep `BASIS_LABEL` as the non-exhibit fallback table and add beneath it:

```ts
/** Exhibit-qualified TOA labels. P-1 is procurement, R-1 is RDT&E — a figure
 *  may not claim an exhibit its own row does not report. `mixed` and unknown
 *  both render the honest both-exhibits form. */
export type ExhibitFamily = "rdte" | "procurement" | "mixed" | null | undefined;

const TOA_LABEL_BY_EXHIBIT: Record<string, string> = {
  rdte: "R-1 TOA",
  procurement: "P-1 TOA",
  mixed: "P-1/R-1 TOA",
};

export function basisChipForExhibit(
  basis: string,
  exhibit: ExhibitFamily,
): string | null {
  if (basis !== "toa") return BASIS_LABEL[basis] ?? null;
  return TOA_LABEL_BY_EXHIBIT[exhibit ?? "mixed"] ?? "P-1/R-1 TOA";
}
```

Change `BASIS_LABEL.toa` from `"P-1 TOA"` to `"P-1/R-1 TOA"` so any call site not yet
passing an exhibit degrades to the honest form rather than the wrong one.

- [ ] **Step 4: Run the test**

```bash
cd site && npx vitest run src/lib/__tests__/basis.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Thread `exhibitFamily` to every TOA chip call site**

`programs.json` rows already carry `exhibit_family`. Add `exhibitFamily` to the row
type in `site/src/lib/programs-row.ts`, populate it where the row is built, and pass it
into `basisChipForExhibit` wherever `basisChipText` / `BASIS_LABEL.toa` is reached
today. Find them with:

```bash
cd site && grep -rn "basisChipText\|BASIS_LABEL" src/ | grep -v __tests__
```

For aggregate surfaces spanning both exhibits (`/agency/*`, `/years/`, `/feed/`), pass
`"mixed"` explicitly — do not leave it undefined, so the value is a decision rather
than a default.

- [ ] **Step 6: Add gate 23 leg (d), built failing first**

In `site/scripts/gates/basis.mjs`, add:

```js
/**
 * LEG (d) — exhibit agreement (#48).
 *
 * A TOA chip naming a single exhibit must match the exhibit its own row
 * reports. Program pages know their exhibit_family from programs.json; a
 * page whose family is 'rdte' may not render "P-1 TOA", and vice versa.
 * Non-vacuity: fails if it resolves zero chips across the sampled pages.
 */
```

Read `exhibit_family` per `pe_bli` from `data/site/json/programs.json`, walk
`out/program/*/index.html`, and for each rendered basis chip assert:
`rdte` → text starts `R-1`; `procurement` → text starts `P-1 ` (not `P-1/`);
either may render `P-1/R-1` only inside a `[data-reconciliation]` or declared-aggregate
ancestor. Fail if fewer than 100 chips resolve.

Run it against a build made from **HEAD before Step 3**:

```bash
cd site && git stash && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build \
  && node scripts/gates/basis.mjs 2>&1 | grep -iE "exhibit|R-1" | head
git stash pop
```

Expected: **FAIL** on ~1,077 rdte pages rendering `P-1 TOA`. Record verbatim.

- [ ] **Step 7: Rebuild, verify, commit**

```bash
uv run python -m govbudget export-site
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
npx vitest run && npx tsc --noEmit && npx eslint .
```

```bash
git add site/src/lib/basis.ts site/src/lib/programs-row.ts \
  site/src/lib/__tests__/basis.test.ts site/scripts/gates/basis.mjs \
  docs/superpowers/reviews/5c-gates-pre-failure.txt docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(basis): an R-1 line may not claim the P-1 exhibit (#48)" \
  -m "1,077 of 1,741 corpus programs are RDT&E, and every one of them stamped 'P-1 TOA' on its figures — while the citation record said Exhibit R-1 and the /programs/ footer said P-1/R-1 two inches below. exhibit_family already shipped in programs.json; the chip discarded it for a constant. Unknown and mixed now render the both-exhibits form, so a chip never claims an exhibit it cannot prove." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task A′3: #49 — a row counter over a 59%-complete dollar universe

`/programs/` says "1,741 of 1,741 programs" while its columns sum to **$228.46B**
against the site's own **$385.3B** FY2026 universe. A reader filtering for "columbia"
gets "No programs match the filter" for a **$10.92B** P-1 line. A reader filtering for
"carrier" gets $112.6M — the RDT&E element, not the ship. **A search that returns a
wrong-magnitude cited number is more dangerous than one that returns nothing.**

The stated exclusion is also false: *"appropriations not covered by the R-1/P-1
rollups"* — COLUMBIA **is** a P-1 line and its own page prints "Exhibit P-1 ·
Shipbuilding and Conversion, Navy". The real criterion is "lacks R-2/P-40 detail".

**Files:**
- Modify: `src/govbudget/export_site.py` (emit coverage figures + the excluded list)
- Modify: `site/src/app/programs/page.tsx`
- Modify: `site/src/components/programs-table.tsx:480`
- Modify: `site/scripts/gates/render-static.mjs`
- Test: `tests/test_programs_coverage.py`

- [ ] **Step 1: Reproduce the gap and the true criterion**

> **Units correction (2026-08-08, found during execution):** `trajectory.fy2026_total`
> is **USD THOUSANDS**, not millions — verified on ATA000, which reads `4086744`
> against a warehouse figure of $4.087B. The $228.46B / 59.3% conclusions are right;
> the unit label in the first draft of this script was not, and a literal reading of
> it would have been off by 1000×. The script below is the corrected version.

```bash
uv run python - <<'PY'
import duckdb, json
con = duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
rows = json.load(open('data/site/json/programs.json'))
t26 = sum((r['trajectory'] or {}).get('fy2026_total') or 0 for r in rows)   # USD THOUSANDS
u = con.execute("select sum(amount_thousands) from fct_budget_lines"
                " where amount_type='fy_2026_total'").fetchone()[0]         # USD THOUSANDS
print(f"index ${t26/1e6:.2f}B of universe ${u/1e6:.2f}B = {100*t26/u:.1f}%")
have = {r['pe_bli'] for r in rows}
for pe, title, k in con.execute(
    "select pe_bli, any_value(title), sum(amount_thousands) k from fct_budget_lines"
    " where amount_type='fy_2026_total' group by 1 order by 3 desc limit 40").fetchall():
    if pe not in have:
        print(f"  EXCLUDED {pe:12s} {str(title)[:42]:42s} ${k/1e6:>6.2f}B")
PY
```

Expected: `index $228.46B of universe $385.27B = 59.3%`, and an excluded list headed by
9999999999 Classified $73.90B, 2013 Virginia Class $11.08B, 1045 COLUMBIA $10.92B.

- [ ] **Step 2: Write the failing test**

Create `tests/test_programs_coverage.py`:

```python
from govbudget.export_site import build_programs_coverage


def test_coverage_reports_dollars_not_rows():
    cov = build_programs_coverage(
        index_total_millions=228_460.8,
        universe_total_millions=385_270.0,
        excluded=[("1045", "COLUMBIA Class Submarine", 10_920.5)],
    )
    assert cov["index_billions"] == 228.5
    assert cov["universe_billions"] == 385.3
    assert cov["coverage_pct"] == 59.3


def test_coverage_names_the_largest_excluded_lines():
    cov = build_programs_coverage(
        index_total_millions=100.0,
        universe_total_millions=200.0,
        excluded=[("A", "Big", 60.0), ("B", "Small", 5.0)],
    )
    assert [e["pe_bli"] for e in cov["largest_excluded"]] == ["A", "B"]
    assert cov["largest_excluded"][0]["title"] == "Big"


def test_coverage_refuses_to_claim_full_coverage_when_dollars_are_missing():
    """The counter may not read 100% while a dollar of the universe is absent."""
    cov = build_programs_coverage(
        index_total_millions=199.0, universe_total_millions=200.0, excluded=[]
    )
    assert cov["coverage_pct"] < 100.0
```

- [ ] **Step 3: Run it and watch it fail**

```bash
uv run pytest tests/test_programs_coverage.py -v
```

Expected: `ImportError: cannot import name 'build_programs_coverage'`.

- [ ] **Step 4: Implement in `src/govbudget/export_site.py`**

```python
def build_programs_coverage(
    *,
    index_total_millions: float,
    universe_total_millions: float,
    excluded: list[tuple[str, str, float]],
) -> dict:
    """Dollar-denominated coverage for the /programs/ index.

    The row counter ("1,741 of 1,741") is true and useless: it denominates the
    index by itself. This denominates it by the FY2026 request universe the
    site publishes elsewhere, and names what is missing.
    """
    return {
        "index_billions": round(index_total_millions / 1000, 1),
        "universe_billions": round(universe_total_millions / 1000, 1),
        "coverage_pct": round(100 * index_total_millions / universe_total_millions, 1),
        "largest_excluded": [
            {"pe_bli": pe, "title": title, "billions": round(m / 1000, 2)}
            for pe, title, m in sorted(excluded, key=lambda x: -x[2])[:5]
        ],
    }
```

Call it where `programs.json` is written and emit the result into `site_meta.json`
under `programs_coverage`. **Do not hardcode any figure into the page.**

- [ ] **Step 5: Run the tests**

```bash
uv run pytest tests/test_programs_coverage.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Render the denominator and the true criterion**

In `site/src/app/programs/page.tsx`, read `programs_coverage` from the same `data.ts`
path other build-derived content uses and render, in the `ScopeNote` register:

> **$228.5B of the $385.3B FY2026 request (59.3%).** This index covers program
> elements that publish R-2/P-40 project detail. Lines without that detail are absent
> even when they are large and even when they are P-1 — the biggest are Classified
> Programs ($73.90B), Virginia Class Submarine ($11.08B) and COLUMBIA Class Submarine
> ($10.92B).

Replace the false criterion at `programs-table.tsx:480` and the homepage scope
qualifier's *"appropriations not covered by the R-1/P-1 rollups"* with the R-2/P-40
wording. Grep for the old string to catch every copy:

```bash
grep -rn "not covered by the R-1/P-1" site/src/
```

- [ ] **Step 7: Gate leg (u), built failing first**

In `render-static.mjs`, add leg **(u) index denominators are dollars**: any page
rendering an "N of M" corpus counter where N === M must also render a dollar-denominated
coverage figure whose percentage is < 100. Non-vacuity: fails if it resolves no counter
on `/programs/`.

Prove it fails by reverting the page copy in the built HTML only:

```bash
node -e "
const f='site/out/programs/index.html', fs=require('fs');
const h=fs.readFileSync(f,'utf8'); fs.writeFileSync(f+'.bak', h);
fs.writeFileSync(f, h.replace(/\\\$228\\.5B of the \\\$385\\.3B[^<]*/, '1,741 of 1,741 programs'));
"
cd site && node scripts/gates/render-static.mjs 2>&1 | grep -iE "denominator|coverage" | head
mv site/out/programs/index.html.bak site/out/programs/index.html
```

Expected: **FAIL**, then PASS after restore. Record both verbatim.

- [ ] **Step 8: Verify and commit**

```bash
uv run python -m govbudget export-site && uv run pytest
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
```

```bash
git add src/govbudget/export_site.py tests/test_programs_coverage.py \
  site/src/app/programs/page.tsx site/src/components/programs-table.tsx \
  site/src/app/page.tsx site/scripts/gates/render-static.mjs \
  docs/superpowers/reviews/5c-gates-pre-failure.txt docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(programs): denominate the index in dollars, and state the true exclusion (#49)" \
  -m "'1,741 of 1,741 programs' denominated the index by itself while its columns covered 59.3% of the site's own FY2026 universe. The stated exclusion was also wrong: COLUMBIA is a P-1 line whose own page says so — the real criterion is 'lacks R-2/P-40 detail'. The three largest excluded lines are now named, because a filter that silently returns nothing for a \$10.9B program is worse than one that explains itself." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task A′4: #50 — reconciliation money folded into every "Request" figure

The site is fanatical about P-1 vs J-book basis and completely silent on discretionary
vs mandatory. Measured from the shipped warehouse:

```
fy_2026_total                    n=1714    $385.27B   ← the sitewide headline basis
fy_2026_disc_request             n=1664    $296.26B
fy_2026_reconciliation_request   n= 207    $ 89.01B   ← 23.1% of the headline
fy_2025_enacted                  n=1891    $321.88B

headline basis        $321.88B → $385.27B   =  +19.7%
discretionary basis   $321.88B → $296.26B   =   −8.0%
```

Opposite conclusions about outyear sustainability; the site publishes only the first.
At program level:

```
1203154SF Long Range Kill Chains   FY25 enacted 244,121k
                                   FY26 disc 1,916k + recon 7,695,000k = 7,696,916k
                                   published +3052.9% · discretionary −99.2%
B02100    B-21                     FY25 enacted 2,600,468k
                                   FY26 disc 3,452,116k + recon 2,099,126k
                                   published +113.5% · discretionary +32.7%
```

Long Range Kill Chains is the #1 row on `/programs/` and the #1 item on the homepage.
**The data already ships** — `EXTENDED_MEASURE_LABEL` in `basis.ts` already defines
`disc-request` and `reconciliation-request`. This is a presentation-layer fix.

**Files:**
- Modify: `src/govbudget/export_site.py` (emit the split per program)
- Modify: `site/src/components/program-figures.tsx`
- Modify: `site/src/components/programs-table.tsx` (CSV columns)
- Modify: `site/scripts/gates/basis.mjs`
- Test: `tests/test_fy26_split.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_fy26_split.py`:

```python
from govbudget.export_site import build_fy26_split


def test_split_reports_both_components_and_the_discretionary_change():
    s = build_fy26_split(
        fy25_enacted_k=244_121.0, disc_k=1_916.0, recon_k=7_695_000.0
    )
    assert s["total_k"] == 7_696_916.0
    assert s["recon_share"] == 1.0 or s["recon_share"] > 0.999
    assert s["disc_pct_change"] == -99.2
    assert s["has_reconciliation"] is True


def test_a_pure_discretionary_line_carries_no_split():
    s = build_fy26_split(fy25_enacted_k=100.0, disc_k=150.0, recon_k=0.0)
    assert s["has_reconciliation"] is False
    assert s["disc_pct_change"] == 50.0


def test_absent_prior_year_yields_no_change_rather_than_a_fabricated_one():
    """A program with no FY2025 enacted figure has no percentage change — the
    site must render an absence, never a change computed against zero."""
    s = build_fy26_split(fy25_enacted_k=None, disc_k=150.0, recon_k=0.0)
    assert s["disc_pct_change"] is None
```

- [ ] **Step 2: Run it and watch it fail**

```bash
uv run pytest tests/test_fy26_split.py -v
```

Expected: `ImportError: cannot import name 'build_fy26_split'`.

- [ ] **Step 3: Implement in `src/govbudget/export_site.py`**

```python
def build_fy26_split(
    *,
    fy25_enacted_k: float | None,
    disc_k: float | None,
    recon_k: float | None,
) -> dict:
    """FY2026 discretionary/reconciliation split for one program.

    fy_2026_total is disc + reconciliation. Reconciliation is one-time mandatory
    money; a year-over-year rate computed on the combined basis is not a rate of
    anything a reader can extrapolate. Both are published; the change is computed
    on the discretionary basis, which is the like-for-like comparison to an
    enacted discretionary prior year.
    """
    disc = float(disc_k or 0.0)
    recon = float(recon_k or 0.0)
    total = disc + recon
    pct = None
    if fy25_enacted_k:
        pct = round(100 * (disc - float(fy25_enacted_k)) / float(fy25_enacted_k), 1)
    return {
        "disc_k": disc,
        "recon_k": recon,
        "total_k": total,
        "recon_share": (recon / total) if total else 0.0,
        "disc_pct_change": pct,
        "has_reconciliation": recon > 0,
    }
```

Emit the result into each program's `program_details` sidecar under `fy26_split`, and
add `fy2026_disc_toa_usd_thousands` + `fy2026_reconciliation_toa_usd_thousands` to the
`/programs/` CSV header in `programs-table.tsx:85`.

- [ ] **Step 4: Run the tests**

```bash
uv run pytest tests/test_fy26_split.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Render the split chip beside every FY2026 figure that has one**

In `program-figures.tsx`, when `fy26_split.has_reconciliation`, render beside the FY2026
figure — using the existing chip vocabulary, `data-note-kind="scope"`:

> `$7.70B` `84% reconciliation` — *$1.9M discretionary + $7,695.0M one-time
> reconciliation. Discretionary change vs FY2025 enacted: −99.2%.*

Keep the combined figure as the headline (it is the true total) and put the
discretionary rate beside it. **Do not delete the +3052.9% — label it.** Both numbers
are true; only the unlabelled one is a false claim.

- [ ] **Step 6: Gate 23 leg (e), built failing first**

Add to `basis.mjs`: any rendered FY2026 figure whose sidecar `fy26_split.recon_share`
exceeds 0 must render a reconciliation chip within its own cell or card, and any
rendered FY25→FY26 percentage change on such a program must be accompanied by the
discretionary rate. Non-vacuity: fails if it resolves fewer than 100 FY2026 figures.

Prove it fails against a build from HEAD before Step 5 (207 lines carry reconciliation;
expect ≥200 findings). Record verbatim.

- [ ] **Step 7: Verify and commit**

```bash
uv run python -m govbudget export-site && uv run pytest
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
```

```bash
git add src/govbudget/export_site.py tests/test_fy26_split.py \
  site/src/components/program-figures.tsx site/src/components/programs-table.tsx \
  site/scripts/gates/basis.mjs docs/superpowers/reviews/5c-gates-pre-failure.txt \
  docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(basis): separate one-time reconciliation money from the request (#50)" \
  -m "\$89.01B of the \$385.27B FY2026 headline is one-time mandatory reconciliation, and the site said nothing. On the headline basis FY25→FY26 reads +19.7%; on discretionary it reads -8.0%. Long Range Kill Chains — the #1 row on /programs/ and the #1 homepage item — headlined +3052.9% on \$1,916k of discretionary money, a -99.2% like-for-like. The combined total stays as the headline because it is true; what it gains is a label and the discretionary rate beside it." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task A′5: #51 — district totals add one award to itself

Published **$8.0111B** against **$5.5787B** award-distinct — **43.6% inflation**,
$2.432B. AK-00 publishes $1.05B from a single $209.3M award attributed in full to each
of five DARPA program elements, then summed. The identical `1 recipient · 102
transactions` on all five rows is the tell.

`fct_district_programs` joins on `award_id_piid` and never on `pe_bli`
([the mart, lines 18-23](../../dbt/models/marts/fct_district_programs.sql)); the
exporter then sums those rows at `export_site.py:6734`.

**The per-PE rows are not wrong** — they are a legitimate attribution view. Only the sum
is wrong. Following the #37 precedent, the fix is a purpose-built model at the grain the
headline needs, not a re-grain of the existing one.

**Files:**
- Create: `dbt/models/marts/fct_district_totals.sql`
- Create: `dbt/tests/assert_district_totals_no_double_count.sql`
- Modify: `dbt/models/marts/schema.yml`
- Modify: `src/govbudget/export_site.py:6734` (+ the citation mirror at ~3331)
- Modify: `site/src/components/district-table.tsx:67,261`
- Modify: `site/scripts/gates/district.mjs`

- [ ] **Step 1: Reproduce, and record the before-table**

```bash
uv run python - <<'PY'
import duckdb
con = duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
print(con.execute("""
with linked as (
  select t.pop_district, t.award_id_piid, sum(t.obligation) obl
  from fct_award_transactions t
  join (select distinct award_piid from fct_budget_to_awards where confidence='high') b
    on t.award_id_piid = b.award_piid
  where t.pop_district is not null group by 1,2),
d as (select pop_district, sum(obl) true_obl from linked group by 1),
p as (select pop_district, sum(total_obligation) pub_obl from fct_district_programs group by 1)
select p.pop_district, round(p.pub_obl/1e6,1), round(d.true_obl/1e6,1),
       round(p.pub_obl/nullif(d.true_obl,0),2)
from p join d using(pop_district) order by p.pub_obl desc limit 10""").fetchall())
PY
```

Expected: AK-00 at `5.0`, CO-05 `1.2`, VA-08 `1.52`. Record as the before-table.

- [ ] **Step 2: Write the dbt assertion FIRST**

Create `dbt/tests/assert_district_totals_no_double_count.sql`:

```sql
-- No district total may exceed the sum of its DISTINCT awards.
-- fct_district_programs is per (district, pe_bli); one award matched to N
-- program elements produces N rows carrying the same dollars, so any sum over
-- that model double-counts. This asserts the headline model does not.
with truth as (
    select t.pop_district, t.award_id_piid, sum(t.obligation) as obl
    from {{ ref('fct_award_transactions') }} t
    join (
        select distinct award_piid
        from {{ ref('fct_budget_to_awards') }}
        where confidence = 'high'
    ) b on t.award_id_piid = b.award_piid
    where t.pop_district is not null
    group by 1, 2
),
distinct_by_district as (
    select pop_district, sum(obl) as distinct_obl from truth group by 1
)
select
    h.pop_district,
    h.total_obligation as published,
    d.distinct_obl     as distinct_awards,
    h.total_obligation - d.distinct_obl as overstatement
from {{ ref('fct_district_totals') }} h
join distinct_by_district d using (pop_district)
where h.total_obligation > d.distinct_obl + 0.01
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd dbt && uv run dbt test --select assert_district_totals_no_double_count
```

Expected: **FAIL** — `fct_district_totals` does not exist yet, then (after Step 4's
model but before wiring) the model must pass. Record the compile error verbatim as the
first arm; the meaningful arm is Step 5.

- [ ] **Step 4: Create the model**

`dbt/models/marts/fct_district_totals.sql`:

```sql
-- fct_district_totals: the district HEADLINE grain — one row per district,
-- dollars counted once per award.
--
-- fct_district_programs stays as-is: it is the correct per-(district, program)
-- ATTRIBUTION view, and its rows are individually true. What it is not is
-- summable — an award matched to five program elements appears five times with
-- the same dollars. This model is the sum-safe companion (#51, precedent #37:
-- the fix belongs in a purpose-built model, not a re-grained one).
with linked as (
    select
        t.pop_state,
        t.pop_district,
        t.award_id_piid,
        sum(t.obligation) as obligation
    from {{ ref('fct_award_transactions') }} t
    join (
        select distinct award_piid
        from {{ ref('fct_budget_to_awards') }}
        where confidence = 'high'
    ) b on t.award_id_piid = b.award_piid
    where t.pop_district is not null
    group by 1, 2, 3
)
select
    pop_state,
    pop_district,
    count(distinct award_id_piid) as award_count,
    sum(obligation)               as total_obligation
from linked
group by 1, 2
```

Register it in `dbt/models/marts/schema.yml` with a `unique` test on `pop_district`.

- [ ] **Step 5: Build and re-run the assertion**

```bash
cd dbt && uv run dbt build --select fct_district_totals+ \
  && uv run dbt test --select assert_district_totals_no_double_count
```

Expected: PASS. Now prove the assertion can fail — point it at the old model:

```bash
cd dbt && sed -i.bak "s/ref('fct_district_totals')/ref('fct_district_programs')/" \
  tests/assert_district_totals_no_double_count.sql
uv run dbt test --select assert_district_totals_no_double_count   # expect FAIL
mv tests/assert_district_totals_no_double_count.sql.bak tests/assert_district_totals_no_double_count.sql
```

Expected: **FAIL** naming the overstated districts. Record both verbatim.

- [ ] **Step 6: Source the headline from the new model**

In `export_site.py`, `_emit_district_sidecars`: keep the per-program rows exactly as
they are, but stop accumulating `total_linkable_dollars` from them. Replace the
accumulation at line ~6734 with a read from `fct_district_totals`, and mirror the same
change in `_build_geography_citation_rows` (~line 3331) so the sidecar and the
derived-citation `recorded_value` still agree by construction. Grand total likewise.

Add to each per-program row a `shared_award_count` — the number of program elements the
same award matched — so the page can say *"this award, matched to 5 programs"* instead
of implying five awards.

- [ ] **Step 7: Correct the page**

In `district-table.tsx`: change the default sort at line 67 from
`"total_linkable_dollars"` to `"pop_district"` — a sorted ranking is a claim, and a
0.22% DARPA-only slice cannot support a "which districts get the most defense money"
list. Rename the column from `Linkable $` to `DARPA-linked $ (place of performance)`.
Hoist the attribution basis and the 0.22% ratio onto the **detail** pages, which are
what search lands on.

- [ ] **Step 8: Gate 12 leg (e)**

Add to `district.mjs`: for every district sidecar, `total_linkable_dollars` must equal
the `fct_district_totals` value recomputed from the shipped Parquet, and no page may
render a per-program dollar figure without its `shared_award_count` when that count
exceeds 1. Non-vacuity: fails if it resolves fewer than 100 district sidecars.

- [ ] **Step 9: Verify and commit, with before/after in the message**

```bash
uv run python -m govbudget export-site && uv run pytest
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
```

```bash
git add dbt/models/marts/fct_district_totals.sql dbt/models/marts/schema.yml \
  dbt/tests/assert_district_totals_no_double_count.sql src/govbudget/export_site.py \
  site/src/components/district-table.tsx site/scripts/gates/district.mjs \
  docs/superpowers/reviews/5c-gates-pre-failure.txt docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(district): count each award once — \$8.01B was \$5.58B (#51)" \
  -m "One award matched to N program elements produced N rows carrying the same dollars, and the exporter summed them: 43.6% inflation, \$2.432B, with AK-00 ranked #2 nationally on a five-fold duplicate of one \$209.3M award. Every duplicate carried a valid receipt, which is why no existing gate could see it — the citation system was actively certifying the error. The per-program rows stay (they are true individually); the headline now comes from an award-distinct model, and the default sort is no longer a leaderboard a 0.22% DARPA slice cannot support." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task A′6: #52 — "named in lobbying filings" means one common word

`mentions.py` emits a match row when **one** title token ≥5 chars appears in a filing
description. A `GENERIC_WORDS` stoplist exists ([mentions.py:27-39](../../src/govbudget/influence/mentions.py)) —
60 words — and every word the review found slips through it, including `SERVICES`
(the list has singular `SERVICE`):

```
Ground Based Midcourse (MD08)              matched: "Based"
Federal Investigative Services IT          matched: "Services"
Acquisition Visibility – Software Pilot    matched: "Acquisition"
CYBERCOM Activities (0208059JCY)           matched: "Activities"    ← via BP AMERICA
Chemical & Biological Defense Program      matched: "Chemical"      ← vs energy futures text
```

**The stoplist is not the bug — the one-token threshold is.** No stoplist can make a
single common word evidence of naming. The site honestly prints the matched token per
row, which is how this was caught; the aggregates (34,538 sitewide) carry no caveat.

**Files:**
- Modify: `src/govbudget/influence/mentions.py`
- Modify: `src/govbudget/cli.py` (new offline `influence rematch` action)
- Create: `dbt/tests/assert_program_mentions_evidence.sql`
- Modify: `site/src/components/program-mentions.tsx` + `/methodology/` wording
- Test: `tests/influence/test_mentions_evidence.py`

- [ ] **Step 1: Write the failing test**

Create `tests/influence/test_mentions_evidence.py`:

```python
from govbudget.influence.mentions import build_program_terms, find_mentions

PROGRAMS = [
    ("MD08", "Ground Based Midcourse Defense"),
    ("0208059JCY", "CYBERCOM Activities"),
    ("ATA000", "F-35 Joint Strike Fighter"),
]


def _terms():
    return build_program_terms(PROGRAMS)


def test_a_single_common_word_is_not_a_naming():
    acts = [{"filing_uuid": "u1", "description": "Issues related to based energy futures."}]
    assert find_mentions(acts, _terms()) == []


def test_the_pe_code_alone_is_sufficient_evidence():
    acts = [{"filing_uuid": "u2", "description": "Appropriations for PE 0208059JCY."}]
    got = find_mentions(acts, _terms())
    assert [m["pe_bli"] for m in got] == ["0208059JCY"]
    assert got[0]["evidence_kind"] == "pe_literal"


def test_two_distinctive_tokens_are_sufficient_evidence():
    acts = [{"filing_uuid": "u3",
             "description": "Funding for Ground Based Midcourse interceptors."}]
    got = find_mentions(acts, _terms())
    assert [m["pe_bli"] for m in got] == ["MD08"]
    assert got[0]["evidence_kind"] == "multi_token"
    assert got[0]["matched_term"] == "Ground|Midcourse"


def test_one_distinctive_token_still_does_not_qualify():
    """'Midcourse' is distinctive but alone — the rule is evidence, not rarity."""
    acts = [{"filing_uuid": "u4", "description": "Midcourse policy discussion."}]
    assert find_mentions(acts, _terms()) == []
```

- [ ] **Step 2: Run it and watch it fail**

```bash
uv run pytest tests/influence/test_mentions_evidence.py -v
```

Expected: 4 failures — today every one of these descriptions produces a match, and
`evidence_kind` does not exist.

- [ ] **Step 3: Implement the evidence rule**

In `mentions.py`, replace the emit condition in `find_mentions` (currently
`if pattern.search(desc)` → emit) with: collect **all** matching terms for a
(filing, pe_bli) pair first, then emit **once**, only if either

- an exact `pe_bli` literal matched → `evidence_kind="pe_literal"`, or
- **≥2 distinct** title tokens matched → `evidence_kind="multi_token"`,
  `matched_term` = the matched tokens joined by `|`, or
- a curated multi-word alias matched → `evidence_kind="alias"`.

Keep `GENERIC_WORDS` and add the words this review surfaced:
`ACQUISITION, ACTIVITIES, BASED, CHEMICAL, EQUIPMENT, SERVICES, ARMED, STRIKE, FOREIGN`.
The stoplist is now a precision aid, not the sole defence.

- [ ] **Step 4: Run the tests**

```bash
uv run pytest tests/influence/test_mentions_evidence.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Add an offline re-match subcommand**

There is no way to re-run the matcher without a network re-pull today: the `influence`
subparser accepts only `pull` (network) and `restamp` (offline). Re-pulling would change
filing amounts and orphan the 50 dossier claims — that is drawdown Task D1's problem, and
this task must not trigger it. Add a third action modeled exactly on `restamp`.

In `src/govbudget/cli.py`, beside `inf_restamp` (~line 1971):

```python
    inf_rematch = inf_sub.add_parser(
        "rematch",
        help=(
            "Re-run program-mention matching over the existing lda_filings.parquet "
            "using the current evidence rule; no network calls, no re-pull."
        ),
    )
    inf_rematch.set_defaults(func=cmd_influence_rematch)
```

and a `cmd_influence_rematch(args)` that loads the existing activities parquet, rebuilds
`programs` from `dim_programs`, calls `build_program_terms` + `find_mentions`, and
rewrites `lda_program_mentions.parquet` in place. It must **not** call the LDA API.

- [ ] **Step 6: Re-match and measure the drop**

```bash
uv run python -m govbudget influence rematch   # no API cost, no re-pull
cd dbt && uv run dbt build --select fct_program_lobbying+ && cd ..
uv run python -c "
import duckdb; con=duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
print('rows:', con.execute('select count(*) from fct_program_lobbying').fetchone())
print('by kind:', con.execute('select evidence_kind, count(*) from fct_program_lobbying group by 1').fetchall())
"
```

Record the before (34,538) and after counts. **The drop is the deliverable, not a
regression.** If the after count is near zero, stop and report — the rule may be too
strict for the alias path.

- [ ] **Step 7: Add the dbt assertion**

`dbt/tests/assert_program_mentions_evidence.sql`: every `fct_program_lobbying` row must
carry a non-null `evidence_kind` in `('pe_literal','multi_token','alias')`, and no row
may carry a `matched_term` that is a single token present in `GENERIC_WORDS`. Prove it
fails by inserting one single-token row into a scratch copy. Record verbatim.

- [ ] **Step 8: Re-word the claim**

Section headings, `/methodology/`, and the aggregate captions currently say **named**.
Change to **"keyword co-occurrence with lobbying filings"**, and put the evidence kind
on every rendered row. On aggregate counts, render the caveat inline — the count is the
figure people quote.

- [ ] **Step 9: Verify and commit**

```bash
uv run pytest && uv run python -m govbudget export-site
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
```

```bash
git add src/govbudget/influence/mentions.py src/govbudget/cli.py \
  tests/influence/test_mentions_evidence.py \
  dbt/tests/assert_program_mentions_evidence.sql site/src/components/program-mentions.tsx \
  site/src/app/methodology/page.tsx docs/superpowers/reviews/5c-gates-pre-failure.txt \
  docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(influence): a common word is not a naming (#52)" \
  -m "The heading, the methodology and the aggregates all said program elements were NAMED in filings; the match was one title token >=5 chars. A 60-word stoplist existed and missed BASED, SERVICES (it listed the singular), ACQUISITION, ACTIVITIES and CHEMICAL — which is the point: no stoplist can make one common word evidence. The threshold is now a PE literal, two distinctive tokens, or a curated alias, every row carries its evidence_kind, and the claim is re-worded to keyword co-occurrence." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task A′7: #53 — a stated lineage edge built from a retraction

`/program/1203154SF/` asserts, at the site's strongest evidence tier,
`REALIGNED TO → 1203609SF`. The payload shows what it was extracted from:

```json
{"confidence": "stated", "pe": "1203609SF", "relation": "realigned", "resolved": true,
 "evidence": {"fact_id": "10a4acbaa3270c74", "page": 647,
   "sentence": "In FY 2026, Project Auxiliary Payloads was erroneously
                transferred to Program Element 1203609SF."}}
```

The next sentence in the same paragraph — rendered lower on the same page — reads
*"This funding will be realigned back to PE 1203154SF for proper execution following
enactment."* Both edges on this program also share one page-level fact id, itself
flagged *"Ambiguous: first matching page"*, so per-edge provenance is displayed but not
held. A member's floor statement built on this would be refuted using the next sentence
of the Air Force's own book.

**The real API** (read it before writing tests): the extractor is
`extract_stated_edges(narratives: list[dict]) -> list[LineageEdge]`, where each
narrative dict carries `pe_bli, fiscal_year, fact_id, page, body`, and `LineageEdge` is
a frozen dataclass with `from_pe_bli, to_pe_bli, fiscal_year, relation, confidence,
evidence_fact_id, evidence_sentence, evidence_page, portion_amount, inference_basis`.
Two mechanics matter here: `extract_stated_edges` iterates `_SENT.findall(body)` **one
sentence at a time**, which is why the next-sentence retraction is invisible; and it sets
`evidence_fact_id=n.get("fact_id")`, the narrative's single id, which is why both edges
on 1203154SF share `10a4acbaa3270c74`. Self-edges are *already* dropped by `mint`, so do
not write a test for that — it would pass without any change.

**Files:**
- Modify: `src/govbudget/lineage/extract.py`
- Modify: `src/govbudget/verify_lineage.py`
- Test: `tests/lineage/test_extract_negation.py`

- [ ] **Step 1: Write the failing test**

Create `tests/lineage/test_extract_negation.py`:

```python
from govbudget.lineage.extract import extract_stated_edges

RETRACTED_BODY = (
    "In FY 2026, Project Auxiliary Payloads was erroneously transferred to "
    "Program Element 1203609SF. This funding will be realigned back to "
    "PE 1203154SF for proper execution following enactment."
)
CLEAN_BODY = (
    "In FY 2026, Project Moving Target Indicator is transferred to Program "
    "Element 1203155SF to better align efforts with the USSF mission areas."
)


def _narrative(body: str, fact_id: str = "10a4acbaa3270c74") -> dict:
    return {"pe_bli": "1203154SF", "fiscal_year": 2026,
            "fact_id": fact_id, "page": 647, "body": body}


def test_an_erroneous_transfer_yields_no_stated_edge():
    got = extract_stated_edges([_narrative(RETRACTED_BODY)])
    assert [e.to_pe_bli for e in got] == []


def test_a_clean_transfer_still_yields_a_stated_edge():
    got = extract_stated_edges([_narrative(CLEAN_BODY)])
    assert [(e.from_pe_bli, e.to_pe_bli) for e in got] == [("1203154SF", "1203155SF")]
    assert got[0].confidence == "stated"


def test_the_negation_cue_may_sit_in_the_following_sentence():
    """The retraction on 1203154SF is the NEXT sentence, so a per-sentence
    window cannot see it. The window is the sentence pair."""
    body = ("Project X is transferred to Program Element 1203609SF. "
            "This funding will be realigned back to PE 1203154SF.")
    assert extract_stated_edges([_narrative(body)]) == []


def test_each_edge_mints_its_own_fact_id():
    body = ("Project A is transferred to Program Element 1203155SF. "
            "Project B is transferred to Program Element 1203160SF.")
    got = extract_stated_edges([_narrative(body)])
    assert len(got) >= 2
    assert len({e.evidence_fact_id for e in got}) == len(got)
    # and none of them is the narrative's page-level id
    assert "10a4acbaa3270c74" not in {e.evidence_fact_id for e in got}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
uv run pytest tests/lineage/test_extract_negation.py -v
```

Expected: failures on the negation cases and on the shared fact id.

- [ ] **Step 3: Implement negation-awareness and per-edge fact ids**

In `extract.py`, add above `extract_stated_edges`:

```python
# Cues that a transfer sentence describes an error, a reversal, or a
# non-event. "Stated" is the site's strongest evidence tier; a sentence that
# retracts itself cannot carry it. Checked against the sentence AND its
# immediate successor — on 1203154SF the retraction IS the next sentence,
# which is precisely why a per-sentence window certified it (#53).
NEGATION_CUES = (
    "erroneously", "in error", "incorrectly", "realigned back",
    "transferred back", "will be returned", "no longer", "rescinded",
)


def _window_is_negated(sent: str, next_sent: str | None) -> bool:
    hay = (sent + " " + (next_sent or "")).lower()
    return any(cue in hay for cue in NEGATION_CUES)
```

Then in `extract_stated_edges`, replace `for sent in _SENT.findall(body):` with an
indexed walk that carries the successor, and skip negated windows:

```python
        sents = _SENT.findall(body)
        for i, sent in enumerate(sents):
            if _window_is_negated(sent, sents[i + 1] if i + 1 < len(sents) else None):
                continue
```

And in `mint`, replace `evidence_fact_id=n.get("fact_id")` with a per-edge id so two
edges from one narrative can never share provenance:

```python
        import hashlib
        edge_fid = hashlib.sha256(
            f"{frm}|{to}|{n['fiscal_year']}|{relation}|{sent.strip()}".encode()
        ).hexdigest()[:16]
```

Pass `evidence_fact_id=edge_fid`, and keep the narrative's id on a new
`source_fact_id` field so the page-level provenance is not lost — add that field to
`LineageEdge` in `src/govbudget/lineage/model.py` with a `None` default so existing
constructors keep working. Self-edges need no change: `mint` already returns early on
`frm == to`.

- [ ] **Step 4: Run the tests**

```bash
uv run pytest tests/lineage/test_extract_negation.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Add `verify-lineage` leg (f)**

No `confidence="stated"` edge may carry an evidence sentence (or its successor)
matching a `NEGATION_CUES` term, and no two edges on one program may share a fact id.
Non-vacuity: fails if it resolves zero stated edges.

- [ ] **Step 6: Re-extract and confirm the count moved**

```bash
uv run python -m govbudget lineage build && uv run python -m govbudget verify-lineage
```

(`build` is the only action the `lineage` subparser accepts — `cli.py:1984`.)

Expected: the stated-edge count drops from 31 by at least 1 (the 1203609SF edge), five
legs still pass, and leg (f) passes. If the drop is larger, list every removed edge in
the commit — each is a claim the site was making and no longer makes.

- [ ] **Step 7: Verify and commit**

```bash
uv run pytest && uv run python -m govbudget export-site
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
```

```bash
git add src/govbudget/lineage/extract.py src/govbudget/verify_lineage.py \
  tests/lineage/test_extract_negation.py \
  docs/superpowers/reviews/5c-gates-pre-failure.txt docs/superpowers/ROADMAP.md
git commit --author="Andes Lee <andes.lee444@gmail.com>" \
  -m "fix(lineage): a sentence that retracts itself cannot be a Stated edge (#53)" \
  -m "The strongest evidence tier asserted realigned -> 1203609SF from 'was erroneously transferred', while the next sentence of the same Air Force paragraph — rendered lower on the same page — said the funding will be realigned back. Extraction is now negation-aware over the sentence PAIR, self-edges are dropped, and each edge mints its own fact id instead of sharing one page-level id flagged 'Ambiguous: first matching page'." \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task A′8: Sprint close — full loop, then hand to the controller

- [ ] **Step 1: Full loop at final HEAD**

```bash
uv run pytest
uv run python -m govbudget verify-lineage
cd site && npx vitest run && npx tsc --noEmit && npx eslint .
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
cd .. && uv run python -m govbudget verify-phase5
```

Run `verify-phase5` **serialized** — it binds port 4173 and contends with
`verify-phase5b3` if both run at once (`EADDRINUSE` presents as a spurious assembly
FAIL).

- [ ] **Step 2: Write the corrections note**

The owner decision says these ship *labelled as corrections*. Add a dated entry to
`/methodology/`'s corrections section naming the four figures that moved, their old and
new values, and the date — district linkable dollars, the lobbying mention count, the
`/programs/` denominator, and any lineage edges withdrawn.

- [ ] **Step 3: Report to the controller — do NOT deploy**

Deploy is `./scripts/launch/deploy.sh` and is the controller's call. Report: gate count,
the four moved figures with before/after, and the eval result.

---

## Self-review

**Spec coverage.** All six P0s from the 2026-08-07 multi-persona review are assigned:
homepage "enacted" → A′1; basis chip → A′2; `/programs/` denominator → A′3;
reconciliation basis → A′4; district double-count → A′5; lobbying matches → A′6;
lineage retraction → A′7. The four drawdown-plan corrections are filed in A′0.

**Deliberately not covered — these are the review's P1s and need their own plan.** Named
so "the P0s are clear" is an honest claim: the 768–1023px header overflow (a breakpoint
collision, *not* the same defect as drawdown C1's h1 offsets); agency totals on an
Add-only basis (*not* the same defect as drawdown B1's org grain — both are real);
`/years/` nominal dollars undisclosed; the missing masthead on `/about/`; `pe_bli`
collisions fusing `3010`/`3050`/`2210`; the citation dialog leaving `<main>` exposed;
the missing `/glossary/`; `/agency/` index 404; CSV exports dropping fact ids; no dark
mode; the HHI "near-monopoly" gloss at the 2,500 threshold.

**Gate additions keep the suite at 24.** Leg (t) and (u) on gate 2, legs (d) and (e) on
gate 23, leg (e) on gate 12, leg (f) on `verify-lineage`, two new dbt assertions on one
new model. No new gate number.

**Dependencies.** A′1–A′3 are independent and cheap — ship them as one deploy. A′4 must
land before any future work reads FY2026 change rates. A′5 must land before the district
choropleth (drawdown #15) or it will render the inflated figure. A′6 interacts with
drawdown D1: the LDA re-pull changes filing amounts, so **run A′6 before D1** or the
re-pull will re-match on the old rule.

**Cost.** Zero API spend. A′6's rebuild is local re-matching, not a re-pull. Everything
else is compute.

**Known risk, stated rather than hidden.** A′6's after-count is unknown until its Step 6
runs. If the evidence rule removes nearly all mentions, the honest outcome may be to
withdraw the surface rather than publish a near-empty one — that is an owner decision,
and Step 6 says stop and report rather than tuning the rule until the number looks right.

**API mismatches found and corrected during self-review** (recorded so a reader knows
these were checked, not assumed): the lineage extractor is `extract_stated_edges(
narratives)`, not `extract_edges(pe, text)`; `lineage` accepts only the `build` action;
and there is **no** offline mentions-rebuild command today, so A′6 adds `influence
rematch` rather than assuming one exists. `tests/influence/` and `tests/lineage/` both
already exist.
