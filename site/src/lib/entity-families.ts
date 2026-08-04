/**
 * entity-families.ts — merge the curated corporate families into the
 * `/companies/` table (PM Sprint 2, §P1-3). PURE (no fs, no React).
 *
 * The defect: `/companies/` listed **RAYTHEON COMPANY $43.7B (#4)** and
 * **RTX CORP $24.6B (#6)** as two families. One company, renamed in 2023 —
 * the split understated the combined position by roughly half and misordered
 * the top ten.
 *
 * The merge, and its guard rails:
 *
 *  - Membership comes ONLY from the curated seed (data-seeds/
 *    entity_family_events.csv → entity_family_events.json). Nothing here
 *    infers a family from a name.
 *  - A registry row belongs to AT MOST ONE family (the exporter raises if the
 *    seed ever says otherwise), so `mergeCompanies` cannot emit a row twice.
 *    `assertNoDoubleCount` re-checks that on the OUTPUT: every input row
 *    appears in exactly one output row, and the merged obligation equals the
 *    payload's cited combined figure.
 *  - The combined figure is NOT summed in the browser. It is the exporter's
 *    derived `combined_obligation_fact_id` — a citation whose inputs are the
 *    member facts and whose sum the citation verifier recomputes. The site
 *    renders a cited number, never an arithmetic one.
 *  - Members outside the top-200 export contribute to the family's total and
 *    are named, but carry no `/company/` link (they have no page).
 *
 * Ranking is recomputed after merging, so the top ten is correct.
 */

import type { EntityTop } from "@/lib/data";

// ── Payload (data/site/json/entity_family_events.json) ──────────────────────

export type FamilyEventKind = "rename" | "acquisition" | "merger";

/** How well the linked source supports THIS row (exporter EVIDENCE_KINDS). */
export type FamilyEvidence = "sourced" | "name-inferred";

export interface FamilyEventRow {
  from_name: string;
  to_name: string;
  event: FamilyEventKind;
  effective_date: string;
  evidence: FamilyEvidence;
  /** Official press release or SEC filing — an EXTERNAL reference. */
  source_url: string;
  /** Form label for the link ("8-K Item 2.01", "Press release"). */
  source_form: string;
  /** The document's own date. */
  source_date: string;
  /** When a curator last opened the source and checked this row. */
  source_verified: string;
  note: string;
  from_family_key: string | null;
  to_family_key: string | null;
  /** DOM id of this event's row on /companies/families/. */
  anchor: string;
  /** Registry family keys whose membership THIS event explains (may be []). */
  changed_family_keys: string[];
}

/**
 * The event that explains why ONE registry name is in the family (§P1-3 fix
 * round). Computed by the exporter — see entity_families.member_arrivals.
 *
 * The defect it closes: /companies/ hung ONE trailing event label off a
 * heterogeneous list of former names, so EXELIS INC. (acquired by Harris in
 * 2015) read "acquired 2019" — the date of the separate Harris/L3 merger —
 * and ROCKWELL COLLINS, INC. (acquired 2018) read "renamed 2023".
 */
export interface MemberArrival {
  event_index: number;
  /** /companies/families/#{anchor} — the exact row that documents this. */
  anchor: string;
  /** "from": this name is what changed. "to": this is the post-event name. */
  role: "from" | "to";
  /** The other side of the event. */
  counterparty: string;
  event: FamilyEventKind;
  effective_date: string;
  evidence: FamilyEvidence;
}

export interface FamilyMember {
  family_key: string;
  display_name: string;
  slug: string;
  /** True when this member is in the top-200 export (has a /company/ page). */
  has_page: boolean;
  total_obligation: number;
  total_obligation_fact_id: string | null;
  uei_count: number;
  worst_confidence: string;
  /** null for the family's surviving name (the acquirer is not "acquired"). */
  arrival: MemberArrival | null;
}

export interface CuratedFamily {
  label: string;
  slug: string;
  members: FamilyMember[];
  /** null when the family has fewer than two resolved members (no merge). */
  combined_obligation: number | null;
  combined_obligation_fact_id: string | null;
  combined_uei_count: number;
  events: FamilyEventRow[];
}

