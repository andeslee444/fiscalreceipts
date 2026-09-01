import { companyLabel, displayCompanyName } from "@/lib/company-name.mjs";

/**
 * CompanyName — one render path for a USAspending registry name (§P2-4).
 *
 * `LOCKHEED MARTIN CORPORATION` was an `<h1>` on 200 pages. Title-casing it
 * is only half the fix: the registry string is the thing that ties the row to
 * its source, so it must stay reachable, never be replaced.
 *
 * Every rendered company name therefore carries BOTH:
 *   - the display casing (lib/company-name.mjs, which refuses rather than
 *     guesses — see that file for the rule), as the element's text;
 *   - the raw registry string, as the VALUE of `data-company-name`, ALWAYS —
 *     including when the two are identical, so gate 2 leg (tc) can re-run the
 *     rule against the built HTML and catch a page that hand-rolled a name.
 *     One attribute rather than a marker plus a payload: at 230 names on
 *     /companies/, and with the App Router echoing every rendered string into
 *     the RSC payload, the second attribute was ~9KB of nothing.
 *
 * `title` is set only when the two differ, so hovering a transformed name
 * shows what the award data actually records. Pages that carry a name as
 * their SUBJECT (the `/company/` detail page) show the registry string
 * visibly instead — a tooltip is not provenance on a page about one company.
 *
 * ROADMAP #10 (option A) added the third case. For 15 of the 200 published
 * families the registry string is not merely SHOUTED, it is WRONG: it is the
 * winner of a parent-registration argmax that beat its runner-up by under 15%,
 * and the flagship (`ROCKWELL COLLINS AUSTRALIA PTY LIMITED`, on a family that
 * is 97.3% RAYTHEON COMPANY) won by 3.1% with a registration RTX reverted in
 * FY2026. Those families carry a curated `label`, which is:
 *   - rendered verbatim as the element's text;
 *   - declared in `data-company-label`, so gate 2 leg (tc) knows the text is
 *     authored rather than derived and gate 24 leg (l) can check it against
 *     data-seeds/entity_display_aliases.csv;
 *   - rendered BESIDE `data-company-name`, never instead of it. The registry
 *     string still ties the row to USAspending, which is exactly what a reader
 *     with a relabelled family in front of them needs most.
 */
export function CompanyName({
  raw,
  label,
  className,
  as: As = "span",
}: {
  /** The registry string exactly as the award data records it. */
  raw: string;
  /** The curated published label, for a family that has one (#10 A). */
  label?: string | null;
  className?: string;
  as?: "span" | "strong";
}) {
  const { registry } = displayCompanyName(raw);
  const text = companyLabel(raw, label);
  const curated = text !== displayCompanyName(raw).display;
  return (
    <As
      className={className}
      data-company-name={registry}
      data-company-label={curated ? text : undefined}
      title={text !== registry ? registry : undefined}
    >
      {text}
    </As>
  );
}

/**
 * The visible provenance line for a page whose subject IS one registry name.
 * Rendered under the `/company/` h1 — "registered name" is where a raw
 * SCREAMING-CAPS string belongs, and a reader searching USAspending needs
 * exactly this string, not the pretty one.
 *
 * A CURATED label makes this line mandatory rather than optional (#10 A): the
 * heading no longer even claims to be the registered name, so the page owes
 * the reader both the string and the fact that the site chose the heading. It
 * says which, in one clause, and points at the method rather than restating it.
 */
export function RegisteredNameNote({
  raw,
  label,
}: {
  raw: string;
  label?: string | null;
}) {
  const { display, registry } = displayCompanyName(raw);
  const curated = companyLabel(raw, label) !== display;
  if (!curated && display === registry) return null;
  return (
    <p
      data-registry-note=""
      className="mb-4 text-xs leading-5 text-muted-foreground"
    >
      Registered name in the award data:{" "}
      <span className="font-mono text-foreground">{registry}</span>.{" "}
      {curated ? (
        <>
          Search USAspending for that string. The heading above is a{" "}
          <a
            href="/methodology/#company-families"
            className="underline decoration-dotted hover:decoration-solid"
          >
            curated label
          </a>
          : this family&rsquo;s registered parent name was chosen by a near-tie
          over obligations, and we publish the reviewed name instead.
        </>
      ) : (
        <>
          Search USAspending for that string — the display name above is this
          site&rsquo;s casing of it, nothing else.
        </>
      )}
    </p>
  );
}
