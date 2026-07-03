# Phase 5E Visual Judge Rubric — decade view (/years/), decade trajectory, RVA feed

Phase 5E turned the single-edition /years/ matrix into a 12-column,
edition-honest decade grid (FY2015A–FY2024A + FY2025E + FY2026R, each column
from its own President's Budget book), added the DecadeTrajectory section to
program pages (sparkline + value grid + asked-vs-spent strip), and added the
request-vs-actuals gap section to /feed/. Three independent vision judges
score each dimension 1–5; **median-of-3 ≥ 4 required per dimension**.

Evidence files in this directory (all deviceScaleFactor 2):

| File | What it shows |
| --- | --- |
| `years-1440.png` | /years/ default 12-column decade view at 1440 — controls, column picker, edition legend, honesty legend, edition-tagged column headers, top rows |
| `years-1440-expanded.png` | One org section (DARPA) open with one program's J-book project sub-rows out — project cells absent ("–") in non-PB2026 decade columns |
| `years-1440-picker.png` | Column picker clip — the Decade \| PB2026 detail grouping, 12 decade defaults selected, edition + honesty legends |
| `years-1440-filtered.png` | Text filter "missile" narrowing 462 programs to 25 |
| `years-768.png` | Default decade view at 768 (tablet) |
| `years-390.png` | Default view at 390 (mobile), grid mid-horizontal-scroll — sticky first column holding |
| `program-decade-1440.png` | /program/0607136A/ (full tier) decade section — actuals sparkline with an FY2023 edition gap, asked-vs-spent strip, value grid |
| `program-decade-rollup-1440.png` | /program/0605625A/ (rollup tier) same section — FY2017 gap, $431.6M asked-vs-spent delta |
| `program-decade-cite-1440.png` | A decade grid value clicked — citation panel open with the Budget Workbook source card (sheet, cells, SHA-256, download) |
| `feed-rva-1440.png` | /feed/ "Largest Request-vs-Actuals Gaps" section — headline cards with signed cited gaps |

Score each dimension with 2–3 sentences of justification citing specific
screenshots. A 5 = best-in-class for a civic-data product; 4 = professional,
minor nits; 3 = competent but generic or with visible rough edges; ≤2 =
fails the bar.

---

## Dimensions (Phase 5E)

### E1 — Data-density legibility at 12 columns (CapIQ bar)
**Does the decade grid read as a professional financial terminal, or as
cramped noise?**

Twelve numeric columns is the density of a Capital IQ / Bloomberg screen.
Judge: right-aligned tabular numerals in a mono face, one decimal, tight but
readable row rhythm; the `FY2015A…FY2026R` headers and their `PB20XX`
edition sub-tags legible at 1440 AND at 390 (abbreviated `FY20A` forms);
sticky header + sticky first column holding under scroll; sort carets,
filter, and column picker discoverable without crowding the data.

Evidence: `years-1440.png`, `years-768.png`, `years-390.png`,
`years-1440-expanded.png`, `years-1440-filtered.png`.

Score | Criteria
:---: | ---
5 | The 12-column grid scans like a terminal: aligned mono numerals, headers + edition tags crisp at both 1440 and 390, sticky column/header hold mid-scroll with no bleed-through, hierarchy (org → program → project) legible at a glance, controls compact and out of the data's way.
4 | Dense but readable; one minor crowding or truncation nit (e.g. a header tag tight against the sort caret) that does not slow scanning.
3 | Readable on effort — columns visibly cramped at 1440 or the 390 abbreviations ambiguous; or sticky surfaces show artifacts (partial glyphs, misaligned borders) that distract.
2 | Columns collide or numerals wrap; the first column loses registration under horizontal scroll; density reads as noise.
1 | The grid is illegible at default zoom or structurally broken at any captured width.

### E2 — Edition honesty comprehension
**Would a first-time reader understand that each column comes from a
different book edition — without opening the methodology page?**

The core 5E claim: actuals for FY N are read from the PB(N+2) book, so
every column is a different document. Judge whether the on-page cues carry
that alone: the one-line edition legend ("Actuals for FY N come from the
PB(N+2) book; each column states its edition"), the `PB20XX` sub-tag under
every decade header, the Decade vs PB2026-detail grouping in the column
picker, and the header tooltips ("FY2020 actuals (PB2022 edition)").

Evidence: `years-1440.png`, `years-1440-picker.png`,
`program-decade-1440.png`, `program-decade-cite-1440.png`.

Score | Criteria
:---: | ---
5 | A first-time reader cannot miss it: every decade column visibly states its edition, the legend explains the rule in one line, the picker's two group labels make "decade across books" vs "one book's detail" explicit, and the program page repeats the rule at the decade section ("each figure cites its own President's Budget edition").
4 | The cues are all present; one is easy to skim past (e.g. the group labels in the picker read as part of the chip flow) but the header tags alone still carry the claim.
3 | Edition tags present but visually subordinate enough that a hasty reader would assume one source; or legend and tags disagree in wording.
2 | Editions only discoverable via tooltip or the methodology page; the grid implies a single continuous source.
1 | Columns from different books are presented as one book's series — the honesty claim is absent or contradicted.

### E3 — Gap honesty
**Do missing values read as honest data boundaries rather than bugs?**

Absent cells must render "–" (never 0, never interpolated); the sparkline
must break into separate segments at edition gaps; asked-vs-spent must
appear only where both sides are cited. Judge: the FY2023 hole in
0607136A's actuals (grid "–" AND a visible line break), the FY2017 hole in
0605625A, project sub-rows showing "–" in non-PB2026 decade columns while
the same rows show cited values (including amber `0.0 XML` state-B zeros)
in the PB2026-mapped columns, and the marker-key line stating "gaps are
editions the program is absent from, never interpolated."

Evidence: `program-decade-1440.png`, `program-decade-rollup-1440.png`,
`years-1440-expanded.png`, `years-1440.png`.

Score | Criteria
:---: | ---
5 | Every absence is deliberate and explained: "–" cells with edition tooltips, sparkline segments that visibly stop at gaps (no bridging line), the marker key stating the never-interpolated rule, absent-at-parent vs explicit-zero-at-child visually distinct (plain "–" vs amber XML chip), and asked-vs-spent present only with both sides cited.
4 | Gaps honest throughout; one cue underweighted (e.g. the line break is subtle at sparkline scale but the grid "–" confirms it).
3 | Values are never invented, but a gap could be mistaken for a rendering fault — e.g. a broken-looking line with no nearby explanation, or "–" and empty cells indistinguishable.
2 | A gap renders as zero, or a line visibly bridges a missing year.
1 | Interpolated or fabricated values anywhere, or an asked-vs-spent claim whose sides are not cited.

### E4 — Trajectory craftsmanship
**Does the decade section read as an instrument — and is the citation
affordance discoverable?**

Judge the render: sparkline segments with clean joins, filled actuals dots
vs hollow enacted circles vs hollow request diamonds distinguishable at
size, the marker key naming all three, the value grid aligned under its FY
headers, the asked-vs-spent strip reading as one cited sentence, and the
dotted-underline cite affordance on every value leading to a real source
panel (sheet, cells, checksum, download) in one click.

Evidence: `program-decade-1440.png`, `program-decade-rollup-1440.png`,
`program-decade-cite-1440.png`.

Score | Criteria
:---: | ---
5 | The section feels native to the site's design system: crisp line/marker rendering, no label collisions, grid and sparkline visibly agree, asked-vs-spent states both books and the signed delta with every dollar underlined-citable, and the opened panel delivers document-tier proof (sheet + cell + hash) within one click.
4 | Professional with one minor nit (e.g. marker shapes hard to tell apart at 2.5px radius, or the FY axis labels sparse) that does not impair reading.
3 | Chart legible but generic — markers ambiguous without the key, grid spacing uneven, or the cite affordance only discoverable by accident.
2 | Sparkline and grid disagree visually, labels collide, or clicking a value produces no source.
1 | The section reads as a broken prototype or the citation panel fails to render.

### E5 — Feed card clarity
**Does a request-vs-actuals card state its claim precisely and invite the
click-through?**

Each card must scope its claim exactly: which FY, which book asked, which
book reported, direction and magnitude of the gap ("X FY2024 actuals came
in $2.3B above the PB2024 request (per the PB2026 book)"), with the signed
cited figure, the PE code, a "view program →" link, and a "why flagged?"
methodology link. The section description must restrict the claim to
request-vs-actuals (nothing about request-vs-request).

Evidence: `feed-rva-1440.png`.

Score | Criteria
:---: | ---
5 | Every visible card names both editions and the FY, the direction word matches the sign of the cited figure, the section description states the exact PB(N) vs PB(N+2) construction, and each card offers both the program click-through and the why-flagged explainer.
4 | Claims precise; one affordance is subdued (e.g. "why flagged?" easy to miss) but present.
3 | Cards state magnitude but blur the two-books construction — a reader could think the program "went over budget" rather than "a later book reported different actuals".
2 | Direction words and signed figures disagree, or cards omit which books are being compared.
1 | A card editorializes ("waste", "overrun") or asserts a gap without a cited figure.

---

## Scoring Guidance

- Three independent judges; each scores every dimension 1–5 with 2–3
  sentences of justification citing specific screenshots.
- **Threshold: per-dimension median of the three judges ≥ 4** across all
  five dimensions (E1–E5).
- A score of 1 on any dimension from any judge is a blocking defect
  regardless of median.
- When evidence is ambiguous (e.g. hover-only tooltips a static capture
  cannot show), note the ambiguity and score conservatively (round down).

## Output format (per judge, 5C convention)

Report findings as a table:

| Dim | Score | Finding |
|-----|------:|---------|
| E1  |     ? | … |
| E2  |     ? | … |
| E3  |     ? | … |
| E4  |     ? | … |
| E5  |     ? | … |
| **Median** | **?** | |

Then list any blocking defects (score = 1) and recommended fixes.
