# Phase 5D Visual Judging Rubric

Three independent vision judges score each dimension 1–5. **Median ≥ 4 required per
dimension.** Judges see the /years/ budget-over-time matrix and the breakdown
("show your work") citation surfaces:

- `years-390.png`, `years-768.png`, `years-1440.png` — /years/ top fold, default state
- `years-1440-expanded.png` — one org section open (others collapsed) with one
  program's J-book project sub-rows expanded
- `years-1440-filtered.png` — text filter narrowing 462 programs to a handful
- `years-390-scrolled.png` — grid horizontally scrolled to mid-position; the sticky
  first column must be holding
- `breakdown-inline-1440.png` — a Δ cell's citation panel with the inline 2-row
  breakdown table (FY26 total minus FY25 total)
- `breakdown-overlay-1440.png` — an agency FY24 total's full-screen breakdown overlay
  (123 line items, filter box visible)

Score each dimension with 2-3 sentences of justification citing specific screenshots.
A 5 = best-in-class for a civic-data product; 4 = professional, minor nits; 3 =
competent but generic or with visible rough edges; ≤2 = fails the bar.

## Inherited dimensions (5B/5C baseline — regression watch)

| D1 | Visual hierarchy & typography — scan order matches importance; consistent scale |
| D2 | Data presentation — tables/figures legible, aligned, honest units |
| D3 | Responsive integrity — 390/768/1440 all coherent; no overflow/clipping/cramping |
| D4 | Citation affordance clarity — cited vs uncited states distinguishable; chips readable |

**V1 — Receipt-moment credibility (Goal 1).** "Would a skeptical journalist believe
this site's numbers within 30 seconds — and could they say why?" For 5D judge the
citation surfaces in the breakdown screenshots: does every dollar in the matrix look
clickable-to-source, and does the opened panel deliver visible proof?

**V2 — Honest completeness (Goal 3).** "Does any chart or table imply completeness it
doesn't have?" The single-edition coverage note must be present and legible on
/years/; missing values must read as absent ("–"), never as zero; the breakdown
tables must not hide uncited inputs. Any implied-completeness finding caps the
score at 2.

**V5 — Motion design & modernity (Goal 6).** Consistency (one easing family, token
durations), restraint (no bounce, no gratuitous movement), purpose (motion stages
content — panel slide, overlay fade, expand/collapse). Judge from any visible
mid-animation states; static frames must not show half-revealed content stuck
mid-transition.

## Phase 5D dimensions

**M1 — CapIQ density bar.** "Does this table read like a professional financial-data
product — density, alignment, scanability — or like a generic web table?" Judge the
/years/ grid against the Capital IQ / Bloomberg standard: right-aligned tabular
numerals in a mono face, one decimal, tight but readable row rhythm, sticky
header + sticky first column holding under scroll (`years-390-scrolled.png`),
org grouping and project sub-rows legible as hierarchy (`years-1440-expanded.png`),
sort/filter/column controls discoverable without crowding the data
(`years-1440-filtered.png`). A grid that wastes vertical space, center-aligns
numbers, mixes numeral styles, or loses its first column under horizontal scroll
fails the bar.

**M2 — Breakdown trust.** "Does the show-your-work table make the sum verifiable at a
glance — is the subtraction/uncited handling legible?" Judge
`breakdown-inline-1440.png` and `breakdown-overlay-1440.png`: line-item amounts and
the sum row must visually add up (exact numerals, aligned column); subtracted inputs
must read unambiguously as negative lines (− label + negative amount), not as
formatting accidents; uncited inputs must be visibly distinct yet still counted, so
the table accounts for 100% of the recorded value; the 123-row overlay must stay
navigable (filter box, sticky sum, CSV affordance). If a reader could not check the
arithmetic with a pencil from the screenshot alone, the score caps at 3.

## Output format (per judge)

```
D1: <score> — <justification>
D2: <score> — <justification>
D3: <score> — <justification>
D4: <score> — <justification>
V1: <score> — <justification>
V2: <score> — <justification>
V5: <score> — <justification>
M1: <score> — <justification>
M2: <score> — <justification>
FINDINGS: <numbered list of specific fixable issues with page + viewport>
```
