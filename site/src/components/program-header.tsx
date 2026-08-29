import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { HeroCategory, ProgramRow } from "@/lib/data";
import { CategoryHero } from "@/components/hero";
import { serviceOrgName } from "@/lib/program-tier";

/**
 * ProgramHeader — title, org link, exhibit_family badge, reconciliation badge, pe_bli mono.
 * Server component.
 *
 * The org links to /agency/{org}/ ONLY when the page passes orgHasPage
 * (computed from agencies.json, the agency generateStaticParams source).
 * `org` is always the raw org CODE — the /agency/ route's own identity and
 * the key agencies.json is indexed by. A humanized name here matches no
 * agency and silently demotes every such page to the plain-text branch,
 * which is exactly what rollup pages did until lib/program-tier.ts was fixed.
 * The codes that genuinely have no agency page are the workbook orgs outside
 * agencies.json — DHA, DEFW, IG, and the "DoD" umbrella a sidecar with no
 * service_org falls back to. Those render the org as plain text, never a
 * dead link (G1 contract).
 *
 * Top-50 dossier pages (category present in categories.json) additionally get
 * a subtle CategoryHero background layer behind the header text (Task 8a);
 * all other program pages are unchanged (no hero markup at all).
 */

interface ProgramHeaderProps {
  program: ProgramRow;
  /** Hero category for top-50 pages; null/undefined → no hero layer. */
  category?: HeroCategory | null;
  /**
   * Whether /agency/{org}/ exists as a built page. The program page computes
   * this from agencies.json; defaults to true (all dim_programs orgs have
   * agency pages — only synthesized trajectory-only programs don't).
   */
  orgHasPage?: boolean;
  /**
   * Page tier (Phase 5F §2a). Rollup pages carry only R-1/P-1 workbook
   * figures — the reconciliation badge (a full-tier line-item concept) is
   * replaced by an honest "Summary figures" badge.
   */
  tier?: "full" | "rollup";
}

/**
 * Human-friendly label for exhibit_family values.
 *
 * Sprint E, Task E3 (ROADMAP #67): null is now a real case — one of the 8
 * appropriation-account collisions' SYNTHETIC accounts (e.g. LPD Flight II)
 * has no R-2/P-40 exhibit behind it at all (dbt/models/marts/dim_programs.sql's
 * `synth` branch casts exhibit_family NULL), the same "no classifiable
 * workbook lines" shape the rollup tier already names "Budget."
 */
function exhibitFamilyLabel(family: string | null): string {
  switch ((family ?? "budget").toLowerCase()) {
    case "rdte":
      return "RDT&E";
    case "procurement":
      return "Procurement";
    case "om":
    case "o&m":
      return "O&M";
    case "milpers":
      return "MILPERS";
    case "budget":
      return "Budget";
    default:
      return family!.toUpperCase();
  }
}

/**
 * Tri-persona review Wave 2 — the badge said the same thing about 1,310
 * clean programs and 87 broken ones.
 *
 * The old predicate was ProgramRow.fully_reconciled, i.e. bool_and over
 * EVERY J-book detail scenario. One of those scenarios, AllPriorYears, has
 * no R-1/P-1 display analog, so govbudget.jbooks.reconcile never issues a
 * check for it and its rows keep `reconciled=false` permanently — 0 of 3,267
 * in the shipped corpus. Measured 2026-08-29 against dim_programs: 345 rows
 * read "Fully Reconciled" (only because they happen to carry no
 * AllPriorYears detail at all), 1,398 read "Partial Reconciliation", and of
 * those 1,398 exactly 87 have a real in-scope failure. B-21 wore the warning
 * badge with every checked scenario tying; F-47 wore the identical badge
 * with five genuine BudgetYearOne failures.
 *
 * So the badge now reads dim_programs.reconciled_in_scope, and the pass
 * label is "Reconciled" — NOT "Fully Reconciled". The 1,310 promoted rows do
 * carry an unreconciled AllPriorYears row; claiming "fully" of them would
 * widen the claim to fit the new number, which is the opposite of the fix.
 * Each state links to its glossary entry, because a badge whose term appears
 * nowhere else on the site is not a disclosure.
 */
