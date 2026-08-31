import "server-only";

/**
 * Build-time (server-only) data loaders for GovBudget site.
 * Reads JSON sidecars from ../data/site/json/ relative to the repo root.
 * Throws with clear messages if files are missing or schema_version !== 1.
 *
 * All exports are cached via module-level memo (loaded once per build process).
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

import {
  parseDossier,
  validateDossierCitations,
  type DossierFile,
  type SnapshotMeta,
} from "./dossier";
import type { FamilyEventsPayload } from "./entity-families";
import { pctNotCrosswalked, type FlowChartPayload } from "./flow";
import { isZeroContentDetails, setIngestedServiceOrgs } from "./program-tier";
import type { LineageBlock } from "./lineage";
import type { LineageFlowPayload } from "./lineage-flow";

// ── Path helpers ────────────────────────────────────────────────────────────

function jsonDir(): string {
  // process.cwd() is the site/ directory during next build
  return join(process.cwd(), "..", "data", "site", "json");
}

function readJson<T>(relPath: string): T {
  const full = join(jsonDir(), relPath);
  try {
    return JSON.parse(readFileSync(full, "utf8")) as T;
  } catch (err) {
    throw new Error(
      `[govbudget/data] Failed to read ${full} — run "uv run python -m govbudget export-site" first. (${String(err)})`,
    );
  }
}

// ── site_meta ────────────────────────────────────────────────────────────────

export interface SiteMetaCounts {
  agencies: number;
  citations: number;
  companies: number;
  /** Detail-grade tier — programs.json length (R-2/P-40 J-book data). */
  programs: number;
  /**
   * PM Sprint 2 (§P1-5): the FULL browsable universe — every program_details
   * sidecar (full tier + rollup tier). Absent on pre-Sprint-2 exports; the
   * corpus module falls back to counting the sidecar directory.
   */
  program_pages?: number;
}

/**
 * PM Sprint 2 (§P1-6): the DERIVED period every USAspending aggregate covers,
 * computed at export from fct_award_transactions. Absent on pre-Sprint-2
 * exports (and on degenerate exports with no awards mart) — surfaces render no
 * range at all rather than a guessed one.
 */
export interface SiteMetaAwardFyRange {
  fy_min: number;
  fy_max: number;
  /** Canonical wording, e.g. "FY2017–FY2026" (en dash). */
  label: string;
  /** Newest ingested action_date (ISO), or null when unknown. */
  latest_action_date: string | null;
  /** True when fy_max's latest action predates its September 30 close. */
  max_partial: boolean;
}

export interface SiteMeta {
  award_fy_range?: SiteMetaAwardFyRange | null;
  built_at: string;
  counts: SiteMetaCounts;
  /**
   * Org codes (details.service_org / budget_lines.organization space) whose
   * FY2026 J-book is loaded — data-derived single source of truth for the
   * rollup-note wording (program-tier.isIngestedServiceOrg). Injected into
   * program-tier via setIngestedServiceOrgs by getSiteMeta below.
   */
  ingested_service_orgs?: string[];
  /** Per-dataset row counts keyed by dataset name (e.g. "citations", "jbook_details"). */
  datasets?: Record<string, number>;
  /** Number of J-book PDFs copied into the site bundle (from manifest.pdf_count). */
  pdf_count?: number;
  /** Number of workbook (Excel) files copied into the site bundle. */
  workbook_count?: number;
  pdf_base_url: string;
  schema_version: number;
  skipped_unresolved: number;
  skipped_zero_amount: number;
  uncited_datasets: string[];
  /**
   * PM Sprint 1 (§P0-5): the canonical-TOA homepage hero — largest FY2024
   * actuals on the Total Obligation Authority basis, with its workbook fact
   * and the corpus scope qualifier. Absent on pre-Sprint-1 exports.
   */
  hero?: SiteMetaHero;
  /** §P0-5 corpus scope qualifier (also on hero + feed sidecars). */
  scope_qualifier?: string;
  /**
   * §P1-5 bare scope caveat — the tail of scope_qualifier, shared with the
   * canonical corpus statement so hero and corpus wording cannot drift.
   */
  corpus_scope?: string;
  /**
   * §P1-5 per-build check counts, DERIVED at export from the artifacts that
   * define them (dbt's compiled manifest, the verify.mjs gate registry, the
   * eval set + the threshold constant the gate enforces). /methodology/ §3
   * renders these instead of authored literals. Fields the exporter cannot
   * derive honestly (pytest/vitest totals) are absent by design — the page
   * states those qualitatively rather than shipping a number that rots.
   */
  build_checks?: {
    dbt_assertions?: number;
    npm_gates?: number;
    eval_questions?: number;
    eval_threshold?: number;
  };
  /**
   * Trajectory metric → basis attribute map (single payload-level source for
   * the trajectory pivots' data-basis/fy/measure — never re-derive in TS).
   */
  trajectory_measures?: Record<
    string,
    { basis: string; edition: number; fy: number; measure: string }
  >;
  /**
   * Backlog #49: dollar-denominated /programs/ coverage. The row counter
   * ("1,741 of 1,741") is true and useless — it denominates the index by
   * itself. This denominates it by the FY2026 request universe
   * fct_budget_lines actually carries, and names the largest excluded
   * lines. Absent on pre-#49 exports.
   */
  programs_coverage?: SiteMetaProgramsCoverage;
}

export interface SiteMetaProgramsCoverageExcluded {
  pe_bli: string;
  title: string;
  billions: number;
  /** Raw USD thousands — for <Cite value units="USD thousands">, not display. */
  amount_thousands: number;
  /** Derived citation (fact_id_derived("programs_coverage", `excluded/{pe_bli}/{title}`, …)). */
  fact_id: string;
  /**
   * (#56 addendum) WHY this line is absent from the index — computed from
   * what is ACTUALLY missing, never a hardcoded criterion:
   *   - 'no_detail': the original #49 case — the whole pe_bli publishes no
   *     R-2/P-40 project detail and never became a program page at all.
   *   - 'key_collision': pe_bli IS a program page (one program under that
   *     key won the #56 re-key), but a DIFFERENT, unrelated program
   *     coincidentally shares the same numeric key and lost — its own
   *     money is real, cited, and absent from every program page, not
   *     just this index. Named by ITS OWN title; the shared pe_bli does
   *     not identify it.
   */
  reason: "no_detail" | "key_collision";
}

export interface SiteMetaProgramsCoverage {
  index_billions: number;
  universe_billions: number;
  coverage_pct: number;
  largest_excluded: SiteMetaProgramsCoverageExcluded[];
  /** Raw USD thousands — for <Cite value units="USD thousands">, not display. */
  index_total_thousands: number;
  universe_total_thousands: number;
  /** Derived citations minted alongside the figures (export_site.py §2b). */
  index_fact_id: string;
  universe_fact_id: string;
  /**
   * (#56) The key_collision subset's own count and total, in USD millions.
   * largest_excluded is ranked by dollars and every collision line is smaller
   * than the biggest no_detail ones, so the category would otherwise be
   * described on /programs/ but never quantified.
   */
  key_collision_count: number;
  key_collision_millions: number;
  /** Raw USD thousands + its derived citation, for <Cite>. */
  key_collision_thousands: number;
  key_collision_fact_id: string;
}

export interface SiteMetaHero {
  basis: string;
  dataset: string;
  edition: number;
  fid: string;
  fy: number;
  measure: string;
  org: string;
  pe_bli: string;
  /** fid[:8] — THE public id (drawer footer + /fact/{id8} permalink). */
  public_id: string;
  scope_qualifier: string;
  title: string;
  units: "USD thousands";
  value: number;
}

let _siteMeta: SiteMeta | null = null;

export function getSiteMeta(): SiteMeta {
  if (_siteMeta) return _siteMeta;
  const meta = readJson<SiteMeta>("site_meta.json");
  if (meta.schema_version !== 1) {
    throw new Error(
      `[govbudget/data] site_meta.json has schema_version=${meta.schema_version}, expected 1. ` +
        `Re-run "uv run python -m govbudget export-site" to regenerate sidecars.`,
    );
  }
  // Inject the data-derived ingested-org set into the universal program-tier
  // module (it cannot read the payload itself — no fs). Every code path that
  // reaches isIngestedServiceOrg first hits a data loader that calls
  // getSiteMeta, so this runs before any rollup-note wording is decided.
  setIngestedServiceOrgs(meta.ingested_service_orgs);
  _siteMeta = meta;
  return _siteMeta;
}

// ── datasets.json — Explorer dataset manifest (PM Sprint 2, §P1-5) ───────────

export interface DatasetManifestEntry {
  /** Parquet size on disk, bytes. */
  bytes: number;
  /** False only while a dataset ships ahead of its citation rows. */
  cited: boolean;
  /** e.g. "dim_programs.parquet" */
  file: string;
  /** Table name as registered in DuckDB-WASM. */
  name: string;
  /** Real row count of the emitted parquet — computed by the exporter. */
  row_count: number;
  /** One sentence describing what ONE row of this dataset IS. */
  scope: string;
  /**
   * A MEASURED limitation of the shipped file, present only where the
   * exporter computes one (_derived_caveat in export_site.py). Rendered on
   * the /downloads/ card, not in the /data/ inventory table — see the
   * exporter's note on why the two disclosures split.
   */
  caveat?: string;
}

export interface DatasetManifest {
  built_at: string;
  datasets: DatasetManifestEntry[];
  schema_version: number;
}

let _datasetManifest: DatasetManifest | null = null;

/**
 * The shipped-parquet inventory. Every number the /data/ page states about a
 * dataset comes from here — nothing is authored in TSX. Replaces the
 * DATASET_INVENTORY literals that had rotted to 5B-2-era values (dim_programs
 * "326" against a 1,739-row parquet) and omitted budget_lines_decade entirely.
 */
export function getDatasetManifest(): DatasetManifest {
  if (_datasetManifest) return _datasetManifest;
  getSiteMeta();
  const m = readJson<DatasetManifest>("datasets.json");
  if (m.schema_version !== 1) {
    throw new Error(
      `[govbudget/data] datasets.json has schema_version=${m.schema_version}, expected 1. ` +
        `Re-run "uv run python -m govbudget export-site" to regenerate sidecars.`,
    );
  }
  if (!Array.isArray(m.datasets) || m.datasets.length === 0) {
    throw new Error(
      "[govbudget/data] datasets.json has no datasets — the Explorer inventory would render empty.",
    );
  }
  _datasetManifest = m;
  return _datasetManifest;
}

// ── Trajectory fiscal-year label (re-exported for server components) ─────────
// Defined in site.ts (universal, no server-only guard) so that client
// components can import it too without violating the server-only boundary.
export { TRAJECTORY_FY_LABEL } from "./site";

// ── programs.json ────────────────────────────────────────────────────────────

/**
 * The PROGRAM's budget trajectory — every organisation that funds the PE,
 * summed (ROADMAP backlog #37).
 *
 * It used to be the row's DECLARED-ORG SLICE: read out of the component mart
 * at (pe_bli, dim_programs.org) and published under the program's name. For
 * 1,738 of 1,741 programs the declared org is the only org, so the slice was
 * the program; for the three BLI codes shared across organisations it was a
 * part (BLI 30 FY2024: OSD's 408,006 of 435,163). The exporter reads
 * fct_program_trajectory now, whose every metric is pinned by dbt to the sum
 * of its component rows.
 *
 * `org` on the row beside this is the row's LABEL — which agency page lists
 * it — and was never the scope of these figures.
 */
export interface ProgramTrajectory {
  /**
   * How many (pe_bli, organization) rows these figures were summed from.
   * 1 for all but three programs. Published so the grain is visible to a
   * consumer rather than something you have to know: >1 means the citation
   * key is the program's own derived sum, not a component's row.
   */
  n_org_components: number;
  fy2024_actuals: number | null;
  fy2025_total: number | null;
  fy2026_total: number | null;
  fy2526_change: number | null;
  fy2526_pct_change: number | null;
}

/**
 * Derived-citation fact_ids for trajectory figures (Phase 5B-3 flips).
 * Computed in Python (export_site.fact_id_derived) — NEVER recompute in TS.
 * Each id is non-null only when the metric value is non-null AND the
 * citation row exists in citations.json.
 */
export interface ProgramTrajectoryFactIds {
  fy2024_actuals: string | null;
  fy2025_total: string | null;
  fy2026_total: string | null;
  fy2526_change: string | null;
}

export interface ProgramHHI {
  family_count: number;
  hhi: number;
  /** Derived citation fact_id for the HHI value (nullable). */
  hhi_fact_id: string | null;
  program_dollars: number;
  /** Derived citation fact_id for program_dollars (nullable). */
  program_dollars_fact_id: string | null;
  top_family: string;
}

