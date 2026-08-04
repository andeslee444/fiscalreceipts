/**
 * workbook-cells.ts — lazy fetch of workbook cell-preview sidecars
 * (PM-review Sprint 2 §P1-9).
 *
 * The exporter (src/govbudget/workbook_cells.py) emits
 * data/site/json/workbook-cells/{fact_id[:2]}.json: for every workbook
 * citation, the cited cells with their OWN values, ±2 rows of workbook
 * context, and the cited column's header — all read out of the same .xlsx the
 * 5B-1 gate re-derives against. The drawer renders it as a small table, so a
 * citation finally "opens the source with the exact cell highlighted" without
 * a 4 MB download.
 *
 * WHY A SIDECAR, NOT A CITATION FIELD: measured at export, the previews add
 * 23.4 MB to a 91.0 MB cite-shard set (+25.7%) — and the same rows would land
 * in every page's EMBEDDED citation slice, i.e. in the static HTML of every
 * figure-bearing page. A separate shard, fetched only when a workbook drawer
 * opens, costs one ~86 KB request and nothing at all to readers who never
 * open one.
 *
 * Sharding is identical to lib/cite-shards.ts (256 buckets keyed by the
 * fact_id's first two hex chars); prepare-assets.mjs copies the directory to
 * public/json/workbook-cells/, served same-origin like the citation shards.
 *
 * Failure semantics mirror cite-shards: a fetch failure resolves null (the
 * drawer shows an explicit "preview unavailable" note next to the download
 * link — never a spinner and never a fabricated table) and is NOT
 * poison-cached, so reopening retries.
 */

/** One workbook row in a preview window. */
export interface WorkbookPreviewRow {
  /** 1-based worksheet row number. */
  r: number;
  /** The row's line-item code (BLI / PE), when the sheet has that column. */
  code?: string;
  /** The row's line-item title, when the sheet has that column. */
  title?: string;
  /** Row qualifier — P-1 "Cost Type Title" / BSA title. Absent if none. */
  note?: string;
  /** Add/Non-Add memo flag, when the sheet has that column. */
  flag?: string;
  /** The cited column's value on this row. Absent when the cell is blank. */
  v?: number;
  /** True only for the citation's OWN cells. */
  cited?: boolean;
}

/** Preview payload for one workbook citation. */
export interface WorkbookPreview {
  sheet: string;
  /** Column letters of the cited cells (all cited cells share one column). */
  col: string;
  /** That column's header text, normalized to one line. Null if unlabelled. */
  col_header: string | null;
  /** Units of the values — the citation's units ("USD thousands"). */
  units: string | null;
  /** The citation's amount; equals the sum of the cited rows' `v`. */
  total: number;
  /** Cited rows plus context, in worksheet row order. */
  rows: WorkbookPreviewRow[];
}

export type WorkbookPreviewMap = Record<string, WorkbookPreview>;

/** Same-origin base path for the shards (copied by prepare-assets). */
export const WORKBOOK_CELLS_BASE = "/json/workbook-cells";

/** Shard key for a fact_id — its first two hex chars. */
export function workbookShardPrefix(factId: string): string {
  return factId.slice(0, 2);
}

/** Same-origin URL of the shard containing factId. */
export function workbookShardUrl(factId: string): string {
  return `${WORKBOOK_CELLS_BASE}/${workbookShardPrefix(factId)}.json`;
}

// prefix → in-flight/settled shard promise. Successful shards are immutable
// per build and stay cached; failures remove themselves so a later open
// retries.
const shardCache = new Map<string, Promise<WorkbookPreviewMap | null>>();

export function fetchWorkbookShard(
  prefix: string,
): Promise<WorkbookPreviewMap | null> {
  const cached = shardCache.get(prefix);
  if (cached) return cached;

  const promise: Promise<WorkbookPreviewMap | null> = fetch(
    `${WORKBOOK_CELLS_BASE}/${prefix}.json`,
  )
    .then((res) => {
      if (!res.ok) {
        throw new Error(`workbook shard ${prefix} returned HTTP ${res.status}`);
      }
      return res.json() as Promise<WorkbookPreviewMap>;
    })
    .catch(() => {
      if (shardCache.get(prefix) === promise) shardCache.delete(prefix);
      return null;
    });

  shardCache.set(prefix, promise);
  return promise;
}

/**
 * Resolve one workbook citation's cell preview.
 * Null means "no preview" — the shard was unreachable, or this fact has no
 * preview row. Callers must render the honest fallback, never a guess.
 */
export async function fetchWorkbookPreview(
  factId: string,
): Promise<WorkbookPreview | null> {
  const shard = await fetchWorkbookShard(workbookShardPrefix(factId));
  if (!shard) return null;
  return shard[factId] ?? null;
}

/** The cited rows, in worksheet order — the arithmetic line's operands. */
export function citedRows(preview: WorkbookPreview): WorkbookPreviewRow[] {
  return preview.rows.filter((r) => r.cited);
}

/**
 * Does the preview's own arithmetic hold?
 *
 * The exporter refuses to emit a preview whose cited cells disagree with the
 * citation (Decimal-exact), so this is a client-side belt-and-braces check:
 * the drawer only renders the "a + b + c = total" line when the numbers it is
 * about to print actually add up. Tolerance is a float-representation epsilon,
 * not an accounting one.
 */
export function previewSumsToTotal(preview: WorkbookPreview): boolean {
  const rows = citedRows(preview);
  if (rows.length === 0) return false;
  if (rows.some((r) => typeof r.v !== "number")) return false;
  const sum = rows.reduce((acc, r) => acc + (r.v as number), 0);
  return Math.abs(sum - preview.total) < 0.0005;
}

/** Test hook — clears the module-level shard cache. */
export function __resetWorkbookCellsCache(): void {
  shardCache.clear();
}
