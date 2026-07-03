# Phase 5F — Program Page Normalization, Universal Linking, Narrative Provenance

**Date:** 2026-07-02
**Status:** Approved (user directives: PE/project mentions hyperlinked to official
descriptions with pages created where missing; prose dollar values cited; narrative
citation chips must point at the cited paragraph, not unrelated numbers; all program
pages normalized to the same sections)
**Sequenced:** after Phase 5D ships (shared exporter surface). Informs/joined by the
service-J-books feasibility spike (2026-07-02-service-jbooks-feasibility.md).

## 1. Problems being fixed (diagnosed)

1. **Narrative chips mis-target.** Narrative paragraphs carry honest citations
   (fact_id + xml anchor + source book) but `provenance_pages` only ever resolved
   *amounts* to PDF page+bbox — never prose. Clicking a paragraph chip opens the book
   with no paragraph highlight and surfaces amount-shaped metadata that isn't in the
   paragraph.
2. **~1,533 of 1,995 PEs have no page** (462 exist). Most are Army/Navy/AF PEs whose
   numbers come from the all-service R-1/P-1 workbooks while their narrative books
   (service comptroller sites) were never ingested — hence pages like 0604015F with
   numbers but no description.
3. **PE/project mentions are inconsistently linked** across narratives, dossiers,
   breakdowns, mentions lists.
4. **Prose dollar figures are uncited** inside descriptions.
5. **Section structure varies page-to-page.**

## 2. Design

### 2a. Pages for all 1,995 PEs + universal mention linking
- Exporter emits program sidecars for **every distinct PE in budget_lines** (1,995).
  Tiers: full (R-2/P-40 details — the 326), rollup (R-1/P-1 numbers + trajectory —
  everything else). Rollup pages state honestly: *"Detailed justification for this
  program lives in the {service} J-book, which is not yet ingested — see roadmap."*
  (wording auto-adjusts when the service spike → ingestion lands).
- **Universal linker**: one shared resolver (`site/src/lib/pe-link.ts` + exporter
  equivalent) turns any PE-shaped token with a page into an internal link. Applied to:
  narrative bodies (PE references inside prose), dossier claims, breakdown rows,
  mentions lists, feed, matrix rows, analyst-visible surfaces. Project references link
  to `/program/{pe}#project-{n}` anchors.
- **G1 linkgraph new leg (f):** on sampled pages, every PE-shaped string that has a
  page must be an `<a>`; proof-can-fail recorded.
- SEO: rollup-tier pages are indexable (they carry real cited figures); pages whose
  only content is a single zero line get `noindex` (same policy as zero-mention
  filings).

### 2b. Narrative paragraph provenance (fixes complaint #1)
- Extend the provenance builder: for each narrative fact, locate the paragraph's
  distinctive opening text (first ~12 words, whitespace-normalized) in its book via
  the existing pdfplumber machinery → page + bbox of the passage start. Store alongside
  amount provenance (same table, `target_kind='narrative'`).
- jbook_narrative citations gain page+bbox; the panel renders the **narrative card
  like the PDF card**: page render, passage highlight, "open official source at
  p.N". Unresolvable paragraphs (OCR-hostile layouts) keep the current card with the
  ambiguity flag — never fake a location.
- verify-phase5b1 gains a narrative re-derivation sample (N=25, opening text must
  appear on the cited page) — proof-can-fail first.

### 2c. Cited dollar figures in prose (deterministic only)
- Exporter pass over narrative bodies: a dollar token in prose becomes a state-A Cite
  **only** when it exactly matches (canonical normalization) a fact amount scoped to
  the same PE (details, budget_lines, trajectory). No fuzzy matching — a wrong receipt
  is worse than none; unmatched tokens stay plain prose (still inside the
  data-source-text exemption).
- Render-static (a0) contract unchanged; matched tokens carry their fact_id.

### 2d. Normalized section skeleton
- Every program page renders the same ordered sections, each with `data-section`:
  **Answer strip · Budget figures · Trajectory · Description (mission) ·
  Justification (accomplishments/plans) · Line items · Follow-the-dollar · Awards ·
  Lobbying mentions · Oversight · Dossier · Primary sources**.
- Sections without data render the established honest empty state (one quiet line +
  "why →" methodology link) — never silently absent.
- **New gate leg (program-skeleton):** sampled pages from both tiers render all
  `data-section` markers in canonical order; empty states carry explanations.

## 3. Verification
- New/extended gate legs above, each with recorded pre-failure.
- Full suite + visual judging round (program pages both tiers at 3 widths; judges
  check: does a rollup-tier page feel honest rather than broken?).
- Live pass: narrative chip click lands on the highlighted paragraph in production.

## 4. Non-goals
- Service J-book ingestion itself (separate GO/NO-GO from the spike — likely Phase 5G).
- LLM-written descriptions for rollup-tier pages (dossier pipeline exists for that,
  cited-or-absent; expanding it is a cost decision, not part of 5F).
