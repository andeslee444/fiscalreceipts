import type { Metadata } from "next";
import Link from "next/link";
import { getLineageFlow, getPeLinkIndex } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { ScopeNote } from "@/components/notes";
import { LineageFlow } from "@/components/lineage/lineage-flow";

/**
 * /lineage/ — every stated identity link in the corpus, drawn (ROADMAP #29(c)).
 *
 * WHY THIS PAGE EXISTS AT ALL, beyond "the backlog asked for a Sankey".
 *
 * The lineage layer shipped as a per-program rail: land on /program/0604818A/
 * and you see that line's own predecessors and successors. That surface can
 * only ever show an edge on a page one of its endpoints owns — so the nine
 * stated links whose BOTH endpoints are outside the built program universe
 * (verify-lineage leg (g) has been reporting them as "renders nowhere" since
 * #29(b) landed) were verified, cited, and invisible. They are on this page.
 * So is the branch structure the family funding line explicitly refuses to
 * sum: family 6's four-way merge is a picture, not a footnote.
 *
 * WHAT THE PAGE WILL NOT DO. A Sankey's ribbon width is a dollar amount, and
 * #29(c) asked for "dollar ribbons for transfers/splits/merges". There are no
 * dollars to draw: program_lineage.portion_amount is non-null on ZERO rows,
 * because the narratives these edges come from say "was realigned from PE
 * 0203728A" and do not say how much. Every ribbon here is therefore one fixed
 * width, and the page says so three times — in the lede, in the legend, and in
 * the figure's own description — because a reader who has seen one Sankey has
 * been taught that width means money.
 *
 * Server shell + a prerendered island. The payload is small enough to render
 * into the static HTML (unlike /flow/, which fetches), which is the point:
 * gate 22 leg (g) re-measures every ribbon's band off the built `d=` string,
 * and verify-lineage leg (i) reconciles the built DOM against the live
 * program_lineage table. Citations resolve lazily through cite-shards — the
 * provider mounts with an EMPTY embedded slice, the /flow/ and /years/
 * architecture.
 */

const _payload = getLineageFlow();

export const metadata: Metadata = {
  title: "Lineage — one funded line, all the names it wore",
  description:
    `Every program-element identity change the ingested justification books actually state: ` +
    `${_payload.counts.stated_edges} cited links across ${_payload.counts.families} families, drawn as identities over ` +
    `lineage steps. No ribbon carries a dollar amount, because no J-book sentence states how much moved.`,
  alternates: { canonical: `${SITE_URL}/lineage/` },
  openGraph: {
    title: `Lineage — one funded line, all the names it wore | ${SITE_NAME}`,
    description:
      "Program elements get renamed, realigned and merged, and the money follows an identity that changed names. Here is every such link the books state, cited — and an explicit refusal to draw amounts nobody wrote down.",
    url: `${SITE_URL}/lineage/`,
    siteName: SITE_NAME,
  },
};

