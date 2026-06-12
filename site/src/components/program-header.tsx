import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ProgramRow } from "@/lib/data";

/**
 * ProgramHeader — title, org link, exhibit_family badge, fully_reconciled badge, pe_bli mono.
 * Server component.
 */

interface ProgramHeaderProps {
  program: ProgramRow;
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

export function ProgramHeader({ program }: ProgramHeaderProps) {
  const { title, org, exhibit_family, fully_reconciled, pe_bli } = program;

  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-foreground leading-tight mb-2">
        {title}
      </h1>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {/* Org link */}
        <Link
          href={`/agency/${encodeURIComponent(org)}/`}
          className="text-primary hover:underline font-medium"
        >
          {org}
        </Link>

        <span className="text-muted-foreground/50" aria-hidden="true">
          ·
        </span>

        {/* Exhibit family */}
        <Badge variant="secondary" className="text-xs">
          {exhibitFamilyLabel(exhibit_family)}
        </Badge>

        {/* Fully reconciled */}
        {fully_reconciled ? (
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
