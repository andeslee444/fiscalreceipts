import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  getEntitiesTop,
  getEntityFamilyEvents,
  collectCitationsWithInputs,
} from "@/lib/data";
import {
  allEvents,
  companyRowFactIds,
  mergeCompanies,
} from "@/lib/entity-families";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";

/**
 * /companies/families/ — the curated rename & acquisition table (§P1-3).
 *
 * The PM's note: "that table is itself a publishable asset". It is the one
 * page on this site whose sources are NOT warehouse citations — every row
 * cites an SEC filing or a company press release, and the page says so in the
 * first paragraph rather than letting the reader assume the usual provenance.
 *
 * Everything here is hand-curated and hand-sourced. Nothing is inferred, and
 * the page states the two things it deliberately does not do: it does not
 * guess at names that fail to resolve, and it does not promote confidence
 * tiers (that needs a SAM.gov extract this build does not have).
 */

const TITLE = "Company renames & acquisitions";
const DESCRIPTION =
  "A hand-curated table of corporate renames and acquisitions in the defense " +
  "contracting base, each with an official source — the crosswalk that lets " +
  "Fiscal Receipts show one company as one line.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/companies/families/` },
  openGraph: {
    title: `${TITLE} — ${SITE_NAME}`,
    description: DESCRIPTION,
    url: `${SITE_URL}/companies/families/`,
    siteName: SITE_NAME,
  },
};

/** "SEC filing" / "press release" — what the reader is about to open. */
function sourceLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.endsWith("sec.gov")) return "SEC filing";
    return `${host} press release`;
  } catch {
    return "source";
  }
}

const EVENT_LABEL: Record<string, string> = {
  rename: "Rename",
  acquisition: "Acquisition",
};

