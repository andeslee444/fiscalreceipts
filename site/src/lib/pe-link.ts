/**
 * pe-link.ts — universal PE (program element) mention linking (Phase 5F §2a).
 *
 * One shared resolver turns any PE-shaped token WITH a page into an internal
 * link. Applied to narrative bodies, dossier claims, breakdown row labels,
 * and lobbying-mention lists. "PE X, Project Y" references resolve to
 * /program/{pe}/#project-{y} anchors when the target program's detail rows
 * actually contain that project number — never a fake anchor.
 *
 * Deterministic only: a token links iff it is in the known PE page set
 * (data/site/json/program_details sidecar basenames). Unknown tokens stay
 * plain prose. No fs access here — callers supply the set (universal module,
 * safe for client components; the G1 linkgraph leg (f) recomputes the same
 * shape independently in scripts/gates/linkgraph.mjs).
 */

/**
 * PE-shaped token: 7 digits + a letter + up to 2 more alphanumerics.
 * Covers 0601101E, 1160403BB, 0604250D8Z, 0606771D8Z — but NOT BLI codes
 * like 2012C130J (letter before position 8) or bare numbers.
 *
 * NOTE: kept in sync with the linkgraph gate leg (f) regex
 * (scripts/gates/linkgraph.mjs) — the gate recomputes independently.
 */
export const PE_TOKEN_RE = /\b\d{7}[A-Z][A-Z0-9]{0,2}\b/;

/** "…PE 0601122E, Project EMR-01" continuation after a PE token. */
const PROJECT_REF_RE = /^,?\s+Project\s+([A-Za-z0-9-]+)/;

export interface PeLink {
  start: number;
  end: number;
  token: string;
  href: string;
}

/** Membership test for the known-PE page set (Set and PeLinkIndex both fit). */
export interface PeMembership {
  has(pe: string): boolean;
}

export interface FindPeLinksOptions {
  /** The page's own PE — self-references stay plain text. */
  selfPe?: string;
  /**
   * Project-number lookup for a target PE (from its detail rows). When the
   * token is followed by ", Project Y" and Y is in the target's set, the
   * href gains a #project-{Y} anchor.
   */
  projectsByPe?: (pe: string) => ReadonlySet<string>;
}

/** DOM-safe anchor id for a detail-table project row. */
export function projectAnchorId(projectNumber: string): string {
  return `project-${projectNumber.replace(/[^A-Za-z0-9-]/g, "_")}`;
}

/**
 * Find every linkable PE token in `text`: PE-shaped AND present in `peSet`
 * AND not the page's own PE. Returns non-overlapping links in text order.
 */
export function findPeLinks(
  text: string,
  peSet: PeMembership,
  opts: FindPeLinksOptions = {},
): PeLink[] {
  const links: PeLink[] = [];
  const re = new RegExp(PE_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    if (!peSet.has(token)) continue;
    if (opts.selfPe && token === opts.selfPe) continue;

    let href = `/program/${token}/`;
    if (opts.projectsByPe) {
      const rest = text.slice(m.index + token.length);
      const proj = rest.match(PROJECT_REF_RE);
      if (proj && opts.projectsByPe(token).has(proj[1])) {
        href = `/program/${token}/#${projectAnchorId(proj[1])}`;
      }
    }
    links.push({ start: m.index, end: m.index + token.length, token, href });
  }
  return links;
}

// ── Body segmentation (shared by PE links and prose amount links, §2c) ──────

export interface LinkRange {
  start: number;
  end: number;
  /** 'pe' → internal <a>; 'amount' → prose Cite (opens citation panel). */
  kind: "pe" | "amount";
  /** Internal href (kind 'pe'). */
  href?: string;
  /** Citation fact_id (kind 'amount'). */
  factId?: string;
}

export interface BodySegment {
  kind: "text" | "pe" | "amount";
  text: string;
  href?: string;
  factId?: string;
}

/**
 * Split `body` into ordered segments around the given link ranges.
 * Every character of the body appears in exactly one segment (offsets are
 * into the RAW body string). Malformed ranges — out of bounds, inverted, or
 * overlapping an earlier-accepted range — are DROPPED (plain text is always
 * correct; a corrupted slice never is).
 */
export function segmentBody(
  body: string,
  ranges: readonly LinkRange[],
): BodySegment[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const accepted: LinkRange[] = [];
  let lastEnd = 0;
  for (const r of sorted) {
    if (
      !Number.isInteger(r.start) ||
      !Number.isInteger(r.end) ||
      r.start < lastEnd ||
      r.end <= r.start ||
      r.end > body.length
    ) {
      continue;
    }
    accepted.push(r);
    lastEnd = r.end;
  }

  const segments: BodySegment[] = [];
  let cursor = 0;
  for (const r of accepted) {
    if (r.start > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, r.start) });
    }
    segments.push({
      kind: r.kind,
      text: body.slice(r.start, r.end),
      href: r.href,
      factId: r.factId,
    });
    cursor = r.end;
  }
  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }
  return segments;
}
