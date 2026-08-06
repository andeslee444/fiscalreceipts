import "server-only";

/**
 * coverage-map.ts — the /coverage/ manifest (PM Sprint 3 Task 6, §Coverage).
 *
 * "The honesty is right, the roadmap is missing." Every coverage gap on this
 * site is disclosed at the point of use — and a visitor still cannot tell
 * "early, moving fast" from "abandoned at 1%". This module is the answer:
 * for each surface, what it covers TODAY, the SPECIFIC thing standing in the
 * way, and a DATED target (or an honest statement of why there is no date).
 *
 * THE ONE RULE. Every number here is read from a shipped artifact — §P1-5,
 * and on this page of all pages it is not negotiable. A hardcoded count on the
 * page that publishes the site's coverage would be self-refuting the first
 * time the corpus moved. So: `covered` strings are assembled from the data.ts
 * / feeds.ts loaders, `numerator` and `denominator` carry the same values as
 * machine-readable attributes, and gate 14's coverage-map leg recomputes all
 * of them from the sidecars and the built HTML.
 *
 * Numbers that cannot be derived at export time are OMITTED rather than
 * authored — the precedent /methodology/ §3 already set for the pytest and
 * vitest totals. One is omitted here for the same reason and named in the
 * page's own "what is not on this page" note: the share of award dollars whose
 * recipient resolves to a corporate family (the entity crosswalk's own
 * coverage). It is a warehouse query, not a sidecar, so the page does not
 * state it rather than shipping a literal that would rot.
 *
 * BLOCKERS AND TARGETS ARE PROSE, and prose is authored — that is the point of
 * them. What the gate enforces is that they EXIST, that a dated target names a
 * month and a year, and that an undated one says so in as many words.
 *
 * TARGET POLICY (Sprint 3 round 3 — the site owner's decision). The first cut
 * of this page shipped eight dated targets that nobody outside the build had
 * committed to. The owner reviewed them and decided the page ships with the
 * targets UNDATED: publishing a date the project has not agreed to is the same
 * class of defect as publishing a figure it cannot recompute, and this is the
 * page least able to afford either. So every row now states that there is no
 * dated target AND names the work that is planned and what would move it —
 * "undated pending a roadmap decision", never "undated because nobody knows".
 * The BLOCKERS are untouched: they are the page's value, and none was dropped.
 * A dated target remains legal in this vocabulary (targetKind "dated"); adding
 * one back is a deliberate act that has to name a month and a year.
 */

import {
  getCompaniesCount,
  getCompaniesWithAwardsCount,
  getDecadeEditions,
  getDetailGradeCount,
  getDistrictsCount,
  getDossierCount,
  getFilingsCount,
  getFlowChartMeta,
  getFlowsCount,
  getLineagePrograms,
  getProgramPagesCount,
  getProgramsCount,
  getSiteMeta,
} from "@/lib/data";
import { getFeedInventory } from "@/lib/feeds";
import { formatCount } from "@/lib/format";

/** Rows, in the order the page renders them. */
export const COVERAGE_MAP_IDS = [
  "program-pages",
  "editions",
  "dossiers",
  "lineage",
  "flows",
  "bridge",
  "company-awards",
  "awards-window",
  "districts",
  "state-ca",
  "feeds",
  "filings",
] as const;

export type CoverageMapId = (typeof COVERAGE_MAP_IDS)[number];

/**
 * The row whose blocker IS the methodology limit — the crosswalk gap. Named
 * so the page, the tests and the gate all point at the same row rather than
 * three copies of the string "bridge".
 */
export const CROSSWALK_LIMIT_ID: CoverageMapId = "bridge";

/** "dated" → target names a month and a year. "none" → and says why not. */
export type CoverageTargetKind = "dated" | "none";

export interface CoverageMapRow {
  id: CoverageMapId;
  /** What the row is about, in the reader's words. */
  label: string;
  /** The surface this row describes. */
  href: string;
  /** Machine-readable ratio, or null where the row is not a ratio. */
  numerator: number | null;
  denominator: number | null;
  /** The rendered coverage sentence — every figure interpolated. */
  covered: string;
  /** Which shipped artifact those figures were read from. */
  derivation: string;
  /** The specific thing in the way. Never "not done yet". */
  blocker: string;
  targetKind: CoverageTargetKind;
  /** A dated target, or the reason there is not one. */
  target: string;
}