export interface ProgramRow {
  award_count: number;
  /**
   * Sprint E, Task E3 (ROADMAP #67): null for the SYNTHETIC side of one of
   * the 8 appropriation-account collisions (e.g. LPD Flight II) — that
   * account has no R-2/P-40 exhibit behind it at all (dbt/models/marts/
   * dim_programs.sql's `synth` branch), so there is no exhibit to name.
   * Every consumer already treats "budget"/unknown as the honest fallback
   * label (rollup-tier programs produce it too) — see answerFamilyPlain /
   * exhibitFamilyLabel.
   */
  exhibit_family: string | null;
  /**
   * bool_and(reconciled) across EVERY detail scenario, INCLUDING the two the
   * reconciler never issues a check for. Not the badge predicate — see
   * reconciled_in_scope. Kept because published agency/coverage counts were
   * computed on this definition.
   */
  fully_reconciled: boolean;
  /**
   * Tri-persona review Wave 2 — what the reconciliation badge renders.
   *
   * dim_programs.reconciled_in_scope: bool_and(reconciled) restricted to the
   * scenarios govbudget.jbooks.reconcile.scenario_map() actually checks.
   * true = no in-scope failure; false = a genuine reconciliation failure;
   * null = nothing in scope was checked (the detail-less synthetic side of an
   * account collision, a rollup-tier row, or a payload predating this field).
   *
   * fully_reconciled is false on 1,398 of 1,753 corpus rows only because the
   * AllPriorYears scenario is 0-of-3,267 reconciled BY CONSTRUCTION; on this
   * predicate 87 of them are real failures and the badge can say so.
   */
  reconciled_in_scope: boolean | null;
  fy2024_actual_millions: number | null;
  fy2024_fact_id: string | null;
  /** xml_path for zero-amount FY24 facts (Cite state B fallback). */
  fy2024_xml_path: string | null;
  hhi: ProgramHHI | null;
  narrative_count: number;
  org: string;
  pe_bli: string;
  project_count: number;
  title: string;
  trajectory: ProgramTrajectory | null;
  trajectory_fact_ids: ProgramTrajectoryFactIds | null;
  /**
   * FY2026 discretionary/reconciliation split (backlog #50), USD thousands,
   * R-1/P-1 workbook TOA basis — the SAME two addends the program page's own
   * fy26_split sidecar field cites. null means no such workbook row exists
   * for this PE (never a fabricated zero indistinguishable from a real one).
   * Optional: the exporter always emits both keys, but pre-#50 sidecars/test
   * fixtures may not carry them.
   */
  fy2026_disc_toa_usd_thousands?: number | null;
  fy2026_reconciliation_toa_usd_thousands?: number | null;
  /**
   * Sprint E, Task E3 (ROADMAP #67) — the URL-contract identity. `slug` is
   * the page's route/filename: identical to `pe_bli` for every ordinary
   * program, "{pe_bli}-{ACCOUNT_CODE}" for the 8 genuine appropriation-
   * account collisions (dbt/models/marts/dim_programs.sql's account_match).
   * `account` / `account_title` are non-null on exactly those same 16 rows
   * — two dim_programs rows now legitimately share one `pe_bli`, and this
   * is how a caller tells them apart. Always use `slug` for hrefs; `pe_bli`
   * remains the display code and the bare-key stub-page identity.
   */
  slug: string;
  account: string | null;
  account_title: string | null;
}

let _programs: ProgramRow[] | null = null;

export function getPrograms(): ProgramRow[] {
  if (_programs) return _programs;
  // Validate schema_version before loading any data
  getSiteMeta();
  _programs = readJson<ProgramRow[]>("programs.json");
  return _programs;
}

/**
 * Keyed by SLUG (Sprint E, Task E3 — ROADMAP #67), not pe_bli: identical to
 * pe_bli for every ordinary program, but the 8 genuine appropriation-account
 * collisions each carry TWO programs.json rows sharing one pe_bli — keying
 * by pe_bli would silently collapse them (whichever iterated last wins),
 * exactly the #56 fusion failure this sprint removes. `[peBli]`'s dynamic
 * route param IS the slug for a real program page (see generateStaticParams
 * / getProgramPeBlis, which enumerate program_details sidecar basenames —
 * also filed by slug).
 */
export function getProgramMap(): Map<string, ProgramRow> {
  const programs = getPrograms();
  return new Map(programs.map((p) => [p.slug, p]));
}

let _splitProgramKeys: string[] | null = null;

/**
 * Bare pe_bli values with MORE than one programs.json row — the 8 genuine
 * appropriation-account collisions (Sprint E, Task E3). The bare
 * `/program/{pe_bli}/` URL for each of these is a disambiguation STUB
 * listing both real (slug-addressed) pages, never a program page itself —
 * it carries no program_details sidecar (see the stub branch in
 * app/program/[peBli]/page.tsx and program-skeleton.mjs's exclusion of it).
 */
export function getSplitProgramKeys(): string[] {
  if (_splitProgramKeys) return _splitProgramKeys;
  const counts = new Map<string, number>();
  for (const p of getPrograms()) {
    counts.set(p.pe_bli, (counts.get(p.pe_bli) ?? 0) + 1);
  }
  _splitProgramKeys = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([pe]) => pe)
    .sort();
  return _splitProgramKeys;
}

/** Every programs.json row sharing this bare pe_bli — the stub page's own
 *  listing. Empty for a pe_bli that isn't a split key. */
export function getProgramsByBareKey(peBli: string): ProgramRow[] {
  return getPrograms().filter((p) => p.pe_bli === peBli);
}

// ── program_details/{pe_bli}.json ────────────────────────────────────────────

export interface ProgramDetailRow {
  amount_millions: number;
  fact_id: string;
  project_number: string | null;
  project_title: string | null;
  // 'unique'/'ambiguous_first' → exporter emitted a jbook_pdf citation (state A).
  // 'zero_amount'/'unresolved' → no citation emitted; the amount cites its
  // xml_path chip (state B). Navy's FY2026 books (Phase 5G) first surfaced
  // 'unresolved' on full-tier pages — a factId here would orphan.
  resolution: "unique" | "ambiguous_first" | "zero_amount" | "unresolved";
  scenario: string;
  units: string;
  xml_path: string;
  /** Basis threading (PM Sprint 1): always 'jbook-detail' for detail rows. */
  basis: string;
  /** Fiscal year from the edition-relative scenario map; null for AllPriorYears. */
  fy: number | null;
  /** Measure token (request / base-request / all-prior-years / …). */
  measure: string | null;
  edition: number;
  /**
   * Gate-23 grouping scope: the PE itself for a UNIQUE program-root row,
   * '{pe}/{project}' for project rows, '{pe}/line{n}' for conflicting
   * multi-root scenarios (per-line labels — see ProgramDetailsTable).
   */
  entity: string;
}

/**
 * Prose amount link (Phase 5F §2c): a dollar token inside a narrative body
 * that EXACTLY matches a fact amount scoped to the same PE. Offsets are into
 * the raw body string; token is the literal slice for defense-in-depth.
 * Rendered as a prose Cite (data-prose-cite) — NEVER data-amount, which is
 * forbidden inside data-source-text subtrees (render-static a0).
 */
export interface ProseAmountLink {
  start: number;
  end: number;
  fact_id: string;
  token: string;
}

export interface ProgramNarrative {
  body: string;
  kind: string;
  title: string;
  /** xml_path of this narrative row in the J-book XML source. Used for
   *  data-xml-path on the data-source-text container (block-level citation). */
  xml_path?: string;
  /** jbook_narrative citation fact_id for this narrative row (Phase 5F §2b). */
  fact_id?: string;
  /** Deterministic prose dollar-token citations (Phase 5F §2c). */
  amount_links?: ProseAmountLink[];
}

export interface ProgramBudgetLine {
  account_title: string;
  /** #56: the workbook row's own title — usually the page's own title, but
   *  for the 10 pe_bli values coincidentally shared by two different real
   *  appropriation accounts, a row's title can name a DIFFERENT program
   *  than the page's own (see app/program/[peBli]/page.tsx's
   *  SharedKeyDisclosure). */
  title?: string | null;
  amount_thousands: number;
  amount_type: string;
  exhibit: string;
  fact_id: string;
  organization: string;
  source_cells: string;
  source_sheet: string;
  units: "USD thousands";
  /** Basis threading (PM Sprint 1): always 'toa' for workbook rows. */
  basis: string;
  fy: number | null;
  measure: string | null;
  edition: number;
  /** pe when this is the sole row on its (fy, measure); component key otherwise. */
  entity: string;
}

export interface ProgramAward {
  award_piid: string;
  confidence: string;
  recipient_name: string;
}

export interface ProgramMention {
  client_name: string;
  description_snippet: string;
  /**
   * (#52) which evidence tier qualified this row: 'pe_literal' | 'alias' |
   * 'multi_token'. A single common title word is never sufficient on its
   * own — see site/src/lib/evidence.ts for the rendered label.
   */
  evidence_kind: string;
  /** Can be null for dangling family_keys (2,781 / 32,780 lobbying rows). */
  family_key: string | null;
  filing_url: string;
  filing_uuid: string;
  filing_year: string;
  matched_term: string;
}

/**
 * One decade-series point (Phase 5E): a cited grain from fct_decade_series.
 * v is USD thousands; fid resolves in citations.json (uncited grains are
 * never exported); edition is the PB book the figure was read from.
 * Gaps are ABSENT entries — never zeros, never interpolated.
 */
export interface DecadePoint {
  fy: number;
  v: number;
  fid: string;
  edition: number;
  /** Basis threading (PM Sprint 1): always 'toa' for decade grains. */
  basis: string;
  /**
   * Kind-qualified measure token (export_site._decade_measure_token): the
   * series kind when the chosen slug agrees ('actuals'), a compound token
   * ('enacted-request') when the source column diverges from the row label.
   */
  measure: string;
}

/** Keyed by amount_type_kind; a kind with no grains is simply absent. */
export interface DecadeSeries {
  actuals?: DecadePoint[];
  enacted?: DecadePoint[];
  request?: DecadePoint[];
}

/**
 * The PE's largest cited request-vs-actuals book diff (Phase 5E Task 7):
 * PB(from_edition) asked `fy`-year dollars, PB(to_edition) reported the
 * actuals — delta (USD thousands) cites the minted book_diff derived fact
 * (fid). Side values resolve from decade_series by (fy, edition, kind).
 * Minted in Python (fact_id_derived) — NEVER recomputed in TS.
 */
export interface ProgramBookDiff {
  kind: "request_vs_actuals";
  fy: number;
  from_edition: number;
  to_edition: number;
  delta: number;
  fid: string;
  /** Basis threading (PM Sprint 1): 'toa', measure 'change', PB edition. */
  basis: string;
  measure: string;
  edition: number;
}

/**
 * One summary-card payload (PM Sprint 1 §P0-1/§P0-2): union-computed from
 * workbook (toa) + J-book detail facts, preferring toa. Either a value
 * (fid/public_id resolve in citations.json; xml_path for fid-less zero
 * roots — Cite state B) or an honest absence_reason — never a bare null.
 */
export interface SummaryCard {
  key: "fy2024" | "fy2025" | "fy2026" | "change";
  fy: number;
  measure: string;
  basis: string | null;
  value: number | null;
  units: "USD thousands" | "USD millions" | null;
  fid: string | null;
  /** fid[:8] — THE public id. Render verbatim, never re-slice. */
  public_id: string | null;
  dataset: string | null;
  edition: number;
  absence_reason: "not-published" | "no-comparison" | "no-rollup" | null;
  xml_path?: string;
  pct?: number | null;
}

/** One reconciliation entry: the two-basis divergence at one (fy, measure). */
export interface ReconciliationEntry {
  fy: number;
  measure: string;
  toa: {
    v: number;
    units: "USD thousands";
    fid: string;
    public_id: string;
    dataset: string;
  };
  detail: {
    v: number;
    units: "USD millions";
    fid: string | null;
    public_id: string | null;
    dataset: string;
    scenario: string;
    /** Present when fid is null (zero/unresolved root — Cite state B). */
    xml_path?: string;
    resolution?: string;
  };
  delta_thousands: number;
}

/** WHO-GETS-IT named-primes fallback (§P0-2 fix 3). */
export interface NamedPrime {
  name: string;
  family_key: string;
  fact_id: string;
  public_id: string;
}

/**
 * WHO-GETS-IT lobbying tier (tri-persona Wave 3).
 *
 * The companies whose Senate LDA filings name this program, for the pages
 * where the award crosswalk and the dossiers are both silent. THIS IS NOT AN
 * AWARD CLAIM and the payload is shaped so it cannot be mistaken for one: no
 * dollars, no obligations, no share. Only `pe_literal`/`alias` evidence
 * qualifies a company for this list — see _build_lobbied_by in
 * src/govbudget/export_site.py and lib/evidence.ts for the tiers.
 */
export interface LobbiedByFamily {
  /** display_name from dim_entities where profiled, else the family key. */
  name: string;
  family_key: string;
  /** Filings in this program's mention set naming this family. */
  filings: number;
  /** 'pe_literal' | 'alias' — never 'multi_token'. */
  evidence_kind: string;
  /** /company/{slug}/ when the family is profiled; null otherwise. */
  slug: string | null;
}

