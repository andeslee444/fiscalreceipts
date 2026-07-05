/**
 * <ServiceBooksNote> — the rollup-tier honesty note (Phase 5F §2a, 5G §5).
 *
 * Rollup pages carry R-1/P-1 workbook figures but no R-2/P-40 J-book detail.
 * The reason depends on the service:
 *
 *   • Ingested services (Navy 'N', Army 'A', Air Force / Space Force 'F') —
 *     as of the Phase 5G archive round, all three military-department FY2026
 *     J-books ARE ingested; this particular PE simply has no matching
 *     R-2/P-40 narrative in them (e.g. a procurement-only, summary,
 *     classified, or SBIR line). Saying it is "not yet ingested" would be
 *     false, so the note says so honestly instead.
 *   • Other org codes with no service J-book concept (DHA, OSD, …) keep the
 *     generic honest note.
 *
 * Either way the word 'roadmap' links to the methodology coverage anchor.
 *
 * data-coverage="service-books" is the G2 coverage-gate contract (the gate's
 * representative page is the first rollup-tier program page); the wording
 * auto-adjusts per service via serviceOrgName / isIngestedServiceOrg.
 * data-section-empty marks it as the description section's explained empty
 * state for the program-skeleton gate.
 */

import Link from "next/link";
import { serviceOrgName, isIngestedServiceOrg } from "@/lib/program-tier";

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
  const ingested = isIngestedServiceOrg(serviceOrg);
  return (
    <p
      data-coverage="service-books"
      data-section-empty
      className={`text-sm text-muted-foreground ${className}`}
    >
      {ingested ? (
        <>
          The {service} FY2026 J-books are ingested, but this program element
          carries no R-2/P-40 narrative in them — only its cited R-1/P-1
          workbook figures are shown. See{" "}
        </>
      ) : (
        <>
          Detailed justification for this program lives in the {service}{" "}
          J-book, which is not yet ingested — see{" "}
        </>
      )}
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
