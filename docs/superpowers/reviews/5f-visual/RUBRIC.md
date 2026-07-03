# Phase 5F Visual Judge Rubric

Inherits dimensions D1–D4, V1, V2, V5 from the 5C rubric.
Adds three new dimensions N1–N3 specific to the Phase 5F deliverables.

---

## Inherited Dimensions

### D1 — Data fidelity
Every figure on screen must match the cited source value.  No rounding that
changes a digit, no transposed amounts, no placeholder text standing in for a
real number.

Score | Criteria
:---: | ---
5 | All visible figures match source exactly; citation links resolve to the right page and cell.
4 | One minor discrepancy (rounding display, unit label) that does not misrepresent magnitude.
3 | One figure is off by < 10 %; tooltips or breakdowns correct it on click.
2 | Multiple figures diverge or a breakdown total does not sum correctly.
1 | Figures are fabricated, missing, or systematically wrong.

### D2 — Coverage honesty
Pages must not silently omit data.  Empty sections must carry an explained
empty state, not a blank space or a spinner that never resolves.

Score | Criteria
:---: | ---
5 | Every absent section carries a one-sentence honest explanation; no silent gaps.
4 | One empty section has a generic "no data" message without explanation.
3 | Two sections are silent (blank) rather than explained.
2 | Several sections silently absent; user cannot tell if data is missing or loading.
1 | Page appears to have content but is silently hiding unavailable sections.

### D3 — Citation reachability
Every cited figure must be reachable in one click (≤ 2 clicks for derived
figures).  Citation panel must open and render within 4 seconds on a local
static server.

Score | Criteria
:---: | ---
5 | All visible Cite elements open a panel; panel renders within 4 s with source page.
4 | Panel opens for all but one cite; that cite still shows amount text in panel header.
3 | Panel opens for most cites; one cite opens to an error or empty state.
2 | Multiple cites do not open panels or panels load indefinitely.
1 | Cite elements are non-interactive or panel is missing.

### D4 — Print / export integrity
The print layout must not expose internal scaffolding (fact IDs, raw JSON,
uncollapsed dev panels).  The print-only byline must be visible in the print
stylesheet and hidden on screen.

Score | Criteria
:---: | ---
5 | Print CSS hides UI chrome, reveals byline, all figures remain legible.
4 | Minor cosmetic issue in print layout (one column bleeds, one icon visible).
3 | Print layout degrades meaningfully but content is readable.
2 | Print layout is broken; figures truncated or hidden.
1 | Page cannot be printed usefully.

### V1 — Visual hierarchy
Heading levels, font weights, and whitespace must communicate importance
without relying solely on color.  The most important figure on the page must
be the most visually dominant element.

Score | Criteria
:---: | ---
5 | Clear hierarchy; primary figure is immediately dominant; sections scannable.
4 | Hierarchy mostly clear; one section's heading weight is ambiguous.
3 | Two or more sections compete visually at the same weight.
2 | Hierarchy is flat; every element is the same visual weight.
1 | No discernible hierarchy; page is a wall of equal-weight text.

### V2 — Responsive integrity
At 390 px the page must not overflow horizontally; the sticky header must
remain visible; numbers must not truncate into ellipsis where the full value
matters.

Score | Criteria
:---: | ---
5 | No horizontal overflow; sticky header visible; all figures fully legible.
4 | One minor overflow (< 20 px) or one figure truncates a trailing zero.
3 | Horizontal overflow present but scrollable; no data hidden.
2 | Content is clipped or hidden at 390 px; some figures inaccessible.
1 | Page is unusable at 390 px.

### V5 — Motion restraint
Animations must not play indefinitely, must not obstruct reading, and must
respect prefers-reduced-motion.  Reveal animations must complete before the
user reaches the section (not a persistent spinner).

Score | Criteria
:---: | ---
5 | All animations are one-shot and short (< 400 ms); reduced-motion is respected.
4 | One animation loops briefly (< 2 s) before settling; no obstruction.
3 | One animation is longer than 1 s but eventually settles.
2 | An animation loops indefinitely above a content section, obstructing reading.
1 | Animations prevent reading or fire repeatedly on scroll.

---

## New Dimensions (Phase 5F)

### N1 — Normalized skeleton honesty
**Do rollup-tier program pages feel intentional and honest rather than thin or
broken?  Does the service J-book note clearly explain the data gap?**

The "rollup" tier means R-1 / P-1 workbook figures are present (trajectory,
budget lines) but the service J-book has not been ingested.  A visitor who
lands on a rollup page must come away understanding what they have (cited
figures) and what is absent (narrative prose), without feeling the page is
defective.