export interface FamilyEventsPayload {
  schema_version: number;
  method: string;
  source_kind: string;
  seed: string;
  /** Max source_verified across the seed — the table's "as of" stamp. */
  sources_verified_through: string | null;
  families: CuratedFamily[];
}

// ── Merged rows ─────────────────────────────────────────────────────────────

/**
 * One `/companies/` row. A plain registry row and a merged corporate family
 * render through the SAME shape, so the table has one code path.
 */
export interface CompanyRow {
  /** Family slug for a merge, entity slug for a plain row (React key). */
  key: string;
  /** The name in the first column. */
  displayName: string;
  /** Registry rows folded into this line (1 for an unmerged row). */
  members: FamilyMember[];
  totalObligation: number;
  /** The CITED fact for `totalObligation` — combined fact for a merge. */
  factId: string | null;
  ueiCount: number;
  worstConfidence: string;
  /** Curated family this row came from — null for a plain registry row. */
  family: CuratedFamily | null;
  /** True when ≥2 registry rows were folded together. */
  merged: boolean;
  /** 1-based rank by obligation AFTER the merge. */
  rank: number;
}

/** Confidence ordering, worst first — a family is as good as its worst member. */
const CONFIDENCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export function worstConfidence(values: readonly string[]): string {
  let worst = values[0] ?? "medium";
  for (const v of values) {
    if ((CONFIDENCE_RANK[v] ?? 1) < (CONFIDENCE_RANK[worst] ?? 1)) worst = v;
  }
  return worst;
}

function entityToMember(e: EntityTop): FamilyMember {
  return {
    family_key: e.family_key,
    display_name: e.display_name,
    slug: e.slug,
    has_page: true,
    total_obligation: e.total_obligation,
    total_obligation_fact_id: e.total_obligation_fact_id,
    uei_count: e.uei_count,
    worst_confidence: e.worst_confidence,
    arrival: null, // an unmerged registry row arrived by no curated event
  };
}

// ── Event vocabulary ────────────────────────────────────────────────────────

/**
 * The past-participle label for an event kind. "merger" exists because calling
 * the UTC/Raytheon merger of equals an "acquisition" misstates who absorbed
 * whom, and calling it a "rename" is worse.
 */
const EVENT_VERB: Record<FamilyEventKind, string> = {
  rename: "renamed",
  acquisition: "acquired",
  merger: "merged",
};

/** "acquired 2015" / "renamed 2023" / "merged 2020" — the year is the EVENT's. */
export function eventLabel(event: FamilyEventKind, effectiveDate: string): string {
  return `${EVENT_VERB[event] ?? event} ${effectiveDate.slice(0, 4)}`;
}

/**
 * The per-former-name annotation. A "from" arrival states what happened to
 * THAT name; a "to" arrival names the predecessor it replaced, because
 * "Northrop Grumman Innovation Systems — acquired 2018" alone would leave the
 * reader wondering which company that was.
 */
export function memberEventLabel(arrival: MemberArrival): string {
  const label = eventLabel(arrival.event, arrival.effective_date);
  return arrival.role === "to"
    ? `formerly ${arrival.counterparty}, ${label}`
    : label;
}

/**
 * Merge the top-200 registry rows into corporate families and re-rank.
 *
 * A family is merged only when it has a cited combined figure — i.e. the
 * exporter minted `combined_obligation_fact_id`. A family whose combined fact
 * is missing (fewer than two resolved members, or an unresolvable citation)
 * leaves its rows alone: the site would rather show the honest split than an
 * uncited merged number.
 */