export default function CompanyFamiliesPage() {
  const payload = getEntityFamilyEvents();
  const events = allEvents(payload);
  const families = payload?.families ?? [];
  const rows = mergeCompanies(getEntitiesTop(), payload);
  const mergedRows = rows.filter((r) => r.merged);
  const citationsSlice = collectCitationsWithInputs(companyRowFactIds(mergedRows));

  return (
    <CitationPanelProvider citations={citationsSlice}>
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Companies", href: "/companies/" },
            { label: "Renames & acquisitions" },
          ]}
        />

        <h1 className="mb-2 text-3xl font-bold">{TITLE}</h1>

        {/* ── Method, stated plainly and first ── */}
        <div
          data-method-statement
          className="mb-6 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground"
        >
          <p className="mb-2">
            <strong className="text-foreground">
              This table is hand-curated and hand-sourced. Nothing on it is
              inferred.
            </strong>{" "}
            Federal award data records the recipient name that was on the
            contract, so a company that renames appears under both names —
            Raytheon Company and RTX Corp are one company, and entity
            resolution by name cannot know that. Each row below is a corporate
            event we read in an SEC filing or an official company press
            release, linked in the Source column.
          </p>
          <p className="mb-2">
            <strong className="text-foreground">
              These sources are external references, not warehouse citations.
            </strong>{" "}
            Everywhere else on this site, a cited figure opens a receipt from
            our own document lake. The links in this table leave the site and
            go to the filing itself; they carry no fact ID and no page
            highlight, because we did not extract them — we read them.
          </p>
          <p className="mb-2">
            <strong className="text-foreground">Where a name does not resolve</strong>,
            we say so rather than guessing. Names are matched to award-data
            recipient families by exact normalized equality — never fuzzily. An
            event side marked{" "}
            <span className="italic">no separate registry family</span> means
            the award data has no separate family under that name, usually
            because it was already resolved under its parent.
          </p>
          <p>
            <strong className="text-foreground">Not in scope:</strong> promoting
            resolution confidence from name-inference to SAM.gov
            registered-parent. That needs a SAM.gov entity extract this build
            does not have, so every family on{" "}
            <Link href="/companies/" className="underline hover:text-foreground">
              /companies/
            </Link>{" "}
            still resolves by name inference. This table changes which rows are
            combined; it does not change how the underlying families were
            inferred.
          </p>
        </div>

        {/* ── The events ── */}
        <h2 className="mb-3 text-xl font-semibold">
          {events.length} curated {events.length === 1 ? "event" : "events"}
        </h2>
        <div className="mb-8 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm" data-family-events-table>
            <caption className="sr-only">
              Curated corporate renames and acquisitions, newest first. Each row
              links its official source.
            </caption>
            <thead className="bg-muted/60 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium w-28">
                  Effective
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  From
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  To
                </th>
                <th scope="col" className="px-4 py-3 font-medium w-28">
                  Event
                </th>
                <th scope="col" className="px-4 py-3 font-medium w-36">
                  Source
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map(({ family, event }, i) => (
                <tr
                  key={`${family.slug}-${i}`}
                  data-family-event={family.slug}
                  className="align-top hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                    {event.effective_date}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">
                      {event.from_name}
                    </span>
                    {!event.from_family_key && (
                      <span className="mt-0.5 block text-xs italic text-muted-foreground">
                        no separate registry family
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">
                      {event.to_name}
                    </span>
                    {!event.to_family_key && (
                      <span className="mt-0.5 block text-xs italic text-muted-foreground">
                        no separate registry family
                      </span>
                    )}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {event.note}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {EVENT_LABEL[event.event] ?? event.event}
                  </td>
                  <td className="px-4 py-3">
                    {/* EXTERNAL reference — deliberately not a Cite chip. */}
                    <a
                      href={event.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-external-source={event.source_url}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {sourceLabel(event.source_url)}
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="sr-only">(opens in new tab)</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── What the merge did to /companies/ ── */}
        <h2 className="mb-3 text-xl font-semibold">
          What this changes on the contractor list
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Each family below renders as one line on{" "}
          <Link href="/companies/" className="underline hover:text-foreground">
            /companies/
          </Link>
          . The combined figure is a derived citation whose inputs are the
          member figures it replaced — click it to see the arithmetic and drill
          into each member. Members are disjoint by construction (award data
          assigns each recipient identifier to exactly one family), so nothing
          is counted twice.
        </p>
        <ul className="mb-8 space-y-3">
          {families.map((fam) => {
            const row = rows.find((r) => r.key === fam.slug);
            return (
              <li
                key={fam.slug}
                data-curated-family={fam.slug}
                className="rounded-lg border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-foreground">
                    {fam.label}
                  </span>
                  {row?.merged && fam.combined_obligation != null ? (
                    <>
                      <Cite
                        value={fam.combined_obligation}
                        units="USD"
                        dataset="dim_entities"
                        factId={fam.combined_obligation_fact_id}
                      />
                      <span className="text-xs text-muted-foreground">
                        combined across {fam.members.length} registry names ·
                        rank #{row.rank} on the contractor list
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      merges no separate row — the award data already resolves
                      this event under one family
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {fam.members.map((m, i) => (
                    <span key={m.family_key}>
                      {i > 0 && <span aria-hidden="true"> · </span>}
                      {m.has_page ? (
                        <Link
                          href={`/company/${m.slug}/`}
                          className="hover:text-foreground hover:underline"
                        >
                          {m.display_name}
                        </Link>
                      ) : (
                        <span title="Outside the top-200 list — counted in the total, no profile page">
                          {m.display_name}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="text-sm text-muted-foreground">
          The seed for this table lives in the repository at{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {payload?.seed ?? "data-seeds/entity_family_events.csv"}
          </code>
          . It is deliberately small and deliberately conservative: only
          well-documented events with an official source. If a company you
          expect is missing, it is missing because we have not sourced it yet —
          not because we decided it does not belong.
        </p>
      </div>
    </CitationPanelProvider>
  );
}
