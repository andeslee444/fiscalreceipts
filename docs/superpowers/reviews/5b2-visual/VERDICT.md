# 5B-2 Visual Gate Verdict

**Round 1 (2026-06-12):** FAIL — medians {layout 2, readability 3, data 2, trust 3}.
Blockers: (1) state-C "uncited" flag rendered doubled/overlapping on every flagged
figure (CSS `after:content` + React child both active); (2) mobile nav did not
collapse at 390px. Fixed in commit 35bb7b0.

**Round 2 (2026-06-12):** PASS — medians {layout 5, readability 5, data 5, trust 5},
zero blockers across 3 independent opus vision judges (product-designer,
journalist-reader, a11y/typography personas; 18 screenshots = 6 states × 3 viewports).

Judge highlights: citation drawer "best-in-class provenance UX… exemplary provenance
for a citing journalist"; company-page non-additive callout "outstanding editorial
honesty that prevents a wrong total"; overall "ship-proud."

Non-blocking nits recorded for backlog: em-dash placeholder for missing FY25 figures
could read as a styling gap; company header chip density at 390px; below-fold mobile
table scrolling unobserved in viewport crops.