export function mergeCompanies(
  companies: readonly EntityTop[],
  payload: FamilyEventsPayload | null,
): CompanyRow[] {
  const families = (payload?.families ?? []).filter(
    (f) => f.combined_obligation != null && f.combined_obligation_fact_id != null,
  );

  // family_key → the family that owns it (at most one, exporter-enforced).
  const owner = new Map<string, CuratedFamily>();
  for (const fam of families) {
    for (const m of fam.members) owner.set(m.family_key, fam);
  }

  const rows: CompanyRow[] = [];
  const emitted = new Set<string>();

  for (const company of companies) {
    const fam = owner.get(company.family_key);
    if (!fam) {
      rows.push({
        key: company.slug,
        displayName: company.display_name,
        members: [entityToMember(company)],
        totalObligation: company.total_obligation,
        factId: company.total_obligation_fact_id,
        ueiCount: company.uei_count,
        worstConfidence: company.worst_confidence,
        family: null,
        merged: false,
        rank: 0,
      });
      continue;
    }
    if (emitted.has(fam.slug)) continue; // already folded in at its first member
    emitted.add(fam.slug);
    rows.push({
      key: fam.slug,
      displayName: fam.label,
      members: fam.members,
      totalObligation: fam.combined_obligation!,
      factId: fam.combined_obligation_fact_id,
      ueiCount: fam.combined_uei_count,
      worstConfidence: worstConfidence(fam.members.map((m) => m.worst_confidence)),
      family: fam,
      merged: fam.members.length > 1,
      rank: 0,
    });
  }

  rows.sort((a, b) => b.totalObligation - a.totalObligation);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

/**
 * The double-count guard, asserted on the OUTPUT.
 *
 * Returns the list of violations (empty when the merge held):
 *   - a registry family_key appearing in more than one rendered row;
 *   - a merged row whose member totals do not sum to the cited combined
 *     figure (a member shown but not counted, or counted twice);
 *   - an input company that vanished entirely.
 *
 * Called by the page at build time (throws — a build failure, never a silent
 * bad number) and independently by gate 24 leg (g) on the built HTML.
 */
export function assertNoDoubleCount(
  companies: readonly EntityTop[],
  rows: readonly CompanyRow[],
): string[] {
  const problems: string[] = [];

  const seen = new Map<string, string>();
  for (const row of rows) {
    for (const m of row.members) {
      const prev = seen.get(m.family_key);
      if (prev && prev !== row.key) {
        problems.push(
          `registry family ${m.family_key} appears in two rows (${prev}, ${row.key}) — its obligations would be counted twice`,
        );
      }
      seen.set(m.family_key, row.key);
    }
  }

  for (const c of companies) {
    if (!seen.has(c.family_key)) {
      problems.push(`registry family ${c.family_key} vanished from the merged table`);
    }
  }

  for (const row of rows) {
    if (!row.merged) continue;
    const sum = row.members.reduce((n, m) => n + m.total_obligation, 0);
    // Float sum of ~1e11 magnitudes — a cent of tolerance.
    if (Math.abs(sum - row.totalObligation) > 0.01) {
      problems.push(
        `merged row ${row.key}: members sum to ${sum} but the cited combined figure is ${row.totalObligation}`,
      );
    }
    const keys = new Set(row.members.map((m) => m.family_key));
    if (keys.size !== row.members.length) {
      problems.push(`merged row ${row.key} lists a member twice`);
    }
  }

  return problems;
}

/**
 * Should the per-row confidence chip render?
 *
 * §P1-3: all 200 rows read "medium" — a chip that never varies conveys
 * nothing while adding 200 amber badges of visual alarm. Suppress it when it
 * is uniform across the WHOLE table (not the filtered view — a chip column
 * that appears and disappears as the reader types would be worse), and state
 * the method once in the header instead.
 */
export function confidenceIsUniform(rows: readonly CompanyRow[]): boolean {
  if (rows.length === 0) return true;
  const first = rows[0].worstConfidence;
  return rows.every((r) => r.worstConfidence === first);
}

/** Every fact_id a merged table needs in its citation slice. */
export function companyRowFactIds(rows: readonly CompanyRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.factId) ids.push(row.factId);
    for (const m of row.members) {
      if (m.total_obligation_fact_id) ids.push(m.total_obligation_fact_id);
    }
  }
  return ids;
}

/** All curated events, newest first — the events page's table order. */
export function allEvents(
  payload: FamilyEventsPayload | null,
): { family: CuratedFamily; event: FamilyEventRow }[] {
  const out: { family: CuratedFamily; event: FamilyEventRow }[] = [];
  for (const family of payload?.families ?? []) {
    for (const event of family.events) out.push({ family, event });
  }
  out.sort((a, b) => {
    if (a.event.effective_date !== b.event.effective_date) {
      return a.event.effective_date < b.event.effective_date ? 1 : -1;
    }
    return a.family.label.localeCompare(b.family.label);
  });
  return out;
}