export interface LobbiedBy {
  families: LobbiedByFamily[];
  shown: number;
  /** Qualifying families beyond the ones named. */
  more: number;
  /** Total qualifying filings across all families. */
  filings: number;
}

export interface ProgramSummary {
  edition: number;
  basis_preference: string;
  cards: SummaryCard[];
  reconciliation: ReconciliationEntry[];
  named_primes: NamedPrime[];
  /** Null on every page where the tier does not apply. */
  lobbied_by?: LobbiedBy | null;
}

/**
 * One cited FY2026 workbook figure feeding a Fy26Split side (backlog #50).
 * Reuses the SAME shape as ReconciliationEntry's toa/detail sides — a fid
 * that resolves in citations.json, always basis 'toa' (R-1/P-1 workbook).
 */
export interface Fy26SplitSide {
  v: number;
  units: "USD thousands";
  fid: string;
  public_id: string;
  dataset: string;
  basis: string;
  fy: number;
  measure: string;
  edition: number;
}

/**
 * FY2026 discretionary/reconciliation split for one program (backlog #50).
 *
 * The site's FY2026 "Request" figure is disc + reconciliation with no
 * visible seam — $89.01B of the $385.27B FY2026 corpus total is one-time
 * reconciliation-bill money. `disc_pct_change` is computed on the
 * discretionary basis only (the like-for-like comparison to an enacted
 * FY2025, which carries no reconciliation component of its own); a rate
 * computed on the combined total is not a rate of anything a reader can
 * extrapolate. See build_fy26_split in export_site.py for the exact math.
 *
 * `disc`/`reconciliation` are null exactly when the program has no workbook
 * row of that kind (disc_k/recon_k then read 0 — a real, not fabricated,
 * zero) — never render a Cite for a null side.
 */
/**
 * One constituent budget line of a page's FY2026 total (ROADMAP #69).
 *
 * A program's BLI code can carry money in more than one budget activity —
 * F-15EX files in BA-01 (Combat aircraft), BA-05 (Modification of inservice
 * aircraft) and BA-07 (Aircraft support equipment and facilities). Usually
 * every activity's line carries the SAME title, so the page's one title
 * names all of it. Twice in PB2026 it does not: HCMC00's BA-07 line is
 * titled "HC/MC-130 Post Prod" while its BA-05 line is "HC/MC-130
 * Modifications", and JSE000's are "Joint Simulation Environment" and
 * "…Post Production Support". `lines` is present exactly on those pages,
 * so the headline says which lines it is made of instead of publishing the
 * total under one line's name. Same cited shape as Fy26SplitSide.
 */
export interface Fy26SplitLine extends Fy26SplitSide {
  title: string;
  budget_activity: string | null;
  budget_activity_title: string | null;
  /**
   * Gate-23 grouping scope ('{pe}/{org}/{acct}/{ba}/fy_2026_total') — the
   * same component entity the page's line-items table stamps on these very
   * rows, so the note and the table agree under one label instead of
   * colliding with the headline card they are components of.
   */
  entity: string;
}

export interface Fy26Split {
  disc_k: number;
  recon_k: number;
  total_k: number;
  recon_share: number;
  disc_pct_change: number | null;
  has_reconciliation: boolean;
  disc: Fy26SplitSide | null;
  reconciliation: Fy26SplitSide | null;
  /**
   * (#69) The page's FY2026 total per constituent budget line, largest
   * first. Null/absent whenever the page's lines all share one title —
   * the overwhelming majority — never an all-one-entry list restating the
   * headline.
   */
  lines?: Fy26SplitLine[] | null;
}

/**
 * ROADMAP #32(a) — PB2026 requests nothing for this program element.
 *
 * Present on the 319 pages whose PB2026 R-1/P-1 workbook rows carry
 * FY2024/FY2025 money and no FY2026 row at all (Army 113, Air Force 77, Navy
 * 69, OSD 18, DARPA 14, 28 elsewhere — PB2026 renumbered program elements at
 * scale). Absent everywhere else. `last_fy` is the latest year the workbook
 * still funds the line, and the year the note names.
 *
 * Deliberately carries no successor OF ITS OWN: the corpus cannot prove one
 * from workbook rows, and naming a guess would be a fabricated citation.
 * Successor EDGES are #32(b), folded into backlog #29 — but where the
 * lineage rail already publishes a cited successor, `has_successor` says so,
 * because the note used to deny one on five pages that named it three
 * inches below (837170 → 0207279F, quoted verbatim from the J-book).
 *
 * `jbook_fy2026_zero` marks the 173 pages whose J-book detail carries an
 * FY2026 row at exactly $0. A workbook blank and a documented zero are
 * different records; conflating them is the error that produced the 87
 * withdrawn "zeroed out in FY2026" feed cards.
 *
 * Pages whose J-book detail shows POSITIVE FY2026 money never get this
 * payload at all — the exporter returns None, so the note cannot render
 * over a figure that contradicts it.
 */
export interface Fy2026Absent {
  last_fy: number;
  jbook_fy2026_zero: boolean;
  has_successor: boolean;
}

/**
 * ROADMAP #28 — the decade-only tier's absence block.
 *
 * Present on EVERY decade-tier sidecar and nowhere else. A decade-only page
 * is one whose program element has cited President's Budget history and no
 * PB2026 R-1/P-1 line AT ALL — not a blank FY2026 cell on a line that is
 * still listed (that is Fy2026Absent above, a different record and a
 * different sentence), but no row.
 *
 * Every field is derived from the page's OWN rendered decade series and
 * lineage rail, so gate 21 leg (k) recomputes the whole block from the
 * sidecar and checks the rendered sentence against what the page displays.
 *
 * `renumber` is true ONLY when `last_edition` is PB2025 — the edition
 * immediately before this one — so the PB2026-renumber explanation renders
 * only where the line's disappearance really is a PB2025 → PB2026 event. A
 * line last carried in PB2019 gets the other sentence; blaming PB2026 for it
 * would be the #32(a) defect in a new place.
 */
export interface DecadeAbsent {
  /** Earliest PB edition the page publishes a figure from. */
  first_edition: number;
  /** Latest — and, by the exporter's eligibility filter, the last edition
   *  whose R-1/P-1 workbook carries this line at all. */
  last_edition: number;
  /** Distinct PB editions behind the page's figures (may have gaps). */
  edition_count: number;
  fy_min: number;
  fy_max: number;
  renumber: boolean;
  has_successor: boolean;
}

export interface ProgramDetails {
  awards: ProgramAward[];
  budget_lines: ProgramBudgetLine[];
  details: ProgramDetailRow[];
  mentions: ProgramMention[];
  narratives: ProgramNarrative[];
  /** PM Sprint 1: union summary cards + reconciliation + named primes.
   *  Present on EVERY sidecar (both tiers). */
  summary: ProgramSummary;
  /** Phase 5E: cited decade series (absent when the PE has no decade grains). */
  decade_series?: DecadeSeries;
  /** Phase 5E: largest cited request-vs-actuals gap (requires decade_series). */
  book_diff?: ProgramBookDiff;
  /**
   * program-lineage (Task 7): evidence-tiered YoY money-flow block — a rail of
   * predecessor/successor edges (stated-with-citation or inferred-without) plus
   * a 1:1 family funding line. Absent on programs with no lineage. See
   * ./lineage.ts for the honesty invariants.
   */
  lineage?: LineageBlock;
  /**
   * FY2026 discretionary/reconciliation split (backlog #50): present when
   * the PE has a fy_2026_disc_request and/or fy_2026_reconciliation_request
   * workbook row. Absent means neither exists — not a fabricated all-zero
   * split.
   */
  fy26_split?: Fy26Split;
  /**
   * ROADMAP #32(a): PB2026 carries no FY2026 request line for this program
   * element. Absent means it does — never a fabricated "renumbered" claim.
   */
  fy2026_absent?: Fy2026Absent;
  /**
   * ROADMAP #28: this page's program element has no PB2026 R-1/P-1 line at
   * all, and everything it shows comes from earlier editions. Present on
   * every tier:"decade" sidecar, absent on every other.
   */
  decade_absent?: DecadeAbsent;
  /**
   * Phase 5F rollup-tier fields (Batch A): present ONLY on the rollup
   * sidecars (R-1/P-1 figures + trajectory, no J-book detail) — ~254 after
   * the Phase 5G Army/AF/SF archive round — and on the ROADMAP #28
   * decade-tier sidecars, which carry the same fields for the same reason
   * (no programs.json row to read them from). The ~1,741 full-tier sidecars
   * carry none of these — their program row lives in programs.json.
   */
  tier?: "rollup" | "decade";
  service_org?: string;
  title?: string;
  trajectory?: ProgramTrajectory | null;
  trajectory_fact_ids?: ProgramTrajectoryFactIds | null;
  /**
   * ROADMAP #28 (decade tier only): R-1 vs P-1 majority across the page's
   * OWN older-edition workbook rows. The rollup tier derives this from
   * `budget_lines` (deriveExhibitFamily); a decade page's budget_lines array
   * is empty by construction, so the exporter computes it and ships it.
   */
  exhibit_family?: string | null;
}

const _programDetails = new Map<string, ProgramDetails>();

export function getProgramDetails(peBli: string): ProgramDetails {
  if (_programDetails.has(peBli)) return _programDetails.get(peBli)!;
  getSiteMeta();
  const details = readJson<ProgramDetails>(`program_details/${peBli}.json`);
  _programDetails.set(peBli, details);
  return details;
}

// ── Program page universe (Phase 5F §2a) ─────────────────────────────────────
// Every distinct PE in budget_lines has a program_details sidecar (~1,995
// after the Phase 5G Army/AF/SF archive round): the ~1,741 full-tier programs
// from programs.json PLUS ~254 rollup-tier sidecars. generateStaticParams /
// sitemap / OG all enumerate THIS set.

let _programPeBlis: string[] | null = null;

/** Sorted basenames of every program_details sidecar (the page universe). */
export function getProgramPeBlis(): string[] {
  if (_programPeBlis) return _programPeBlis;
  getSiteMeta();
  const dir = join(jsonDir(), "program_details");
  _programPeBlis = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
  return _programPeBlis;
}

/** Total number of program PAGES (all tiers) — 1,995 with Batch A data. */
export function getProgramPagesCount(): number {
  return getProgramPeBlis().length;
}

// ── Organizations with money and no agency page (tri-persona Wave 4) ────────

export interface UnpagedOrgProgram {
  slug: string;
  title: string;
  /** The page's own cited FY2026 headline; null where it publishes none. */
  value: number | null;
  units: "USD thousands" | "USD millions" | null;
  factId: string | null;
  measure: string;
  basis: string | null;
}

export interface UnpagedOrg {
  /** Workbook organization code; "" where the workbook leaves it blank. */
  org: string;
  programs: UnpagedOrgProgram[];
}

let _unpagedOrgs: UnpagedOrg[] | null = null;

/**
 * Workbook organizations that carry FY2026 money and have NO /agency/ page —
 * tri-persona review Wave 4, item 5.
 *
 * `/agency/` lists 24 organizations; 28 carry FY2026 money in the budget
 * lines. The four with no page are DEFW ($5.65B, the two FY2026
 * reconciliation initiatives), DHA ($973M across thirteen medical program
 * elements), IG, and the classified line the workbook files under no
 * organization code at all. Their PROGRAM pages exist and are indexed; what
 * did not exist was any way to get to them from the agency index, because
 * agencies.json is built from dim_programs and none of these has a
 * dim_programs row.
 *
 * WHY A LIST AND NOT FOUR NEW AGENCY PAGES. An /agency/{org}/ page's header
 * total and its program list are both dim_programs-grained; minting one for
 * an org with no dim_programs rows would produce a page whose header states
 * a real total over a list that shows none of it — the exact "true number,
 * false label" shape this whole review is about. Giving dim_programs a
 * per-org grain is ROADMAP #45, a dimension change. Until then the honest
 * fix is the browse path plus a plain statement of why the page is absent.
 *
 * THE PAGED/UNPAGED TEST IS DERIVED, NOT AN ALIAS TABLE. The workbook
 * organization code space is not quite agencies.json's — the workbook writes
 * CYBER where agencies.json writes CYBERCOM — and a hand-written alias map
 * would be one more paired constant to drift. Instead: an org is PAGED when
 * any of its program pages has a programs.json row whose own org has an
 * agency page. CYBER's seven pages all do (as CYBERCOM); DEFW's and IG's
 * have no programs.json row at all, and DHA's one row carries org "DHA",
 * which agencies.json does not list.
 */
