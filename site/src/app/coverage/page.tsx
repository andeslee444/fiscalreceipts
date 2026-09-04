import type { Metadata } from "next";
import Link from "next/link";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { DocToc } from "@/components/doc-toc";
import { ScopeNote } from "@/components/notes";
import {
  getCoverageMap,
  CROSSWALK_LIMIT_ID,
  MAP_REVIEWED_ON,
} from "@/lib/coverage-map";
import { getCorpusCounts } from "@/lib/corpus";
import { coreOgImages } from "@/lib/og";
import { SITE_NAME, SITE_URL } from "@/lib/site";

/**
 * /coverage/ — what this site covers, what it does not, and when that changes
 * (PM-review Sprint 3 Task 6, §Coverage).
 *
 * "The honesty is right, the roadmap is missing." Every gap is already
 * disclosed at the point of use; what nobody could see was whether the site is
 * early and moving or abandoned at 1%. This page is that missing half — and
 * because it is a page ABOUT coverage, it is the one page on which a hardcoded
 * count would be self-refuting. Every figure comes from lib/coverage-map,
 * which reads the shipped sidecars; gate 14's coverage-map leg recomputes all
 * of them from those same artifacts and fails the build on a mismatch.
 *
 * REGISTER (§P2-6): this page is scope disclosure end to end, so it uses the
 * calm <ScopeNote> register throughout and never the amber caution treatment —
 * amber is reserved for "this specific number needs care".
 *
 * MOBILE: the table becomes a stack of cards below `sm` (the /data/ pattern) —
 * one DOM, restyled, so the gate hooks and header semantics are unchanged and
 * nothing scrolls off the right edge at 390px.
 *
 * TARGETS ARE UNDATED (Sprint 3 round 3, the site owner's decision). The first
 * cut published eight dates the project had never committed to. They are gone;
 * every blocker is kept verbatim, and each row now says there is no dated
 * target, names the work that is planned, and says the date is pending a
 * roadmap decision. A site that will not publish a figure it cannot recompute
 * should not publish a schedule it has not agreed to either.
 */

const _rows = getCoverageMap();

export const metadata: Metadata = {
  title: "Coverage — what this site does and does not cover",
  description:
    `Coverage and the specific blocker behind it for all ${_rows.length} datasets and features on ${SITE_NAME}. ` +
    "Every figure is recomputed from the shipped data at build time, including the budget→award crosswalk gap.",
  alternates: { canonical: `${SITE_URL}/coverage/` },
  openGraph: {
    title: `Coverage — what this site does and does not cover | ${SITE_NAME}`,
    description:
      "Per-feature coverage with the specific blocker standing in the way of each — and a plain statement of the one gap that is a methodology limit rather than a backlog item.",
    url: `${SITE_URL}/coverage/`,
    siteName: SITE_NAME,
    images: coreOgImages("coverage"),
  },
};

