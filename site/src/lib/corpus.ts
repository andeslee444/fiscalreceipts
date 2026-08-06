import "server-only";

/**
 * Canonical corpus statement — PM-review Sprint 2, spec §P1-5.
 *
 * The site used to state its own size four different ways: /programs/ said
 * "1,741 program elements", /years/ said "all 1,993 program pages are
 * browsable", /methodology/ said "1,741 of 1,993", and /data/ showed
 * dim_programs = 326. From outside that reads as the site disagreeing with
 * itself on the one page built to let people check its work.
 *
 * There is now ONE wording, built from ONE pair of numbers:
 *
 *   programPages — every program_details sidecar, i.e. every /program/{pe}/
 *                  page that actually gets built. Counted from the directory,
 *                  which is the artifact itself, not a claim about it.
 *   detailPages  — sidecars that actually hold R-2/P-40 J-book DETAIL rows.
 *
 * site_meta.counts.program_pages is a CROSS-CHECK, not a second source: if the
 * exporter's count disagrees with the sidecars on disk, that is a real defect
 * and this module throws rather than picking a winner.
 *
 * BACKLOG #35 (Sprint 3 round 3). detailPages used to be programs.json's
 * length, 1,741 — while /data/ published dim_programs at 1,739 rows from the
 * parquet. programs.json is the /programs/ INDEX and since backlog #17 carries
 * two trajectory-only programs with no J-book detail; dim_programs, built from
 * the detail rows, holds neither. So the corpus statement overstated the
 * detail-grade tier by two on the very number /coverage/ leads with. It is now
 * getDetailGradeCount() — the sidecars that actually carry detail rows, with
 * the parquet's own row count as the cross-check.
 *
 * The scope caveat is `site_meta.corpus_scope` — the same string the §P0-5
 * hero superlative carries, so the two cannot drift.
 */

import { getDetailGradeCount, getProgramPagesCount, getSiteMeta } from "./data";
import { formatCount } from "./format";

export interface Corpus {
  /** Sidecars carrying R-2/P-40 J-book detail rows (= dim_programs). */
  detailPages: number;
  /** Every browsable /program/{pe}/ page (all tiers). */
  programPages: number;
  /** The §P0-5 scope caveat, verbatim from the build. */
  scope: string;
  /** The canonical sentence — the ONLY place corpus size is worded. */
  statement: string;
}

/** Shared with the datatruth gate's leg-d regex — change both or neither. */
export function corpusStatement(
  programPages: number,
  detailPages: number,
  scope: string,
): string {
  return (
    `${formatCount(programPages)} browsable program pages; ` +
    `${formatCount(detailPages)} of them ` +
    `carry detail-grade R-2/P-40 J-book data — ${scope}.`
  );
}

export function getCorpus(): Corpus {
  const meta = getSiteMeta();
  const programPages = getProgramPagesCount();
  const detailPages = getDetailGradeCount();

  const declared = meta.counts.program_pages;
  if (declared !== undefined && declared !== programPages) {
    throw new Error(
      `[govbudget/corpus] site_meta.counts.program_pages=${declared} but ` +
        `${programPages} program_details sidecars exist on disk. The export is ` +
        `inconsistent with its own output — re-run "uv run python -m govbudget export-site".`,
    );
  }
  if (!(programPages > 0) || !(detailPages > 0)) {
    throw new Error(
      `[govbudget/corpus] degenerate corpus (${programPages} pages, ${detailPages} detail-grade) — ` +
        `sidecars missing; re-run "uv run python -m govbudget export-site".`,
    );
  }
  if (detailPages > programPages) {
    throw new Error(
      `[govbudget/corpus] detail-grade (${detailPages}) exceeds total program pages (${programPages}) — ` +
        `the detail tier is a SUBSET of the page universe by definition.`,
    );
  }

  const scope = meta.corpus_scope;
  if (!scope) {
    throw new Error(
      `[govbudget/corpus] site_meta.json has no corpus_scope — re-run ` +
        `"uv run python -m govbudget export-site" (PM Sprint 2 §P1-5 added it).`,
    );
  }

  return {
    detailPages,
    programPages,
    scope,
    statement: corpusStatement(programPages, detailPages, scope),
  };
}
