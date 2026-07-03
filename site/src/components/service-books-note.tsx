/**
 * <ServiceBooksNote> — the rollup-tier honesty note (Phase 5F §2a).
 *
 * Rollup pages carry R-1/P-1 workbook figures but no J-book detail because
 * the service narrative books (service comptroller sites) are not yet
 * ingested. The note states that plainly and links the word 'roadmap' to the
 * methodology coverage anchor.
 *
 * data-coverage="service-books" is the G2 coverage-gate contract (the gate's
 * representative page is the first rollup-tier program page); the wording
 * auto-adjusts per service via serviceOrgName. data-section-empty marks it
 * as the description section's explained empty state for the
 * program-skeleton gate.
 */

import Link from "next/link";
import { serviceOrgName } from "@/lib/program-tier";

export function ServiceBooksNote({
  serviceOrg,
  className = "",
}: {
  serviceOrg: string;
  className?: string;
}) {
  // Empty org code (1 sidecar) → the generic "service" so the sentence
  // still reads honestly.
  const service = serviceOrgName(serviceOrg) || "service";
  return (
    <p
      data-coverage="service-books"
      data-section-empty
      className={`text-sm text-muted-foreground ${className}`}
    >
      Detailed justification for this program lives in the {service} J-book,
      which is not yet ingested — see{" "}
      <Link
        href="/methodology/#coverage-service-books"
        className="underline decoration-dotted hover:text-foreground"
      >
        roadmap
      </Link>
      .
    </p>
  );
}
