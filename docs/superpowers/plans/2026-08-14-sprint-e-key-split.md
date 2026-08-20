# Sprint E — The Key Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> Standing rules (MANDATORY): commits `--author="Andes Lee <andes.lee444@gmail.com>"`
> + trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; **use
> `git commit -F <file>`** (backticks in `-m` get eaten by the shell); explicit
> paths only, never `git add -A`; TDD; **never weaken a gate**; new gate legs ship
> with proof-can-fail in `docs/superpowers/reviews/5c-gates-pre-failure.txt`,
> verbatim FAIL and PASS; **the suite is 24 gates and must stay 24** — check
> leg-letter collisions first; gate 1 pins `git_head`, so build AFTER committing;
> **never launch a background process and stop to wait for it**; **do NOT run
> `verify-phase5`** (~$0.85/run, controller only); **do not deploy**.

**Goal:** Give each (appropriation account, program key) pair its own page, so the
10 programs currently correct-but-absent — **$5.35B**, headed by LPD Flight II and
Medium Landing Ship — appear on the site instead of in an excluded list.

**Architecture:** B′1 de-fused six pages that were summing two unrelated programs
under one title. It did so by keeping one program per key, which was right for
correctness and wrong for completeness: the other half left the corpus. This sprint
re-grains the program identity on `(account, pe_bli)` end to end.

**Tech Stack:** Python 3.12/uv, DuckDB, dbt; Next.js 16 static export, React 19,
Tailwind v4, Playwright.

**Current state:** `main` at `de3e65c`, deployed. 1,575 pytest · 1,007 vitest ·
24/24 gates.

---

## The estimate that brought us here was wrong. Read this before planning around it.

B′1's cost estimate said 5–9 days, "dominated by `fct_decade_series` (2–4 days, high
uncertainty)", on the grounds that the collision "is **not** confined to PB2026" and
that there is "**no `dim_programs`-equivalent anchor for older editions** to pick
which account is primary — a naive per-edition, size-based tiebreak could flip which
program a given edition's point describes."

**Measured 2026-08-14, that premise does not hold.** The colliding keys do not exist
before PB2024:

```
key      2017 … 2023   2024  2025  2026        decade_series rows   editions
0145        -  …   -      2     2     2              9              2024–2026
2210        -  …   -      1     1     2              9              2024–2026
2292        -  …   -      2     2     2              9              2024–2026
3010        -  …   -      2     2     2              9              2024–2026
3050        -  …   -      1     2     2              9              2024–2026
3215        -  …   -      2     2     2              9              2024–2026
3302        -  …   -      2     2     2              9              2024–2026
4217        -  …   -      2     2     2              9              2024–2026
```

Era editions (PB2017–PB2023) key Navy procurement with namespaced identities —
`1810N-NAVY-L1`, i.e. `{account}-{org}-L{n}` — so a bare numeric key like `3010`
is **absent by construction**, which is the same identity gap eval q048 exists to
test. There is therefore no "which account was primary in PB2019" problem, because
`3010` was never in PB2019. The decade work is bounded to **8 keys × 3 editions**,
and PB2026 has `dim_programs` as an anchor for all of them.

The estimate was not careless — it correctly observed that PB2024 and PB2025 also
collide. It then generalised from that to ten editions without checking the other
seven. **This is the tenth prescribed premise in this plan family to fail the same
way: symptom observed correctly, cause inferred rather than traced.** Re-derive the
table above yourself before you rely on it.

---

## Verified scope (2026-08-14)

```
key     account                              title                            FY26     page?
0145    Aircraft Procurement, Navy           F/A-18E/F (Fighter) Hornet       $0.05B    NO
0145    Procurement of Ammunition, Navy/MC   General Purpose Bombs            $0.03B    NO
2210    Weapons Procurement, Navy            Joint Advance Tactical Missile   $0.30B    NO
2210    Other Procurement, Navy              Submarine Acoustic Warfare Sys   $0.06B   yes
2292    Procurement, Marine Corps            Naval Strike Missile (NSM)       $0.16B    NO
2292    Weapons Procurement, Navy            Naval Strike Missile (NSM)       $0.04B    NO
3010    Shipbuilding and Conversion, Navy    LPD Flight II                    $2.60B    NO
3010    Other Procurement, Navy              Shipboard Tactical Comms         $0.02B   yes
3050    Shipbuilding and Conversion, Navy    Medium Landing Ship              $1.96B    NO
3050    Other Procurement, Navy              Ship Communications Automation   $0.16B   yes
3215    Weapons Procurement, Navy            MK-54 Torpedo Mods               $0.11B    NO
3215    Other Procurement, Navy              Satellite Communications Sys     $0.06B   yes
3302    Weapons Procurement, Navy            ASW Range Support                <$0.01B   NO
3302    Other Procurement, Navy              Joint Comms Support Element      <$0.01B  yes
4217    Weapons Procurement, Navy            Gun Mount Mods                   $0.08B    NO
4217    Other Procurement, Navy              Advanced Arresting Gear (AAG)    <$0.01B  yes

10 programs would gain a page · $5.35B
9999999999 is the intentional classified sentinel — excluded BY NAME, never by threshold
```

