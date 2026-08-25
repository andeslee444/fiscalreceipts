# Curation worksheets — owner/domain work, not engineering

Files here exist so a human who knows the programs can make a decision cheaply.
They are inputs to curation, never the curation itself.

---

## `roadmap-55-flagship-alias-worksheet.csv`

**For:** ROADMAP #55 remainder — *"RTX/Boeing aliases: NOT engineering work…
This needs someone who knows the programs to author the mappings."*

**What it is:** one row per **(flagship term, candidate program element)** pair.
72 terms, **215 rows**. Tick the `pick` column on the row that is the correct
program element for that term, or write `DROP` in `curator_notes` if the term
should not become an alias at all. Everything ticked becomes a row in
`dbt/seeds/program_aliases.csv`.

**Regenerate:** `uv run python docs/curation/regen_roadmap_55_worksheet.py`
(read-only against `data/duckdb/govbudget.duckdb`; overwrites the CSV).

### Columns

| Column | Meaning |
|---|---|
| `alias_term` | The flagship product name as a lobbyist would write it |
| `vendor` | Annotation for orientation — the prime this product belongs to. **Not warehouse-derived.** |
| `n_candidates` | How many distinct PEs have this term in their `dim_programs.title` |
| `curation_tier` | `sole_match` (1) · `ambiguous` (2–8) · `unusable_too_many` (>8) · `no_title_match` (0) |
| `roadmap_crosscheck` | Whether this term's count reproduces the figure ROADMAP #55 recorded on 2026-08-21 |
| `candidate_pe_bli` / `candidate_title` / `org` / `account_title` | The candidate program |
| `fy2026_total_thousands`, `fy2025_total_thousands`, `fy2024_actuals_thousands` | Money, from `fct_budget_trajectory`, resolved the same way `dossiers.research.top50` resolves it (exact `(pe_bli, workbook_org, account)` hit wins; NULL account falls back to `(pe_bli, org)` only when that resolves to exactly one row) |
| `program_page` | Where the mention would land |
| `lobbying_mentions_today` / `mention_evidence_kinds` | What `fct_program_lobbying` already carries for this PE, and by which tier — shows whether the program already has evidence some other way |
| `seeded_alias_today` | The PE this term currently resolves to in `dbt/seeds/program_aliases.csv`, or `none` |
| `resolves_today` | What the shipped code does with this term right now |
| `auto_pick_would_be` | `YES` when the term is a **sole title match** — i.e. what a naive auto-derived alias would land on. **These are the known-wrong ones.** |
| `seed_conflict` | Set when this term already has a seeded alias and *this* candidate is **not** the one it points at. 20 rows across 6 terms — the seed audit, embedded in the worksheet rather than kept separately |
| `pick`, `curator_notes` | **Yours.** Blank on purpose. |

### The trap this worksheet exists to make visible

A title match is not a correct alias. The `auto_pick_would_be = YES` rows are
exactly the cases where an automated approach would confidently produce a wrong
answer:

| Term | Sole title match | Almost certainly wrong because |
|---|---|---|
| `Sentinel` | `0125WK5057` **Sentinel Mods** (Army, FY26 $462.0M) | The LGM-35A Sentinel ICBM is `0605238F` *Ground Based Strategic Deterrent EMD* (Air Force, in the top-50). Nothing in any title contains the string "Sentinel" for it. |
| `Harpoon` | `5227` **Harpoon Support Equipment** (Navy, FY26 $209k) | Support equipment, not the missile. |
| `Stinger` | `2684C20000` **Stinger Mods** (Army, FY26 $505.9M) | Modifications line, not the base program. |

`GBSD` matches **zero** titles, which is the same finding from the other side:
when a term has no title match, the right PE has to be found by program
knowledge, not by string search.

### When the term isn't in any title

Search the warehouse by the spelled-out program name instead:

```bash
uv run python -c "
import duckdb
con = duckdb.connect('data/duckdb/govbudget.duckdb', read_only=True)
for r in con.execute(\"\"\"
  select pe_bli, org, title from dim_programs
  where upper(title) like '%STRATEGIC DETERRENT%' order by pe_bli\"\"\").fetchall():
    print(r)
"
```

### Provenance of the term list

The exact 31 terms the 2026-08-21 investigation used were never written down.
The 72 terms here are a documented superset: 60 open flagship names covering RTX,
Boeing, Northrop and the still-open Lockheed lines, plus the 12 aliases already
in `dbt/seeds/program_aliases.csv` so the file doubles as an audit of the
existing seed. The method is recovered rather than guessed: a
plain **substring match against `dim_programs.title`** reproduces **all twelve**
candidate counts ROADMAP #55 recorded — Patriot 2, AMRAAM 3, Tomahawk 2, F/A-18
2, KC-46 2, Apache 2, Hellfire 3, ESSM 8, RAM 89, Sentinel 1, Harpoon 1,
Stinger 1 — exactly, and a word-boundary rule does not. Those rows are marked
`matches ROADMAP` in `roadmap_crosscheck`.

### Two live defects this audit surfaced

Both are already shipped and are free to fix; see
`docs/superpowers/plans/2026-08-24-sprint-d-cost-and-dependencies.md` §4.

1. `JASSM → 0603000D8Z` (*Joint Munitions Advanced Technology*, OSD) carries
   **10 live alias mention rows**, while `0207325F` *Joint Air-to-Surface
   Standoff Missile (JASSM)* — the actual program element — gets only 3 weaker
   `multi_token` rows.
2. `C-130J`, `Aegis`, `MQ-9`, `CV-22`, and `F-35` each route a 4–6-PE family to a
   single PE. Possibly the right editorial call (a canonical landing page);
   possibly the false attribution #52 removed. The 12 currently-seeded aliases are
   included as terms in the worksheet for exactly this reason, so the audit lives
   next to the decision instead of in a one-off query.
