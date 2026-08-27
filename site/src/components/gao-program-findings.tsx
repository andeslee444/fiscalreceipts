/**
 * gao-program-findings.tsx — the PROGRAM tier of the Oversight section
 * (ROADMAP #30).
 *
 * The department tier ("GAO lists 5 high-risk areas for DOD as a whole") was
 * de-emphasized in PM Sprint 2 precisely because it is not about the program
 * whose page it sits on.  This block carries the tier that is: GAO's own
 * per-program assessment from the Weapon Systems Annual Assessment, and the
 * program-specific GAO reports that volume cites.  It renders ABOVE the
 * department note and takes the emphasis the department note gave up.
 *
 * Three deliberate choices:
 *
 * 1. **Not the amber caution register.**  `notes.tsx` reserves amber for
 *    "this NUMBER needs care".  GAO assessing a program is not by itself an
 *    adverse finding — several of these assessments are unremarkable — so
 *    turning every one amber would relabel routine oversight as a defect and
 *    re-break the register PM Sprint 3 repaired.  Emphasis comes from
 *    structure instead: a full card, a foreground heading, a ruled pull
 *    quote.
 *
 * 2. **GAO's words, verbatim, in quotation marks.**  The description is
 *    GAO's own paragraph as printed in the report, ingested unmodified.  A
 *    paraphrase would be a new uncited claim about a weapons program.
 *
 * 3. **The scope line is not decoration.**  GAO assesses a PROGRAM; this page
 *    is one budget line that funds it.  Saying so is the difference between
 *    a true statement and an implied finding against a line GAO never
 *    examined.
 */

import Link from "next/link";
import type { GaoProgramFindings } from "@/lib/data";

function releasedLabel(iso: string): string {
  // "2025-06" or "2024-05-16" -> "June 2025" / "May 16, 2024"
  const parts = iso.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || !m) return iso;
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return parts.length > 2
    ? `${month} ${Number(parts[2])}, ${y}`
    : `${month} ${y}`;
}

/** "an Air Force", "an Army", "a Navy", "a Space Force". */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export function GaoProgramFindingsBlock({
  findings,
  programTitle,
}: {
  findings: GaoProgramFindings;
  programTitle: string;
}) {
  const total = findings.assessments.length + findings.reports.length;
  return (
    <div
      data-gao-scope="program"
      data-gao-item-count={total}
      className="mb-4 rounded-lg border border-border bg-card px-4 py-3.5"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
        GAO oversight of this program
      </p>

      {findings.assessments.map((a) => (
        <div
          key={`${a.product_number}:${a.common_name}`}
          data-gao-item="assessment"
          data-gao-product={a.product_number}
          data-gao-program={a.gao_program}
          className="mt-3"
        >
          <p className="text-sm text-foreground">
            GAO assessed{" "}
            <span data-gao-program-name className="font-semibold">
              {a.gao_program}
            </span>{" "}
            in its {releasedLabel(a.released)} Weapon Systems Annual
            Assessment, as {article(a.service)} {a.service}{" "}
            {a.assessment_type} program.
          </p>
          <blockquote
            data-gao-quote
            className="mt-2 border-l-2 border-foreground/25 pl-3 text-sm text-foreground/85"
          >
            &ldquo;{a.description}&rdquo;
          </blockquote>
          <p className="mt-1.5 text-xs text-muted-foreground">
            <a
              href={a.report_url}
              data-gao-cite
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              title={a.report_title}
            >
              {a.product_number}
            </a>
            , p. {a.report_page} —{" "}
            <a
              href={`${a.pdf_url}#page=${a.pdf_page}`}
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              the assessment page in GAO&rsquo;s report
            </a>
          </p>
        </div>
      ))}

      {findings.reports.length > 0 && (
        <div className="mt-3">
          <p className="text-sm text-foreground">
            GAO reports naming this program:
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {findings.reports.map((r) => (
              <li
                key={r.product_number}
                data-gao-item="report"
                data-gao-product={r.product_number}
                data-gao-program={r.gao_program}
                className="text-sm text-foreground/85"
              >
                <a
                  href={r.report_url}
                  data-gao-cite
                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                >
                  {r.report_title}
                </a>{" "}
                <span className="text-xs text-muted-foreground">
                  ({r.product_number}, {releasedLabel(r.released)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p
        data-gao-program-scope
        className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground"
      >
        GAO assessed the program, not this budget line.{" "}
        <span data-program-name>{programTitle}</span> is one of the lines that
        funds it, and GAO&rsquo;s work above says nothing about this line&rsquo;s
        own figures. Which line each GAO item attaches to is a hand-ratified
        crosswalk —{" "}
        <Link
          href="/methodology/#gao-program-crosswalk"
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          how it was checked
        </Link>
        .
      </p>
    </div>
  );
}
