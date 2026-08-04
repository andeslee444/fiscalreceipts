/**
 * what-it-is.test.ts — §P1-2: the WHAT-IT-IS card is no longer a template stub.
 *
 * The PM's repro is the first case: /program/ATA000/ must speak the dossier's
 * own first sentence, with its fact citation, instead of
 * "F-35 – a procurement program run by Air Force."
 */

import { describe, it, expect } from "vitest";
import type { DossierClaim, DossierFile } from "@/lib/dossier";
import {
  DOSSIER_CARD_CHAR_BUDGET,
  buildFieldCard,
  buildRollupCard,
  hoistDossierClaims,
  pickAccountSource,
  whatItIsCard,
} from "@/lib/what-it-is";

const TEMPLATE_STUB = /^[^—]+ — an? [^.]+ program run by /;

function claim(text: string, factId = "5b532c52d3ebb4c2"): DossierClaim {
  return { text, citation: { fact_id: factId } };
}

function dossierWith(claims: DossierClaim[]): DossierFile {
  const empty = { claims: [] as DossierClaim[] };
  return {
    pe_bli: "ATA000",
    model: "test",
    collected_at: "2026-07-01T00:00:00Z",
    dossier: {
      what_it_is: { claims },
      why_it_matters: empty,
      players: empty,
      recent_developments: empty,
    },
  };
}

// The live ATA000 dossier's first two what_it_is claims.
const F35_CLAIM_1 =
  "F-35 (budget line ATA000) is a U.S. Air Force procurement line funded in " +
  "the Aircraft Procurement, Air Force account.";
const F35_CLAIM_2 =
  "The line procures the F-35 Joint Strike Fighter, a family of aircraft with " +
  "three variants — the F-35A conventional takeoff and landing, the F-35B " +
  "short takeoff and vertical landing, and the F-35C carrier variant — " +
  "sharing maximum commonality to minimize life-cycle cost.";

describe("hoistDossierClaims", () => {
  it("always takes the first claim, even when it alone exceeds the budget", () => {
    const long = claim("x".repeat(DOSSIER_CARD_CHAR_BUDGET + 50));
    expect(hoistDossierClaims([long, claim("second")])).toHaveLength(1);
  });

  it("takes a second claim when the pair fits the card budget", () => {
    const picked = hoistDossierClaims([claim("A."), claim("B."), claim("C.")]);
    expect(picked.map((c) => c.text)).toEqual(["A.", "B."]);
  });

  it("never takes more than two claims", () => {
    const picked = hoistDossierClaims([
      claim("A."),
      claim("B."),
      claim("C."),
      claim("D."),
    ]);
    expect(picked).toHaveLength(2);
  });

  it("stops before the budget rather than overflowing the fold", () => {
    const first = claim("a".repeat(300));
    const second = claim("b".repeat(300));
    expect(hoistDossierClaims([first, second])).toHaveLength(1);
  });

  it("keeps the budget inside the measured 390x844 headroom", () => {
    // 350px of headroom below the strip at 390 wide, ~19px per ~45-char line.
    const lines = Math.ceil(DOSSIER_CARD_CHAR_BUDGET / 45);
    expect(lines * 19).toBeLessThan(350);
  });

  it("returns nothing when the dossier section is empty", () => {
    expect(hoistDossierClaims([])).toEqual([]);
  });

  it("carries each claim's own citation with its text (never re-paired)", () => {
    const picked = hoistDossierClaims([claim("A.", "aaaa1111"), claim("B.", "bbbb2222")]);
    expect(picked[0].citation).toEqual({ fact_id: "aaaa1111" });
    expect(picked[1].citation).toEqual({ fact_id: "bbbb2222" });
  });
});

describe("whatItIsCard — dossier tier (the PM's repro)", () => {
  const input = {
    tier: "full" as const,
    peBli: "ATA000",
    title: "F-35",
    org: "F",
    exhibitFamily: "procurement",
    budgetLines: [
      {
        account_title: "Aircraft Procurement, Air Force",
        fact_id: "5b532c52d3ebb4c2",
        fy: 2024,
      },
    ],
    projectCount: 0,
    dossier: dossierWith([claim(F35_CLAIM_1), claim(F35_CLAIM_2, "dda8103fcf287a42")]),
    serviceOrg: "F",
    serviceIngested: true,
  };

  it("speaks the dossier's own first sentence", () => {
    const card = whatItIsCard(input);
    expect(card.source).toBe("dossier");
    if (card.source !== "dossier") throw new Error("unreachable");
    expect(card.claims[0].text).toBe(F35_CLAIM_1);
  });

  it("is NOT the name-plus-org template", () => {
    const card = whatItIsCard(input);
    if (card.source !== "dossier") throw new Error("unreachable");
    const text = card.claims.map((c) => c.text).join(" ");
    expect(text).not.toMatch(TEMPLATE_STUB);
    expect(text).not.toContain("a procurement program run by Air Force");
  });

  it("keeps every hoisted sentence fact-cited", () => {
    const card = whatItIsCard(input);
    if (card.source !== "dossier") throw new Error("unreachable");
    for (const c of card.claims) {
      expect("fact_id" in c.citation ? c.citation.fact_id : "").toMatch(
        /^[0-9a-f]{16}$/,
      );
    }
  });

  it("hoists BOTH F-35 sentences — the pair fits the card", () => {
    const card = whatItIsCard(input);
    if (card.source !== "dossier") throw new Error("unreachable");
    expect(card.claims).toHaveLength(2);
    expect(card.claims[1].text).toBe(F35_CLAIM_2);
  });

  it("keeps the F-35 pair inside the above-the-fold budget", () => {
    const card = whatItIsCard(input);
    if (card.source !== "dossier") throw new Error("unreachable");
    const total = card.claims.reduce((n, c) => n + c.text.length, 0);
    expect(total).toBeLessThanOrEqual(DOSSIER_CARD_CHAR_BUDGET + 1);
  });
});

