/**
 * The in-table medium-tier caveat (ROADMAP #77; 2026-09-04 final review C3).
 *
 * THE DEFECT. The caveat said medium rows "drew from the same appropriation
 * account and agency as this program". True of ~8,800 account/sub-agency rows
 * and FALSE of the ~2,300 that rest on an FPDS acquisition-program tag, a
 * subaward description, or an unadjudicated keyword match — and /methodology/
 * describes those three correctly one page away. A true sentence about most
 * rows, printed over all of them, is a false sentence about the table.
 *
 * The table has no method column (the sidecar carries only piid, recipient
 * and confidence), so the caveat is POOLED and must therefore be true of
 * every medium species. These tests assert the load-bearing phrases that make
 * it so — reword the caveat and they fail, which is the point. Gate 21 leg m
 * asserts the same phrases against the BUILT pages.
 */

import { test, expect } from "vitest";
import { render } from "@testing-library/react";
import { ProgramAwards } from "@/components/program-awards";

const row = (piid: string, confidence: string) => ({
  award_piid: piid,
  recipient_name: "X",
  confidence,
});

test("medium rows render the tier caveat", () => {
  const { container } = render(
    <ProgramAwards
      initialAwards={[row("A", "high"), row("B", "medium")]}
      totalCount={2}
      peBli="0601101E"
    />,
  );
  const note = container.querySelector("[data-awards-tier-note='medium']");
  expect(note).not.toBeNull();
  expect(note!.textContent).toMatch(/rest on\s+evidence weaker than a program-level match/);
});

test("the caveat is true of every medium species, not just the account one", () => {
  const { container } = render(
    <ProgramAwards initialAwards={[row("B", "medium")]} totalCount={1} peBli="0601101E" />,
  );
  const text = container
    .querySelector("[data-awards-tier-note='medium']")!
    .textContent!.replace(/\s+/g, " ");

  // account / account+subagency / account+tokens — an association, hedged.
  expect(text).toContain("same appropriation account as this program");
  expect(text).toContain("not evidence that this program paid for the contract");
  // fpds-ap and subaward+lexicon — program established, budget line not.
  expect(text).toContain("FPDS acquisition-program tag or a subaward description");
  expect(text).toContain("which of its budget lines paid is not");
  // The pre-C3 sentence claimed ALL medium rows were account+agency matches.
  expect(text).not.toContain("drew from the same appropriation account and agency");
});

test("the high tier's claim is about naming the program, not confidence alone", () => {
  const { container } = render(
    <ProgramAwards initialAwards={[row("B", "medium")]} totalCount={1} peBli="0601101E" />,
  );
  const text = container
    .querySelector("[data-awards-tier-note='medium']")!
    .textContent!.replace(/\s+/g, " ");
  expect(text).toContain("high rows rest on evidence that names this program");
});

test("high-only tables render no caveat", () => {
  const { container } = render(
    <ProgramAwards initialAwards={[row("A", "high")]} totalCount={1} peBli="0601101E" />,
  );
  expect(container.querySelector("[data-awards-tier-note]")).toBeNull();
});
