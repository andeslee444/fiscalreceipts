import type { Metadata } from "next";
import Link from "next/link";
import { getFilingsIndex } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FilingsTable } from "@/components/filings-table";

export const metadata: Metadata = {
  title: `Lobbying Filings — ${SITE_NAME}`,
  description:
    "Senate LDA lobbying filings cross-referenced against tracked defense programs — client, registrant, reported dollars, and program mentions.",
  alternates: { canonical: `${SITE_URL}/filings/` },
  openGraph: {
    title: `Lobbying Filings — ${SITE_NAME}`,
    description:
      "Senate LDA lobbying filings cross-referenced against tracked defense programs.",
    url: `${SITE_URL}/filings/`,
    siteName: SITE_NAME,
    images: coreOgImages("filings-index"),
  },
};

export default function FilingsIndexPage() {
  const index = getFilingsIndex();
  const withMentions = index.filings.filter((f) => f.has_mentions).length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Filings" }]}
      />

      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Lobbying Filings</h1>
        <p className="text-muted-foreground mb-2">
          {index.total.toLocaleString("en-US")} Senate LDA filings from
          registrants whose clients appear in the tracked-program corpus.{" "}
          {withMentions.toLocaleString("en-US")} filings mention at least one
          tracked program (shown first).
        </p>
        <p className="text-xs text-muted-foreground">
          Reported income/expense figures on each filing page cite the filing
          record on lda.senate.gov. See{" "}
          <Link
            href="/methodology/"
            className="underline hover:text-foreground"
          >
            methodology
          </Link>{" "}
          for how program mentions are matched.
        </p>
      </div>

      <FilingsTable filings={index.filings} />
    </div>
  );
}