describe("pickAccountSource", () => {
  it("prefers the highest fiscal year", () => {
    const picked = pickAccountSource([
      { account_title: "Old Account", fact_id: "a".repeat(16), fy: 2024 },
      { account_title: "Current Account", fact_id: "b".repeat(16), fy: 2026 },
    ]);
    expect(picked?.account_title).toBe("Current Account");
  });

  it("ignores lines with no account title or no fact id", () => {
    const picked = pickAccountSource([
      { account_title: "   ", fact_id: "a".repeat(16), fy: 2026 },
      { account_title: "Real", fact_id: "", fy: 2026 },
      { account_title: "Kept", fact_id: "c".repeat(16), fy: 2024 },
    ]);
    expect(picked?.account_title).toBe("Kept");
  });

  it("returns null when there is nothing to cite", () => {
    expect(pickAccountSource([])).toBeNull();
  });
});

describe("buildFieldCard — non-dossier full tier", () => {
  it("names the account and cites the workbook row it came from", () => {
    const card = buildFieldCard({
      peBli: "0604256N",
      title: "THREAT SIMULATOR DEVELOPMENT",
      org: "N",
      exhibitFamily: "rdte",
      budgetLines: [
        {
          account_title: "Research, Development, Test & Evaluation, Navy",
          fact_id: "f".repeat(16),
          fy: 2026,
        },
      ],
      projectCount: 3,
    });
    expect(card.text).toBe(
      "THREAT SIMULATOR DEVELOPMENT (0604256N) is a Navy research & development " +
        "line funded in the Research, Development, Test & Evaluation, Navy account. " +
        "Its J-book detail breaks the line into 3 projects.",
    );
    expect(card.accountFactId).toBe("f".repeat(16));
  });

  it("humanizes the org code — never renders the raw token", () => {
    const card = buildFieldCard({
      peBli: "ATA000",
      title: "F-35",
      org: "F",
      exhibitFamily: "procurement",
      budgetLines: [],
      projectCount: 0,
    });
    expect(card.text).toContain("an Air Force procurement line");
    expect(card.text).not.toMatch(/\bis a F\b/);
  });

  it("passes agency acronyms through unchanged", () => {
    const card = buildFieldCard({
      peBli: "0602702E",
      title: "TACTICAL TECHNOLOGY",
      org: "DARPA",
      exhibitFamily: "rdte",
      budgetLines: [],
      projectCount: 0,
    });
    expect(card.text).toContain("a DARPA research & development line");
  });

  it("omits the account clause rather than inventing one", () => {
    const card = buildFieldCard({
      peBli: "0605502A",
      title: "SMALL BUSINESS INNOVATIVE RESEARCH",
      org: "A",
      exhibitFamily: "rdte",
      budgetLines: [],
      projectCount: 0,
    });
    expect(card.text).toContain("in the FY2026 budget request.");
    expect(card.accountFactId).toBeNull();
  });

  it("uses the singular for a one-project line", () => {
    const card = buildFieldCard({
      peBli: "X",
      title: "T",
      org: "A",
      exhibitFamily: "rdte",
      budgetLines: [],
      projectCount: 1,
    });
    expect(card.text).toContain("into 1 project.");
  });

  it("is materially more than name-plus-org", () => {
    const card = buildFieldCard({
      peBli: "ATA000",
      title: "F-35",
      org: "F",
      exhibitFamily: "procurement",
      budgetLines: [
        {
          account_title: "Aircraft Procurement, Air Force",
          fact_id: "1".repeat(16),
          fy: 2024,
        },
      ],
      projectCount: 0,
    });
    expect(card.text).not.toMatch(TEMPLATE_STUB);
    expect(card.text).toContain("Aircraft Procurement, Air Force");
  });
});

describe("buildRollupCard — keeps the tier's honest tail", () => {
  it("says the book is ingested but carries no detail for this line", () => {
    const card = buildRollupCard({
      title: "SPACE PROGRAMS",
      org: "Air Force",
      exhibitFamily: "rdte",
      serviceOrg: "F",
      serviceIngested: true,
    });
    expect(card.tail).toContain("Air Force FY2026 book is ingested");
    expect(card.tail).toContain("no R-2/P-40 detail");
  });

  it("says the book is not ingested when it is not", () => {
    const card = buildRollupCard({
      title: "SOME LINE",
      org: "DHA",
      exhibitFamily: "budget",
      serviceOrg: "DHA",
      serviceIngested: false,
    });
    expect(card.tail).toContain("DHA detail book is not yet ingested");
  });

  it("routes rollup pages to the rollup card", () => {
    const card = whatItIsCard({
      tier: "rollup",
      peBli: "0605123F",
      title: "SPACE PROGRAMS",
      org: "Air Force",
      exhibitFamily: "rdte",
      budgetLines: [],
      projectCount: 0,
      dossier: null,
      serviceOrg: "F",
      serviceIngested: true,
    });
    expect(card.source).toBe("rollup");
  });
});

describe("whatItIsCard — a dossier with an empty what_it_is falls back", () => {
  it("uses the field card rather than rendering an empty card", () => {
    const card = whatItIsCard({
      tier: "full",
      peBli: "ATA000",
      title: "F-35",
      org: "F",
      exhibitFamily: "procurement",
      budgetLines: [
        { account_title: "Aircraft Procurement, Air Force", fact_id: "9".repeat(16), fy: 2024 },
      ],
      projectCount: 0,
      dossier: dossierWith([]),
      serviceOrg: "F",
      serviceIngested: true,
    });
    expect(card.source).toBe("fields");
  });
});
