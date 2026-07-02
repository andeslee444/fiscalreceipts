/**
 * <CoverageNote id> — server component.
 *
 * Renders a small scope/coverage disclaimer at the point of use with a link to
 * the relevant methodology anchor. The data-coverage attribute is the contract
 * checked by the G2 gate (coverage.mjs).
 */

import { getCoverage, type CoverageId } from "@/lib/coverage";
import Link from "next/link";

export function CoverageNote({
  id,
  className = "",
}: {
  id: CoverageId;
  className?: string;
}) {
  const c = getCoverage(id);
  return (
    <p
      data-coverage={id}
      className={`text-xs text-muted-foreground ${className}`}
    >
      {c.note}{" "}
      <Link
        href={c.anchor}
        className="underline decoration-dotted hover:text-foreground"
      >
        why →
      </Link>
    </p>
  );
}
