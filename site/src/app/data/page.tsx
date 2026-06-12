import type { Metadata } from "next";
import { getSiteMeta } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { AssetConfigProvider } from "@/components/asset-config";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Explorer } from "@/components/explorer";
import type { DatasetName } from "@/lib/duckdb";

export const metadata: Metadata = {
  title: `Data Explorer — ${SITE_NAME}`,
  description:
    "Query all 14 GovBudget datasets directly in your browser — budget lines, trajectory, lobbying, awards, and more. Powered by DuckDB-WASM; no data leaves your machine.",
  alternates: { canonical: `${SITE_URL}/data/` },
  openGraph: {
    title: `Data Explorer — ${SITE_NAME}`,
    description:
      "Explore DoD budget, lobbying, and awards data with SQL — queries run entirely in your browser via DuckDB-WASM.",
    url: `${SITE_URL}/data/`,
    siteName: SITE_NAME,
  },
};

// ── Dataset inventory ─────────────────────────────────────────────────────────
// Row counts are build-time constants derived from the parquet files.
// These are NOT dollar amounts — no <Cite> needed.

interface DatasetEntry {
  name: DatasetName;
  rowCount: number;
  description: string;
  isCited: boolean;
}

const DATASET_INVENTORY: DatasetEntry[] = [
  {
    name: "budget_lines",
    rowCount: 8557,
    description:
      "Budget line items from R-1 and P-1 Excel rollups. Workbook-cited.",
    isCited: true,
  },
  {
    name: "jbook_details",
    rowCount: 4421,
    description:
      "Project-level cost figures from J-book XML (R-2/P-40 exhibits). PDF-cited.",
    isCited: true,
  },
  {
    name: "fct_budget_trajectory",
    rowCount: 1982,
    description:
      "FY2024–FY2026 budget trajectory per program element — actuals, enacted, proposed.",
    isCited: false,
  },
  {
    name: "dim_programs",
    rowCount: 326,
    description:
      "326 DoD R&D and procurement program elements with org, exhibit family, and reconciliation status.",
    isCited: false,
  },
  {
    name: "dim_entities",
    rowCount: 76727,
    description:
      "Contractor entity families normalized across USAspending UEI records.",
    isCited: false,
  },
  {
    name: "fct_influence",
    rowCount: 181,
    description:
      "LDA lobbying filing totals by contractor family and filing year (income/expense/obligations). Non-additive.",
    isCited: false,
  },
  {
    name: "fct_program_lobbying",
    rowCount: 32780,
    description:
      "Program-level lobbying mentions — each row links a filing to a matched program element.",
    isCited: false,
  },
  {
    name: "fct_budget_to_awards",
    rowCount: 10091,
    description:
      "Crosswalk linking budget program elements to USAspending award records by recipient.",
    isCited: false,
  },
  {
    name: "dim_geography",
    rowCount: 1045,
    description:
      "Congressional district-level obligation totals derived from USAspending.",
    isCited: false,
  },
  {
    name: "fct_program_concentration",
    rowCount: 24,
    description:
      "HHI market concentration scores for programs with sufficient award data.",
    isCited: false,
  },
  {
    name: "fct_state_per_capita",
    rowCount: 6,
    description:
      "State-level per-capita defense obligation (pilot: CA + CT).",
    isCited: false,
  },
  {
    name: "fct_improper_exposure",
    rowCount: 15,
    description:
      "Programs flagged for improper payment exposure from oversight reports.",
    isCited: false,
  },
  {
    name: "dim_lobbyists",
    rowCount: 1416,
    description:
      "Individual lobbyist records extracted from LDA filings.",
    isCited: false,
  },
  {
    name: "jbook_narratives",
    rowCount: 2457,
    description:
      "Mission and accomplishment narrative text blocks from J-book exhibits.",
    isCited: false,
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DataPage() {
  const meta = getSiteMeta();
  const uncitedDatasets = new Set(meta.uncited_datasets);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Data Explorer" }]}
      />

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-3">Data Explorer</h1>
        <p className="text-muted-foreground max-w-2xl">
          Browse and query all {DATASET_INVENTORY.length} GovBudget datasets
          using SQL. Queries run entirely in your browser — no server receives
          your SQL or sees any intermediate results. Powered by{" "}
          <a
            href="https://duckdb.org/docs/api/wasm/overview.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            DuckDB-WASM
          </a>
          ; parquet files are streamed on demand (HTTP range requests).
        </p>
      </div>

      {/* Dataset inventory table */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Dataset inventory</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Dataset
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold text-muted-foreground">
                  Rows
                </th>
                <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Citation
                </th>
                <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {DATASET_INVENTORY.map((ds) => {
                const isCited = !uncitedDatasets.has(ds.name);
                return (
                  <tr
                    key={ds.name}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-foreground whitespace-nowrap">
                      {ds.name}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {ds.rowCount.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {isCited ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-medium">
                          cited
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-muted-foreground font-medium">
                          tier pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground max-w-sm">
                      {ds.description}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Built: {new Date(meta.built_at).toLocaleDateString("en-US", { dateStyle: "long" })}.
          Citation methodology: see{" "}
          <a href="/methodology/" className="underline hover:text-foreground">
            methodology
          </a>
          .
        </p>
      </section>

      {/* Interactive explorer — client-only, lazy-init */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Interactive SQL explorer</h2>
        <AssetConfigProvider>
          <Explorer
            datasets={DATASET_INVENTORY.map((ds) => ({
              name: ds.name,
              rowCount: ds.rowCount,
              description: ds.description,
            }))}
          />
        </AssetConfigProvider>
      </section>
    </div>
  );
}