export function getUnpagedOrgs(): UnpagedOrg[] {
  if (_unpagedOrgs) return _unpagedOrgs;
  const agencySet = new Set(getAgencies().map((a) => a.org));
  const programRows = getProgramMap();

  // org -> slugs, and slug -> its FY2026 headline card.
  const byOrg = new Map<string, UnpagedOrgProgram[]>();
  for (const slug of getProgramPeBlis()) {
    const d = getProgramDetails(slug);
    let org: string | null = null;
    for (const bl of d.budget_lines) {
      if (bl.edition !== 2026) continue;
      if (
        bl.amount_type !== "fy_2026_disc_request" &&
        bl.amount_type !== "fy_2026_reconciliation_request"
      ) {
        continue;
      }
      org = bl.organization ?? "";
      break;
    }
    if (org === null) continue; // no FY2026 request money on this page
    const card = d.summary.cards.find((c) => c.key === "fy2026");
    const list = byOrg.get(org) ?? [];
    list.push({
      slug,
      title: d.title ?? programRows.get(slug)?.title ?? slug,
      value: card?.value ?? null,
      units: card?.units ?? null,
      factId: card?.fid ?? null,
      measure: card?.measure ?? "request",
      basis: card?.basis ?? null,
    });
    byOrg.set(org, list);
  }

  const out: UnpagedOrg[] = [];
  for (const [org, programs] of byOrg) {
    const paged = programs.some((p) => {
      const row = programRows.get(p.slug);
      return row != null && agencySet.has(row.org);
    });
    if (paged) continue;
    programs.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    out.push({ org, programs });
  }
  // Largest FY2026 headline first — the same order /agency/ itself uses.
  out.sort(
    (a, b) => (b.programs[0]?.value ?? -1) - (a.programs[0]?.value ?? -1),
  );
  return (_unpagedOrgs = out);
}

let _programSitemapSlugs: string[] | null = null;

/**
 * Every INDEXABLE /program/{key}/ URL — the set sitemap.xml declares.
 *
 * Tri-persona review Wave 4, item 4: sitemap.xml stated the corpus at 2,016
 * while four pages said 1,755, /coverage/ said 1,743 of 2,005 and
 * dim_programs.parquet said 1,753. Each is right for its own denominator and
 * nothing said so. This one is "URLs a crawler is offered" — which is neither
 * the sidecar universe (zero-content pages are noindex and excluded) nor the
 * index (split-key stubs are real pages with no programs.json row of their
 * own).
 *
 * app/sitemap.ts used to compute it inline; it calls this now, so the number
 * on /coverage/'s reconciliation and the number in the XML are one
 * expression evaluated once. Cached: this parses every sidecar, and the
 * sitemap was already paying for that pass.
 */
export function getProgramSitemapSlugs(): string[] {
  if (_programSitemapSlugs) return _programSitemapSlugs;
  const indexable = getProgramPeBlis().filter(
    (slug) => !isZeroContentDetails(getProgramDetails(slug)),
  );
  // The split-key disambiguation stubs are real, indexable pages that carry
  // no sidecar (see getSplitProgramKeys), so the directory scan never sees
  // them.
  _programSitemapSlugs = [...indexable, ...getSplitProgramKeys()];
  return _programSitemapSlugs;
}

let _pagesWithoutDetail: PagesWithoutDetail | null = null;

/**
 * The program pages that carry NO R-2/P-40 detail row, split by what they DO
 * carry (ROADMAP #28). Returns { workbookOnly, decadeOnly }.
 *
 * The site's coverage prose used to describe this whole remainder in one
 * sentence — "the other N pages carry cited R-1/P-1 workbook figures only" —
 * with N derived as programPages − detailGrade. #28 made that sentence false
 * for 553 pages, whose program element has no FY2026 workbook line at all.
 *
 * SPLIT BY CONTENT, NOT BY TIER LABEL, and that distinction is load-bearing.
 * A first cut of this function counted tier:"rollup" against tier:"decade"
 * and asserted their sum was the remainder — which failed the build, exactly
 * as it should have: TWO full-tier pages (0603115DHA and 0708083D, the
 * backlog #17 trajectory-only programs, which have a programs.json row and
 * no J-book detail) belong to neither tier and would have gone undescribed.
 * They carry five FY2026 workbook rows each, so the workbook sentence is
 * true of them; the tier label is what was not. Counting "does this page
 * have FY2026 workbook rows" partitions the remainder with nothing left
 * over, and `unclassified` exists so a future page that fits neither
 * sentence fails loudly instead of being silently absorbed by one.
 *
 * Derived, never a literal: read from the artifact the pages render from.
 * Cheap byte prefilter, like getDetailGradeCount below.
 */
export interface PagesWithoutDetail {
  /** No J-book detail, but cited FY2026 R-1/P-1 workbook rows. */
  workbookOnly: number;
  /** No J-book detail and no FY2026 workbook row — the #28 decade tier. */
  decadeOnly: number;
  /** Slugs matching neither sentence. Non-empty is a defect, not a bucket. */
  unclassified: string[];
}

export function getPagesWithoutDetail(): PagesWithoutDetail {
  if (_pagesWithoutDetail) return _pagesWithoutDetail;
  const dir = join(jsonDir(), "program_details");
  if (!existsSync(dir)) {
    return (_pagesWithoutDetail = {
      workbookOnly: 0,
      decadeOnly: 0,
      unclassified: [],
    });
  }
  let workbookOnly = 0;
  let decadeOnly = 0;
  const unclassified: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    // Same cheap reject getDetailGradeCount uses, so the two partition the
    // sidecars on exactly one predicate and their counts must sum.
    const hasDetailKey =
      raw.includes('"details"') && !/"details":\s*\[\]/.test(raw);
    let d: {
      details?: unknown[];
      budget_lines?: unknown[];
      tier?: unknown;
    };
    try {
      d = JSON.parse(raw);
    } catch {
      continue; // malformed — getCorpus / gate 24 leg d report it
    }
    if (hasDetailKey && Array.isArray(d.details) && d.details.length > 0) {
      continue;
    }
    if (Array.isArray(d.budget_lines) && d.budget_lines.length > 0) {
      workbookOnly++;
    } else if (d.tier === "decade") {
      decadeOnly++;
    } else {
      unclassified.push(f.slice(0, -".json".length));
    }
  }
  return (_pagesWithoutDetail = { workbookOnly, decadeOnly, unclassified });
}

let _detailGradeCount: number | null = null;

/**
 * Programs that actually carry R-2/P-40 J-book DETAIL — i.e. whose sidecar
 * holds at least one detail row. This is the number the corpus statement
 * means by "detail-grade", and it is NOT programs.json's length.
 *
 * Backlog #35. The corpus statement said 1,741 — programs.json's row count —
 * while /data/ published dim_programs at 1,739 from the parquet the exporter
 * measured. Both were read from shipped artifacts, so neither was a rotted
 * literal; they were counting different things. programs.json is the
 * /programs/ INDEX (every row that table lists), and since backlog #17 it also
 * carries trajectory-only programs that have no J-book detail at all —
 * 0603115DHA (Medical Development) and 0708083D (Assembled Chemical Weapons
 * Alternatives), both with zero detail rows and zero narratives. dim_programs
 * is built from stg_budget_details, so it holds neither. The parquet was
 * right; the claim was two generous, on the number /coverage/ leads with.
 *
 * Counting the sidecars rather than trusting datasets.json keeps §P1-5 intact
 * (the figure is derived from the artifact the pages render), and the
 * published parquet row count is used as a CROSS-CHECK: if the two disagree
 * the export is inconsistent with itself and this throws rather than picking a
 * winner — the same discipline getCorpus() applies to program_pages.
 *
 * Cost: one pass over the sidecars, prefiltered on the bytes (like
 * getLineagePrograms) so only files that mention detail rows are parsed.
 */
export function getDetailGradeCount(): number {
  if (_detailGradeCount !== null) return _detailGradeCount;
  const dir = join(jsonDir(), "program_details");
  if (!existsSync(dir)) return (_detailGradeCount = 0);

  // Sprint E, Task E3 (ROADMAP #67): the cross-check below used to assert
  // declared (dim_programs row count) === count (sidecars with detail) —
  // true pre-E1, when dim_programs WAS "every pe_bli with stg_budget_details
  // presence" by construction (this function's own doc comment above states
  // that premise). E1's re-grain deliberately added a SYNTHETIC dim_programs
  // row for the non-detail side of each of the 8 appropriation-account
  // collisions (dbt/models/marts/dim_programs.sql's `synth` branch — "there
  // is no R-2/P-40 exhibit behind these rows"), so dim_programs' row count
  // now legitimately exceeds the detail-grade sidecar count by exactly the
  // number of those synthetic rows. slugsWithNoDetailExpected identifies
  // them independently (account !== null on the programs.json row — real
  // only for the 16 split-key rows, half of which are synthetic by design)
  // so the assertion can allow exactly that gap instead of forbidding it.
  const slugsWithAccount = new Set(
    getPrograms()
      .filter((p) => p.account !== null)
      .map((p) => p.slug),
  );

  let count = 0;
  let expectedNoDetailGap = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    // An empty details array serializes as `"details": []` — cheap reject
    // (both the compact and space-after-colon forms, since json.dumps'
    // default separators include one).
    if (!raw.includes('"details"') || /"details":\s*\[\]/.test(raw)) {
      if (slugsWithAccount.has(f.slice(0, -".json".length))) {
        expectedNoDetailGap++;
      }
      continue;
    }
    try {
      const details = (JSON.parse(raw) as { details?: unknown[] }).details;
      if (Array.isArray(details) && details.length > 0) {
        count++;
      } else if (slugsWithAccount.has(f.slice(0, -".json".length))) {
        expectedNoDetailGap++;
      }
    } catch {
      // skip malformed files
    }
  }

  const declared = getDatasetManifest().datasets.find(
    (d) => d.name === "dim_programs",
  )?.row_count;
  if (declared !== undefined && declared !== count + expectedNoDetailGap) {
    throw new Error(
      `[govbudget/data] dim_programs.parquet declares ${declared} rows but ` +
        `${count} program_details sidecars carry detail rows and only ` +
        `${expectedNoDetailGap} of the remainder are accounted for by a ` +
        `known split-key synthetic (no-detail) row. The detail-grade tier ` +
        `is defined by the J-book detail rows themselves, so these must ` +
        `agree — re-run "uv run python -m govbudget export-site".`,
    );
  }
  return (_detailGradeCount = count);
}

// ── PE link index (Phase 5F §2a — universal mention linking) ─────────────────

export interface PeLinkIndex {
  /** True when /program/{pe}/ is a built page. */
  has: (pe: string) => boolean;
  /** Project numbers present in a PE's detail rows (for #project-N anchors). */
  projects: (pe: string) => ReadonlySet<string>;
}

const _peProjects = new Map<string, ReadonlySet<string>>();
let _peLinkIndex: PeLinkIndex | null = null;

/**
 * Build-time PE link resolver: `has` answers from the sidecar dir listing;
 * `projects` lazily loads the TARGET program's detail rows (memoized) so
 * "PE X, Project Y" prose references can carry a real #project-Y anchor —
 * only when the target actually has that project row.
 */
/**
 * `has` also recognizes the 8 split-key STUBS (Sprint E, Task E3) — a bare
 * pe_bli mention that cannot know which account it means still resolves to
 * a real, honest page (the disambiguation stub), so linking it is correct.
 * `projects` stays scoped to sidecar-backed pages only: a stub carries no
 * program_details sidecar and therefore no project rows of its own.
 */
