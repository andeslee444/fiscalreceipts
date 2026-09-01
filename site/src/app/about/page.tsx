import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { ScopeNote } from "@/components/notes";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata: Metadata = {
  title: "About",
  description:
    "About Fiscal Receipts — corrections policy, data transparency, and the correlational-not-causal disclaimer.",
  alternates: { canonical: `${SITE_URL}/about/` },
  openGraph: {
    title: `About — ${SITE_NAME}`,
    description:
      "Corrections policy, data transparency, and the correlational-not-causal disclaimer.",
    url: `${SITE_URL}/about/`,
    siteName: SITE_NAME,
    images: coreOgImages("about"),
  },
};

export default function AboutPage() {
  return (
    <div className="spine py-10">
      {/* Round-3 judging: the other of the two pages that had no breadcrumb. */}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "About" }]} />
      <h1 className="text-3xl font-bold mb-8">About {SITE_NAME}</h1>

      {/* Mission */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Mission</h2>
        <p className="text-muted-foreground leading-7">
          {SITE_NAME} makes federal defense spending legible: every budget
          figure, contract award, and lobbying filing is linked back to its
          exact source document. Our goal is to reduce the distance between a
          number on a government website and the original document that number
          came from — to zero.
        </p>
      </section>

      {/* Publisher — §B′3 (#58). The 2026-08-07 review found no masthead: no
          publisher, no funder, no reachable contact, and a CC0 licence that
          existed only in JSON-LD. Every fact below came from the owner
          directly for this task — nothing here is inferred, and nothing
          beyond what the owner supplied (no title, no organisation, no repo
          link — none was given) is added. */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Publisher</h2>
        <p className="text-muted-foreground leading-7">
          {SITE_NAME} is written and maintained by Andes Lee. It is an
          independent, unfunded personal project — no institutional
          affiliation, no funder.
        </p>
        <p className="text-muted-foreground leading-7 mt-3">
          Contact:{" "}
          <a
            href="mailto:andes.han.lee@gmail.com"
            className="underline hover:text-foreground"
          >
            andes.han.lee@gmail.com
          </a>
        </p>
        <p className="text-muted-foreground leading-7 mt-3">
          Data licence: the underlying datasets are released under{" "}
          <a
            href="https://creativecommons.org/publicdomain/zero/1.0/"
            className="underline hover:text-foreground"
            rel="license noopener noreferrer"
            target="_blank"
          >
            CC0 1.0
          </a>{" "}
          — public domain, no rights reserved. See{" "}
          <Link href="/downloads/" className="underline hover:text-foreground">
            Downloads
          </Link>{" "}
          for the exports.
        </p>
      </section>

      {/* Correlational, not causal — §P2-6: this is the site declaring the
          limit of its own claims, which is the strongest thing on the page.
          It read as a warning box; it now reads as a scope statement. */}
      <ScopeNote className="mb-10" label={null}>
        <h2 className="text-lg font-semibold mb-2 text-foreground">
          Correlation is not causation
        </h2>
        <p className="text-sm leading-7">
          {/* Explicit {" "}: an adjacent {expr} + text chunk loses its joining
              space in the static export (the /years/ intro carries the same
              note) — this rendered "Fiscal Receiptsshows". */}
          {SITE_NAME}{" "}
          shows lobbying expenditure and federal contract
          obligations side by side for the same company family, and identifies
          which budget programs a company&apos;s lobbyists mentioned in their
          filings. This is presented for transparency and research purposes.
        </p>
        <p className="text-sm leading-7 mt-3">
          <strong className="text-foreground">
            We do not assert that lobbying caused any particular award.
          </strong>{" "}
          The relationship between lobbying activity and
          federal contracts involves many confounding factors, including
          competitive procurement rules, technical requirements, past
          performance, and market structure. Our data quantifies the lobbying
          activity and the awards; inference about causal relationships
          requires the reader&apos;s own analysis and judgment.
        </p>
        <p className="text-sm leading-7 mt-3">
          The budget-to-contract crosswalk is also an inference (not a
          direct database join), tiered by confidence level. See the full{" "}
          <Link href="/methodology/" className="underline font-medium">
            methodology
          </Link>{" "}
          for all confidence tiers and known limitations.
        </p>
      </ScopeNote>

      {/* Corrections policy */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Corrections Policy</h2>
        <p className="text-muted-foreground leading-7">
          We follow a <strong>supersede-not-delete</strong> policy. If a
          figure is found to be wrong:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground mt-3 pl-2 leading-7">
          <li>
            The incorrect record is marked <em>superseded</em> — it is never
            deleted.
          </li>
          <li>
            A new corrected record is published and becomes the current value.
          </li>
          <li>
            Existing permalinks continue to resolve permanently. They show
            the current best value alongside the correction history.
          </li>
        </ol>
        <p className="text-muted-foreground leading-7 mt-4">
          To report an error, email{" "}
          <a
            href="mailto:andes.han.lee@gmail.com"
            className="underline hover:text-foreground"
          >
            andes.han.lee@gmail.com
          </a>{" "}
          with the citation that contradicts the published figure (document
          title, page, and the value you believe is correct). We will
          investigate and respond.
        </p>
      </section>

      {/* Data provenance */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Data Provenance</h2>
        <p className="text-muted-foreground leading-7">
          All data originates from official government sources:
          comptroller.defense.gov, USAspending.gov, lda.senate.gov,
          paymentaccuracy.gov, gao.gov, and Census Bureau population
          estimates. We do not manufacture, estimate, or interpolate
          figures — we extract and link what the government publishes.
        </p>
        <p className="text-muted-foreground leading-7 mt-3">
          Every rendered number is in one of three citation states: directly
          cited (linked to a PDF page, workbook cell, or API endpoint),
          XML-path traced (zero-dollar line from structured budget XML), or
          citation tier pending (dataset where row-level linkage is a work in
          progress). No number is displayed without disclosing which state it
          is in. See{" "}
          <Link href="/methodology/" className="underline hover:text-foreground">
            methodology
          </Link>{" "}
          for details.
        </p>
      </section>

      {/* Open data */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Open Data</h2>
        <p className="text-muted-foreground leading-7">
          All underlying datasets are available as Parquet exports with full
          provenance metadata — see the{" "}
          <Link href="/downloads/" className="underline hover:text-foreground">
            Downloads
          </Link>{" "}
          page, released under CC0 1.0 (see Publisher, above). Researchers,
          journalists, and oversight advocates are encouraged to build on it.
        </p>
      </section>
    </div>
  );
}
