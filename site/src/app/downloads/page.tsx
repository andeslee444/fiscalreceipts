import type { Metadata } from "next";
import { getSiteMeta } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { AssetConfigProvider } from "@/components/asset-config";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DownloadCards } from "@/components/download-cards";
import { datasetJsonLd, safeJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = {
  title: `Downloads — ${SITE_NAME}`,
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

function buildDatasets(citationCount: number, programCount: number) {
  return [
    {
      name: "DoD Program Elements (dim_programs)",
      description:
        `All ${programCount.toLocaleString("en-US")} defense program elements with exhibit family, fiscal year trajectory, and reconciliation status.`,
      url: "/downloads/",
      encodingFormat: "application/vnd.apache.parquet",
    },
    {
      name: "J-book Details (jbook_details)",
      description:
        "Project-level cost detail rows extracted from DoD J-book XML attachments with XML paths and provenance.",
      url: "/downloads/",
      encodingFormat: "application/vnd.apache.parquet",
    },
    {
      name: "Budget Lines (budget_lines)",
      description:
        "Workbook-cited budget line items with cell-level provenance from R-1 and P-1 Excel rollups.",
      url: "/downloads/",
      encodingFormat: "application/vnd.apache.parquet",
    },
    {
      name: "Federal Awards (fct_budget_to_awards)",
      description:
        "USAspending award transactions linked to DoD program elements via budget account crosswalk.",
      url: "/downloads/",
      encodingFormat: "application/vnd.apache.parquet",
    },
    {
      name: "Entity Graph (dim_entities)",
      description:
        "Top contractor families with SAM.gov entity registration data, UEI counts, and confidence tiers.",
      url: "/downloads/",
      encodingFormat: "application/vnd.apache.parquet",
    },
    {
      name: "LDA Lobbying (fct_influence)",
      description:
        "Senate LDA lobbying filings linked to DoD programs, with filing UUIDs and client family keys.",
      url: "/downloads/",
      encodingFormat: "application/vnd.apache.parquet",
    },
    {
      name: "Citation Index (citations)",
      description:
        `${citationCount.toLocaleString("en-US")}-row citation index mapping fact_ids to source documents — J-book PDF pages, workbook cells, or LDA filings.`,
      url: "/downloads/",
      encodingFormat: "application/vnd.apache.parquet",
    },
  ];
}

export default function DownloadsPage() {
  const meta = getSiteMeta();

  const programCount = (meta.datasets ?? {})["dim_programs"] ?? 326;
  const datasets = buildDatasets(meta.counts.citations, programCount);
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
      <div className="container mx-auto px-4 py-8 max-w-4xl">
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
        <AssetConfigProvider>
          <DownloadCards
            builtAt={meta.built_at}
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
