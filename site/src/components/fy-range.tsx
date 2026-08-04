/**
 * <FyRange /> — server component. PM-review Sprint 2, spec §P1-6.
 *
 * The period an aggregate covers, in ONE wording, everywhere. Aggregate KPIs
 * used to render with no period at all — "$3.66T · all-district obligations"
 * next to "$8.0B · linkable dollars" — which reads as an annual figure. It is
 * a decade of USAspending award obligations.
 *
 * Every instance renders the SAME token (lib/fy-range, derived at export from
 * fct_award_transactions); this file authors no years. The data-fy-range
 * attribute carries the same label as the rendered text so the gate can find
 * aggregate figures and confirm they are periodised — the gate reads the
 * RENDERED text, never the attribute, for the value it checks.
 *
 * Renders nothing when the export carries no range (degenerate export) rather
 * than guess a period.
 */

import { getAwardFyRange } from "@/lib/fy-range";

export function FyRange({
  className = "",
  /** Leading separator for KPI sub-labels ("linkable obligations · FY2017–FY2026"). */
  separator = null,
}: {
  className?: string;
  separator?: string | null;
}) {
  const range = getAwardFyRange();
  if (!range) return null;
  return (
    <>
      {separator ? <span aria-hidden="true">{separator}</span> : null}
      <span
        data-fy-range={range.label}
        data-fy-partial={range.maxPartial ? "" : undefined}
        title={range.title}
        className={`whitespace-nowrap tabular-nums ${className}`}
      >
        {range.label}
      </span>
    </>
  );
}