const RECONCILED_TITLE =
  "Every scenario this site reconciles — prior-year actuals, current-year " +
  "enacted, and the budget-year request and its base — ties to the R-1/P-1 " +
  "workbook rollup for this line. Click for the full definition.";
const PARTIAL_TITLE =
  "At least one reconciliation check FAILED for this line: a scenario's " +
  "J-book detail does not tie to the R-1/P-1 workbook rollup. The failure " +
  "is filed in the review queue. Click for the full definition.";
const NO_DETAIL_TITLE =
  "No reconcilable R-2/P-40 detail exists for this line, so no check was " +
  "run — this is an absence of evidence, not a failed check. Click for the " +
  "full definition.";

export function ProgramHeader({
  program,
  category,
  orgHasPage = true,
  tier = "full",
}: ProgramHeaderProps) {
  const { title, org, exhibit_family, reconciled_in_scope, pe_bli } = program;

  return (
    <div className={category ? "relative mb-6 -mx-3 px-3 py-3" : "mb-6"}>
      {/* Background hero layer — rendered FIRST so the header text paints on
          top in DOM order (no z-index juggling); aria-hidden + pointer-events
          none keep it purely decorative. */}
      {category && <CategoryHero category={category} />}

      {/* data-program-name: program titles are official names from J-books;
          some contain "$5M" thresholds that are part of the program identifier. */}
      <h1 className="relative text-2xl md:text-3xl font-bold text-foreground leading-tight mb-2" data-program-name>
        {title}
      </h1>

      <div className="relative flex flex-wrap items-center gap-2 text-sm">
        {/* Org link — only when the agency page exists (see doc comment).
            §P1-E badge sweep: the LABEL is the human service name ("Air
            Force"), never the raw workbook token ("F"); the href keeps the raw
            code because that is the agency page's identity. Agency acronyms
            (OSD, DARPA, MDA, …) pass through serviceOrgName unchanged. */}
        {orgHasPage ? (
          <Link
            href={`/agency/${encodeURIComponent(org)}/`}
            className="text-primary hover:underline font-medium"
            title={`Organization code ${org}`}
          >
            {serviceOrgName(org)}
          </Link>
        ) : (
          <span className="font-medium text-foreground" title={`Organization code ${org}`}>
            {serviceOrgName(org)}
          </span>
        )}

        <span className="text-muted-foreground/50" aria-hidden="true">
          ·
        </span>

        {/* Exhibit family */}
        <Badge variant="secondary" className="text-xs">
          {exhibitFamilyLabel(exhibit_family)}
        </Badge>

        {/* Tier badge: full pages show reconciliation state; rollup pages
            (R-1/P-1 workbook figures only — Phase 5F §2a) say so honestly
            instead of claiming a reconciliation status they never had. */}
        {tier === "rollup" ? (
          <Badge
            variant="outline"
            className="text-xs text-muted-foreground"
            data-reconciliation-badge="rollup"
            title="Summary figures from the all-service R-1/P-1 workbooks — this line carries no matching R-2/P-40 J-book detail (see the description note for why)"
          >
            Summary figures (R-1/P-1)
          </Badge>
        ) : reconciled_in_scope === true ? (
          <Link href="/glossary/#partial-reconciliation" className="rounded-sm">
            <Badge
              variant="default"
              className="text-xs bg-green-100 text-green-800 border-green-200 hover:bg-green-200"
              data-reconciliation-badge="reconciled"
              title={RECONCILED_TITLE}
            >
              Reconciled
            </Badge>
          </Link>
        ) : reconciled_in_scope === false ? (
          <Link href="/glossary/#partial-reconciliation" className="rounded-sm">
            <Badge
              variant="outline"
              className="text-xs border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
              data-reconciliation-badge="partial"
              title={PARTIAL_TITLE}
            >
              Partial Reconciliation
            </Badge>
          </Link>
        ) : (
          <Link href="/glossary/#partial-reconciliation" className="rounded-sm">
            <Badge
              variant="outline"
              className="text-xs text-muted-foreground"
              data-reconciliation-badge="no-detail"
              title={NO_DETAIL_TITLE}
            >
              No detail to reconcile
            </Badge>
          </Link>
        )}

        {/* PE-BLI */}
        <span className="text-muted-foreground/50" aria-hidden="true">
          ·
        </span>
        <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
          {pe_bli}
        </code>
      </div>
    </div>
  );
}