Evidence files: `rollup-program-390.png`, `rollup-program-1440.png`,
`rollup-program-1440-full.png`.

Score | Criteria
:---: | ---
5 | Service J-book note is prominently placed in the Description section; its language is plain and informative (not apologetic or legalistic); empty sections carry discrete explained empty states; the trajectory card and budget figures give the page substance even without prose; full-page shot shows all 12 sections with no silent blanks.
4 | Note is present and clear; one empty state is generic rather than specific; the page feels content-rich despite no narrative.
3 | Note is present but buried (below the fold at 1440); or it is present but the wording implies a broken page rather than a data-availability boundary; some empty states are silent.
2 | Note is absent or only present in fine print; several sections are blank without explanation; page feels broken rather than intentionally scoped.
1 | Rollup page is indistinguishable from a broken full-tier page; no explanation of data absence.

### N2 — Narrative receipt fidelity
**Does the paragraph-level citation panel prove the text's origin — passage
highlight legible, location unambiguous?  Is the amber ambiguity note visible
and informative for ambiguous_first passages?**

The jbook-narrative-card renders the PDF page with the passage highlighted.
For `ambiguous_first` passages (multiple paragraphs matched the XML pointer;
only the first is highlighted), an amber badge must appear to tell the user
the match is approximate.

Evidence files: `narrative-panel-1440.png`,
`narrative-panel-ambiguous-1440.png`.

Score | Criteria
:---: | ---
5 | Panel opens within 4 s; PDF page is legible (not blank); passage highlight (yellow rectangle) is visible and positioned over the correct paragraph; for ambiguous_first the amber badge reads clearly and explains the approximation; panel header shows the paragraph title and a link to the official PDF.
4 | Panel renders; highlight is visible but slightly offset (< 1 line); amber badge present for ambiguous case; minor rendering delay (4–8 s).
3 | Panel renders but highlight is absent or invisible; passage location inferred from page number alone; amber badge present but text is truncated.
2 | Panel opens but PDF does not render (blank canvas); highlight missing; ambiguity not flagged.
1 | Panel does not open on narrative chip click; or panel opens to an error state.

### N3 — Linking coherence
**Do PE token links and in-prose dollar Cites read as native features of the
prose, not as spammy decorations?  Are they consistently styled, interactive,
and limited to cases where they add information?**

Phase 5F adds two in-prose linking mechanisms: `data-prose-cite` spans
(clickable dollar amounts that open the citation panel) and PE token `<a>`
links (linked program codes that navigate to the target program page).  Both
must feel integrated — not excessive, not broken.

Evidence files: `prose-cites-1440.png`, `pe-links-1440.png`.

Score | Criteria
:---: | ---
5 | Dollar Cite links are visually distinct from surrounding prose (underline or color) without overwhelming the paragraph; source chip appears cleanly after the paragraph heading; PE token links render as inline hyperlinks without wrapping or overlapping surrounding text; hover states (underline / color shift) work; no more than 3 links per visible paragraph in the capture.
4 | Styling is consistent; one link wraps awkwardly in a narrow column; or the source chip alignment is off by a few pixels.
3 | Links are styled but inconsistently (some underlined, some not); source chip overlaps heading text on one paragraph; or a PE link navigates to a 404.
2 | Dollar Cite spans are not visually distinct from plain text (no underline, no color); or source chip is invisible (color: transparent, opacity: 0).
1 | Links are non-interactive; or prose Cites open wrong panels; or every dollar amount in a paragraph is wrapped as a link regardless of whether it has a backing fact_id.

---

## Scoring Guidance

- Score each dimension independently on the 1–5 scale above.
- **Threshold: median ≥ 4** across all 10 dimensions (D1–D4, V1, V2, V5, N1–N3).
- A score of 1 on any dimension is a blocking defect regardless of median.
- When evidence is ambiguous (e.g. PDF render depends on network), note the
  ambiguity and score conservatively (round down).

## Output format (5C convention)

Report findings as a table:

| Dim | Score | Finding |
|-----|------:|---------|
| D1  |     ? | … |
| D2  |     ? | … |
| D3  |     ? | … |
| D4  |     ? | … |
| V1  |     ? | … |
| V2  |     ? | … |
| V5  |     ? | … |
| N1  |     ? | … |
| N2  |     ? | … |
| N3  |     ? | … |
| **Median** | **?** | |

Then list any blocking defects (score = 1) and recommended fixes.
