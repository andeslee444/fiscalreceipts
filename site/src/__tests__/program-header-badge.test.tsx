/**
 * ProgramHeader's reconciliation badge — tri-persona review Wave 2.
 *
 * The shipped defect was not a wrong number. `fully_reconciled` was
 * bool_and(reconciled) over EVERY J-book scenario, including AllPriorYears,
 * which govbudget.jbooks.reconcile issues no check for (0 of 3,267 rows
 * reconciled, by construction). So 1,310 programs whose every CHECKED
 * scenario tied wore the same "Partial Reconciliation" badge as the 87 with
 * a genuine failure, and 345 read "Fully Reconciled" only because they happen
 * to carry no AllPriorYears detail at all.
 *
 * What these tests hold:
 *   1. the badge reads reconciled_in_scope and NOTHING else — a row that is
 *      false on the old flag and true on the new one must read as clean;
 *   2. a real failure stays visibly distinct, in words and in the attribute;
 *   3. the pass label is "Reconciled", never "Fully Reconciled" — the 1,310
 *      promoted rows DO carry an unreconciled AllPriorYears row, and widening
 *      the claim to fit the new number is the failure mode this fix exists to
 *      avoid;
 *   4. every state links to its definition.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

import { ProgramHeader } from "@/components/program-header";
import type { ProgramRow } from "@/lib/data";

const BASE: ProgramRow = {
  award_count: 0,
  exhibit_family: "rdte",
  fully_reconciled: false,
  reconciled_in_scope: true,
  fy2024_actual_millions: 100,
  fy2024_fact_id: null,
  fy2024_xml_path: null,
  hhi: null,
  narrative_count: 0,
  org: "DARPA",
  pe_bli: "0603286E",
  project_count: 1,
  title: "Advanced Aerospace Systems",
  trajectory: null,
  trajectory_fact_ids: null,
  slug: "0603286E",
  account: null,
  account_title: null,
};

function badge(program: ProgramRow, tier: "full" | "rollup" = "full") {
  const { container } = render(
    <ProgramHeader program={program} tier={tier} orgHasPage={false} />,
  );
  return container.querySelector("[data-reconciliation-badge]") as HTMLElement;
}

afterEach(cleanup);

describe("ProgramHeader reconciliation badge", () => {
  it('reads reconciled_in_scope, not fully_reconciled (the 1,310-page case)', () => {
    // B-21's shape: every checked scenario ties, AllPriorYears does not, so
    // the old flag is false. The page used to warn about it.
    const el = badge({ ...BASE, fully_reconciled: false, reconciled_in_scope: true });
    expect(el.getAttribute("data-reconciliation-badge")).toBe("reconciled");
    expect(el.textContent).toBe("Reconciled");
  });

  it("keeps a genuine in-scope failure visibly distinct (the 87-page case)", () => {
    const el = badge({ ...BASE, fully_reconciled: false, reconciled_in_scope: false });
    expect(el.getAttribute("data-reconciliation-badge")).toBe("partial");
    expect(el.textContent).toBe("Partial Reconciliation");
  });

  it('never claims "Fully Reconciled" — the promoted rows are not fully anything', () => {
    for (const fully of [true, false]) {
      cleanup();
      const el = badge({ ...BASE, fully_reconciled: fully, reconciled_in_scope: true });
      expect(el.textContent).not.toContain("Fully");
    }
  });

  it("distinguishes 'nothing was checked' from 'a check failed'", () => {
    const el = badge({ ...BASE, reconciled_in_scope: null });
    expect(el.getAttribute("data-reconciliation-badge")).toBe("no-detail");
    expect(el.textContent).toBe("No detail to reconcile");
  });

  it("rollup tier still says summary figures, not a reconciliation verdict", () => {
    const el = badge({ ...BASE, reconciled_in_scope: null }, "rollup");
    expect(el.getAttribute("data-reconciliation-badge")).toBe("rollup");
    expect(el.textContent).toContain("Summary figures");
  });

  it("links every verdict to its glossary definition", () => {
    for (const v of [true, false, null] as (boolean | null)[]) {
      cleanup();
      const { container } = render(
        <ProgramHeader
          program={{ ...BASE, reconciled_in_scope: v }}
          tier="full"
          orgHasPage={false}
        />,
      );
      const el = container.querySelector("[data-reconciliation-badge]")!;
      // jsdom's Link renders the href without next.config's trailingSlash
      // rewrite; the built page emits "/glossary/#partial-reconciliation"
      // (gate 23 leg k2 asserts that form on the real artifact).
      const href = el.closest("a")?.getAttribute("href");
      expect(href).toMatch(/^\/glossary\/?#partial-reconciliation$/);
    }
  });

  it("states what the verdict means where the reader meets it", () => {
    const clean = badge({ ...BASE, reconciled_in_scope: true });
    expect(clean.getAttribute("title")).toMatch(/ties to the R-1\/P-1 workbook/);
    cleanup();
    const failed = badge({ ...BASE, reconciled_in_scope: false });
    expect(failed.getAttribute("title")).toMatch(/FAILED/);
    cleanup();
    const none = badge({ ...BASE, reconciled_in_scope: null });
    expect(none.getAttribute("title")).toMatch(/no check was run/);
  });
});