**`2292` is not like the others.** Both halves are titled "Naval Strike Missile
(NSM)" — one program funded from two appropriations, not two programs sharing a key.
Splitting it produces two pages with the same title. Decide deliberately whether that
is right (two funding lines of one program) or whether it should stay merged with its
accounts itemised. **`1045` COLUMBIA is the precedent for the merged reading** — one
program whose account changed between editions, correctly NOT split by B′1.

**Tomahawk is NOT in scope.** It is excluded for `no_detail`, not `key_collision` —
`dim_programs` has no row for either account. Different defect, do not fold it in.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `docs/superpowers/ROADMAP.md` | ledger | E0, E6 |
| `dbt/models/marts/dim_programs.sql` | `(account, pe_bli)` grain | E1 |
| `dbt/models/marts/fct_budget_trajectory.sql` | same grain | E1 |
| `dbt/models/marts/fct_decade_series.sql` | account-aware, 8 keys × 3 editions | E2 |
| `dbt/tests/assert_program_key_unique.sql` | tighten to the new grain | E1 |
| `src/govbudget/export_site.py` | slug identity; page emission | E3 |
| `site/src/app/program/[peBli]/page.tsx` | composite slug route | E3 |
| `site/scripts/gates/basis.mjs` | leg: no program page spans two accounts | E4 |
| `site/src/app/programs/page.tsx` | coverage note loses its collision clause | E5 |

---

### Task E0: File the sprint and re-derive the scope

- [ ] **Step 1:** Re-run the edition table and the scope table above. **Report your
      numbers.** If they differ from these, yours win — say so loudly.
- [ ] **Step 2:** File #67 in the ROADMAP with the measured scope, and record that
      B′1's 5–9 day estimate rested on a premise that did not survive checking.
- [ ] **Step 3:** Commit.

---

### Task E1: Re-grain program identity on `(account, pe_bli)`

**Files:** `dbt/models/marts/dim_programs.sql`, `fct_budget_trajectory.sql`,
`dbt/tests/assert_program_key_unique.sql`, `dbt/models/marts/schema.yml`.

B′1 added an `account`/`account_title` column to `dim_programs` and a "pick one
account per (pe_bli, organization)" rule to `fct_budget_trajectory`
(`slot_collision` / `account_rank`, preferring the `dim_programs` account then the
largest total). **That pick-one rule is what this task removes** — read both models
before touching them and understand the `account_rank` CTE, because the same
machinery becomes the split key.

- [ ] **Step 1: Enumerate every consumer of the one-row-per-`pe_bli` assumption.**
      B′1 found six by hand: `traj_index`, `_trajectory_citation_key`, two agency-sum
      builders, `fct_program_trajectory`'s uniqueness (2 dbt guard tests), and
      `_scoped_amounts`. **Do not trust that list — re-derive it**, and report what
      you find. A missed consumer silently drops or double-counts a program.
- [ ] **Step 2:** Tighten `assert_program_key_unique.sql` from "no key spans two
      accounts within an edition" to "the program grain is unique on
      `(account, pe_bli, fiscal_year)`". Run it, watch it FAIL, record verbatim.
- [ ] **Step 3:** Re-grain both models. Rebuild. Re-run to PASS.
- [ ] **Step 4: Corpus arithmetic must balance.** Program count goes **1,739 → 1,749**
      (+10) and no program may lose money. Assert the FY2026 sum over the new grain
      equals the sum over `fct_budget_lines` for these 8 keys. State before/after.
- [ ] **Step 5:** Commit.

---

### Task E2: Make `fct_decade_series` account-aware

Bounded: 8 keys, editions 2024–2026, 9 rows each. `fct_decade_series` currently has
no `account` column (`pe_bli, fy, edition_year, amount_type_kind, amount,
amount_thousands, scenario, amount_type, n_source_rows, source_fact_id`).

B′1 excluded these keys from `decade_grains` to stop a leak. **That exclusion is what
this task replaces** — find it first and say where it is.

- [ ] **Step 1:** Add `account` to the grain for these keys only, or to the model
      generally if that is cleaner. State which and why. The era keys
      (`1810N-NAVY-L1`) are already account-namespaced, so the concept is not foreign
      to the model — check how it treats them before inventing a parallel mechanism.
- [ ] **Step 2:** `n_source_rows` must be 1 per (key, account, fy, edition) after
      this. It is 2 today for the fused keys — that is the leak's signature.
