import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { HeroCategory, ProgramRow } from "@/lib/data";
import { CategoryHero } from "@/components/hero";

/**
 * ProgramHeader — title, org link, exhibit_family badge, fully_reconciled badge, pe_bli mono.
 * Server component.
 *
 * The org links to /agency/{org}/ ONLY when the page passes orgHasPage
 * (computed from agencies.json, the agency generateStaticParams source).
 * Trajectory-only feed programs (backlog #17) carry service workbook org
 * codes (A/N/F/DHA) with no agency pages — those render the org as plain
 * text, never a dead link (G1 contract).
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

/** Human-friendly label for exhibit_family values. */
function exhibitFamilyLabel(family: string): string {
  switch (family.toLowerCase()) {
    case "rdte":
      return "RDT&E";
    case "procurement":
      return "Procurement";
    case "om":
    case "o&m":
      return "O&M";
    case "milpers":
      return "MILPERS";
    default:
      return family.toUpperCase();
  }
}

export function ProgramHeader({
  program,
  category,
  orgHasPage = true,
  tier = "full",
}: ProgramHeaderProps) {
  const { title, org, exhibit_family, fully_reconciled, pe_bli } = program;

  return (
    <div className={category ? "relative mb-6 -mx-3 px-3 py-3" : "mb-6"}>
      {/* Background hero layer — rendered FIRST so the header text paints on
          top in DOM order (no z-index juggling); aria-hidden + pointer-events
          none keep it purely decorative. */}
      {category && <CategoryHero category={category} />}

      {/* data-program-name: program titles are official names from J-books;
          some contain "$5M" thresholds that are part of the program identifier. */}
      <h1 className="relative text-2xl font-bold text-foreground leading-tight mb-2" data-program-name>
        {title}
      </h1>

      <div className="relative flex flex-wrap items-center gap-2 text-sm">
        {/* Org link — only when the agency page exists (see doc comment) */}
        {orgHasPage ? (
          <Link
            href={`/agency/${encodeURIComponent(org)}/`}
            className="text-primary hover:underline font-medium"
          >
            {org}
          </Link>
        ) : (
          <span className="font-medium text-foreground">{org}</span>
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
            title="Summary figures from the all-service R-1/P-1 workbooks — the detailed service J-book is not yet ingested"
          >
            Summary figures (R-1/P-1)
          </Badge>
        ) : fully_reconciled ? (
          <Badge
            variant="default"
            className="text-xs bg-green-100 text-green-800 border-green-200"
            title="All budget line items have been reconciled against source documents"
          >
            Fully Reconciled
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-xs text-muted-foreground"
            title="Reconciliation in progress — some line items may be unmatched"
          >
            Partial Reconciliation
          </Badge>
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
