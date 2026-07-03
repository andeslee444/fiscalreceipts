"use client";

/**
 * Dataset download cards — uses useAssetUrl() to resolve runtime asset base.
 *
 * Degraded mode (Phase 5C G3): on mount a HEAD probe checks
 * {assetBase}/citations/citations.parquet. When the asset bundle is not
 * attached to the deployment, an explicit banner (data-degraded="downloads")
 * renders above the cards and the cards dim with aria-disabled — no dead
 * download links pretending to work.
 */

import React from "react";
import { useAssetUrl } from "@/components/asset-config";

interface DatasetCard {
  name: string;
  description: string;
  parquetPath: string;
  rowCount?: number;
  /**
   * Hardcoded override only for the non-dataset "citations" card; dataset
   * cards derive citedness from the manifest ledger (uncitedDatasets prop).
   */
  isCited?: boolean;
}

function buildDatasets(datasetsRowCounts: Record<string, number>): DatasetCard[] {
  const citCount = datasetsRowCounts["citations"] ?? 0;
  const citLabel = citCount > 0
    ? `${citCount.toLocaleString("en-US")} source citations`
    : "Source citations";
  const programCount = datasetsRowCounts["dim_programs"] ?? 326;
  return [
    {
      name: "dim_programs",
      description: `${programCount.toLocaleString("en-US")} DoD R&D and procurement program elements with metadata.`,
      parquetPath: "/data/dim_programs.parquet",
    },
    {
      name: "jbook_details",
      description:
        "Project-level cost figures from J-book XML (R-2/P-40 exhibits), with page-level PDF citation.",
      parquetPath: "/data/jbook_details.parquet",
    },
    {
      name: "budget_lines",
      description:
        "Budget line items from R-1 and P-1 Excel rollups (workbook-cited).",
      parquetPath: "/data/budget_lines.parquet",
    },
    {
      name: "fct_budget_trajectory",
      description: "FY2024–FY2026 budget trajectory per program element.",
      parquetPath: "/data/fct_budget_trajectory.parquet",
    },
    {
      name: "dim_entities",
      description: "Top-200 contractor families by total federal obligation.",
      parquetPath: "/data/dim_entities.parquet",
    },
    {
      name: "fct_influence",
      description:
        "LDA lobbying filings by family key and filing year — income, expense, totals.",
      parquetPath: "/data/fct_influence.parquet",
    },
    {
      name: "fct_program_lobbying",
      description: "Program mentions extracted from LDA filing issue text.",
      parquetPath: "/data/fct_program_lobbying.parquet",
    },
    {
      name: "fct_budget_to_awards",
      description:
        "Budget-to-contract crosswalk (confidence-tiered: high/medium/low), with per-link derived citations.",
      parquetPath: "/data/fct_budget_to_awards.parquet",
    },
    {
      name: "dim_geography",
      description:
        "Congressional-district obligation aggregates from USAspending place-of-performance data.",
      parquetPath: "/data/dim_geography.parquet",
    },
    {
      name: "fct_state_per_capita",
      description: "State-level per-capita spending with Census population data.",
      parquetPath: "/data/fct_state_per_capita.parquet",
    },
    {
      name: "fct_program_concentration",
      description: "HHI contractor concentration scores per program element.",
      parquetPath: "/data/fct_program_concentration.parquet",
    },
    {
      name: "fct_improper_exposure",
      description: "Agency-level improper-payment exposure estimates (derived).",
      parquetPath: "/data/fct_improper_exposure.parquet",
    },
    {
      name: "dim_lobbyists",
      description:
        "Named lobbyists from LDA filings with revolving-door flags and disclosing-filing provenance columns.",
      parquetPath: "/data/dim_lobbyists.parquet",
    },
    {
      name: "jbook_narratives",
      description: "Mission/accomplishment narratives from J-book exhibits.",
      parquetPath: "/data/jbook_narratives.parquet",
    },
    {
      name: "citations",
      description:
        `All ${citLabel} (jbook_pdf + workbook + lda_filing), keyed by fact_id.`,
      parquetPath: "/citations/citations.parquet",
      isCited: true,
    },
  ];
}

export function DownloadCards({
  builtAt,
  datasets = {},
  pdfCount,
  workbookCount,
  uncitedDatasets = [],
}: {
  builtAt: string;
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
  const uncited = new Set(uncitedDatasets);
  const DATASETS = buildDatasets(datasets).map((ds) => ({
    ...ds,
    isCited: ds.isCited ?? !uncited.has(ds.name),
  }));

  // Asset-bundle reachability: null = probing, true = reachable, false = not.
  // Probe re-runs if the runtime asset base changes (config.json resolution).
  const [assetsAvailable, setAssetsAvailable] = React.useState<boolean | null>(
    null,
  );
  React.useEffect(() => {
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
  }, [assetUrl]);
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
              {ds.isCited && (
                <span className="shrink-0 text-xs rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5">
                  cited
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-5">
              {ds.description}
            </p>
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
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>
            <code>citations.parquet</code> —{" "}
            {(datasets["citations"] ?? 0) > 0
              ? (datasets["citations"] as number).toLocaleString("en-US")
              : "all"}{" "}
            source citations linking fact_ids to PDF pages, workbook cells,
            and LDA filing UUIDs
          </li>
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