export function getPeLinkIndex(): PeLinkIndex {
  if (_peLinkIndex) return _peLinkIndex;
  const peSet = new Set(getProgramPeBlis());
  const stubSet = new Set(getSplitProgramKeys());
  _peLinkIndex = {
    has: (pe: string) => peSet.has(pe) || stubSet.has(pe),
    projects: (pe: string) => {
      if (!peSet.has(pe)) return EMPTY_SET;
      const cached = _peProjects.get(pe);
      if (cached) return cached;
      const projects = new Set<string>();
      for (const row of getProgramDetails(pe).details) {
        if (row.project_number) projects.add(row.project_number);
      }
      _peProjects.set(pe, projects);
      return projects;
    },
  };
  return _peLinkIndex;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

// ── entities_top.json ────────────────────────────────────────────────────────

export interface EntityTop {
  display_name: string;
  family_key: string;
  slug: string;
  total_obligation: number;
  /** Derived citation fact_id for total_obligation (nullable). */
  total_obligation_fact_id: string | null;
  uei_count: number;
  worst_confidence: string;
}

let _entitiesTop: EntityTop[] | null = null;

export function getEntitiesTop(): EntityTop[] {
  if (_entitiesTop) return _entitiesTop;
  getSiteMeta();
  _entitiesTop = readJson<EntityTop[]>("entities_top.json");
  return _entitiesTop;
}

export function getEntityTopMap(): Map<string, EntityTop> {
  const entities = getEntitiesTop();
  return new Map(entities.map((e) => [e.slug, e]));
}

export function getEntityTopByFamilyKey(): Map<string, EntityTop> {
  const entities = getEntitiesTop();
  return new Map(entities.map((e) => [e.family_key, e]));
}

// ── entity_family_events.json (curated renames/acquisitions, §P1-3) ─────────

let _familyEvents: FamilyEventsPayload | null | undefined;

/**
 * The hand-curated corporate rename/acquisition table, or null on an export
 * that predates it (the /companies/ table then renders the honest unmerged
 * split rather than failing the build).
 */
export function getEntityFamilyEvents(): FamilyEventsPayload | null {
  if (_familyEvents !== undefined) return _familyEvents;
  getSiteMeta();
  const full = join(jsonDir(), "entity_family_events.json");
  if (!existsSync(full)) {
    _familyEvents = null;
    return null;
  }
  // No try/catch: a present-but-malformed curated payload must fail the build
  // loudly — silently degrading would restore the very split it exists to fix.
  const payload = JSON.parse(readFileSync(full, "utf8")) as FamilyEventsPayload;
  // v2 (Sprint 2 visual-judge fix round) adds per-member `arrival`, per-event
  // `anchor` / `changed_family_keys` / `evidence`, and the source form + dates.
  // The reader requires all of them, so v1 is no longer accepted: an old
  // payload would render former names with no event at all, which is the
  // defect this schema exists to close.
  if (payload.schema_version !== 2) {
    throw new Error(
      `[govbudget/data] entity_family_events.json schema_version ` +
        `${payload.schema_version} != 2 — re-run \`govbudget export-site\``,
    );
  }
  _familyEvents = payload;
  return payload;
}

// ── title_overrides.json — published title corrections (ROADMAP #39) ────────

export interface TitleOverrideRow {
  pe_bli: string;
  source_title: string;
  display_title: string;
  reason: string;
  verified_on: string;
}

export interface TitleOverridesPayload {
  schema_version: number;
  rows: TitleOverrideRow[];
}

let _titleOverrides: TitleOverridesPayload | null | undefined;

/**
 * The published title-override table (ROADMAP #39): every case where a
 * displayed program title differs from the source workbook's as-ingested
 * title, and why — e.g. `Joint Hypersonic Technology Development
 * &Transition` (PE 0603183D8Z), whose source workbook omits the space
 * after its ampersand. /methodology/ renders every row here so a corrected
 * title is visibly a correction, not a silent edit; null (or an empty
 * `rows`) on an export that predates the sidecar or lists none, in which
 * case the section renders zero rows rather than failing the build —
 * matches getEntityFamilyEvents' absent-seed tolerance above.
 */
export function getTitleOverrides(): TitleOverridesPayload | null {
  if (_titleOverrides !== undefined) return _titleOverrides;
  getSiteMeta();
  const full = join(jsonDir(), "title_overrides.json");
  if (!existsSync(full)) {
    _titleOverrides = null;
    return null;
  }
  const payload = JSON.parse(readFileSync(full, "utf8")) as TitleOverridesPayload;
  _titleOverrides = payload;
  return payload;
}

// ── entity_details/{slug}.json ───────────────────────────────────────────────

export interface EntityInfluenceRow {
  [key: string]: unknown;
  nonAdditive?: boolean;
  family_obligations_usd?: number;
  /** Derived citation fact_ids (Phase 5B-3 flips, nullable). */
  income_fact_id?: string | null;
  expense_fact_id?: string | null;
  total_fact_id?: string | null;
  family_obligations_fact_id?: string | null;
}

export interface EntityAwardRow {
  award_piid?: string;
  confidence?: string;
  recipient_name?: string;
  /**
   * The budget program element this award is crosswalked to. Present in the
   * sidecar all along but untyped and unrendered — round-2 judging found the
   * "Budget-Linked Awards" table naming no budget line at all.
   */
  pe_bli?: string;
  [key: string]: unknown;
}

export interface EntityMentionRow {
  filing_uuid: string;
  pe_bli: string;
  program_title: string;
  matched_term: string;
  /**
   * (#52) which evidence tier qualified this row: 'pe_literal' | 'alias' |
   * 'multi_token'. A single common title word is never sufficient on its
   * own — see site/src/lib/evidence.ts for the rendered label.
   */
  evidence_kind: string;
  filing_year: string;
  filing_url: string;
}

export interface EntityLinkedProgram {
  pe_bli: string;
  title: string;
}

export interface EntityDetails {
  awards: EntityAwardRow[];
  influence: EntityInfluenceRow[];
  linked_programs: EntityLinkedProgram[];
  mentions: EntityMentionRow[];
}

const _entityDetails = new Map<string, EntityDetails>();

export function getEntityDetails(slug: string): EntityDetails {
  if (_entityDetails.has(slug)) return _entityDetails.get(slug)!;
  getSiteMeta();
  const details = readJson<EntityDetails>(`entity_details/${slug}.json`);
  _entityDetails.set(slug, details);
  return details;
}

// ── agencies.json ────────────────────────────────────────────────────────────

export interface AgencyRow {
  fy2024_total_millions: number;
  /** Derived citation fact_id for the FY24 agency sum (nullable). */
  fy2024_fact_id_derived: string | null;
  fy2026_total_thousands: number | null;
  /** Derived citation fact_id for the FY26 agency sum (nullable). */
  fy2026_fact_id_derived: string | null;
  org: string;
  program_count: number;
  /**
   * #59: the P-1/R-1 workbook TOA basis of the SAME FY2024 figure
   * fy2024_total_millions reports on the R-2/P-40 J-book detail basis —
   * sum(fct_budget_lines.amount_thousands)/1000 for this org's programs,
   * same source ReconciliationStrip's "toa" side reads.
   */
  fy2024_toa_actuals_millions: number;
  /** Derived citation fact_id for the FY24 agency TOA sum (nullable). */
  fy2024_toa_actuals_fact_id_derived: string | null;
  /**
   * Count of this org's programs whose FY2024 figure differs (>0.001M,
   * the same tolerance govbudget.jbooks.reconcile.TOLERANCE_M uses) between
   * the P-40 detail basis (fy2024_total_millions's own programs) and the
   * TOA basis above. NOT the same set as dim_programs.fully_reconciled —
   * that flag is bool_and(reconciled) across ALL FIVE detail scenarios
   * (PriorYear/CurrentYear/BudgetYearOne/BudgetYearOneBase, plus the
   * never-checked AllPriorYears), so a program
   * can be fully_reconciled:false purely on a FY2025/FY2026 mismatch while
   * its FY2024 actuals matches exactly (1,271 of 1,397 such programs,
   * verified 2026-08-11) — using that flag here would overstate what the
   * FY2024 column specifically excludes.
   */
  fy2024_not_reconciled_count: number;
}

let _agencies: AgencyRow[] | null = null;

export function getAgencies(): AgencyRow[] {
  if (_agencies) return _agencies;
  getSiteMeta();
  _agencies = readJson<AgencyRow[]>("agencies.json");
  return _agencies;
}

export function getAgencyMap(): Map<string, AgencyRow> {
  const agencies = getAgencies();
  return new Map(agencies.map((a) => [a.org, a]));
}

// ── citations.json ───────────────────────────────────────────────────────────

export type CitationKind =
  | "jbook_pdf"
  | "workbook"
  | "lda_filing"
  | "derived"
  | "usaspending"
  | "state_soql"
  | "state_file"
  | "jbook_narrative";

export interface CitationBase {
  kind: CitationKind;
  official_url: string | null;
  retrieved_at: string | null;
  units: string | null;
  /**
   * PM Sprint 1 Task 5 (§P0-4): the program (PE/BLI) this fact appears on,
   * emitted for the kinds whose citation rows carry it (jbook_pdf, workbook,
   * lda_filing). Optional: shards built before the exporter started emitting
   * it lack the key entirely, and derived/geography kinds have no single
   * parent program. The /fact/{id} resolver renders an "Appears on"
   * /program/{pe_bli}/#fact-{id} link only when present.
   */
  pe_bli?: string | null;
  /**
   * Phase 5B-3 citation-tier fields (nullable; populated for the
   * derived / usaspending / state_soql / state_file kinds only):
   *   formula        — human-readable derivation formula or pointer note
   *   inputs         — JSON array string of 16-hex fact_ids and/or URLs
   *   query_body     — JSON filter body (usaspending) or query text
   *   recorded_value — value captured at export time (string decimal)
   */
  formula: string | null;
  inputs: string | null;
  query_body: string | null;
  recorded_value: string | null;
}

export interface JbookPdfCitation extends CitationBase {
  kind: "jbook_pdf";
  amount_text: string | null;
  amount_thousands: null;
  bottom_pt: number;
  cells: null;
  hosted_pdf_url: string;
  page_height: number;
  page_number: number;
  page_width: number;
  resolution: "unique" | "ambiguous_first";
  sha256: string;
  sheet: null;
  top_pt: number;
  x0: number;
  x1: number;
  xml_path: null;
}

export interface WorkbookCitation extends CitationBase {
  kind: "workbook";
  amount_text: null;
  amount_thousands: number;
  bottom_pt: null;
  cells: string;
  hosted_pdf_url: null;
  page_height: null;
  page_number: null;
  page_width: null;
  resolution: null;
  sha256: string;
  sheet: string;
  top_pt: null;
  x0: null;
  x1: null;
  xml_path: null;
}

export interface LdaFilingCitation extends CitationBase {
  kind: "lda_filing";
  amount_text: null;
  amount_thousands: null;
  bottom_pt: null;
  cells: null;
  hosted_pdf_url: null;
  page_height: null;
  page_number: null;
  page_width: null;
  resolution: null;
  sha256: null;
  sheet: null;
  top_pt: null;
  x0: null;
  x1: null;
  xml_path: null;
}

/** Shared null-bbox shape for the non-document citation kinds. */
interface NonDocumentCitationFields {
  amount_text: null;
  amount_thousands: null;
  bottom_pt: null;
  cells: null;
  hosted_pdf_url: null;
  page_height: null;
  page_number: null;
  page_width: null;
  resolution: null;
  sha256: null;
  sheet: null;
  top_pt: null;
  x0: null;
  x1: null;
  xml_path: null;
}

/**
 * derived — figure computed from warehouse data (trajectory totals, agency
 * sums, HHI, entity obligations, influence dollars, per-capita).
 * formula + recorded_value always present; inputs is a JSON array string of
 * 16-hex fact_ids (recomputable chain) and/or source URLs.
 */
export interface DerivedCitation extends CitationBase, NonDocumentCitationFields {
  kind: "derived";
  formula: string;
  inputs: string;
  recorded_value: string;
}

/**
 * usaspending — durable artifact is {endpoint (official_url), query_body}.
 * recorded_value captured at export; live API results may drift.
 * official_url may be the API endpoint, a usaspending.gov search-hash
 * permalink (when minted), or a recipient profile URL.
 */
export interface UsaspendingCitation extends CitationBase, NonDocumentCitationFields {
  kind: "usaspending";
  official_url: string;
  query_body: string;
  recorded_value: string;
}

/**
 * state_soql — CT Socrata aggregate; official_url is the exact SoQL URL.
 * The CT dataset refreshes nightly, so live results may drift from the
 * captured value.
 */
export interface StateSoqlCitation extends CitationBase, NonDocumentCitationFields {
  kind: "state_soql";
  official_url: string;
  recorded_value: string;
  retrieved_at: string;
}

/**
 * state_file — CA Open Fi$Cal pointer tier; official_url is the pointer page,
 * formula carries the pointer/aggregation note.
 */
export interface StateFileCitation extends CitationBase, NonDocumentCitationFields {
  kind: "state_file";
  official_url: string;
  recorded_value: string;
  retrieved_at: string;
}

/**
 * jbook_narrative — J-book narrative text (program descriptions, project
 * narratives, accomplishments, plans).  Minted one-per-row from
 * detail_narratives; sha256 identifies the source document; xml_path is the
 * J-book XML locator; official_url is the document's hosted source URL.
 *
 * Phase 5F §2b: 2,449 of 2,457 narrative citations now carry the passage
 * START's page + bbox (page_number, x0/x1/top_pt/bottom_pt, hosted_pdf_url,
 * resolution) derived by the narrative provenance builder — the panel then
 * renders the PDF page with the passage highlight, like the jbook_pdf card.
 * The 8 unresolved citations keep null page fields (OCR-hostile layouts) and
 * render the non-paged card — never a fake location.
 *
 * Null fields: sheet/cells/amount fields are always null.
 */
export interface JbookNarrativeCitation
  extends CitationBase,
    Omit<
      NonDocumentCitationFields,
      | "sha256"
      | "xml_path"
      | "hosted_pdf_url"
      | "page_number"
      | "page_width"
      | "page_height"
      | "top_pt"
      | "bottom_pt"
      | "x0"
      | "x1"
      | "resolution"
    > {
  kind: "jbook_narrative";
  // Unlike other non-document kinds, narratives DO carry the source
  // document's sha and their in-document XML locator.
  sha256: string;
  xml_path: string;
  official_url: string;
  // Passage-start page provenance (null for the 8 unresolved narratives).
  hosted_pdf_url: string | null;
  page_number: number | null;
  page_width: number | null;
  page_height: number | null;
  top_pt: number | null;
  bottom_pt: number | null;
  x0: number | null;
  x1: number | null;
  resolution: "unique" | "ambiguous_first" | null;
}

export type Citation =
  | JbookPdfCitation
  | WorkbookCitation
  | LdaFilingCitation
  | DerivedCitation
  | UsaspendingCitation
  | StateSoqlCitation
  | StateFileCitation
  | JbookNarrativeCitation;

export type CitationsMap = Record<string, Citation>;

let _citations: CitationsMap | null = null;

export function getCitations(): CitationsMap {
  if (_citations) return _citations;
  getSiteMeta();
  _citations = readJson<CitationsMap>("citations.json");
  return _citations;
}

export function getCitation(factId: string): Citation | undefined {
  return getCitations()[factId];
}

/**
 * Return a slice of citations.json containing ONLY the given fact_ids.
 * Memoized via getCitations() (loaded once per build process).
 *
 * Unknown fact_ids are silently skipped (zero_amount facts have no citations row).
 * Pass the complete set of fact_ids for a page to produce the per-page slice.
 */
export function collectCitations(factIds: string[]): CitationsMap {
  const all = getCitations();
  const result: CitationsMap = {};
  for (const id of factIds) {
    if (id in all) {
      result[id] = all[id];
    }
  }
  return result;
}

/** 16-hex fact_id pattern (matches export_site identity hashes). */
const FACT_ID_RE = /^[0-9a-f]{16}$/;

/**
 * Like collectCitations, but ALSO pulls in ONE level of derived-citation
 * inputs: for every requested fact_id whose citation is kind='derived',
 * any 16-hex entries in its inputs JSON array are added to the slice too.
 *
 * This makes derived-card input chips clickable (they open their own
 * citation in the panel) without shipping the full citations map.
 * URL inputs are ignored (rendered as external links, no slice entry).
 */
export function collectCitationsWithInputs(factIds: string[]): CitationsMap {
  const all = getCitations();
  const result = collectCitations(factIds);
  for (const id of Object.keys(result)) {
    const c = result[id];
    if (c.kind !== "derived" || !c.inputs) continue;
    let inputs: unknown;
    try {
      inputs = JSON.parse(c.inputs);
    } catch {
      continue;
    }
    if (!Array.isArray(inputs)) continue;
    for (const inp of inputs) {
      if (typeof inp === "string" && FACT_ID_RE.test(inp) && inp in all) {
        result[inp] = all[inp];
      }
    }
  }
  return result;
}

// ── Receipt moment (home page, Phase 5C Goal 1) ──────────────────────────────

export interface ReceiptMomentFact {
  pe_bli: string;
  title: string;
  org: string;
  /** FY2024-actuals amount, USD millions (J-book detail row units). */
  amount_millions: number;
  /** jbook_pdf citation fact_id — resolves in citations.json (kind guaranteed). */
  fact_id: string;
  /** PDF page the amount is printed on (from the jbook_pdf citation). */
  page_number: number;
}

/** J-book detail scenario whose column is FY2024 actuals (FY2026 J-books). */
const RECEIPT_FY24_SCENARIO = "PriorYear";

/** Bound the detail-file scan — the top program yields in practice. */
const RECEIPT_SCAN_CAP = 20;

let _receiptMomentFact: ReceiptMomentFact | null | undefined;

/**
 * The home page's "receipt moment" figure: the LARGEST FY2024-actuals amount
 * whose citation is kind=jbook_pdf — a figure literally printed on a J-book
 * PDF page, so the citation panel opens the page render with the amber
 * highlight (spec Goal 1: "the page it's printed on").
 *
 * Selection (build time, memoized): iterate programs sorted by FY24 dollars
 * descending, load each program's details, and return the largest
 * FY24-actuals (scenario "PriorYear") jbook_pdf-cited row of the FIRST
 * program that has one — typically the first program. The scan is hard-capped
 * at RECEIPT_SCAN_CAP detail files. Null when no candidate exists (the home
 * page then renders no receipt moment — G4 fails loudly).
 */
export function getReceiptMomentFact(): ReceiptMomentFact | null {
  if (_receiptMomentFact !== undefined) return _receiptMomentFact;
  const citations = getCitations();

  // FY24 dollars in USD thousands (trajectory) or millions × 1000 (rollup) —
  // whichever is known; programs with neither are excluded.
  const fy24Thousands = (p: ProgramRow): number => {
    const t = p.trajectory?.fy2024_actuals ?? null;
    const m =
      p.fy2024_actual_millions != null ? p.fy2024_actual_millions * 1000 : null;
    return Math.max(t ?? -Infinity, m ?? -Infinity);
  };

  const ranked = getPrograms()
    .filter((p) => fy24Thousands(p) > 0)
    .sort((a, b) => fy24Thousands(b) - fy24Thousands(a))
    .slice(0, RECEIPT_SCAN_CAP);

  for (const p of ranked) {
    let best: { row: ProgramDetailRow; page_number: number } | null = null;
    for (const row of getProgramDetails(p.pe_bli).details) {
      if (row.scenario !== RECEIPT_FY24_SCENARIO || !row.fact_id) continue;
      const citation = citations[row.fact_id];
      if (!citation || citation.kind !== "jbook_pdf") continue;
      if (!best || row.amount_millions > best.row.amount_millions) {
        best = { row, page_number: citation.page_number };
      }
    }
    if (best) {
      _receiptMomentFact = {
        pe_bli: p.pe_bli,
        title: p.title,
        org: p.org,
        amount_millions: best.row.amount_millions,
        fact_id: best.row.fact_id,
        page_number: best.page_number,
      };
      return _receiptMomentFact;
    }
  }
  _receiptMomentFact = null;
  return _receiptMomentFact;
}

// ── feed.json ─────────────────────────────────────────────────────────────────

/**
 * One run of a feed headline: plain prose, or a dollar token with the fact id
 * of the figure it prints (ROADMAP backlog #44).
 *
 * `amount` is the token EXACTLY as the exporter formatted it and is rendered
 * verbatim — never re-derived from the fact. The two are not always the same
 * string by design: a request-vs-actuals gap prints |delta| beside the word
 * "above" or "below", while the fact it cites is the signed value.
 */
export type FeedHeadlineSegment =
  | { text: string; amount?: undefined; fact_id?: undefined }
  | { amount: string; fact_id: string; text?: undefined };

export interface FeedCard {
  event_type:
    | "yoy_swing"
    | "zeroed_fy2026"
    | "concentration_shift"
    | "new_entrant"
    | "request_vs_actuals_gap";
  family_key: string | null;
  figure_fact_id: string | null;
  figure_units: string;
  figure_value: number | null;
  fiscal_year: number | null;
  headline: string;
  /**
   * ROADMAP backlog #44 — the same sentence as `headline`, split so its
   * dollar tokens can carry the fact id of the figure they print.
   *
   * A feed headline is a sentence the export pipeline COMPOSES. Its dollar
   * tokens are site-computed figures on the most-forwarded, least-context
   * surface the site has, and while the headline was one flat string they
   * were the only figures on the site a reader could not click through to a
   * source. The amount segments render as <ProseCite>: dotted underline,
   * opens the citation panel, and render-static (a1) asserts every one of
   * those fact ids resolves in citations.json.
   *
   * The exporter guarantees `segments.map(text).join("") === headline`, and
   * that a dollar figure only appears at all when its fact resolves — where
   * it does not, the money clause is dropped rather than printed uncitable.
   *
   * Optional for pre-#44 exports; feedHeadlineSegments falls back to a single
   * text segment, which the currency gate will then fail on any card that
   * prints money — the honest failure, not a silent exemption.
   */
  headline_segments?: FeedHeadlineSegment[];
  organization: string | null;
  pe_bli: string | null;
  program_url: string | null;
  /**
   * Program title resolved by the export pipeline (dim_programs first,
   * fct_budget_lines titled detail rows as fallback). Null for
   * family_key-based cards (new_entrant) and unresolvable pe_blis.
   * The sidecar headline already LEADS with this title when present.
   */
  title: string | null;
  why_url: string;
  /** Basis threading (PM Sprint 1): non-null on budget-figure cards
   *  (yoy_swing / zeroed_fy2026 / request_vs_actuals_gap). */
  basis: string | null;
  fy: number | null;
  measure: string | null;
  edition: number | null;
  /**
   * §P1-8 — the DOLLARS the event is about, emitted by the exporter for every
   * card. "increased 79%" is not a story until the reader knows 79% of what:
   * a 79% swing on a $50M line and on a $5B line are different events.
   *
   * kind='pair'   two real endpoints (from → to) plus their delta.
   * kind='single' one dollar magnitude (an award total) — stated as such
   *               rather than paired against an invented base.
   * Each point carries its OWN cited fact id, so the base, the new figure and
   * the change each open their own receipt.
   */
  magnitude: FeedMagnitude | null;
  /**
   * backlog #54 — the SAME Fy26Split shape /program/*\/ sidecars carry
   * (backlog #50), set on a yoy_swing card exactly when its PE has a real
   * fy_2026_reconciliation_request row (has_reconciliation true). Non-null
   * means the combined pct_change this card headlines is not a like-for-like
   * rate — the site renders <Fy26SplitNote> (imported from
   * program-figures.tsx, the SAME component and vocabulary /program/*\/
   * uses) to state the discretionary-only rate beside it. Null for every
   * other event type and for a yoy_swing card whose PE carries no
   * reconciliation money. Optional for pre-#54 sidecars.
   */
  fy26_split?: Fy26Split | null;
}

export interface FeedMagnitudePoint {
  label: string;
  fy: number | null;
  value: number;
  /** Cited derived/workbook fact id — null renders honest state C. */
  fact_id: string | null;
}

export interface FeedMagnitude {
  kind: "pair" | "single";
  /** Card-side units vocabulary: 'thousands_usd' | 'dollars'. */
  units: string;
  from: FeedMagnitudePoint | null;
  to: FeedMagnitudePoint | null;
  delta: FeedMagnitudePoint | null;
  pct_change: number | null;
}

export interface FeedSidecar {
  cards: FeedCard[];
  total: number;
  /** §P0-5 corpus scope qualifier — rendered once per superlative section. */
  scope_qualifier?: string;
}

let _feed: FeedSidecar | null = null;

export function getFeed(): FeedSidecar {
  if (_feed) return _feed;
  getSiteMeta();
  _feed = readJson<FeedSidecar>("feed.json");
  return _feed;
}

// pe_bli → title lookup for feedDisplayHeadline (memoized once per build).
let _programTitleByPeBli: Map<string, string> | null = null;

/**
 * Display headline for a feed card (V3 journey legibility).
 *
 * The export pipeline resolves a program title for every pe_bli event
 * (card.title) and builds the sidecar headline with that title LEADING —
 * a title-led headline passes through verbatim (the sidecar title wins;
 * never prepend it again or the card reads "Title Title increased 79%").
 *
 * Defense-in-depth for a code-led headline (only possible when the exporter
 * could not resolve a title): swap the leading code for card.title first,
 * then the programs-index title; keep the raw code as the honest fallback —
 * never invent a name. The code is demoted to the card's secondary metadata
 * line either way. Display-only: feed.json is unchanged.
 */
export function feedDisplayHeadline(card: FeedCard): string {
  if (!card.pe_bli || !card.headline.startsWith(card.pe_bli)) {
    return card.headline;
  }
  if (!_programTitleByPeBli) {
    _programTitleByPeBli = new Map(
      getPrograms().map((p) => [p.pe_bli, p.title]),
    );
  }
  const title = card.title ?? _programTitleByPeBli.get(card.pe_bli);
  if (!title) return card.headline;
  return `${title}${card.headline.slice(card.pe_bli.length)}`;
}

/**
 * The display headline as SEGMENTS (ROADMAP backlog #44) — what <FeedHeadline>
 * renders, so every dollar token in it can carry its receipt.
 *
 * Applies the same code→title swap feedDisplayHeadline does, to the leading
 * TEXT segment only (the code can only ever lead the sentence, and an amount
 * segment is never the first). Falls back to one text segment carrying the
 * flat headline when the sidecar predates #44 — which leaves any dollar token
 * on it unanchored, and therefore visible to the currency gate rather than
 * silently exempt.
 */
export function feedHeadlineSegments(card: FeedCard): FeedHeadlineSegment[] {
  const segments = card.headline_segments;
  if (!segments || segments.length === 0) {
    return [{ text: feedDisplayHeadline(card) }];
  }
  const display = feedDisplayHeadline(card);
  if (display === card.headline) return segments;
  // The swap only ever rewrites the leading run; splice it back in place.
  const [first, ...rest] = segments;
  if (first.text === undefined) return segments;
  const swapped = display.slice(
    0,
    display.length - (card.headline.length - first.text.length),
  );
  return [{ text: swapped }, ...rest];
}

// ── districts/index.json ──────────────────────────────────────────────────────

export interface DistrictIndexRow {
  pop_district: string;
  pop_state: string;
  program_count: number;
  /** #51: distinct high-confidence-crosswalked awards behind this district's
   *  total — from fct_district_totals, never a program-element count. */
  award_count: number;
  total_cited_dollars: number;
  /** Derived 'district' surface fact_id — null when the citation is absent. */
  total_cited_fact_id: string | null;
  total_linkable_dollars: number;
  /** Derived 'district' surface fact_id — null when the citation is absent. */
  total_linkable_fact_id: string | null;
}

export interface DistrictIndex {
  districts: DistrictIndexRow[];
  geo_grand_total: number | null;
  geo_grand_total_dataset: string;
  /** Derived 'geography' grand-total fact_id — null when the citation is absent. */
  geo_grand_total_fact_id: string | null;
  total_districts: number;
}

let _districtIndex: DistrictIndex | null = null;

export function getDistrictIndex(): DistrictIndex {
  if (_districtIndex) return _districtIndex;
  getSiteMeta();
  _districtIndex = readJson<DistrictIndex>("districts/index.json");
  return _districtIndex;
}

// ── districts/{pop_district}.json ─────────────────────────────────────────────

export interface DistrictProgram {
  award_count: number;
  fact_id: string | null;
  organization: string;
  pe_bli: string;
  program_url: string;
  recipient_count: number;
  /** #51: the largest number of program elements any one of this row's
   *  underlying awards is ALSO crosswalked to. 1 means "not shared"; >1 is
   *  the AK-00 tell — one award attributed whole to each of N elements. */
  shared_award_count: number;
  title: string;
  total_obligation: number | null;
  transaction_count: number;
}

export interface DistrictDetail {
  pop_district: string;
  pop_state: string;
  program_count: number;
  /** #51: distinct high-confidence-crosswalked awards behind this district's
   *  total — from fct_district_totals, never a program-element count. */
  award_count: number;
  programs: DistrictProgram[];
  total_cited_dollars: number;
  /** Derived 'district' surface fact_id — null when the citation is absent. */
  total_cited_fact_id: string | null;
  total_linkable_dollars: number;
  /** Derived 'district' surface fact_id — null when the citation is absent. */
  total_linkable_fact_id: string | null;
}

const _districtDetails = new Map<string, DistrictDetail>();

export function getDistrictDetail(popDistrict: string): DistrictDetail {
  if (_districtDetails.has(popDistrict)) return _districtDetails.get(popDistrict)!;
  getSiteMeta();
  const detail = readJson<DistrictDetail>(`districts/${popDistrict}.json`);
  _districtDetails.set(popDistrict, detail);
  return detail;
}

// ── flows/{pe_bli}.json ───────────────────────────────────────────────────────

export interface FlowAward {
  confidence: "high";
  /** pop district with state prefix, e.g. 'CO-05'. */
  district: string | null;
  /** Transaction-sum dollars for this award (illustrative in the SVG; the
   *  CITED dollars are the per-district mart rows below the diagram). */
  dollars: number | null;
  family_slug: string;
  piid: string;
  recipient_name: string;
}

export interface FlowSidecar {
  awards: FlowAward[];
  header: {
    /** FY2026 trajectory total, USD thousands (nullable). */
    fy2026_total: number | null;
    org: string | null;
    pe_bli: string;
    title: string | null;
  };
}

const _flows = new Map<string, FlowSidecar | null>();

/**
 * Flow sidecar for a crosswalked program — null when the program has no
 * flows/{pe_bli}.json (only the 17 crosswalked programs have one).
 */
export function getFlow(peBli: string): FlowSidecar | null {
  if (_flows.has(peBli)) return _flows.get(peBli)!;
  getSiteMeta();
  let flow: FlowSidecar | null = null;
  try {
    flow = readJson<FlowSidecar>(`flows/${peBli}.json`);
  } catch {
    flow = null;
  }
  _flows.set(peBli, flow);
  return flow;
}

// ── gao_overlays.json ─────────────────────────────────────────────────────────

export interface GaoHighRiskArea {
  area_title: string;
  area_url: string | null;
  notes: string | null;
  source_url: string | null;
}

export interface GaoImproperExposure {
  agency_code: string;
  derived_improper_amount_usd: number;
  /** Derived-tier citation fact_id (nullable when uncited). */
  fact_id: string | null;
  latest_fiscal_year: number | null;
  program_count: number | null;
  weighted_rate_pct: number | null;
}

export interface GaoAgencyOverlay {
  high_risk_areas: GaoHighRiskArea[];
  improper: GaoImproperExposure | null;
}

export interface GaoOverlays {
  agencies: Record<string, GaoAgencyOverlay>;
  agency_code_by_org: Record<string, string>;
}

let _gaoOverlays: GaoOverlays | null | undefined;

/** GAO overlays sidecar — null when not exported (overlay sections hidden). */
export function getGaoOverlays(): GaoOverlays | null {
  if (_gaoOverlays !== undefined) return _gaoOverlays;
  getSiteMeta();
  try {
    _gaoOverlays = readJson<GaoOverlays>("gao_overlays.json");
  } catch {
    _gaoOverlays = null;
  }
  return _gaoOverlays;
}

/** Overlay for one site org (agency page / program badge), or null. */
export function getGaoOverlayForOrg(
  org: string,
): { agencyCode: string; overlay: GaoAgencyOverlay } | null {
  const overlays = getGaoOverlays();
  if (!overlays) return null;
  const agencyCode = overlays.agency_code_by_org[org];
  if (!agencyCode) return null;
  const overlay = overlays.agencies[agencyCode];
  if (!overlay) return null;
  if (overlay.high_risk_areas.length === 0 && !overlay.improper) return null;
  return { agencyCode, overlay };
}

// ── gao_program_findings.json (ROADMAP #30 — the PROGRAM tier) ───────────────

export interface GaoAssessment {
  assessment_type: string;
  common_name: string;
  description: string;
  gao_program: string;
  pdf_page: number;
  pdf_url: string;
  product_number: string;
  released: string;
  report_page: number;
  report_title: string;
  report_url: string;
  service: string;
}

export interface GaoRelatedReport {
  gao_program: string;
  product_number: string;
  released: string;
  report_title: string;
  report_url: string;
}

export interface GaoProgramFindings {
  assessments: GaoAssessment[];
  reports: GaoRelatedReport[];
}

export interface GaoCrosswalkStats {
  accepted: number;
  adjudicated: number;
  assessments_ingested: number;
  pages_with_findings: number;
  precision_pct: number;
  rejected: number;
  related_ingested: number;
  rendered_items: number;
}

interface GaoProgramFindingsFile {
  source: { product_number: string; report_url: string }[] | null;
  by_slug: Record<string, GaoProgramFindings>;
  stats: GaoCrosswalkStats | null;
}

let _gaoProgramFindings: GaoProgramFindingsFile | null | undefined;

function gaoProgramFindingsFile(): GaoProgramFindingsFile | null {
  if (_gaoProgramFindings === undefined) {
    getSiteMeta();
    try {
      _gaoProgramFindings = readJson<GaoProgramFindingsFile>(
        "gao_program_findings.json",
      );
    } catch {
      _gaoProgramFindings = null;
    }
  }
  return _gaoProgramFindings;
}

/** Crosswalk precision measurement, for /methodology/. Never a literal. */
export function getGaoCrosswalkStats(): GaoCrosswalkStats | null {
  return gaoProgramFindingsFile()?.stats ?? null;
}

/**
 * Program-tier GAO work for one page, or null.
 *
 * Keyed by page SLUG, never by pe_bli: 23 budget lines share a pe_bli with an
 * unrelated program in another appropriation account, and attaching a GAO
 * finding to the wrong weapons program is the failure this whole feature is
 * designed around.
 */
export function getGaoProgramFindings(slug: string): GaoProgramFindings | null {
  const file = gaoProgramFindingsFile();
  if (!file) return null;
  const hit = file.by_slug[slug];
  if (!hit) return null;
  if (hit.assessments.length === 0 && hit.reports.length === 0) return null;
  return hit;
}

// ── categories.json (Task 8a — top-50 hero categories) ───────────────────────

export type HeroCategory =
  | "drones"
  | "hypersonics"
  | "space"
  | "shipbuilding"
  | "cyber"
  | "default";

let _categories: Record<string, HeroCategory> | null | undefined;

/**
 * pe_bli → category mapping for the top-50 dossier programs (from
 * data-seeds/program_categories.csv via export-site). Membership here IS the
 * top-50 test: only these program pages get a hero background.
 * Null when the sidecar has not been exported (no heroes — graceful).
 */
export function getCategories(): Record<string, HeroCategory> | null {
  if (_categories !== undefined) return _categories;
  getSiteMeta();
  try {
    _categories = readJson<Record<string, HeroCategory>>("categories.json");
  } catch {
    _categories = null;
  }
  return _categories;
}

// ── dossiers/{pe_bli}.json (Task 8a — gated dossiers, cited-or-absent) ───────

const _dossiers = new Map<string, DossierFile | null>();

/**
 * Load + re-verify a GATED dossier for a program page.
 *
 * - File absent (the normal case until the live batch lands): returns null —
 *   the page renders no dossier section (zero placeholder text).
 * - File present but structurally invalid OR citing a fact_id that does not
 *   resolve in citations.json OR a url that is not a cached research
 *   snapshot: THROWS a loud build error. The Python dossier gate should have
 *   rejected it; the site must not render ungated content silently.
 */
export function getDossier(peBli: string): DossierFile | null {
  if (_dossiers.has(peBli)) return _dossiers.get(peBli)!;
  getSiteMeta();
  const full = join(jsonDir(), "dossiers", `${peBli}.json`);
  if (!existsSync(full)) {
    _dossiers.set(peBli, null);
    return null;
  }
  // NO try/catch around parse/validate — malformed or ungated dossiers must
  // fail the build loudly, not degrade to "no dossier".
  const raw = JSON.parse(readFileSync(full, "utf8")) as unknown;
  const file = parseDossier(raw, peBli);
  validateDossierCitations(
    file,
    new Set(Object.keys(getCitations())),
    new Set(Object.keys(getSnapshotMeta())),
  );
  _dossiers.set(peBli, file);
  return file;
}

// ── research snapshots index (url → {title, retrieved_at}) ───────────────────

let _snapshotMeta: Record<string, SnapshotMeta> | undefined;

/**
 * url → snapshot metadata from data/research/snapshots/index.json (committed
 * research cache). Used to validate dossier url citations and to render the
 * url-chip tooltip ("title — retrieved YYYY-MM-DD"). Empty when the index
 * is absent (then any url-citing dossier fails validation, by design).
 */
export function getSnapshotMeta(): Record<string, SnapshotMeta> {
  if (_snapshotMeta !== undefined) return _snapshotMeta;
  const full = join(
    process.cwd(),
    "..",
    "data",
    "research",
    "snapshots",
    "index.json",
  );
  const meta: Record<string, SnapshotMeta> = {};
  try {
    const index = JSON.parse(readFileSync(full, "utf8")) as {
      snapshots?: { url?: string; title?: string; retrieved_at?: string }[];
    };
    for (const snap of index.snapshots ?? []) {
      if (snap.url) {
        meta[snap.url] = {
          retrieved_at: snap.retrieved_at ?? null,
          title: snap.title ?? null,
        };
      }
    }
  } catch {
    // index absent — empty map
  }
  _snapshotMeta = meta;
  return _snapshotMeta;
}

// ── filings_index.json ────────────────────────────────────────────────────────

export interface FilingIndexRow {
  client_name: string | null;
  filing_type: string | null;
  filing_uuid: string;
  filing_year: string | null;
  /** True when the filing mentions ≥1 tracked program — drives noindex policy. */
  has_mentions: boolean;
  mention_count: number;
  registrant_name: string | null;
}

export interface FilingsIndex {
  filings: FilingIndexRow[];
  total: number;
}

let _filingsIndex: FilingsIndex | null = null;

export function getFilingsIndex(): FilingsIndex {
  if (_filingsIndex) return _filingsIndex;
  getSiteMeta();
  _filingsIndex = readJson<FilingsIndex>("filings_index.json");
  return _filingsIndex;
}

// ── filings/{uuid}.json ───────────────────────────────────────────────────────

export interface FilingHeader {
  client_name: string | null;
  /** Non-null IFF expenses_usd is non-null (state A or "not reported"). */
  expenses_fact_id: string | null;
  expenses_usd: number | null;
  filing_period: string | null;
  filing_type: string | null;
  filing_uuid: string;
  filing_year: string | null;
  /** Non-null IFF income_usd is non-null (state A or "not reported"). */
  income_fact_id: string | null;
  income_usd: number | null;
  registrant_name: string | null;
  /** LDA JSON API URL — humanLdaUrl() derives the human filing page. */
  url: string;
}

export interface FilingActivity {
  description: string | null;
  issue_code: string | null;
  issue_display: string | null;
}

export interface FilingLobbyist {
  /** Non-empty → revolving-door badge (prior covered government position). */
  covered_position: string | null;
  name: string;
}

export interface FilingMention {
  description_snippet: string | null;
  matched_term: string | null;
  /**
   * (#52) which evidence tier qualified this row: 'pe_literal' | 'alias' |
   * 'multi_token'. A single common title word is never sufficient on its
   * own — see site/src/lib/evidence.ts for the rendered label.
   */
  evidence_kind: string | null;
  pe_bli: string;
  program_title: string | null;
  /** Null when pe_bli has no program page (plain-text mention). */
  program_url: string | null;
}

export interface FilingDetail {
  activities: FilingActivity[];
  filing: FilingHeader;
  lobbyists: FilingLobbyist[];
  mentions: FilingMention[];
}

export function getFilingDetail(uuid: string): FilingDetail {
  getSiteMeta();
  // No memo map: 4,258 filings are each read exactly once during SSG.
  return readJson<FilingDetail>(`filings/${uuid}.json`);
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isJbookPdf(c: Citation): c is JbookPdfCitation {
  return c.kind === "jbook_pdf";
}

export function isWorkbook(c: Citation): c is WorkbookCitation {
  return c.kind === "workbook";
}

export function isLdaFiling(c: Citation): c is LdaFilingCitation {
  return c.kind === "lda_filing";
}

export function isDerived(c: Citation): c is DerivedCitation {
  return c.kind === "derived";
}

export function isUsaspending(c: Citation): c is UsaspendingCitation {
  return c.kind === "usaspending";
}

export function isStateSoql(c: Citation): c is StateSoqlCitation {
  return c.kind === "state_soql";
}

export function isStateFile(c: Citation): c is StateFileCitation {
  return c.kind === "state_file";
}

// ── flow_chart.json meta (Phase 5H — /flow/ server shell + coverage) ─────────

export interface FlowBridgeStats {
  crosswalkedPeCount: number;
  universePeCount: number;
  highConfidencePeCount: number;
  /** Share of the FY2026 request not yet crosswalked, one decimal ("98.7"). */
  pctNotCrosswalked: string;
}

export interface FlowChartMeta {
  budgetLabel: string;
  budgetUnits: string;
  budgetFy: number;
  spendUnits: string;
  spendFys: number[];
  defaultFy: number;
  fy2026Partial: boolean;
  sourceNote: string;
  offersNote: string;
  bridge: FlowBridgeStats;
}

let _flowChartMeta: FlowChartMeta | null = null;

// ── lineage_flow.json (ROADMAP #29(c)) ───────────────────────────────────────

let _lineageFlow: LineageFlowPayload | null = null;

/**
 * The /lineage/ identity-diagram payload.
 *
 * Read SERVER-side and passed to the island as props rather than fetched by
 * the client the way /flow/ fetches its Sankey: the payload is two orders of
 * magnitude smaller (80 identities, 52 links, no per-year series and no
 * source sentences), and rendering it into the static HTML is what lets gate
 * 2, gate 22 leg (g) and verify-lineage leg (i) assert the honesty contract
 * against the BUILT artifact instead of against a payload nobody has drawn.
 */
export function getLineageFlow(): LineageFlowPayload {
  if (_lineageFlow) return _lineageFlow;
  const payload = readJson<LineageFlowPayload>("lineage_flow.json");
  if (payload.schema_version !== 1) {
    throw new Error(
      `[govbudget/data] lineage_flow.json schema_version is ${payload.schema_version}, expected 1`,
    );
  }
  _lineageFlow = payload;
  return _lineageFlow;
}

/**
 * Light server-side meta extracted from the (heavy, client-fetched)
 * flow_chart.json export — the /flow/ shell and the flow-bridge coverage
 * note interpolate from here so no number is ever hardcoded in JSX.
 */
export function getFlowChartMeta(): FlowChartMeta {
  if (_flowChartMeta) return _flowChartMeta;
  const payload = readJson<FlowChartPayload>("flow_chart.json");
  if (payload.schema_version !== 1) {
    throw new Error(
      `[govbudget/data] flow_chart.json schema_version is ${payload.schema_version}, expected 1`,
    );
  }
  const b = payload.budget.bridge;
  _flowChartMeta = {
    budgetLabel: payload.budget.label,
    budgetUnits: payload.budget.units,
    budgetFy: payload.budget.fiscal_year,
    spendUnits: payload.spend.units,
    spendFys: payload.spend.fys,
    defaultFy: payload.spend.default_fy,
    fy2026Partial: payload.spend.notes.fy2026_partial,
    sourceNote: payload.spend.source_note,
    offersNote: payload.spend.notes.offers,
    bridge: {
      crosswalkedPeCount: b.crosswalked_pe_count,
      universePeCount: b.crosswalk_universe_pe_count,
      highConfidencePeCount: b.high_confidence_pe_count,
      pctNotCrosswalked: pctNotCrosswalked(
        b.not_yet_crosswalked_str,
        b.budget_total_str,
      ),
    },
  };
  return _flowChartMeta;
}

// ── Coverage count helpers (Phase 5C) ─────────────────────────────────────────

/** Number of crosswalked flow sidecars (programs with high-confidence budget→award links). */
export function getFlowsCount(): number {
  const flowsDir = join(jsonDir(), "flows");
  if (!existsSync(flowsDir)) return 0;
  return readdirSync(flowsDir).filter((f) => f.endsWith(".json")).length;
}

/** Total number of program pages (from programs.json length). */
export function getProgramsCount(): number {
  return getPrograms().length;
}

/**
 * Backlog #49: the dollar-denominated /programs/ coverage figure. Throws if
 * the export predates it (a page that renders "N of N" without also
 * rendering the dollar denominator is exactly the defect this closes) —
 * never falls back to a guessed or hardcoded percentage.
 */
export function getProgramsCoverage(): SiteMetaProgramsCoverage {
  const meta = getSiteMeta();
  if (!meta.programs_coverage) {
    throw new Error(
      "[govbudget/data] site_meta.json has no programs_coverage — re-run " +
        '"uv run python -m govbudget export-site" (backlog #49 added it).',
    );
  }
  return meta.programs_coverage;
}

/** Number of dossier sidecars present (gated, cited-or-absent research files). */
export function getDossierCount(): number {
  const dossiersDir = join(jsonDir(), "dossiers");
  if (!existsSync(dossiersDir)) return 0;
  return readdirSync(dossiersDir).filter((f) => f.endsWith(".json")).length;
}

/** Number of company pages (top entity profiles). */
export function getCompaniesCount(): number {
  return getEntitiesTop().length;
}

/** Number of company profiles that have at least one award row. */
export function getCompaniesWithAwardsCount(): number {
  const entityDetailsDir = join(jsonDir(), "entity_details");
  if (!existsSync(entityDetailsDir)) return 0;
  const files = readdirSync(entityDetailsDir).filter((f) => f.endsWith(".json"));
  let count = 0;
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(entityDetailsDir, f), "utf8")) as {
        awards?: unknown[];
      };
      if (Array.isArray(data.awards) && data.awards.length > 0) count++;
    } catch {
      // skip malformed files
    }
  }
  return count;
}

