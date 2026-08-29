import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  AGENCY_NAMES,
  agencyFullName,
  agencyDisplayName,
} from "../agency-names";

const JSON_DIR = path.resolve(process.cwd(), "..", "data", "site", "json");

describe("agencyFullName", () => {
  it("refuses rather than guesses on an unknown code", () => {
    expect(agencyFullName("ZZZ")).toBeNull();
    expect(agencyDisplayName("ZZZ")).toBe("ZZZ");
  });

  it("expands the three service codes the same way serviceOrgName does", () => {
    expect(agencyFullName("A")).toBe("Army");
    expect(agencyFullName("N")).toBe("Navy");
    expect(agencyFullName("F")).toBe("Air Force");
  });

  it("keeps DPAP as the account this corpus actually files under it", () => {
    // The reflexive expansion is "Defense Procurement and Acquisition
    // Policy" and it is wrong here: DPAP's one program in this corpus is
    // "Defense Production Act Purchases". Pinned so a future tidy-up cannot
    // quietly "correct" it back.
    expect(agencyFullName("DPAP")).toBe("Defense Production Act Purchases");
  });

  it("names nothing after its own code", () => {
    for (const [code, name] of Object.entries(AGENCY_NAMES)) {
      expect(name.trim().length, code).toBeGreaterThan(0);
      expect(name, code).not.toBe(code);
    }
  });
});

describe("the shipped corpus", () => {
  const agenciesPath = path.join(JSON_DIR, "agencies.json");
  const haveData = fs.existsSync(agenciesPath);

  // THE POINT OF THIS TEST. agency-names.ts refuses rather than guesses, so a
  // code it has never been taught renders bare — honest, but it is exactly
  // the "TJS" the layman review closed the tab on. A new service book landing
  // in the corpus must therefore surface here, in CI, and not on the home
  // page's front grid.
  it.runIf(haveData)("expands every organization code the site publishes", () => {
    const agencies = JSON.parse(fs.readFileSync(agenciesPath, "utf8"));
    const missing = agencies
      .map((a: { org: string }) => a.org)
      .filter((org: string) => agencyFullName(org) === null);
    expect(missing, `unexpanded organization codes: ${missing.join(", ")}`).toEqual([]);
  });
});
