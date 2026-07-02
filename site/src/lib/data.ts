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
  /** xml_path of this narrative row in the J-book XML source. Used for
   *  data-xml-path on the data-source-text container (block-level citation). */
  xml_path?: string;
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
  | "state_file"
  | "jbook_narrative";

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

/**
 * jbook_narrative — J-book narrative text (program descriptions, project
 * narratives, accomplishments, plans).  Minted one-per-row from
 * detail_narratives; sha256 identifies the source document; xml_path is the
 * J-book XML locator; official_url is the document's hosted source URL.
 *
 * Null fields: all page/bbox/sheet/amount fields are null.
 */
export interface JbookNarrativeCitation
  extends CitationBase,
    Omit<NonDocumentCitationFields, "sha256" | "xml_path"> {
  kind: "jbook_narrative";
  // Unlike other non-document kinds, narratives DO carry the source
  // document's sha and their in-document XML locator.
  sha256: string;
  xml_path: string;
  official_url: string;
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
