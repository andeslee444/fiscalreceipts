import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { GLOSSARY } from "@/lib/glossary";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DocToc } from "@/components/doc-toc";

export const metadata: Metadata = {
  title: "Glossary",
  description:
    "Definitions for the budget and procurement terms stamped on Fiscal Receipts figures — TOA, P-1, R-1, R-2, P-40, PE, BLI, and more.",
  alternates: { canonical: `${SITE_URL}/glossary/` },
  openGraph: {
    title: `Glossary — ${SITE_NAME}`,
    description:
      "Definitions for the budget and procurement terms stamped on every figure.",
    url: `${SITE_URL}/glossary/`,
    siteName: SITE_NAME,
  },
};

export default function GlossaryPage() {
  return (
    <div className="spine py-10">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Glossary" }]} />
      <h1 className="text-3xl font-bold mb-2">Glossary</h1>
      <div className="doc-layout">
        <div data-doc-prose>
          <p className="text-sm text-muted-foreground mb-8">
            Every term below is one this site actually stamps on a figure — a
            basis chip, a citation locator, or a card label. Each definition
            traces back to how the term is used here, not a generic gloss.
          </p>

          <dl className="space-y-8">
            {GLOSSARY.map((entry) => (
              <div key={entry.id} id={entry.id} className="scroll-mt-20">
                <dt>
                  <h2 className="text-lg font-semibold text-foreground">
                    {entry.term}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {entry.expansion}
                    </span>
                  </h2>
                </dt>
                <dd className="mt-1 text-muted-foreground leading-7">
                  {entry.definition}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <DocToc />
      </div>
    </div>
  );
}
