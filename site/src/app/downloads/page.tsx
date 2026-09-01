import type { Metadata } from "next";
import { getDatasetManifest, getSiteMeta } from "@/lib/data";
import { getAssetBase } from "@/lib/asset-base";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { AssetConfigProvider } from "@/components/asset-config";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DownloadCards } from "@/components/download-cards";
import { datasetJsonLd, safeJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = {
  title: "Downloads",
  description:
    "Bulk Parquet exports of all Fiscal Receipts datasets — budget, awards, entities, lobbying, and citations — with full provenance metadata.",
  alternates: { canonical: `${SITE_URL}/downloads/` },
  openGraph: {
    title: `Downloads — ${SITE_NAME}`,
    description:
      "Bulk Parquet exports with full provenance metadata — budget, awards, entities, lobbying, citations.",
    url: `${SITE_URL}/downloads/`,
    siteName: SITE_NAME,
    images: coreOgImages("downloads"),
  },
};

/**
 * schema.org Dataset nodes — one per shipped parquet, from the SAME manifest
 * the cards render (Wave 4, item 2). This used to be a hand-written list of
 * seven with its own descriptions, so a crawler was told the site publishes
 * seven datasets of which one was "Top contractor families" (114,806 rows,
 * every family) and budget_lines_decade did not exist.
 *
 * `contentUrl` is the absolute asset-host URL — the thing a machine reading
 * this JSON-LD can actually fetch. It was `/downloads/` (the page describing
 * the file) on every node.
 */
function buildDatasets(
  inventory: { name: string; scope: string; row_count: number }[],
  citationCount: number,
  assetBase: string,
) {
  const nodes = inventory.map((ds) => ({
    name: ds.name,
    description: `${ds.row_count.toLocaleString("en-US")} rows. ${ds.scope}`,
    url: "/downloads/",
    contentUrl: `${assetBase}/data/${ds.name}.parquet`,
    encodingFormat: "application/vnd.apache.parquet",
  }));
  nodes.push({
    name: "citations",
    description: `${citationCount.toLocaleString("en-US")}-row citation index mapping fact_ids to source documents — J-book PDF pages, workbook cells, or LDA filings.`,
    url: "/downloads/",
    contentUrl: `${assetBase}/citations/citations.parquet`,
    encodingFormat: "application/vnd.apache.parquet",
  });
  return nodes;
}

export default function DownloadsPage() {
  const meta = getSiteMeta();

  // §P1-5: the dataset manifest is the single source for per-parquet counts.
  // The old `?? 326` fallback was the same rotted literal that made /data/
  // claim 326 dim_programs rows against a 1,739-row parquet.
  // Wave 4 item 2: it is now the single source for the card LIST too.
  const manifest = getDatasetManifest();
  const assetBase = getAssetBase();
  const datasets = buildDatasets(
    manifest.datasets,
    meta.counts.citations,
    assetBase,
  );
  const datasetsLd = datasets.map((d) =>
    datasetJsonLd({
      ...d,
      dateModified: meta.built_at,
    }),
  );

  return (
    <>
      {datasetsLd.map((ld, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(ld) }}
        />
      ))}
      <div className="spine py-8">
        <Breadcrumbs
          items={[{ label: "Home", href: "/" }, { label: "Downloads" }]}
        />
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Data Downloads</h1>
          <p className="text-muted-foreground">
            All {meta.counts.citations.toLocaleString("en-US")} source
            citations and {meta.counts.programs.toLocaleString("en-US")}{" "}
            program elements are available as Parquet exports. Datasets marked
            &ldquo;cited&rdquo; include row-level citation linkage; others
            are citation-tier pending (see{" "}
            <a href="/methodology/" className="underline hover:text-foreground">
              methodology
            </a>
            ).
          </p>
          <p className="text-muted-foreground text-sm mt-2">
            Schemas &amp; data dictionary: every Parquet file embeds its
            column schema (readable via DuckDB <code>DESCRIBE</code>), and
            the{" "}
            <a href="/data/" className="underline hover:text-foreground">
              data explorer
            </a>{" "}
            lists each dataset with row counts and column descriptions.
          </p>
        </div>
        {/* ssrBase (Wave 4 item 1): the static HTML carries absolute
            asset-host hrefs, so `curl`, `wget`, a copied link and any
            scripted fetch reach the parquet instead of a 404. Hydration
            still applies the runtime /config.json answer. */}
        <AssetConfigProvider ssrBase={assetBase}>
          <DownloadCards
            builtAt={meta.built_at}
            inventory={manifest.datasets}
            datasets={meta.datasets ?? {}}
            pdfCount={meta.pdf_count}
            workbookCount={meta.workbook_count}
            uncitedDatasets={meta.uncited_datasets ?? []}
          />
        </AssetConfigProvider>
      </div>
    </>
  );
}
