# Phase 5 Product Vision — Interactive Program Explorer

**Date:** 2026-06-10 · **Status:** User-directed vision capture (pre-spec)
**Supersedes** the minimal "dashboard + text-to-SQL" Phase 5 sketch in the phase-gates doc — gates there still apply; the surface grows.

## User direction (verbatim intent)

Highly interactive web interface with animations and online research on the programs.
Example: the DoD budget line for Loitering Munitions opens a breakdown — types of
drones, drones in combat, drone animations (animations for the top 50 programs),
associated news articles, links to the companies that won the award, bidders, and a
timeline.

## What the warehouse already enables (no new ingestion)

- **Program dossier skeletons:** every PE carries mission descriptions +
  accomplishments/plans narratives (already extracted, cited to XML paths) — the
  editorial backbone of each program page.
- **Money-flow visuals:** appropriation → PE → project → contract → prime → subaward
  → entity family → state/district. Sankey/particle-flow animations straight from
  fct_budget_to_awards + subawards + dim_geography.
- **Timelines:** budget trajectory (FY2024→FY2026 per PE), contract action history
  (transaction-level mods + deobligations), GAO high-risk/improper-payment overlays.
- **Competition signal:** FPDS carries `number_of_offers_received` + competition type
  per award → competed-vs-sole-source health per program. HONESTY NOTE: FPDS does
  NOT name losing bidders — only counts. True bidder lists exist only prospectively
  via SAM.gov opportunity notices (future enrichment). The UI must say "N offers
  received," never invent bidder identities.
- **Comparisons:** CA↔CT per-capita comparables; program-vs-program; entity families.

## New build: research-enrichment pipeline (the first sanctioned heavy LLM use)

Per-program dossiers for the top 50 programs by FY2026 request:
- Web research (search APIs / curated defense-press RSS: news articles, agency
  program pages, company releases) → cached snapshots with URL + retrieved-at.
- Claude Batch synthesis into dossier sections (what it is, why it matters, players,
  recent developments) where EVERY claim cites either a warehouse fact (provenance
  id) or a fetched URL. Dossier citation gate joins verify-phase5.
- Category → animation mapping (loitering munitions → drone swarm motif; hypersonics
  → trajectory; space → constellation; shipbuilding → hull assembly; cyber → network)
  driving per-category hero animations (Lottie/Canvas/react-three-fiber).

## Candidate "super interesting" additions (brainstormed, for user selection)

1. Follow-the-dollar story mode: animated journey of $1 of appropriation through
   program → contract → company → congressional district.
2. Anomaly/insight feed: auto-surfaced cards — biggest YoY swings, programs zeroed in
   FY2026, concentration spikes, new entrants winning big, deobligation storms — each
   card backed by a warehouse query + citation.
3. District lens: "where the money lands" choropleth by congressional district with
   per-district program lists ("your district builds the SM-6 seeker").
4. Vendor family network: interactive entity graph (Boeing's 89 UEIs, JVs like
   Bell-Boeing kept distinct), expandable to subaward supply chains.
5. Competition health meter per program: offers received, sole-source share,
   incumbent tenure.
6. Book-diff "what changed this cycle": PB-to-PB new starts/cancellations/renames
   (needs historical book backfill — schema already supports).
7. Program genealogy timeline: budget lines + awards + GAO findings + news on one
   scrubber.
8. Risk overlays: GAO high-risk badges + improper-payment exposure on agency/program
   surfaces.
9. Public scorecard permalinks: shareable, statically-rendered program cards (social
   preview images generated from the dossier).
10. "Receipts" mode: every number on screen flips to its citation chain on hover —
    the provenance ethos as UI.

## Standing constraints carried into Phase 5

Cited-or-absent rule for all LLM-generated dossier text; no invented bidders;
animations decorate real data, never substitute for it; verify-phase5 evals
(≥90% NL-question accuracy, 100% citation resolution) still gate the merge.

## Influence layer (user direction, 2026-06-10): lobbying → benefits

Track lobbying by companies and persons and link to the government funding benefits
they receive. Sources + linkage (probed live):

- **Senate LDA API** (lda.senate.gov/api/v1) — works anonymously (rate-limited),
  108,620 filings for 2025, JSON with permanent filing UUIDs (citation-perfect).
  Fields: registrant (lobbying firm), client (company), income/expense amounts,
  lobbyist NAMES with covered government positions (statutory revolving-door
  disclosure), issue codes (DEF/BUD/APP...), agencies lobbied, specific-issue text
  (frequently names programs — a text crosswalk to PEs).
- **House disclosures** (disclosures.house.gov XML bulk) — corroboration source.
- **FEC** later (bulk files keyless): contributions → defense-committee members →
  the `CongressionalAddDetail` elements ALREADY in our J-book XML → contractor
  benefits. The full chain: money in → marks added → money out.

Linkage plan: LDA client names → entity_xwalk families via the Phase-2 normalizer;
influence mart per (family, year): lobbying_spend vs obligations_received vs
congressional adds; lobbyist-person table with covered-position flags. UI: lobbying
panel on program + company dossiers; revolving-door badges.

**Honesty constraints:** present influence ALONGSIDE outcomes — never as causal
claims ("lobbied $X while receiving $Y" with both cited; no "because"). Every figure
cites a filing UUID or warehouse fact. Persons receive no awards — benefits attach
to clients; persons appear as registered lobbyists with disclosed prior positions
only (no speculation about individuals).

## Phase 5 structure (revised)

- **5A Influence layer:** LDA ingestion + entity linkage + influence marts +
  verify-phase5a gates (filing provenance 100%, ≥80% of top-50 defense families
  matched to LDA clients, influence mart non-empty with citations).
- **5B Product surface:** Next.js app — program dossiers (top 50 w/ category
  animations + research enrichment), receipts mode, anomaly feed, district lens,
  follow-the-dollar, competition health, vendor network, risk overlays, shareable
  cards, influence panels. verify-phase5 evals: ≥90% NL accuracy, 100% citation
  resolution, dossier cited-or-absent gate.

## Citation deep-links (user requirement, 2026-06-10): click a number → the PDF line

Every rendered number must click through to the exact source location. Feasibility
verified live: PE 0601101E's 280.494 locates deterministically on page 24 of the
387-page DARPA book via pypdf text-layer search (J-book XML TOC only maps volumes,
so page resolution = text-anchor search: PE/BLI anchor + exact amount string).

Architecture (Phase 5B):
- **provenance_pages builder:** one pass per source PDF → (document_id, pe_bli,
  scenario, amount) → page number (+ word bounding box via PyMuPDF for highlight
  rects). Cached table; rebuilt only when a document sha changes.
- **Citation resolver API:** fact_id → { hosted_pdf_url#page=N, official_url
  (comptroller.war.gov) #page=N, bbox, sha256, xml_path, retrieved_at }.
- **Viewer UX:** click number → side-panel PDF.js opened AT the page with the line
  highlighted; "open official source" link beside it. We host sha-verified copies
  (official URLs can rot) while always co-citing the official URL.
- **Source-tier honesty** (every number gets its native best citation):
  J-book figures → PDF page deep-link + highlight; R-1/P-1 figures → workbook,
  sheet + cell (rendered preview) — the source IS xlsx, not PDF; USAspending →
  dataset + reproducible query permalink; LDA → filing UUID URL; state checkbook →
  SoQL/source URL; derived metrics → formula + links to every input's citation.
- **New verify-phase5 gate (click-through):** sample 50 rendered numbers per build;
  mechanically resolve each citation and assert the cited page/cell/payload actually
  contains the amount string. 100% required — a number whose citation fails to
  resolve does not render.