/**
 * The date this map was last reviewed — rendered so a stale page is visible.
 * (Was TARGETS_SET_ON; the targets are undated now, but the review date is
 * exactly the thing a reader needs to judge whether the map is current.)
 */
export const MAP_REVIEWED_ON = "2026-08-05";

export function getCoverageMap(): CoverageMapRow[] {
  const programs = getProgramsCount();
  const pages = getProgramPagesCount();
  // Backlog #35: the detail-grade tier is the sidecars that carry J-book
  // detail rows (= dim_programs), NOT programs.json's length — the index also
  // lists trajectory-only lines. This page LEADS with this number, so it is
  // the worst possible place for the site to be two generous about itself.
  const detailGrade = getDetailGradeCount();
  const rollups = pages - detailGrade;
  const editions = getDecadeEditions();
  const bridge = getFlowChartMeta().bridge;
  const budgetFy = getFlowChartMeta().budgetFy;
  const awardWindow = getSiteMeta().award_fy_range;
  const feeds = getFeedInventory();

  const rows: CoverageMapRow[] = [
    {
      id: "program-pages",
      label: "Program pages",
      href: "/programs/",
      numerator: detailGrade,
      denominator: pages,
      covered:
        `${formatCount(detailGrade)} of ${formatCount(pages)} program pages carry ` +
        `detail-grade J-book justification; the other ${formatCount(rollups)} ` +
        `carry cited R-1/P-1 workbook figures only.`,
      derivation:
        "program_details sidecars holding at least one J-book detail row, over every sidecar this build shipped.",
      blocker:
        `The ${formatCount(rollups)} remaining pages are rollup lines for which ` +
        "the services publish no matching R-2/P-40 justification — classified " +
        "programs, SBIR/STTR set-asides, and spectrum-relocation lines. Their " +
        "figures are cited to the workbook, but there is no narrative document " +
        "to ingest: this is a limit of what the Department publishes, not of " +
        "what we have loaded.",
      targetKind: "none",
      target:
        "No dated target — the missing volumes do not exist publicly. If a " +
        "service releases withheld justification, it lands in the next " +
        "ingestion run and this number moves on its own.",
    },
    {
      id: "editions",
      label: "President's Budget editions",
      href: "/years/",
      numerator: editions.length,
      denominator: null,
      covered:
        `${formatCount(editions.length)} editions loaded — ` +
        `PB${editions[0]}–PB${editions[editions.length - 1]}. Actuals for ` +
        "fiscal year N are read from the PB(N+2) book, and every column on the " +
        "decade matrix states its edition.",
      derivation:
        "distinct edition stamps on years_matrix.json's decade columns — the same columns /years/ renders.",
      blocker:
        "Each earlier edition is manual work rather than a rerun: the older " +
        "books publish consolidated volumes under unstable file naming, so " +
        "every edition needs its own evidence-keyed volume classification " +
        "before its lines can be trusted next to the modern ones. Two editions " +
        "were nearly published with the wrong volumes before that rule existed.",
      targetKind: "none",
      target:
        "No dated target yet — PB2015 and PB2016 are the next two editions " +
        "queued, and the date is pending a roadmap decision rather than " +
        "unknown. An edition ships only once its volumes are evidence-keyed — " +
        "never on a filename pattern — so the date follows that work, not the " +
        "other way round.",
    },
    {
      id: "dossiers",
      label: "Research dossiers",
      href: "/programs/",
      numerator: getDossierCount(),
      denominator: programs,
      covered: `${formatCount(getDossierCount())} of ${formatCount(programs)} programs have a research dossier.`,
      derivation: "dossier sidecars over programs.json rows.",
      blocker:
        "Dossiers are generated in metered batches under a per-run cost cap, " +
        "and every claim in one must resolve to a citation before it is " +
        "published — a dossier whose citations do not resolve is dropped, not " +
        "published with a caveat. Throughput is bounded by that budget and " +
        "that gate, not by the availability of source material.",
      targetKind: "none",
      target:
        "No dated target yet — the next batches are queued and will be taken " +
        "in order of FY2026 requested dollars, so the largest lines are " +
        "covered first. How many land by when is pending a roadmap decision; " +
        "the order is already fixed.",
    },
    {
      id: "lineage",
      label: "Program lineage",
      href: "/programs/",
      numerator: getLineagePrograms(),
      denominator: programs,
      covered:
        `${formatCount(getLineagePrograms())} of ${formatCount(programs)} programs ` +
        "carry a lineage rail — where the money went when a program element was " +
        "renumbered, realigned or transferred.",
      derivation:
        "program_details sidecars carrying a non-empty lineage rail, over programs.json rows.",
      blocker:
        "An edge is asserted only where a justification narrative names BOTH " +
        "endpoints in a sentence we can quote back. “Realigned to PE " +
        "0604818A” is usable; “realigned to another program element” " +
        "is not, and most renumberings are written the second way. Candidate " +
        "edges found by maturation patterns are shown dashed and are never cited.",
      targetKind: "none",
      target:
        "No dated target yet — narrative extraction across the whole FY2026 " +
        "set is the planned next step and its date is pending a roadmap " +
        "decision. Whenever it runs, anything it finds stays in the candidate " +
        "tier until a quotable sentence names both ends.",
    },
    {
      id: "flows",
      label: "Follow-the-dollar",
      href: "/flow/",
      numerator: getFlowsCount(),
      denominator: programs,
      covered: `${formatCount(getFlowsCount())} of ${formatCount(programs)} programs have a follow-the-dollar view.`,
      derivation: "flow sidecars over programs.json rows.",
      blocker:
        "The budget→award crosswalk, one row below. A program earns this " +
        "view only where its awards can be tied to it by something firmer than " +
        "an account code, and for almost every program they cannot be.",
      targetKind: "none",
      target:
        "No dated target — this number moves when the crosswalk moves, and the " +
        "crosswalk is a methodology limit rather than a queue.",
    },
    {
      id: "bridge",
      label: "Budget→award crosswalk",
      href: "/flow/#bridge",
      numerator: bridge.crosswalkedPeCount,
      denominator: bridge.universePeCount,
      covered:
        `${formatCount(bridge.crosswalkedPeCount)} of ` +
        `${formatCount(bridge.universePeCount)} crosswalked program elements ` +
        `carry FY${budgetFy} request dollars ` +
        `(${formatCount(bridge.highConfidencePeCount)} at high confidence) — ` +
        `${bridge.pctNotCrosswalked}% of the FY${budgetFy} request is not bridged to an award.`,
      derivation:
        "the bridge band of flow_chart.json: crosswalked and universe PE counts, and the unbridged share of the request.",
      blocker:
        "Account codes are too coarse to attribute awards to program elements " +
        "outside DARPA's structure. An award record carries a Treasury account " +
        "and an appropriation; one appropriation account funds dozens to " +
        "hundreds of program elements, and nothing else on the record narrows " +
        "it. DARPA is the exception because its program elements line up almost " +
        "one-to-one with its offices, so its account codes do resolve. " +
        "Everywhere else, asserting a link would mean guessing which of an " +
        "account's program elements paid — and a guess wearing a citation " +
        "is worse than an honest absence.",
      targetKind: "none",
      target:
        "No dated target, because this is a methodology limit and not a backlog " +
        "item. It closes if a source begins publishing the program element on " +
        "the award record. Until then the unbridged share is stated outright, " +
        "so nobody has to reverse-engineer it from what the chart omits.",
    },
    {
      id: "company-awards",
      label: "Company award linkage",
      href: "/companies/",
      numerator: getCompaniesWithAwardsCount(),
      denominator: getCompaniesCount(),
      covered:
        `${formatCount(getCompaniesWithAwardsCount())} of ` +
        `${formatCount(getCompaniesCount())} profiled companies show at least ` +
        "one award linked to a named budget line.",
      derivation:
        "entity_details sidecars carrying a non-empty awards array, over entities_top.json rows.",
      blocker:
        "The same crosswalk limit, seen from the company side. Each profiled " +
        "company's obligations total is complete over the award window; what is " +
        "partial is the link from those obligations to a named budget line.",
      targetKind: "none",
      target:
        "No dated target — this is the crosswalk limit above, counted per " +
        "company rather than per program element.",
    },
    {
      id: "awards-window",
      label: "Award obligations window",
      href: "/companies/",
      numerator: null,
      denominator: null,
      covered:
        `${awardWindow?.label ?? "not stated"} contract and assistance ` +
        `obligations${awardWindow?.latest_action_date ? `, through ${awardWindow.latest_action_date}` : ""}` +
        `${awardWindow?.max_partial ? `. FY${awardWindow.fy_max} is a partial year` : ""}.`,
      derivation:
        "site_meta.award_fy_range, computed from the award transaction lake at export time.",
      blocker:
        "The newest fiscal year is always incomplete: USAspending publishes on " +
        "a rolling basis and the federal year does not close until 30 " +
        "September. Years before the window's start sit outside the transaction " +
        "archive we ingest.",
      targetKind: "none",
      target:
        "No dated target, and none would mean anything here: this window is " +
        "refreshed on every ingestion run rather than on a schedule. The " +
        "newest fiscal year stops moving once the federal year has closed and " +
        "USAspending has finished publishing against it.",
    },
    {
      id: "districts",
      label: "Congressional districts",
      href: "/district/",
      numerator: getDistrictsCount(),
      denominator: 435,
      covered: `${formatCount(getDistrictsCount())} of ${formatCount(435)} congressional districts have linked defense dollars.`,
      derivation: "districts/index.json rows over the 435 seats of the House.",
      blocker:
        "A district appears only where an award's place of performance resolves " +
        "to a numbered district. A large share of defense obligations is " +
        "recorded against statewide or undistricted codes (00, 90, 98, 99), and " +
        "those cannot be split across a state's seats without inventing a " +
        "distribution nobody could check.",
      targetKind: "none",
      target:
        "No dated target yet — the planned fix is to publish the statewide " +
        "residual as its own row per state, so the dollars that cannot be " +
        "districted are visible instead of missing. The work is scoped; its " +
        "date is pending a roadmap decision.",
    },
    {
      id: "state-ca",
      label: "State spending",
      href: "/data/",
      numerator: null,
      denominator: null,
      covered: "California only, FY2025 only.",
      derivation:
        "the scope of the fct_state_per_capita dataset shipped on /data/.",
      blocker:
        "CA Open Fi$Cal publishes on a lag and restates prior years in place, " +
        "so each earlier year needs its own reconciliation against the restated " +
        "totals before it can sit beside a federal figure. Every other state is " +
        "a separate portal with its own schema — there is no shared source.",
      targetKind: "none",
      target:
        "No dated target yet — California FY2023 and FY2024 are the planned " +
        "next step, pending a roadmap decision on when the reconciliation " +
        "work is scheduled. No second state is queued behind them, and none " +
        "will be announced before its portal is ingested.",
    },
    {
      id: "feeds",
      label: "Syndication feeds",
      href: "/feed/",
      numerator: feeds.programFeeds + feeds.companyFeeds,
      denominator: null,
      covered:
        `${formatCount(feeds.items)} items across ` +
        `${formatCount(feeds.eventTypes)} event types, plus ` +
        `${formatCount(feeds.programFeeds)} program and ` +
        `${formatCount(feeds.companyFeeds)} company watch feeds.`,
      derivation:
        "feed.json's cards, and the RSS files under public/feeds/ that this build wrote.",
      blocker:
        "A watch feed is written only where the program or company actually has " +
        "events; the rest would be permanently empty subscriptions advertised " +
        "as live ones. So feed coverage is event coverage, and a new event type " +
        "cannot ship until its threshold is published and gated.",
      targetKind: "none",
      target:
        "No dated target yet — two further event types are planned, protest " +
        "outcomes and GAO high-risk transitions, each with its threshold " +
        "published before its first card. Which build carries them is pending " +
        "a roadmap decision.",
    },
    {
      id: "filings",
      label: "Lobbying filings",
      href: "/filings/",
      numerator: getFilingsCount(),
      denominator: null,
      covered: `${formatCount(getFilingsCount())} Senate LDA filings indexed, with program mentions extracted.`,
      derivation: "filings_index.json's total.",
      blocker:
        "Filings are matched to programs by name and alias, and LDA activity " +
        "descriptions usually name a platform or a service rather than a budget " +
        "line. A mention is published only where a tracked alias matches; a " +
        "description naming only “the Navy” produces none, which is " +
        "the honest result rather than a miss.",
      targetKind: "none",
      target:
        "No dated target yet — extending alias coverage across the whole " +
        "detail-grade corpus is planned, with each new alias recorded in the " +
        "alias table rather than inferred at match time. The date is pending " +
        "a roadmap decision; the rule it has to follow is not.",
    },
  ];

  return rows;
}
