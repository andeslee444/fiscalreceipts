# Crosswalk Follow-ups (backlog #70–#77) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the eight objectives the 2026-09-01→04 crosswalk correction and expansion left open (ROADMAP backlog #70–#77) plus the raw-corpus backup, each as an independently shippable, gated change.

**Architecture:** Every task follows the repo's standing pattern: a change lands with the gate or test that would have caught its absence; published numbers derive from artifacts, never literals; corrections publish the smaller true number and say so. Tasks are independent — execute in priority order but ship each on its own (one commit each, `--author="Andes Lee <andes.lee444@gmail.com>"`, Co-Authored-By trailer).

**Tech Stack:** Python 3.12 via `uv` (psycopg3, duckdb, pytest), Postgres migrations in `migrations/`, dbt-duckdb marts, Next 16 static export + vitest (`site/`), gate suite `site/scripts/verify.mjs` (run with `NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com` for both `npm run build` and `npm run verify`), deploy ONLY via `./scripts/launch/deploy.sh`.

**Spec:** `docs/superpowers/ROADMAP.md` — backlog entries #70–#77 (2026-09-04) and the findings-log entries dated 2026-09-01/02 (the correction, the expansion, the species lessons).

## Global Constraints

- Commit as `--author="Andes Lee <andes.lee444@gmail.com>"`; end messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Never link awards to: collision keys (`select pe_bli from dim_programs group by pe_bli having count(*)>1`), synthetic `-L\d+$` keys, or catch-all titles (`CATCHALL_TITLE` in `scripts/derive_ap_links.py`) — until Task 7 makes collision keys addressable.
- No dollar aggregate may sum below the `high` tier (exporter contract, `export_site.py` ~line 3300).
- Keyed sidecar directories prune-before-emit; `prepare-assets.mjs` `copyDir` mirrors. Do not reintroduce overlay copies.
- Page-weight ceilings in `site/scripts/gates/build.mjs`: `/feed/` must not be raised (do-not-raise note); any other raise needs a dated justification and a re-measured `measured` string.
- Gate floors are measured against the FINAL published corpus (peer-review lesson 2026-09-01), never an intermediate state.
- Deploys: CLI only (`scripts/launch/deploy.sh`); the Vercel project has no git link and `GovBudget/vercel.json` disables git deployments — leave both.
- Standalone repo sync: `git subtree split --prefix=GovBudget` from the monorepo toplevel, then merge `govbudget/main` into the split branch in a temp worktree before pushing (direct commits exist there).

---

## File Structure

| Path | Responsibility |
|---|---|
| `migrations/011_link_precision_samples.sql` | Task 1: held-out adjudication sample + verdict storage |
| `scripts/precision_study.py` | Task 1: draw stratified sample, emit packets, load verdicts, compute precision |
| `src/govbudget/export_site.py` | Tasks 1, 4: publish per-tier precision to site_meta; mint `announcement` citation rows |
| `site/src/app/methodology/page.tsx` | Tasks 1, 2: render derived precision per tier |
| `site/src/components/program-awards.tsx` | Task 2: in-table tier caveat |
| `site/scripts/gates/program-skeleton.mjs` | Task 2: leg asserting the caveat wherever medium rows render |
| `site/src/app/coverage/page.tsx`, `site/src/app/program/[peBli]/page.tsx` | Task 3: stale denominator prose |
| `migrations/012_award_link_sources.sql`, `scripts/load_announcement_links.py` | Task 4: structured provenance per link |
| `site/src/components/citation-panel/panel.tsx`, `site/src/components/citation-panel/announcement-card.tsx` | Task 4: first-class announcement source kind |
| `src/govbudget/jbooks/crosswalk.py`, `data-seeds/org_subagency_aliases.csv`, `tests/jbooks/test_crosswalk.py` | Task 5: v1 mechanical debts |
| `site/src/components/feed-section-expand.tsx`, `site/src/app/feed/page.tsx` | Task 6: client-side expand past the digest cap |
| `scripts/derive_ap_links.py`, `scripts/load_announcement_links.py`, `src/govbudget/export_site.py` (slug contract ~7723) | Task 7: account-qualified link targets for collision keys |
| `scripts/probe_sam_solicitations.py`, `docs/superpowers/reviews/sam-solicitations-spike.md` | Task 8: SAM.gov spike with a published result either way |
| `scripts/launch/backup_raw_announcements.sh` | Task 9: raw-corpus backup to R2 |

---

### Task 1: Held-out precision study on the new link tiers (#72)

