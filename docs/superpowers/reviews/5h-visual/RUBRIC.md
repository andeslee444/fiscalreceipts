# Phase 5H Visual Judge Rubric — /flow/ two-river flowdown

Inherits dimensions D1–D4, V1, V2, V5 from the 5C rubric (restated in the 5F
rubric). Adds three new dimensions F1–F3 specific to the Phase 5H flowdown
chart.

Evidence files in this directory:

| File | What it shows |
| --- | --- |
| `flow-1440.png` | Full /flow/ page at 1440 — shell, banner, both rivers |
| `flow-390.png` | Full /flow/ page at 390 — mobile fold + horizontal-scroll chart |
| `flow-1440-competition.png` | Spend river with the competition legend + class-colored ribbons |
| `flow-1440-drilldown.png` | An "Other (N)" node expanded into the drill-down dialog |
| `flow-node-panel-1440.png` | Citation panel opened from a flow node (derived card) |
| `flow-fy-switch-1440.png` | Spend river after switching to a non-default FY |

---

## Inherited Dimensions (score each 1–5, criteria unchanged from 5C/5F)

### D1 — Data fidelity
Every figure on screen must match the cited source value. For /flow/: node
labels must equal the recorded_value of their fact (the G9 gate verifies this
mechanically; the judge verifies the *displayed* rounding does not
misrepresent magnitude), band thicknesses must visibly track values, and the
bridge remainder must read as budget total minus crosswalked total.

### D2 — Coverage honesty
No silent gaps. For /flow/: the "not yet crosswalked" band must be impossible
to miss; the FY2026 partial-year status must be stated at the selector; the
drill-down's "…and N more" line must account for non-itemized members; the
offers note must state that FPDS records no losing-bidder identities.

### D3 — Citation reachability
Every node opens its citation panel in one click (Enter from the keyboard);
edge ribbons open their edge facts; the drill-down offers the node's citation
in ≤ 2 clicks. Panel renders within 4 s on a local static server.

### D4 — Print / export integrity
The /flow/ shell (title, unit statements, coverage note) must print legibly;
panel chrome and tooltips must not leak into print.

### V1 — Visual hierarchy
The two river headings and the experimental banner must establish an
immediate reading order; the FY selector must be findable without hunting;
column headers must label the levels without competing with node labels.

### V2 — Responsive integrity
At 390 px: no page-level horizontal overflow (the chart itself scrolls inside
its own container by design — that is the /years/ precedent, not a defect);
unit statements and the coverage note stay legible; the drill-down dialog
fits the viewport.

### V5 — Motion restraint
FY switches fade once (< 400 ms) and settle; hover transitions are opacity
only; nothing loops; prefers-reduced-motion renders the final frame.

---

## New Dimensions (Phase 5H)

### F1 — Two-river honesty legibility
**Is the budget-vs-spend distinction — and the bridge between them —
unmistakable to a first-time visitor?**

The chart's core honesty claim is that request dollars and obligation dollars
are different measurement systems. A visitor must never read the two rivers
as one continuous flow: units differ (USD thousands vs USD), years differ
(FY2026 request vs selectable FY2017–FY2026), and the only connective tissue
is the explicitly-labeled bridge band, dominated by "not yet crosswalked."

Evidence: `flow-1440.png`, `flow-390.png`.

Score | Criteria
:---: | ---
5 | Rivers read as two separate systems at a glance (distinct palettes, separate labeled sections, per-river unit statements); the bridge band and its "not yet crosswalked" remainder are prominent; the coverage note's percentage matches the visual dominance of the gap band; nothing implies budget dollars flow into contractor dollars.
4 | Distinction clear; one cue is weak (e.g. unit statement present but easy to skim past); bridge still unmistakable.
3 | Rivers are distinguishable on inspection but a hasty reading could conflate them; bridge present but visually underweighted relative to its 98.7% share.
2 | The two rivers look like one system; the bridge reads as a decorative element rather than a coverage statement.
1 | The chart implies request dollars became contract dollars; the gap is hidden or mislabeled.

### F2 — Competition overlay insight
**Does the sole-source story land without editorializing?**

The overlay's job is to make `extent_competed` visible — especially the
share of obligations that never saw competition — using only the data's own
vocabulary. Colors must be distinguishable under color-vision deficiency
(the not-competed class carries a hatch pattern in addition to hue), the
legend must name the four canonical classes, and hover must show the
offers-received distribution without ever implying who lost.

Evidence: `flow-1440-competition.png`, `flow-fy-switch-1440.png`.

Score | Criteria
:---: | ---
5 | Class colors + hatch are immediately readable and match the legend; the not-competed share is visually discoverable without any editorial labeling; tooltips show class and offers breakdowns with honest shares; negative de-obligation hairlines are explained in the legend; switching FY visibly re-tells the story for that year.
4 | Overlay readable; one legend entry or tooltip row is ambiguous; no editorializing.
3 | Colors legible but the hatch/colorblind backup is missing or invisible at chart scale; or tooltips omit the offers distribution.
2 | Classes are hard to tell apart; legend and ribbons disagree; or copy editorializes ("wasteful sole-sourcing").
1 | Overlay is decorative noise — colors carry no discoverable meaning, or the chart implies losing-bidder knowledge that FPDS does not contain.

### F3 — Sankey craftsmanship
**Does it read professional vs toy?**

The layout is precomputed and verified; what the judge scores is the render:
ribbon curvature, band-to-node registration, label collision handling, the
Other-node drill-down affordance, and the overall sense that this is an
instrument, not a demo.

Evidence: all six screenshots.

Score | Criteria
:---: | ---
5 | Ribbons join their nodes exactly (no gaps/overshoot); thin nodes remain clickable and labeled or gracefully unlabeled; no label collisions at 1440; drill-down and citation panels feel native to the site's design system; column headers, tooltips, and dialogs share one typographic voice.
4 | One minor registration or label-crowding issue that does not impair reading.
3 | Several labels collide or thin bands render with visible artifacts; interactions work but feel bolted on.
2 | Ribbons visibly misregister with nodes; labels unreadable at default zoom; dialogs clash with the design system.
1 | The chart reads as a wireframe or broken prototype.

---

## Scoring Guidance

- Score each dimension independently on the 1–5 scale above.
- **Threshold: median ≥ 4** across all 10 dimensions (D1–D4, V1, V2, V5, F1–F3).
- A score of 1 on any dimension is a blocking defect regardless of median.
- When evidence is ambiguous (e.g. hover-only states a static capture cannot
  show), note the ambiguity and score conservatively (round down).

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
| F1  |     ? | … |
| F2  |     ? | … |
| F3  |     ? | … |
| **Median** | **?** | |

Then list any blocking defects (score = 1) and recommended fixes.
