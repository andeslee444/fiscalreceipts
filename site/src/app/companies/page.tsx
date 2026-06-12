import type { Metadata } from "next";
import Link from "next/link";
import { getEntitiesTop } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CompaniesTable } from "@/components/companies-table";

export const metadata: Metadata = {
  title: `Top Contractors — ${SITE_NAME}`,
  description:
    "Top 200 defense contractor families by total federal obligations — USAspending-derived, FY2017 onward.",
  alternates: { canonical: `${SITE_URL}/companies/` },
  openGraph: {
    title: `Top Contractors — ${SITE_NAME}`,
    description:
      "Top 200 defense contractor families by total federal obligations.",
    url: `${SITE_URL}/companies/`,
    siteName: SITE_NAME,
  },
};

export default function CompaniesPage() {
  const companies = getEntitiesTop();

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Companies" }]}
      />
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Top Defense Contractors</h1>
        <p className="text-muted-foreground mb-2">
          Top {companies.length} contractor families by total federal
          obligations — derived from USAspending.gov award data, FY2017–FY2025.
          Figures are in raw USD.
        </p>
        <p className="text-sm text-muted-foreground">
          ⁂ Obligation totals are USAspending-derived — citation tier pending
          for this dataset. Confidence reflects the entity-resolution method
          (high = SAM.gov registered parent; medium = name-inference). See{" "}
          <Link href="/methodology/" className="underline hover:text-foreground">
            methodology §4
          </Link>
          .
        </p>
      </div>
      <CompaniesTable companies={companies} />
    </div>
  );
}