- [ ] **Step 3:** `/years/` renders from this model. Confirm the split rows appear
      and that the balanced-panel chart (Sprint C #64) still computes — its panel is
      "programs with a figure in every one of 12 years", and these keys have 3
      editions, so they will not join the panel. **Verify the panel size does not
      change**, and if it does, explain why.
- [ ] **Step 4:** Proof-can-fail on the dbt assertion. Commit.

---

### Task E3: The URL contract — the task's real decision

Six keys are live 200s today (`/program/2210/`, `3010`, `3050`, `3215`, `3302`,
`4217`). Splitting changes what those URLs mean.

- [ ] **Step 1: Choose, and write the reasoning into the commit.**
  - **(a) Composite slug** — `/program/3010-OPN/` and `/program/3010-SCN/`, with the
    bare `/program/3010/` a disambiguation stub listing both. Only option where a URL
    means exactly one program. Needs a slug scheme derived from the account (do NOT
    hand-map 16 slugs — derive it, and make collisions in the derivation fail loudly).
  - **(b) Incumbent keeps the bare URL** — the program that has the page today stays,
    the other gets a composite slug, each links to its sibling. Fewest broken links;
    arbitrary about which program "owns" the key.
  - **Prefer (a).** B′1 rejected composite slugs partly because the decade sparkline
    would contradict a split page — E2 removes that objection.
- [ ] **Step 2: Handle `2292` deliberately.** Both halves are "Naval Strike Missile
      (NSM)". Two pages with an identical title is a usability defect of the kind this
      project keeps removing. Either disambiguate the title by account, or keep it
      merged with accounts itemised — decide and justify against the `1045` precedent.
- [ ] **Step 3: Enumerate URL consumers before changing anything** —
      `generateStaticParams`, `sitemap.ts`, gate 1's page-count assertions, gate 13
      (linkgraph), gate 21 (program-skeleton), `search_quick.json`, cite-shards,
      `pe-link.ts`'s auto-linker, and LDA/lineage prose mentions (a bare "3010" in
      text cannot know which page it means — decide what it links to).
- [ ] **Step 4:** Implement, verify every old URL still resolves (stub or redirect).
- [ ] **Step 5:** Commit.

---

### Task E4: Gate leg — one program page, one account

- [ ] Add to `basis.mjs`: no program page may render figures whose citation records
      name more than one `account_title`. Non-vacuity: fail under 100 pages. B′1's
      leg (h) family is adjacent — extend it rather than starting a new letter if that
      is the honest fit; say which you took and how you confirmed it free.
- [ ] Prove it fails against a pre-fix build. Record verbatim FAIL and PASS. Commit.

---

### Task E5: The coverage note loses its collision clause

`/programs/` currently says 17 lines totalling $5.82B are absent because their key is
already another program's page, and links `programs_excluded.json`.

- [ ] **Step 1:** After E1–E3, the `key_collision` set should shrink toward zero.
      **It must be recomputed, never hand-edited** — `build_programs_coverage` already
      derives it from what is actually absent. Confirm the count drops and the prose
      follows automatically.
- [ ] **Step 2:** If any `key_collision` entries remain, say why — a remaining one is
      a finding, not a rounding error.
- [ ] **Step 3:** `/programs/` coverage moves from 58.0%. State the new figure.
- [ ] **Step 4:** Add the split to `/methodology/`'s corrections table. **Page weight
      is tight** — `/methodology/` is at 33,863/34,500 gzip and `/programs/` at
      277,391/278,000 (643 bytes). Adding 10 rows to the index WILL move `/programs/`.
      **If it breaches, report the number and stop — do not raise a ceiling.**
- [ ] **Step 5:** Commit.

---

### Task E6: Sprint close

- [ ] Commit everything FIRST (gate 1 pins `git_head`), then:

```bash
uv run pytest
uv run python -m govbudget verify-lineage
uv run python -m govbudget export-site
cd site && NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run build
NEXT_PUBLIC_SITE_URL=https://fiscalreceipts.com npm run verify   # 24/24
cd .. && uv run python -m govbudget verify-phase5b3               # serialized, binds 4173
```

- [ ] Close #67, file anything not closed. Report to the controller. **Do NOT deploy.**

---

## Self-review

**Scope.** 8 keys, 16 programs, 10 gaining a page, $5.35B. `9999999999` excluded by
name; `1045` and Tomahawk explicitly out of scope with reasons.

**The estimate this sprint was sold on was wrong**, and the correction is recorded at
the top rather than quietly absorbed: the decade component is 3 editions, not 10.

**Dependency.** E1 → E2 → E3 is a chain (grain, then decade, then URLs). E4 and E5
follow E3. Nothing parallelises safely.

**Risk.** E3's URL change is the only outward-facing break. Six live 200s move; every
one needs a stub or redirect, and that is part of E3, not an afterthought.

**Cost.** Zero API spend — unless dossiers for 3010/3050 need regenerating, which is
an owner decision, not this sprint's call.
