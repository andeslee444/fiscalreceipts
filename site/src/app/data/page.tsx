import type { Metadata } from "next";
import { getDatasetManifest, getSiteMeta } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { AssetConfigProvider } from "@/components/asset-config";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CorpusStatement } from "@/components/corpus-statement";
import { CoverageNote } from "@/components/coverage-note";
import { Explorer } from "@/components/explorer";
// Universal module (NOT lib/duckdb, which is "use client" — its runtime
// exports become client references in a server component).
import { DATASET_NAMES, type DatasetName } from "@/lib/dataset-names";

// ── Dataset inventory ─────────────────────────────────────────────────────────
// PM Sprint 2 (§P1-5): row counts and scope sentences come from the build
// manifest (data/site/json/datasets.json), computed from the emitted parquets.
// This file authors NO dataset numbers and NO dataset descriptions — the
// previous hardcoded DATASET_INVENTORY had rotted to 5B-2-era literals
// (dim_programs "326" against a 1,739-row parquet, jbook_details "4,421"
// against 21,028) and omitted budget_lines_decade entirely.
//
// Evaluated at module scope so a manifest/engine mismatch fails the BUILD,
// not a page view.
const DATASET_INVENTORY = getDatasetManifest().datasets;

/**
 * Registration cross-check: the manifest is the shipped inventory,
 * lib/dataset-names DATASET_NAMES is the canned-query/type registry (which
 * lib/duckdb re-exports and registerDatasets defaults to). They must name the same
 * datasets — a parquet documented in the table but absent from the engine is a
 * card the user cannot query (budget_lines_decade, Phase 5E → §P1-5), and a
 * registered name with no parquet is a dead option in the picker.
 */
function assertRegistryMatchesManifest(shippedNames: string[]): void {
  const registered = new Set<string>(DATASET_NAMES);
  const shipped = new Set(shippedNames);
  const unregistered = shippedNames.filter((n) => !registered.has(n));
  const phantom = [...registered].filter((n) => !shipped.has(n));
  if (unregistered.length > 0 || phantom.length > 0) {
    throw new Error(
      "[govbudget/data-page] datasets.json and lib/dataset-names DATASET_NAMES disagree — " +
        (unregistered.length > 0
          ? `shipped but unregistered: ${unregistered.join(", ")}. `
          : "") +
        (phantom.length > 0
          ? `registered but not shipped: ${phantom.join(", ")}.`
          : ""),
    );
  }
}

assertRegistryMatchesManifest(DATASET_INVENTORY.map((d) => d.name));

export const metadata: Metadata = {
  title: "Data Explorer",
  description:
    `Query all ${DATASET_INVENTORY.length} Fiscal Receipts datasets directly in your browser — budget lines, trajectory, lobbying, awards, and more. Powered by DuckDB-WASM; no data leaves your machine.`,
  alternates: { canonical: `${SITE_URL}/data/` },
  openGraph: {
    title: `Data Explorer — ${SITE_NAME}`,
    description:
      "Explore DoD budget, lobbying, and awards data with SQL — queries run entirely in your browser via DuckDB-WASM.",
    url: `${SITE_URL}/data/`,
    siteName: SITE_NAME,
    images: coreOgImages("data"),
  },
};

/** Human-readable file size for the inventory table. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

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
          Browse and query all {DATASET_INVENTORY.length} Fiscal Receipts datasets
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
        {/* §P1-5: the canonical corpus statement, so a reader who compares
            dim_programs' row count against "our programs" sees what each
            number means without leaving the page. */}
        <CorpusStatement className="mt-3 max-w-2xl" />
      </div>

      {/* Dataset inventory table */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Dataset inventory</h2>
        <p className="mb-3 text-xs text-muted-foreground max-w-3xl">
          Row counts and sizes are read from the parquet files this build
          shipped — never authored by hand. Each scope line says what{" "}
          <em>one row</em> of that dataset is, so a row count can be compared
          against the right denominator.
        </p>
        {/* MOBILE (fix round, BLOCKER): at 390px the Citation and "Scope —
            what one row is" columns sat entirely off-canvas, yet the
            off-screen scope prose still drove row height — 250–400px rows that
            were ~85% empty, hiding the most credibility-bearing content on the
            page. Below `sm` each dataset becomes a card: name, rows, size and
            citation on one line, scope beneath. One DOM: the same <table>
            restyled, so data-dataset-card / data-dataset-rowcount hooks and
            the header semantics are untouched. */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-border bg-muted/50">
                <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Dataset
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold text-muted-foreground">
                  Rows
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold text-muted-foreground">
                  Size
                </th>
                <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Citation
                </th>
                <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Scope — what one row is
                </th>
              </tr>
            </thead>
            <tbody>
              {DATASET_INVENTORY.map((ds) => {
                const isCited = ds.cited && !uncitedDatasets.has(ds.name);
                return (
                  <tr
                    key={ds.name}
                    data-dataset-card={ds.name}
                    className="block sm:table-row border-b border-border last:border-0 hover:bg-muted/30 transition-colors py-3 sm:py-0"
                  >
                    <td className="block sm:table-cell px-4 py-0 sm:py-2 font-mono text-xs text-foreground sm:whitespace-nowrap">
                      {ds.name}
                    </td>
                    <td
                      data-dataset-rowcount
                      className="inline sm:table-cell px-4 py-0 sm:py-2 text-left sm:text-right tabular-nums text-xs sm:text-sm text-muted-foreground"
                    >
                      {ds.row_count.toLocaleString("en-US")}
                      <span className="sm:hidden"> rows</span>
                    </td>
                    <td className="inline sm:table-cell pr-4 sm:px-4 py-0 sm:py-2 text-left sm:text-right tabular-nums text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
                      <span className="sm:hidden" aria-hidden="true">
                        ·{" "}
                      </span>
                      {formatBytes(ds.bytes)}
                    </td>
                    <td className="inline sm:table-cell px-4 py-0 sm:py-2 text-xs">
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
                    <td className="block sm:table-cell px-4 pt-1 sm:py-2 text-muted-foreground sm:max-w-sm">
                      {ds.scope}
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
        {/* CA state-data scope note — fct_state_per_capita covers FY2025 only */}
        <CoverageNote id="state-ca" className="mt-1" />
      </section>

      {/* Interactive explorer — client-only, lazy-init */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Interactive SQL explorer</h2>
        <AssetConfigProvider>
          <Explorer
            datasets={DATASET_INVENTORY.map((ds) => ({
              name: ds.name as DatasetName,
              rowCount: ds.row_count,
              description: ds.scope,
            }))}
          />
        </AssetConfigProvider>
      </section>
    </div>
  );
}
