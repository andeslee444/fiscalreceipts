import { displayCompanyName } from "@/lib/company-name.mjs";

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
 *   - the raw registry string, as `data-registry-name`, ALWAYS — including
 *     when the two are identical, so gate 2 leg (tc) can re-run the rule
 *     against the built HTML and catch a page that hand-rolled a name.
 *
 * `title` is set only when the two differ, so hovering a transformed name
 * shows what the award data actually records. Pages that carry a name as
 * their SUBJECT (the `/company/` detail page) show the registry string
 * visibly instead — a tooltip is not provenance on a page about one company.
 */
export function CompanyName({
  raw,
  className,
  as: As = "span",
}: {
  /** The registry string exactly as the award data records it. */
  raw: string;
  className?: string;
  as?: "span" | "strong";
}) {
  const { display, registry } = displayCompanyName(raw);
  return (
    <As
      className={className}
      data-company-name=""
      data-registry-name={registry}
      title={display !== registry ? registry : undefined}
    >
      {display}
    </As>
  );
}

/**
 * The visible provenance line for a page whose subject IS one registry name.
 * Rendered under the `/company/` h1 — "registered name" is where a raw
 * SCREAMING-CAPS string belongs, and a reader searching USAspending needs
 * exactly this string, not the pretty one.
 */
export function RegisteredNameNote({ raw }: { raw: string }) {
  const { display, registry } = displayCompanyName(raw);
  if (display === registry) return null;
  return (
    <p
      data-registry-note=""
      className="mb-4 text-xs leading-5 text-muted-foreground"
    >
      Registered name in the award data:{" "}
      <span className="font-mono text-foreground" data-registry-name={registry}>
        {registry}
      </span>
      . Search USAspending for that string — the display name above is this
      site&rsquo;s casing of it, nothing else.
    </p>
  );
}
