"use client";

/**
 * Dataset download cards — uses useAssetUrl() to resolve runtime asset base.
 *
 * Degraded mode (Phase 5C G3): on mount a HEAD probe checks
 * {assetBase}/citations/citations.parquet. When the asset bundle is not
 * attached to the deployment, an explicit banner (data-degraded="downloads")
 * renders above the cards and the cards dim with aria-disabled — no dead
 * download links pretending to work.
 *
 * TRI-PERSONA REVIEW WAVE 4, item 2 — THE INVENTORY IS THE MANIFEST NOW.
 * This file used to author its own fourteen-card list with its own
 * hand-written descriptions, beside a /data/ page that reads all sixteen from
 * data/site/json/datasets.json. The two drifted, exactly as §P1-5 predicted
 * when it moved /data/ off literals:
 *
 *   · budget_lines_decade (32,642 rows — the decade table, the most
 *     analytically distinctive thing on the site) and fct_district_totals
 *     were QUERYABLE on /data/ and absent from /downloads/. Both parquets
 *     ship; only the card was missing.
 *   · dim_entities was described as "Top-200 contractor families". The file
 *     is 114,806 rows.
 *   · jbook_details was described as having "page-level PDF citation".
 *     7,991 of its 17,007 non-zero rows (47%) resolve to no page at all —
 *     the exporter's own `resolution` column says so, and the manifest scope
 *     now says so on both pages.
 *
 * So the card list, the row counts, the descriptions and the cited badge all
 * come from the manifest the exporter computes from the emitted parquets.
 * This file authors NO dataset name, NO count and NO description.
 */

import React from "react";
import { useAssetUrl, useAssetConfigResolved } from "@/components/asset-config";

/** The manifest fields a card needs — mirrors lib/data DatasetManifestEntry. */
export interface DownloadDataset {
  name: string;
  row_count: number;
  scope: string;
  cited: boolean;
  caveat?: string;
}

interface DatasetCard {
  name: string;
  description: string;
  caveat?: string;
  rowCount?: number;
  parquetPath: string;
  isCited: boolean;
}

function buildDatasets(
  inventory: DownloadDataset[],
  uncited: Set<string>,
  citationsRowCount: number,
): DatasetCard[] {
  const cards: DatasetCard[] = inventory.map((ds) => ({
    name: ds.name,
    description: ds.scope,
    caveat: ds.caveat,
    rowCount: ds.row_count,
    parquetPath: `/data/${ds.name}.parquet`,
    isCited: ds.cited && !uncited.has(ds.name),
  }));
  // citations.parquet is the citation INDEX, not a mart — it has no manifest
  // entry (it is not written to data/site/data/) and is listed last.
  const citLabel =
    citationsRowCount > 0
      ? `${citationsRowCount.toLocaleString("en-US")} source citations`
      : "Source citations";
  cards.push({
    name: "citations",
    description: `All ${citLabel} (jbook_pdf + workbook + lda_filing), keyed by fact_id.`,
    parquetPath: "/citations/citations.parquet",
    isCited: true,
  });
  return cards;
}

export function DownloadCards({
  builtAt,
  inventory,
  datasets = {},
  pdfCount,
  workbookCount,
  uncitedDatasets = [],
}: {
  builtAt: string;
  /**
   * The shipped-parquet manifest (data/site/json/datasets.json), passed
   * through from the server page. THE card list — see the file header.
   */
  inventory: DownloadDataset[];
  /** site_meta.datasets row counts — used for the citations index only. */
  datasets?: Record<string, number>;
  /** Number of J-book PDFs in the bundle (from site_meta.pdf_count). */
  pdfCount?: number;
  /** Number of workbook files in the bundle (from site_meta.workbook_count). */
  workbookCount?: number;
  /**
   * The manifest's uncited_datasets ledger (from site_meta.uncited_datasets).
   * Dataset cards show the "cited" badge IFF they are off this ledger — the
   * badge flips automatically when a dataset gains a citation tier.
   */
  uncitedDatasets?: string[];
}) {
  const assetUrl = useAssetUrl();
  const assetConfigResolved = useAssetConfigResolved();
  const DATASETS = buildDatasets(
    inventory,
    new Set(uncitedDatasets),
    datasets["citations"] ?? 0,
  );

  // Asset-bundle reachability: null = probing, true = reachable, false = not.
  //
  // WAIT FOR THE RUNTIME BASE (Wave 4). `ssrBase` now seeds the first paint
  // with the production asset host, so probing before /config.json resolves
  // would fire at prod R2 from 127.0.0.1 — CORS-blocked — and flash the
  // "not attached to this deployment" banner on every local page load. The
  // probe runs once, against the base the reader's browser will actually use.
  const [assetsAvailable, setAssetsAvailable] = React.useState<boolean | null>(
    null,
  );
  React.useEffect(() => {
    if (!assetConfigResolved) return;
    let cancelled = false;
    fetch(assetUrl("/citations/citations.parquet"), { method: "HEAD" })
      .then((r) => {
        if (!cancelled) setAssetsAvailable(r.ok);
      })
      .catch(() => {
        if (!cancelled) setAssetsAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetUrl, assetConfigResolved]);
  const degraded = assetsAvailable === false;

  const builtDate = builtAt
    ? new Date(builtAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "unknown";

  return (
    <div>
      {degraded && (
        <div
          data-degraded="downloads"
          role="alert"
          className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
        >
          Download files are not attached to this deployment yet — they ship
          from object storage. Checksums and schemas below still describe the
          bundle.
        </div>
      )}

      <p className="text-sm text-muted-foreground mb-6">
        Bundle built: <time dateTime={builtAt}>{builtDate}</time>. Files are
        in Apache Parquet format, readable with DuckDB, pandas, R
        arrow/duckdb, or any Parquet-compatible tool. Each file includes the
        same provenance metadata that backs on-screen figures.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {DATASETS.map((ds) => (
          <div
            key={ds.name}
            {...(degraded ? { "aria-disabled": true } : {})}
            className={[
              "rounded-lg border border-border bg-card p-4 flex flex-col gap-2",
              degraded ? "opacity-50" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-foreground">
                {ds.name}
              </span>
              {ds.rowCount !== undefined && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {ds.rowCount.toLocaleString("en-US")} rows
                </span>
              )}
              {ds.isCited && (
                <span className="shrink-0 text-xs rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5">
                  cited
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-5">
              {ds.description}
            </p>
            {ds.caveat && (
              <p
                data-dataset-caveat={ds.name}
                className="text-xs text-muted-foreground leading-5 border-l-2 border-amber-500/50 pl-2"
              >
                {ds.caveat}
              </p>
            )}
            <a
              href={assetUrl(ds.parquetPath)}
              {...(degraded ? { "aria-disabled": true, tabIndex: -1 } : {})}
              className={[
                "mt-auto inline-flex items-center gap-1 text-xs text-primary hover:underline",
                degraded ? "pointer-events-none" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              download
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {ds.name}.parquet
            </a>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-2">
          Additional assets (not in table above)
        </p>
        {/* citations.parquet used to be listed here too, under a heading
            that says "not in table above" while it had a card of its own.
            One place now: the card. */}
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>
            <code>pdfs/</code> — {pdfCount ?? 34} SHA-named J-book PDFs (~149 MB total)
          </li>
          <li>
            <code>workbooks/</code> — {workbookCount ?? 3} R-1/P-1 Excel rollup files
          </li>
        </ul>
      </div>
    </div>
  );
}
