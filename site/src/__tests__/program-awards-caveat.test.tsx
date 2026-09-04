import { render } from "@testing-library/react";
import { ProgramAwards } from "@/components/program-awards";

const row = (piid: string, confidence: string) => ({ award_piid: piid, recipient_name: "X", confidence });

test("medium rows render the tier caveat", () => {
  const { container } = render(
    <ProgramAwards initialAwards={[row("A", "high"), row("B", "medium")]} totalCount={2} peBli="0601101E" />,
  );
  const note = container.querySelector("[data-awards-tier-note='medium']");
  expect(note).not.toBeNull();
  expect(note!.textContent).toMatch(/same appropriation account and agency/);
});

test("high-only tables render no caveat", () => {
  const { container } = render(
    <ProgramAwards initialAwards={[row("A", "high")]} totalCount={1} peBli="0601101E" />,
  );
  expect(container.querySelector("[data-awards-tier-note]")).toBeNull();
});