/** Number of congressional districts with linked defense dollars. */
export function getDistrictsCount(): number {
  return getDistrictIndex().districts.length;
}

// ── Coverage-map count helpers (PM Sprint 3 Task 6, §Coverage) ────────────────
//
// /coverage/ publishes what the site covers and what it does not, and its
// whole claim is that no number on it was typed by hand. These three answer
// the questions the 5C helpers above did not — each reads the SAME shipped
// artifact the corresponding surface renders from, so a page and its coverage
// row cannot disagree.

let _lineagePrograms: number | null = null;

/**
 * Programs whose sidecar carries a non-empty lineage rail (a predecessor or
 * successor edge — stated or inferred).
 *
 * Reads all program_details sidecars, but PARSES only the ones whose bytes
 * contain the key: 1,993 files / 51 MB where 50 carry a rail, so a blind
 * JSON.parse of the set would cost a second of every build to answer one
 * number. The substring is a prefilter, never the answer — the count comes
 * from the parsed rail.
 */
export function getLineagePrograms(): number {
  if (_lineagePrograms !== null) return _lineagePrograms;
  const dir = join(jsonDir(), "program_details");
  if (!existsSync(dir)) return (_lineagePrograms = 0);
  let count = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    if (!raw.includes('"lineage"')) continue;
    try {
      const rail = (JSON.parse(raw) as { lineage?: LineageBlock | null }).lineage
        ?.rail;
      if (!rail) continue;
      if ((rail.predecessors?.length ?? 0) + (rail.successors?.length ?? 0) > 0) {
        count++;
      }
    } catch {
      // skip malformed files
    }
  }
  return (_lineagePrograms = count);
}

