import "server-only";

/**
 * Build-time (server-only) data loaders for GovBudget site.
 * Reads JSON sidecars from ../data/site/json/ relative to the repo root.
 * Throws with clear messages if files are missing or schema_version !== 1.
 *
 * All exports are cached via module-level memo (loaded once per build process).
 */

import { readFileSync } from "fs";
import { join } from "path";

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
  programs: number;
}

export interface SiteMeta {
  built_at: string;
  counts: SiteMetaCounts;
  pdf_base_url: string;
  schema_version: number;
  skipped_unresolved: number;
  skipped_zero_amount: number;
  uncited_datasets: string[];
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
  _siteMeta = meta;
  return _siteMeta;
}

// ── programs.json ────────────────────────────────────────────────────────────

export interface ProgramTrajectory {
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
  exhibit_family: string;
  fully_reconciled: boolean;
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
}

let _programs: ProgramRow[] | null = null;

export function getPrograms(): ProgramRow[] {
  if (_programs) return _programs;
  // Validate schema_version before loading any data
  getSiteMeta();
  _programs = readJson<ProgramRow[]>("programs.json");
  return _programs;
}

export function getProgramMap(): Map<string, ProgramRow> {
  const programs = getPrograms();
  return new Map(programs.map((p) => [p.pe_bli, p]));
}

// ── program_details/{pe_bli}.json ────────────────────────────────────────────

export interface ProgramDetailRow {
  amount_millions: number;
  fact_id: string;
  project_number: string | null;
  project_title: string | null;
  resolution: "unique" | "ambiguous_first" | "zero_amount";
  scenario: string;
  units: string;
  xml_path: string;
}

export interface ProgramNarrative {
  body: string;
  kind: string;
  title: string;
}

export interface ProgramBudgetLine {
  account_title: string;
  amount_thousands: number;
  amount_type: string;
  exhibit: string;
  fact_id: string;
  organization: string;
  source_cells: string;
  source_sheet: string;
  units: "USD thousands";
}

export interface ProgramAward {
  award_piid: string;
  confidence: string;
  recipient_name: string;
}

export interface ProgramMention {
  client_name: string;
  description_snippet: string;
  /** Can be null for dangling family_keys (2,781 / 32,780 lobbying rows). */
  family_key: string | null;
  filing_url: string;
  filing_uuid: string;
  filing_year: string;
  matched_term: string;
}

export interface ProgramDetails {
  awards: ProgramAward[];
  budget_lines: ProgramBudgetLine[];
  details: ProgramDetailRow[];
  mentions: ProgramMention[];
  narratives: ProgramNarrative[];
}

const _programDetails = new Map<string, ProgramDetails>();

export function getProgramDetails(peBli: string): ProgramDetails {
  if (_programDetails.has(peBli)) return _programDetails.get(peBli)!;
  getSiteMeta();
  const details = readJson<ProgramDetails>(`program_details/${peBli}.json`);
  _programDetails.set(peBli, details);
  return details;
}

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
  [key: string]: unknown;
}

export interface EntityMentionRow {
  filing_uuid: string;
  pe_bli: string;
  program_title: string;
  matched_term: string;
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
  | "state_file";

export interface CitationBase {
  kind: CitationKind;
  official_url: string | null;
  retrieved_at: string | null;
  units: string | null;
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

export type Citation =
  | JbookPdfCitation
  | WorkbookCitation
  | LdaFilingCitation
  | DerivedCitation
  | UsaspendingCitation
  | StateSoqlCitation
  | StateFileCitation;

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

// ── feed.json ─────────────────────────────────────────────────────────────────

export interface FeedCard {
  event_type: "yoy_swing" | "zeroed_fy2026" | "concentration_shift" | "new_entrant";
  family_key: string | null;
  figure_fact_id: string | null;
  figure_units: string;
  figure_value: number | null;
  fiscal_year: number | null;
  headline: string;
  organization: string | null;
  pe_bli: string | null;
  program_url: string | null;
  why_url: string;
}

export interface FeedSidecar {
  cards: FeedCard[];
  total: number;
}

let _feed: FeedSidecar | null = null;

export function getFeed(): FeedSidecar {
  if (_feed) return _feed;
  getSiteMeta();
  _feed = readJson<FeedSidecar>("feed.json");
  return _feed;
}

// ── districts/index.json ──────────────────────────────────────────────────────

export interface DistrictIndexRow {
  pop_district: string;
  pop_state: string;
  program_count: number;
  total_cited_dollars: number;
  total_linkable_dollars: number;
}

export interface DistrictIndex {
  districts: DistrictIndexRow[];
  geo_grand_total: number | null;
  geo_grand_total_dataset: string;
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
  title: string;
  total_obligation: number | null;
  transaction_count: number;
}

export interface DistrictDetail {
  pop_district: string;
  pop_state: string;
  program_count: number;
  programs: DistrictProgram[];
  total_cited_dollars: number;
  total_linkable_dollars: number;
}

const _districtDetails = new Map<string, DistrictDetail>();

export function getDistrictDetail(popDistrict: string): DistrictDetail {
  if (_districtDetails.has(popDistrict)) return _districtDetails.get(popDistrict)!;
  getSiteMeta();
  const detail = readJson<DistrictDetail>(`districts/${popDistrict}.json`);
  _districtDetails.set(popDistrict, detail);
  return detail;
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