**Files:**
- Create: `migrations/011_link_precision_samples.sql`
- Create: `scripts/precision_study.py`
- Modify: `src/govbudget/export_site.py` (site_meta builder — grep `"source_freshness"` to find where `site_meta.json` fields are assembled)
- Modify: `site/src/app/methodology/page.tsx` (§4, after the subaward paragraph)
- Test: `tests/test_precision_study.py`

**Interfaces:**
- Produces: table `link_precision_samples(sample_id, award_piid, pe_bli, method, verdict, reason, adjudicated_at)`; function `draw_sample(dsn, per_method=60, seed=20260904) -> list[dict]`; function `precision_by_method(dsn) -> dict[str, tuple[int,int]]` returning `{method: (confirmed, sampled)}`; `site_meta.link_precision = {method: {confirmed, sampled}}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_precision_study.py
import json
import psycopg
import pytest

from precision_study import draw_sample, precision_by_method  # scripts/ is on sys.path via conftest

def test_sample_is_deterministic_and_stratified(pg_dsn):
    with psycopg.connect(pg_dsn) as pg:
        pg.execute("""insert into budget_line_awards
            (pe_bli, exhibit, fiscal_year, organization, award_piid, method, confidence)
            select '0601101E','R-1',2026,'DARPA','P'||g, 'announcement+lexicon','high'
            from generate_series(1,80) g""")
        pg.execute("""insert into budget_line_awards
            (pe_bli, exhibit, fiscal_year, organization, award_piid, method, confidence)
            select '0601101E','R-1',2026,'DARPA','Q'||g, 'subaward+lexicon','medium'
            from generate_series(1,10) g""")
        pg.commit()
    a = draw_sample(pg_dsn, per_method=20, seed=7)
    b = draw_sample(pg_dsn, per_method=20, seed=7)
    assert a == b
    by = {}
    for r in a: by.setdefault(r["method"], 0); by[r["method"]] += 1
    assert by["announcement+lexicon"] == 20
    assert by["subaward+lexicon"] == 10   # fewer rows than per_method: take all

def test_precision_counts_only_confirmed(pg_dsn):
    with psycopg.connect(pg_dsn) as pg:
        pg.execute("""insert into link_precision_samples
            (sample_id, award_piid, pe_bli, method, verdict, reason)
            values ('s1','P1','0601101E','announcement+lexicon','confirmed','ok'),
                   ('s1','P2','0601101E','announcement+lexicon','refuted','platform mention'),
                   ('s1','P3','0601101E','announcement+lexicon',null,null)""")
        pg.commit()
    assert precision_by_method(pg_dsn)["announcement+lexicon"] == (1, 2)  # unjudged rows excluded
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_precision_study.py -v`
Expected: FAIL with `ModuleNotFoundError: precision_study` (and, once importable, `relation "link_precision_samples" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- migrations/011_link_precision_samples.sql
create table if not exists link_precision_samples (
    id              bigserial primary key,
    sample_id       text not null,           -- one study run, e.g. '2026-09-10'
    award_piid      text not null,
    pe_bli          text not null,
    method          text not null,           -- budget_line_awards.method at draw time
    verdict         text check (verdict in ('confirmed','refuted')),
    reason          text,
    adjudicated_at  timestamptz,
    unique (sample_id, award_piid, pe_bli)
);
```

- [ ] **Step 4: Write the script**

```python
# scripts/precision_study.py
"""Held-out precision study for the published link tiers (ROADMAP #72).

draw   : stratified random sample per method from PUBLISHED links, written as
         evidence packets (same shape the verification workflows consume).
load   : ingest adjudicator verdicts JSON -> link_precision_samples.
report : precision per method (confirmed / judged).
"""
import json, random, sys
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[1]
DSN = "postgresql://localhost/govbudget"
METHODS = ("fpds-ap+account", "fpds-ap", "announcement+lexicon", "subaward+lexicon",
           "account+subagency")

def draw_sample(dsn: str, per_method: int = 60, seed: int = 20260904) -> list[dict]:
    rng = random.Random(seed)
    out = []
    with psycopg.connect(dsn) as pg:
        for m in METHODS:
            rows = pg.execute(
                "select award_piid, pe_bli, recipient_name, rationale from budget_line_awards"
                " where method=%s and confidence in ('high','medium')"
                " order by award_piid, pe_bli", (m,)).fetchall()
            if not rows:
                continue
            pick = rows if len(rows) <= per_method else rng.sample(rows, per_method)
            out += [{"method": m, "piid": r[0], "pe_bli": r[1],
                     "recipient": r[2], "rationale": r[3]} for r in sorted(pick)]
    return out

def load_verdicts(dsn: str, sample_id: str, verdicts_path: Path) -> int:
    v = json.load(open(verdicts_path))          # [{piid, pe_bli, method, verdict, reason}]
    with psycopg.connect(dsn) as pg:
        pg.cursor().executemany(
            """insert into link_precision_samples
               (sample_id, award_piid, pe_bli, method, verdict, reason, adjudicated_at)
               values (%s,%s,%s,%s,%s,%s, now())
               on conflict (sample_id, award_piid, pe_bli) do update set
                 verdict=excluded.verdict, reason=excluded.reason, adjudicated_at=now()""",
            [(sample_id, x["piid"], x["pe_bli"], x["method"], x["verdict"], x.get("reason")) for x in v])
        pg.commit()
    return len(v)

def precision_by_method(dsn: str) -> dict[str, tuple[int, int]]:
    with psycopg.connect(dsn) as pg:
        rows = pg.execute(
            "select method, count(*) filter (where verdict='confirmed'),"
            " count(*) filter (where verdict is not null)"
            " from link_precision_samples group by method").fetchall()
    return {m: (c, n) for m, c, n in rows}

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "draw":
        s = draw_sample(DSN)
        out = ROOT / "data/research/precision" / "sample_packets.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        json.dump(s, open(out, "w"), indent=0)
        print(f"{len(s)} packets -> {out}")
    elif cmd == "load":
        print("loaded", load_verdicts(DSN, sys.argv[2], Path(sys.argv[3])))
    elif cmd == "report":
        for m, (c, n) in precision_by_method(DSN).items():
            print(f"{m:<24} {c}/{n} = {100*c/max(n,1):.1f}%")
```

- [ ] **Step 5: Run the migration and tests**

Run: `uv run python -m govbudget migrate && uv run pytest tests/test_precision_study.py -v`
Expected: PASS (2 tests). If `pg_dsn` fixture does not exist, copy the fixture from `tests/jbooks/test_export_facts.py` (it creates a scratch database per test).

- [ ] **Step 6: Run the study**

Run: `uv run python scripts/precision_study.py draw` then adjudicate `data/research/precision/sample_packets.json` with the SAME two-lens rubric as the waves (Workflow: triage → refute; the surviving set maps to `verdict: confirmed`, everything else `refuted`), write `data/research/precision/verdicts_2026-09-XX.json`, then `uv run python scripts/precision_study.py load 2026-09-XX data/research/precision/verdicts_2026-09-XX.json` and `report`.

- [ ] **Step 7: Publish the number, derived**

In `export_site.py` where `site_meta` is assembled, add:

```python
from precision_study import precision_by_method  # scripts/ on path; or inline the query
site_meta["link_precision"] = {
    m: {"confirmed": c, "sampled": n} for m, (c, n) in precision_by_method(dsn).items()
}
```

In `methodology/page.tsx` §4 after the subaward paragraph:

```tsx
{siteMeta.link_precision && (
  <p className="mt-2" data-link-precision="">
    Measured precision of the published tiers, from a held-out hand-adjudicated
    sample re-run through the same two-reviewer process:{" "}
    {Object.entries(siteMeta.link_precision).map(([m, v]) =>
      `${m} ${v.confirmed}/${v.sampled}`).join("; ")}.
    Published whatever the numbers turn out to be; a tier that misses is
    renamed or narrowed, never widened to fit.
  </p>
)}
```

- [ ] **Step 8: Gate it**

Add to `site/scripts/gates/datatruth.mjs` leg k's corpus-shaped-claims list: the `[data-link-precision]` paragraph's `c/n` pairs must equal `site_meta.link_precision` (recompute from `data/site/site_meta.json`). Fail if the paragraph is absent while `link_precision` is non-empty.

- [ ] **Step 9: Rebuild, verify, commit**

```bash
uv run python -m govbudget export-site && cd site && rm -rf .next out && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify && cd .. && git add migrations/011_link_precision_samples.sql scripts/precision_study.py tests/test_precision_study.py src/govbudget/export_site.py site/src/app/methodology/page.tsx site/scripts/gates/datatruth.mjs data/research/precision && git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(#72): held-out precision study on the published link tiers, derived onto /methodology/"
```

---

### Task 2: In-table medium-tier caveat (#77)

**Files:**
- Modify: `site/src/components/program-awards.tsx`
- Modify: `site/scripts/gates/program-skeleton.mjs`
- Test: `site/src/__tests__/program-awards-caveat.test.tsx`

**Interfaces:**
- Produces: `<p data-awards-tier-note="medium">` rendered whenever any displayed award has `confidence === "medium"`.

- [ ] **Step 1: Write the failing test**

```tsx
// site/src/__tests__/program-awards-caveat.test.tsx
import { render } from "@testing-library/react";
import { ProgramAwards } from "@/components/program-awards";

const row = (piid: string, confidence: string) => ({ award_piid: piid, recipient_name: "X", confidence });

test("medium rows render the tier caveat", () => {
  const { container } = render(
    <ProgramAwards initialAwards={[row("A", "high"), row("B", "medium")]} totalCount={2} peBli="0601101E" />,
  );
  const note = container.querySelector("[data-awards-tier-note='medium']");
  expect(note).not.toBeNull();
  expect(note!.textContent).toMatch(/same appropriation account and agency/);
});

test("high-only tables render no caveat", () => {
  const { container } = render(
    <ProgramAwards initialAwards={[row("A", "high")]} totalCount={1} peBli="0601101E" />,
  );
  expect(container.querySelector("[data-awards-tier-note]")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/__tests__/program-awards-caveat.test.tsx`
Expected: FAIL — `expected null not to be null`.

- [ ] **Step 3: Implement**

In `program-awards.tsx`, inside the `<section>` after the `scopeNote` block:

```tsx
{displayedAwards.some((a) => a.confidence?.toLowerCase() === "medium") && (
  <p className="text-xs text-muted-foreground mb-2" data-awards-tier-note="medium">
    Rows marked <span className="font-medium">medium</span> drew from the same
    appropriation account and agency as this program; that is an association,
    not evidence that this program paid for the contract. Only{" "}
    <span className="font-medium">high</span> rows carry program-level evidence.
  </p>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run src/__tests__/program-awards-caveat.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Gate leg**

In `site/scripts/gates/program-skeleton.mjs`, in the per-page sample loop, add:

```js
// (m) 2026-09: a Related Awards table showing any medium badge must carry
// the in-table caveat — the badge and /methodology/ alone let presence in
// the table read as attribution (#77).
const hasMedium = root.querySelectorAll('[title="Match confidence: medium"]').length > 0;
if (hasMedium && !root.querySelector('[data-awards-tier-note="medium"]')) {
  errors.push(`${rel}: medium-tier award rows without [data-awards-tier-note]`);
}
```

- [ ] **Step 6: Build, verify, commit**

```bash
cd site && rm -rf .next out && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify && cd .. && git add site/src/components/program-awards.tsx site/src/__tests__/program-awards-caveat.test.tsx site/scripts/gates/program-skeleton.mjs && git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "fix(#77): Related Awards tables state what a medium row means, in the table"
```

---

### Task 3: One denominator, derived (#76)

**Files:**
- Modify: `site/src/app/coverage/page.tsx:~210` (prose citing "1,755 … 1,753")
- Modify: `site/src/app/program/[peBli]/page.tsx:~1373` (comment "covers 24 of 1,741")
- Modify: `site/src/lib/corpus.ts:~110-135` (header comment listing five literal counts)

**Interfaces:**
- Consumes: the corpus-count registry in `corpus.ts` (already derived; gate 24 leg k recomputes all five).

- [ ] **Step 1: Confirm the registry is the only source of rendered counts**

Run: `cd site && grep -rnE "\b1,7(39|41|53|55)\b" src --include="*.tsx" --include="*.ts" | grep -v "^\s*//"`
Expected: only comments/prose explaining history. Any rendered literal is a defect — replace it with the registry accessor used by `/coverage/` (grep `corpusCounts(` in `corpus.ts` for the export name).

- [ ] **Step 2: Rewrite the stale prose**

In `coverage/page.tsx` ~210: replace the sentence quoting "1,755 and … 1,753" with one that names the registry: "Each row is derived from the artifact that defines it (see the five-way table above); this page never states a count it did not recompute." In the program page comment at ~1373: change "covers 24 of 1,741" to "covers a build-derived subset of programs (see /coverage/); the 24-of-1,741 figure this comment used to quote was true on 2026-08-29 only". In `corpus.ts` header: prefix the five literal counts with "(as measured 2026-08-29; the registry below is the live value)".

- [ ] **Step 3: Verify gate 24 leg k still passes and commit**

```bash
cd site && rm -rf .next out && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify && cd .. && git add site/src/app/coverage/page.tsx "site/src/app/program/[peBli]/page.tsx" site/src/lib/corpus.ts && git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "docs(#76): the site quotes one derived denominator; stale literals demoted to dated history"
```

---

### Task 4: Announcement as a first-class citation kind (#71)

**Files:**
- Create: `migrations/012_award_link_sources.sql`
- Modify: `scripts/load_announcement_links.py` (write sources alongside links)
- Modify: `src/govbudget/export_site.py` (`_build_budget_to_awards_citation_rows` ~line 6014; add `_announcement_row` next to `_null_usaspending_row` ~line 9675)
- Create: `site/src/components/citation-panel/announcement-card.tsx`
- Modify: `site/src/components/citation-panel/panel.tsx:322-345` (kind switch)
- Test: `tests/test_export_announcement_citations.py`, `site/src/__tests__/announcement-card.test.tsx`

**Interfaces:**
- Produces: table `award_link_sources(award_piid, pe_bli, source_kind, source_id, source_url, archive_url, archived_at, sha256)`; citation rows with `kind='announcement'`, `official_url=source_url`, `query_body=json({article_id, archive_url, sha256})`, `recorded_value=None`; panel case `"announcement"` rendering `<AnnouncementCard>`.

- [ ] **Step 1: Failing exporter test**

```python
# tests/test_export_announcement_citations.py
import json
from govbudget.export_site import _announcement_row

def test_announcement_row_shape():
    row = _announcement_row("abcd1234abcd1234", article_id="1006508",
                            url="https://www.defense.gov/News/Contracts/Contract/Article/1006508/",
                            archive_url="https://web.archive.org/web/2026/…", sha256="ff"*32)
    assert len(row) == 27
    assert row[1] == "announcement"
    assert row[17] == "https://www.defense.gov/News/Contracts/Contract/Article/1006508/"
    assert json.loads(row[22])["sha256"] == "ff" * 32
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_export_announcement_citations.py -v`
Expected: FAIL — `ImportError: cannot import name '_announcement_row'`.

- [ ] **Step 3: Migration + loader**

```sql
-- migrations/012_award_link_sources.sql
create table if not exists award_link_sources (
    award_piid   text not null,
    pe_bli       text not null,
    source_kind  text not null check (source_kind in ('announcement','subaward')),
    source_id    text not null,      -- article_id or subaward_number
    source_url   text,
    archive_url  text,
    archived_at  timestamptz,
    sha256       text,
    primary key (award_piid, pe_bli, source_kind, source_id)
);
```

In `load_announcement_links.py`, after building `rows`, also build `src_rows` from the same packets (`p.get("article_id")` → kind `announcement`, URL `ANN_URL.format(id=aid)`; `p.get("subaward_number")` → kind `subaward`) and look up `archive_url/archived_at/sha256` from `data/raw/announcements/manifest.json` keyed by `article_id`; insert with `on conflict do update`.

- [ ] **Step 4: Exporter**

```python
def _announcement_row(fid: str, *, article_id: str, url: str,
                      archive_url: str | None, sha256: str | None) -> tuple:
    """27-element citation row for kind='announcement' (same layout as _null_usaspending_row)."""
    body = json.dumps({"article_id": article_id, "archive_url": archive_url, "sha256": sha256},
                      sort_keys=True)
    return (fid, "announcement", None, None,
            None, None, None, None, None, None, None,
            None, None, None, None, sha256, None,
            url, None, None, None, None,
            body, None, None, None, None)
```

In `_build_budget_to_awards_citation_rows`, for each link whose method is `announcement+lexicon`/`subaward+lexicon`, read its `award_link_sources` row and emit `_announcement_row(fid, ...)` instead of the generic derived row (keep the fid minting unchanged so program-page `data-fact-id`s still resolve).

- [ ] **Step 5: Panel**

```tsx
// site/src/components/citation-panel/announcement-card.tsx
export function AnnouncementCard({ url, body }: { url: string; body: { article_id: string; archive_url?: string; sha256?: string } }) {
  return (
    <div data-cite-kind="announcement" className="space-y-2 text-sm">
      <p className="font-medium">Official DoD contract announcement</p>
      <a href={url} className="underline" target="_blank" rel="noopener">defense.gov article {body.article_id}</a>
      {body.archive_url && (<p>Archived copy: <a href={body.archive_url} className="underline" target="_blank" rel="noopener">Wayback snapshot</a></p>)}
      {body.sha256 && (<p className="font-mono text-xs text-muted-foreground">sha256 {body.sha256.slice(0, 16)}…</p>)}
    </div>
  );
}
```

In `panel.tsx` kind switch (both switches at ~322 and ~343): add `case "announcement": return <AnnouncementCard url={cite.official_url} body={JSON.parse(cite.query_body)} />;`

- [ ] **Step 6: Tests pass, gates, commit**

Run: `uv run pytest tests/test_export_announcement_citations.py -v && cd site && npx vitest run src/__tests__/announcement-card.test.tsx` (write the vitest to assert `[data-cite-kind="announcement"]` renders the article link). Then the full build+verify; gate 2's Cite-state contract must stay green (fact-ids unchanged). Commit as `feat(#71): announcements are a first-class citation kind with archive snapshot and hash`.

---

### Task 5: Mechanical crosswalk v1 debts (#75)

**Files:**
- Modify: `src/govbudget/jbooks/crosswalk.py`
- Create: `data-seeds/org_subagency_aliases.csv`
- Test: `tests/jbooks/test_crosswalk.py` (extend; fixture `make_award_parquet` exists)

**Interfaces:**
- Produces: `crosswalk_org(..., fy_start, fy_end)` filters by FEDERAL fiscal year; `matched_obligation` is `None` unless the award's `federal_accounts_funding_this_award` is exactly the one account; medium tier uses `subagency_aliases[organization]` from the seed (no hardcoded DARPA clause).

- [ ] **Step 1: Failing tests**

```python
def test_fy_filter_uses_federal_fiscal_year(pg_dsn, tmp_path):
    # action_date 2023-11-15 is FY2024; a 2024..2024 window must include it, 2023..2023 must not
    glob = make_award_parquet_with_dates(tmp_path, [("K9","HR001124C0009","1","097-0400","X","Y","Z","U",
                                                     "Defense Advanced Research Projects Agency","2023-11-15")])
    n_2024 = crosswalk_org(pg_dsn, organization="DARPA", treasury_agency="097", award_glob=glob, fy_start=2024, fy_end=2024)
    n_2023 = crosswalk_org(pg_dsn, organization="DARPA", treasury_agency="097", award_glob=glob, fy_start=2023, fy_end=2023)
    assert n_2024 == 1 and n_2023 == 0

def test_multi_account_award_has_no_matched_obligation(pg_dsn, tmp_path):
    glob = make_award_parquet(tmp_path)   # K3 is funded from '021-1319;097-0400'
    crosswalk_org(pg_dsn, organization="DARPA", treasury_agency="097", award_glob=glob)
    with psycopg.connect(pg_dsn) as pg:
        ob = pg.execute("select matched_obligation from budget_line_awards where award_piid='HR001124C0003'").fetchone()[0]
    assert ob is None

def test_subagency_aliases_come_from_seed(pg_dsn, tmp_path):
    # MDA line, award by 'Missile Defense Agency': medium only if the seed maps MDA -> that string
    ...
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/jbooks/test_crosswalk.py -v -k "federal_fiscal_year or matched_obligation or seed"`
Expected: FAIL (calendar-year filter includes 2023-11-15 in 2023; obligation is non-null; alias lookup missing).

- [ ] **Step 3: Implement**

In `crosswalk.py`:

```python
# federal FY: Oct-Dec belong to the next FY
fy_expr = ("(try_cast(substr(action_date,1,4) as integer)"
           " + case when try_cast(substr(action_date,6,2) as integer) >= 10 then 1 else 0 end)")
fy_filter = f" and {fy_expr} between {fy_start} and {fy_end}" if fy_start is not None and fy_end is not None else ""

# obligation only when the award is single-account (the account IS the money color)
"       sum(case when federal_accounts_funding_this_award = '{fed_account}'"
"                then try_cast(federal_action_obligation as double) end),"

# aliases from seed: data-seeds/org_subagency_aliases.csv  (organization,alias)
def _load_subagency_aliases() -> dict[str, list[str]]:
    import csv; out = {}
    with open(Path(__file__).resolve().parents[3] / "data-seeds/org_subagency_aliases.csv") as f:
        for r in csv.DictReader(f): out.setdefault(r["organization"], []).append(r["alias"].lower())
    return out
```

and replace the `org_in_subagency` expression with `any(a in (sub_agency or "").lower() for a in aliases.get(organization, [organization.lower()]))`. Seed rows: `DARPA,advanced research projects`, `MDA,missile defense agency`, `DISA,defense information systems agency`, `SOCOM,special operations command`.

- [ ] **Step 4: Tests pass; re-run the DARPA crosswalk; the adjudication overlay still wins**

Run: `uv run pytest tests/jbooks/test_crosswalk.py -v` then `uv run python -m govbudget jbooks crosswalk --org DARPA` (confirm the CLI flag name in `cli.py` ~line 820). Then export-facts → dbt → export-site → build → verify. Expected: gate 24 leg b row counts move (medium rows may change) — re-measure any floor that trips against the FINAL corpus, dated. Commit as `fix(#75): federal-FY filter, single-account obligations, seed-driven sub-agency aliases`.

---

### Task 6: /feed/ client-side expand (#73)

**Files:**
- Create: `site/src/components/feed-section-expand.tsx`
- Modify: `site/src/app/feed/page.tsx` (replace the truncation `<p>` with the component)
- Test: `site/src/__tests__/feed-section-expand.test.tsx`

**Interfaces:**
- Produces: `<FeedSectionExpand eventType={etype} shown={75} total={all_section_cards.length} />` which fetches `/json/feed.json` on click, filters `cards` by `event_type`, and renders the rest with `FeedCardItem` (export it from `feed/page.tsx` or move it to `components/feed-card-item.tsx`).

- [ ] **Step 1: Failing test** — render with `shown=75,total=90`, mock `fetch` to return 90 cards, click "Show all 90", assert 15 more `[data-feed-card]` appear and the truncation note disappears.
- [ ] **Step 2: Run** `cd site && npx vitest run src/__tests__/feed-section-expand.test.tsx` → FAIL (module missing).
- [ ] **Step 3: Implement** mirroring `ProgramAwards.handleExpand` (client component, `useState`, plain `fetch`, error state), keeping `data-feed-truncation-note` on the collapsed state so gate 23 leg g4's scoping still sees it.
- [ ] **Step 4: Tests pass; build+verify** — `/feed/` static weight must stay under its LOWERED ceiling (expanded cards are client-only). Commit as `feat(#73): /feed/ sections expand in place past the digest cap`.

---

### Task 7: Account-qualified link targets for collision keys (#70) — needs an owner decision first

**Decision required before starting:** URL shape for the two programs sharing a numeric BLI. Proposed default: keep `/program/{pe_bli}/` as the disambiguation page and add `/program/{pe_bli}--{account}/` per member (e.g. `/program/3010--1810N/`). Confirm against the existing slug contract at `export_site.py:~7723` ("Task E3 (URL contract)") — if E3 already emits account-qualified slugs for the 8 collision keys, reuse them and skip the route work.

**Files:**
- Modify: `src/govbudget/export_site.py` (~5668, ~5884, ~7723 slug emission)
- Modify: `scripts/derive_ap_links.py`, `scripts/load_announcement_links.py` (allow collision keys when the account is known; key links by `(pe_bli, account)`)
- Modify: `dbt/models/marts/fct_budget_to_awards.sql` (carry `account`), `site/src/lib/data.ts` (`getProgramDetails` by slug)
- Test: `tests/test_collision_slugs.py`, `site/src/__tests__/collision-routes.test.tsx`

- [ ] **Step 1: Probe** — `uv run python -c "import duckdb; c=duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True); print(c.execute(\"select pe_bli, account_title, title from dim_programs where pe_bli in (select pe_bli from dim_programs group by 1 having count(*)>1) order by 1\").fetchall())"` and `grep -n '"slug"' data/site/json/programs.json | head` to see what slugs the 8 keys publish today. Record the result in the task commit message.
- [ ] **Step 2: Failing test** — for `('3010','1810N')` and `('3010','1611N')` `derive_ap_links` must emit distinct link rows keyed with `account`, and the exporter must write them to distinct `program_details/{slug}.json` files.
- [ ] **Step 3: Implement** — in `derive_ap_links.py`, replace `display -= collisions` with: for collision keys, keep lines whose `fed_accounts` intersect the award's accounts and key the link as `(pe_bli, account)`; in `load_announcement_links.py`, resolve collision keys only when the lexicon entry's `doc_id` identifies the account (J-book org/exhibit → account) else keep excluding. Add `account` to `budget_line_awards` rows (column exists as of migration 007 on `budget_line_details`; add to `budget_line_awards` via `migrations/013_budget_line_awards_account.sql`).
- [ ] **Step 4: Gate** — gate 21 (program-skeleton) must assert each collision page renders its account in the title block; gate 13 (linkgraph) must resolve the new routes. Commit as `feat(#70): collision keys get account-qualified pages and links`.

---

### Task 8: SAM.gov solicitations spike (#74)

**Files:**
- Create: `scripts/probe_sam_solicitations.py`
- Create: `docs/superpowers/reviews/sam-solicitations-spike.md` (result either way, in the style of `filec-program-activity-spike.md`)

- [ ] **Step 1: Write the probe**

```python
# scripts/probe_sam_solicitations.py — timeboxed evidence, no acquisition lane
import json, urllib.request, urllib.parse, time
BASE = "https://sam.gov/api/prod/sgs/v1/search/"
def q(params):
    url = BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "fiscalreceipts-spike/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
tests = [
  {"index": "opp", "q": "0604800F", "is_active": "false", "page": 0, "size": 5},
  {"index": "opp", "q": "\"0604800F\"", "is_active": "false", "page": 0, "size": 5},
  {"index": "opp", "q": "F-35 EMD", "is_active": "false", "page": 0, "size": 5},
  {"index": "opp", "q": "program element 0604800F", "is_active": "all", "page": 0, "size": 5},
]
for t in tests:
    try:
        r = q(t); n = r.get("_embedded", {}).get("results", []); tot = r.get("page", {}).get("totalElements")
        print(t["q"], "->", tot, [x.get("title", "")[:60] for x in n[:3]])
    except Exception as e:
        print(t["q"], "ERR", e)
    time.sleep(1)
```

- [ ] **Step 2: Run it** — `python3 scripts/probe_sam_solicitations.py`. Also probe FBO-era archives via the Wayback CDX API for `fbo.gov/index?s=opportunity` pages containing a PE code (`http://web.archive.org/cdx/search/cdx?url=fbo.gov/index*&filter=statuscode:200&limit=20`).
- [ ] **Step 3: Write the result doc** — one of: (a) "solicitation text is retrievable and PE codes appear in N of M sampled solicitations → acquisition lane justified (estimate volume/rate)", or (b) negative result with the exact queries that returned 0, so the lane is not rebuilt. Commit as `docs(#74): SAM.gov solicitations spike — <positive|negative> result`.

---

### Task 9: Back up the raw announcements corpus (313MB, ignored)

**Files:**
- Create: `scripts/launch/backup_raw_announcements.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Backs up data/raw/announcements (sha256-manifested, git-ignored) to R2 under
# research/announcements-raw/. Idempotent; uses the same rclone remote as upload_r2.sh.
set -euo pipefail
BUCKET="${R2_BUCKET:-govbudget-assets}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)/data/raw/announcements"
[ -f "$SRC/manifest.json" ] || { echo "no manifest at $SRC"; exit 1; }
rclone copy "$SRC" "r2:$BUCKET/research/announcements-raw" --checksum --transfers 8 -P
# verify: every manifest sha256 exists remotely by name
python3 - "$SRC" <<'EOF'
import json, subprocess, sys
m = json.load(open(sys.argv[1] + "/manifest.json"))
remote = set(subprocess.check_output(["rclone", "lsf", "r2:govbudget-assets/research/announcements-raw", "-R"]).decode().split())
missing = [k for k in m if k not in remote]
print("manifest entries:", len(m), "missing remotely:", len(missing)); sys.exit(1 if missing else 0)
EOF
```

- [ ] **Step 2: Run** `chmod +x scripts/launch/backup_raw_announcements.sh && ./scripts/launch/backup_raw_announcements.sh` → expect `missing remotely: 0`.
- [ ] **Step 3: Commit** the script (not the data) and add one line to `docs/superpowers/LAUNCH.md` under backups. `git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "chore: back up the raw announcements corpus to R2 with manifest verification"`.

---

### Task 10: Tooling — Vercel CLI

- [x] Updated to 59.11.7 on 2026-09-04 (`npm i -g vercel@latest`); no repo change. Re-check with `vercel --version` before the next deploy.

---

## Self-Review

**Spec coverage:** #70 → Task 7; #71 → Task 4; #72 → Task 1; #73 → Task 6; #74 → Task 8; #75 → Task 5; #76 → Task 3; #77 → Task 2; raw-corpus backup → Task 9; CLI → Task 10. Every backlog entry has a task; every task ends in a commit with a test or gate.

**Placeholder scan:** Task 5's third test has an elided body (`...`) — the executor must write it against the seed: insert an MDA budget line, an award with sub-agency "Missile Defense Agency", assert medium only when `data-seeds/org_subagency_aliases.csv` maps `MDA`. Task 7 is explicitly gated on an owner decision and includes a probe step that determines its scope. Task 4's loader change and Task 6's component are described by interface + pattern reference to existing code in this repo (`ProgramAwards.handleExpand`, `_null_usaspending_row`), which the executor can open.

**Type consistency:** `precision_by_method -> dict[str, tuple[int,int]]` is what Task 1's exporter step consumes; `_announcement_row` returns the 27-tuple layout of `_null_usaspending_row` (index 1 kind, 15 sha256, 17 official_url, 22 query_body) and the test asserts those indices; `data-awards-tier-note="medium"` is the attribute both the vitest and the gate leg select.