export default function CoveragePage() {
  const rows = getCoverageMap();
  const crosswalk = rows.find((r) => r.id === CROSSWALK_LIMIT_ID)!;
  const counts = getCorpusCounts();
  const dated = rows.filter((r) => r.targetKind === "dated").length;

  return (
    <div className="spine py-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Coverage" }]} />

      {/* <h1> FIRST — gate 2 (nk) pins that no scope block precedes it. */}
      <h1 className="mb-3 text-3xl font-bold">Coverage</h1>
      <div className="doc-layout">
        <div data-doc-prose>
          <p className="leading-7 text-muted-foreground">
            What this site covers, what it does not, and what would have to change
            for that to move. Each row gives the coverage this build actually
            shipped, the specific thing standing in the way, and where the work
            stands — including, in plain words, why no row here carries a date.
          </p>

          <ScopeNote className="mt-5" label={null}>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Every number on this page is recomputed at build time
            </h2>
            <p className="text-sm leading-7">
              Nothing here is typed by hand. Each coverage figure is read from the
              data files this build shipped — the same files the pages themselves
              render from — and a build-time gate recomputes all{" "}
              {rows.length} rows independently and fails the build if any rendered
              figure disagrees with its source. A coverage page carrying a
              stale literal would refute its own argument, so this one is not
              allowed to carry any. The derivation for each row is printed beside
              it.
            </p>
            <p className="mt-3 text-sm leading-7">
              One figure is deliberately <em>absent</em> for the same reason: the
              share of award dollars whose recipient resolves to a corporate family.
              That is a warehouse query rather than a shipped file, so it cannot be
              recomputed at build time — and an unverifiable number on this page
              would be worse than a missing one.
            </p>
          </ScopeNote>

          {/* ── The map ─────────────────────────────────────────────────────── */}
          <section className="mt-10" aria-labelledby="map-heading">
            <h2 id="map-heading" className="mb-3 text-xl font-semibold">
              Feature by feature
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {dated === 0
                ? "No row on this page carries a dated target, and that is a decision rather than an omission: a site that will not publish a figure it cannot recompute should not publish a schedule it has not committed to. Each row instead names the work that is planned and says the date is pending a roadmap decision. When a date is agreed it is added here — and a date that slips is moved here, not deleted."
                : `${dated} of the ${rows.length} rows carry a dated target; the rest say why they do not, and a date that slips is moved here rather than deleted.`}{" "}
              Every figure above is recomputed at build time. The wording around
              them — blockers, targets, the reasons a row carries no date — is
              written by hand and was last reviewed on{" "}
              <time dateTime={MAP_REVIEWED_ON}>{MAP_REVIEWED_ON}</time>.
            </p>

            {/* MOBILE: below `sm` each row becomes a card (the /data/ treatment),
                so the Blocker and Target columns — the whole point of the page —
                stay on screen at 390px instead of scrolling off behind the
                container. Same <table>, restyled; roles are declared where the
                display override would otherwise drop them. */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table
                data-coverage-map
                className="min-w-full text-sm"
              >
                <caption className="sr-only">
                  Coverage, blocker and target for each dataset and feature on{" "}
                  {SITE_NAME}.
                </caption>
                <thead className="hidden sm:table-header-group">
                  <tr className="border-b border-border bg-muted/50">
                    <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                      Feature
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                      Coverage today
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                      What is in the way
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-semibold text-muted-foreground">
                      Target
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      data-coverage-row={r.id}
                      data-covered-n={r.numerator ?? undefined}
                      data-covered-d={r.denominator ?? undefined}
                      role="row"
                      className="block border-b border-border py-4 last:border-0 sm:table-row sm:py-0"
                    >
                      <th
                        scope="row"
                        className="block px-4 py-0 text-left align-top text-base font-semibold text-foreground sm:table-cell sm:py-3 sm:text-sm sm:whitespace-nowrap"
                      >
                        <Link href={r.href} className="underline decoration-dotted hover:text-primary">
                          {r.label}
                        </Link>
                      </th>
                      <td
                        role="cell"
                        data-primary-value="covered"
                        className="block px-4 pt-1 align-top sm:table-cell sm:py-3"
                      >
                        <span className="text-foreground">{r.covered}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Derived from {r.derivation}
                        </span>
                      </td>
                      <td
                        role="cell"
                        data-coverage-blocker
                        className="block px-4 pt-2 align-top text-muted-foreground sm:table-cell sm:py-3"
                      >
                        <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-widest text-foreground/60 sm:hidden">
                          In the way
                        </span>
                        {r.blocker}
                      </td>
                      <td
                        role="cell"
                        data-coverage-target
                        data-target-kind={r.targetKind}
                        className="block px-4 pt-2 align-top text-muted-foreground sm:table-cell sm:py-3"
                      >
                        <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-widest text-foreground/60 sm:hidden">
                          Target
                        </span>
                        {r.target}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── How the corpus is counted (tri-persona Wave 4, item 4) ──────────
              Five true numbers, five denominators, and until now nothing that
              said so. Each row is derived from the artifact that defines it
              (lib/corpus getCorpusCounts; see the five-way list below); this
              page never states a count it did not recompute. Gate 24 leg k
              recomputes all five from the shipped artifacts and rejects any
              corpus-shaped number on
              the singleton pages that is not one of them. */}
          <section className="mt-12" aria-labelledby="counts-heading" id="corpus-counts">
            <h2 id="counts-heading" className="mb-3 text-xl font-semibold">
              How the corpus is counted
            </h2>
            <p className="mb-4 text-sm leading-7 text-muted-foreground">
              Five nested questions; the differences are the point.
            </p>
            {/* A LIST, AND EVERY SHARED CLASS ON THE <ul>. The table form of this
                block cost 10,794 raw bytes and put the page 288 gzip over its
                ceiling; per-row class strings then cost another 841 raw, because
                the RSC payload carries each one a second time. Nothing was
                trimmed from the disclosure — all five counts and all five
                explanations are here; the markup around them is. */}
            <ul
              data-corpus-counts
              className="divide-y divide-border rounded-lg border border-border text-sm text-muted-foreground [&>li]:px-4 [&>li]:py-3 [&_strong]:tabular-nums [&_strong]:text-foreground"
            >
              {counts.map((c) => (
                <li key={c.id} data-corpus-count={c.id}>
                  <strong data-corpus-value>
                    {c.value.toLocaleString("en-US")}
                  </strong>{" "}
                  on {c.where}. {c.counts}
                </li>
              ))}
            </ul>
          </section>

          {/* ── The crosswalk: a methodology limit, not a backlog item ───────── */}
          <section className="mt-12" aria-labelledby="crosswalk-heading" id="crosswalk">
            <h2 id="crosswalk-heading" className="mb-3 text-xl font-semibold">
              The budget→award crosswalk is a methodology limit, not a backlog item
            </h2>
            <p className="leading-7 text-muted-foreground">
              This is the site&apos;s largest and most visible gap, and it is worth
              being precise about what kind of gap it is. It is not work we have
              not got to. It is a limit of what the source records contain.
            </p>
            <p className="mt-3 leading-7 text-muted-foreground">
              {crosswalk.blocker}
            </p>
            <p className="mt-3 leading-7 text-muted-foreground">
              So the honest boundary is this: we assert a budget→award link only
              where the record supports one, and we publish the size of the
              remainder rather than leaving it to be inferred from an empty chart.{" "}
              <Link href="/flow/#bridge" className="underline hover:text-foreground">
                The bridge
              </Link>{" "}
              states that remainder as a share of the request; in this build:{" "}
              {/* Same string as the row above, from the same source — the gate
                  compares the two, because a page that states one number twice is
                  a page that will eventually state it two ways (§P0-2). */}
              <span data-coverage-crosswalk>{crosswalk.covered}</span>
            </p>
            <p className="mt-3 leading-7 text-muted-foreground">
              {crosswalk.target}
            </p>
          </section>

          {/* ── What this page is not ────────────────────────────────────────── */}
          <section className="mt-12" aria-labelledby="not-heading">
            <h2 id="not-heading" className="mb-3 text-xl font-semibold">
              Where coverage is stated elsewhere
            </h2>
            <p className="leading-7 text-muted-foreground">
              Every one of these gaps is also disclosed where a reader meets it: on
              the page, beside the figure, with a link to the reasoning. This page
              collects them so the shape of the whole is visible at once. For the
              definitions behind the numbers — confidence tiers, the supersede
              policy, and the nine named limitations — see the{" "}
              <Link href="/methodology/" className="underline hover:text-foreground">
                methodology
              </Link>
              . For the datasets themselves, with row counts read from the shipped
              parquet files, see{" "}
              <Link href="/data/" className="underline hover:text-foreground">
                the data explorer
              </Link>
              .
            </p>
          </section>
        </div>
        <DocToc />
      </div>
    </div>
  );
}