export default function LineagePage() {
  const payload = getLineageFlow();
  const c = payload.counts;
  const peIndex = getPeLinkIndex();
  // Only the identities this diagram actually draws — the full 2,000-entry PE
  // index has no business crossing the RSC boundary for 80 lookups.
  const drawn = new Set<string>();
  for (const f of payload.families) for (const n of f.nodes) drawn.add(n.pe);
  for (const cand of payload.candidates)
    for (const n of cand.nodes) drawn.add(n.pe);
  const linkablePes = [...drawn].filter((pe) => peIndex.has(pe)).sort();

  return (
    <CitationPanelProvider citations={{}}>
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <Breadcrumbs
          items={[{ label: "Home", href: "/" }, { label: "Lineage" }]}
        />

        <h1 className="mb-2 text-3xl font-bold">
          One funded line, all the names it wore
        </h1>

        <p className="mb-3 max-w-4xl text-base leading-7 text-foreground sm:text-lg">
          A program element is an accounting identity, and identities get
          renamed, realigned and folded into each other. When that happens the
          work carries on and the label does not, so a year-over-year comparison
          of &ldquo;the same program&rdquo; quietly compares two different
          things. This page draws every such link the ingested justification
          books actually <em>state</em> — {c.stated_edges} of them, each cited
          to the sentence that says it — across the {c.families} families they
          form and the {c.identities} identities those families contain.
        </p>

        {/* The refusal, in the lede rather than in a footnote. */}
        <ScopeNote className="mb-4 max-w-4xl" label="What the ribbons are not">
          <p className="text-sm leading-7">
            In a Sankey, a ribbon&rsquo;s width is an amount. Here it is
            not, and it must not be read as one:{" "}
            <strong className="font-semibold text-foreground">
              every ribbon on this page is drawn at exactly the same width,
              because not one of these {c.stated_edges} sentences states how
              much money moved.
            </strong>{" "}
            The books say a line was realigned from another line; they do not
            say how many dollars went with it. Drawing a width would be
            inventing the number. The identity boxes are uniform for the same
            reason — a taller box in a Sankey means more money, and none of
            these boxes means anything of the kind.
          </p>
          <p className="mt-2 text-sm leading-7">
            The one figure that <em>is</em> stated per identity — its FY
            {payload.amount_fy} request — is in the table under the diagram,
            cited, on the same P-1/R-1 TOA basis the rest of the site uses.{" "}
            {c.identities_with_amount} of the {c.identities} identities carry
            one; the rest render an absence rather than a zero.
          </p>
        </ScopeNote>

        <ScopeNote className="mb-6 max-w-4xl" label="How to read the columns">
          <p className="text-sm leading-7">
            The columns are <strong>lineage steps</strong>, not calendar years.
            That is a deliberate choice against the obvious one: the identities
            in a family routinely draw money side by side for whole decades —
            which is exactly why the family funding line on a program page
            refuses to sum them — so placing a successor to the right of its
            predecessor on a <em>year</em> axis would assert a hand-off date
            the record does not contain. Left-to-right here means &ldquo;the
            books say this one came from that one&rdquo;, nothing more.
          </p>
          <p className="mt-2 text-sm leading-7">
            For the same reason, the fiscal year on a link is the{" "}
            <strong>edition that asserts it</strong> — the J-book the sentence
            was printed in — and not the year money moved. A FY2026 book
            narrating a FY2023 transfer produces a FY2026 link.
          </p>
          <p className="mt-2 text-sm leading-7">
            {c.identities_unresolved} of the {c.identities} identities are{" "}
            <strong>unresolved references</strong>: named in a genuinely cited
            sentence, but absent from the program pages this corpus builds.
            They are drawn dashed and grey and are not links, because a
            reference the corpus cannot resolve is a real state of the record
            and not a gap to paper over. Each identity that does resolve links
            to its own page, where the{" "}
            <Link href="/methodology/" className="underline hover:text-foreground">
              same rail, its citations and the family funding line
            </Link>{" "}
            live.
          </p>
        </ScopeNote>

        <LineageFlow payload={payload} linkablePes={linkablePes} />

        <section className="mt-10 max-w-4xl">
          <h2 className="mb-2 text-xl font-semibold">
            Where these links come from
          </h2>
          <p className="mb-2 text-sm leading-7 text-muted-foreground">
            Stated links are extracted by pattern from the R-2 and P-40
            narrative paragraphs of the ingested justification books, across
            every edition the corpus holds, and each one keeps the fact id of
            the narrative it came from — click any ribbon, or the{" "}
            <span className="whitespace-nowrap">&ldquo;cited&rdquo;</span>{" "}
            marker in the links table, to open that sentence with its document
            and page. An extraction that could not be cited would not ship: the
            exporter refuses to write a stated link whose citation does not
            resolve.
          </p>
          <p className="text-sm leading-7 text-muted-foreground">
            This is high-precision and low-recall on purpose. A sentence that
            names a move without naming the other program element&rsquo;s code
            is not turned into a link here, so the corpus certainly contains
            transfers this page does not draw.{" "}
            <Link href="/coverage/" className="underline hover:text-foreground">
              What this site covers, and what it does not →
            </Link>
          </p>
        </section>
      </div>
    </CitationPanelProvider>
  );
}
