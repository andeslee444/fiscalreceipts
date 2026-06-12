import type { Metadata } from "next";
import { getSiteMeta } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { AssetConfigProvider } from "@/components/asset-config";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DownloadCards } from "@/components/download-cards";

export const metadata: Metadata = {
  title: `Downloads — ${SITE_NAME}`,
  description:
    "Bulk Parquet exports of all GovBudget datasets — budget, awards, entities, lobbying, and citations — with full provenance metadata.",
  alternates: { canonical: `${SITE_URL}/downloads/` },
  openGraph: {
    title: `Downloads — ${SITE_NAME}`,
    description:
      "Bulk Parquet exports with full provenance metadata — budget, awards, entities, lobbying, citations.",
    url: `${SITE_URL}/downloads/`,
    siteName: SITE_NAME,
  },
};

export default function DownloadsPage() {
  const meta = getSiteMeta();

  // JSON-LD Dataset
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DataCatalog",
    name: `${SITE_NAME} Data Exports`,
    description:
      "Bulk Parquet exports of DoD budget, contracts, entities, lobbying, and citation datasets.",
    url: `${SITE_URL}/downloads/`,
    dateModified: meta.built_at,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
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
        </div>
        <AssetConfigProvider>
          <DownloadCards builtAt={meta.built_at} />
        </AssetConfigProvider>
      </div>
    </>
  );
}
