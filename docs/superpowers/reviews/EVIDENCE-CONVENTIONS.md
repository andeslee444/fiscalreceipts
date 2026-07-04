# Visual-evidence pack conventions (RUBRIC authoring)

Each judged phase ships an evidence pack under `reviews/<phase>-visual/`:
a `RUBRIC.md` that names its scoring dimensions and an evidence-file table,
plus the referenced captures (produced by the phase's
`site/scripts/capture-<phase>-visuals.mjs`).

## Required captures (all packs)

For every judged page, in addition to whatever page-specific captures the
rubric's dimensions call for:

1. **Desktop and mobile** — 1440 and 390 viewports (established practice
   since 5C; listed here so it is a rule, not a habit).
2. **Print-emulated capture** — Playwright
   `page.emulateMedia({ media: "print" })` before the screenshot. Every
   rubric carries a D4 print/export-integrity dimension; the judge must
   score it from evidence, not from the screen captures alone.
3. **Reduced-motion capture** — `page.emulateMedia({ reducedMotion:
   "reduce" })` before the screenshot. The motion contract (G7/G12:
   token-driven, collapses to the FINAL frame under
   prefers-reduced-motion) is judged visually; a capture proves animated
   surfaces settle rather than freeze mid-flight or vanish.

Name the files with the emulation in the suffix, and list them in the
rubric's evidence table like any other capture:

```
<page>-1440-print.png
<page>-1440-reduced-motion.png
```

Origin: judge advisories from 5H (2026-07-02, recorded in ROADMAP backlog
#21) — D4 and motion claims were previously scored from default captures
only. Applies to packs authored from 2026-07-03 onward; earlier packs are
grandfathered as shipped.
