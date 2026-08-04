/**
 * <CorpusStatement /> — server component. PM-review Sprint 2, spec §P1-5.
 *
 * The site's single account of its own size. Rendered on /programs/, /years/,
 * /methodology/ and /data/ — the four pages that previously stated corpus size
 * four different ways. Every number comes from lib/corpus (build data); this
 * file authors none of them.
 *
 * The data-corpus-statement attribute is the contract checked by the gate-24
 * datatruth gate (leg d), which reads the RENDERED text — not the attribute —
 * and requires all four pages to agree with the sidecars and each other.
 */

import Link from "next/link";
import { getCorpus } from "@/lib/corpus";

export function CorpusStatement({
  className = "",
  /** Prefix label; set to null on pages where the surrounding prose supplies it. */
  label = "Corpus:",
}: {
  className?: string;
  label?: string | null;
}) {
  const corpus = getCorpus();
  return (
    <p
      data-corpus-statement
      className={`text-xs text-muted-foreground ${className}`}
    >
      {label ? <span className="font-medium text-foreground">{label} </span> : null}
      {corpus.statement}{" "}
      <Link
        href="/methodology/#coverage-service-books"
        className="underline decoration-dotted hover:text-foreground"
      >
        what separates the two tiers? →
      </Link>
    </p>
  );
}