// ── Program-level decade cells for the /programs/ index ──────────────────────

export interface DecadeCell {
  /** USD thousands. */
  v: number;
  /** fact_id — the SAME fact the program page and /years/ cite. */
  fid: string;
}

export interface ProgramDecadeCells {
  /** FY2024 actuals as the PB2026 book reports them (decade kind "actuals"). */
  fy24: DecadeCell | null;
  /** The FY2026 request from the PB2026 book (decade kind "request"). */
  fy26: DecadeCell | null;
}

let _programDecadeCells: Map<string, ProgramDecadeCells> | null = null;

/**
 * The PROGRAM-LEVEL money cells /programs/ renders, read from the same
 * years_matrix.json payload /years/ renders — so the index and the matrix are
 * the same figures with the same fact ids, not two derivations that agree by
 * luck.
 *
 * WHY NOT programs.json's `trajectory` (Sprint 3 round 3, gate 23 leg e).
 * programs.json holds one row per PE with one `org`, and its trajectory is
 * that org's SLICE. For 1,738 programs the declared org is the only org, so
 * the slice is the program and nothing shows. Three BLI codes are shared
 * across organisations, and there the index published a component as if it
 * were the program:
 *
 *   BLI 30  "Other Major Equipment"   index 408,006 (the OSD slice)
 *                                     program page 435,163 (all four orgs:
 *                                     OSD 408,006 + DMACT 13,012 +
 *                                     DTRA 12,787 + DoDEA 1,358)
 *   BLI 20  "Vehicles"                index    356   page   2,491
 *   BLI 500 "Personnel Administration" index 105,943 page 110,388
 *
 * Both money columns were affected, and the FY26 one had been shipping that
 * way since the column existed. The decade cells are program-level by
 * construction, so the join to /program/{pe}/ closes for all 1,741 rows.
 *
 * The two column keys are DERIVED from the payload's own decade_columns
 * (latest edition, kind "actuals" for the actual year and "request" for the
 * request year) rather than hardcoded, so a new edition moves them.
 */
export function getProgramDecadeCells(): Map<string, ProgramDecadeCells> {
  if (_programDecadeCells) return _programDecadeCells;
  const payload = readJson<{
    decade_columns?: { key: string; fy: number; kind: string; edition: number }[];
    orgs?: {
      programs?: {
        pe_bli: string;
        /** Sprint E, Task E3 — present only for a split-key program row. */
        slug?: string;
        cells?: Record<string, DecadeCell | null>;
      }[];
    }[];
  }>("years_matrix.json");

  const cols = payload.decade_columns ?? [];
  const latest = (kind: string): string | null => {
    const of = cols.filter((c) => c.kind === kind);
    if (of.length === 0) return null;
    return of.reduce((a, b) => (b.fy > a.fy || (b.fy === a.fy && b.edition > a.edition) ? b : a))
      .key;
  };
  const actualsKey = latest("actuals");
  const requestKey = latest("request");
  if (!actualsKey || !requestKey) {
    throw new Error(
      `[govbudget/data] years_matrix.json declares no decade column of kind ` +
        `"actuals" (${actualsKey}) and/or "request" (${requestKey}) — the /programs/ ` +
        `index sources both money columns from them.`,
    );
  }

  // Sprint E, Task E3 (ROADMAP #67): keyed by SLUG, not bare pe_bli — one of
  // the 8 appropriation-account collisions carries TWO years_matrix.json
  // program entries sharing one pe_bli (each with its own "slug" field,
  // emitted only when it differs from pe_bli), and a bare-pe_bli Map would
  // silently collapse them (whichever entry iterated last wins), showing
  // one program's FY24/FY26 decade cells on BOTH /programs/ rows.
  const out = new Map<string, ProgramDecadeCells>();
  for (const org of payload.orgs ?? []) {
    for (const p of org.programs ?? []) {
      out.set(p.slug ?? p.pe_bli, {
        fy24: p.cells?.[actualsKey] ?? null,
        fy26: p.cells?.[requestKey] ?? null,
      });
    }
  }
  return (_programDecadeCells = out);
}

let _decadeEditions: number[] | null = null;

/**
 * The President's-Budget editions the decade matrix actually loaded, ascending
 * — derived from years_matrix.json's own column stamps, which is what /years/
 * renders. "Ten editions" is never a literal here; it is this array's length.
 */
export function getDecadeEditions(): number[] {
  if (_decadeEditions) return _decadeEditions;
  const payload = readJson<{ decade_columns?: { edition?: number }[] }>(
    "years_matrix.json",
  );
  const eds = new Set<number>();
  for (const c of payload.decade_columns ?? []) {
    if (typeof c.edition === "number") eds.add(c.edition);
  }
  return (_decadeEditions = [...eds].sort((a, b) => a - b));
}

/** Total lobbying filings in the shipped index. */
export function getFilingsCount(): number {
  return getFilingsIndex().total;
}
