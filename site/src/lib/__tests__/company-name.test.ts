/**
 * company-name — §P2-4 display casing for registry names.
 *
 * The rule's whole value is that it REFUSES rather than guesses, so the tests
 * are split into three arms: names it must transform, spellings it must not
 * invent, and the refusal path itself.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { displayCompanyName, companyDisplay } from "../company-name.mjs";

const JSON_DIR = path.resolve(process.cwd(), "..", "data", "site", "json");

describe("displayCompanyName — the shouted-name transform", () => {
  it("title-cases an ordinary registry name and keeps the registry string", () => {
    const r = displayCompanyName("LOCKHEED MARTIN CORPORATION");
    expect(r.display).toBe("Lockheed Martin Corporation");
    expect(r.registry).toBe("LOCKHEED MARTIN CORPORATION");
    expect(r.refused).toBe(false);
  });

  it("leaves a name that already carries lower case exactly alone", () => {
    for (const n of ["Lockheed Martin", "RTX", "L3Harris Technologies"]) {
      const r = displayCompanyName(n);
      expect(r.display).toBe(n);
      expect(r.refused).toBe(false);
    }
  });

  it("never title-cases an initialism", () => {
    expect(companyDisplay("AECOM")).toBe("AECOM");
    expect(companyDisplay("BAE SYSTEMS PLC")).toBe("BAE Systems PLC");
    expect(companyDisplay("SCIENCE APPLICATIONS INTERNATIONAL CORPORATION")).toBe(
      "Science Applications International Corporation",
    );
    expect(companyDisplay("CACI INTERNATIONAL INC")).toBe("CACI International Inc");
    expect(companyDisplay("KBR, INC.")).toBe("KBR, Inc.");
    expect(companyDisplay("COLSA CORP")).toBe("COLSA Corp");
    expect(companyDisplay("SLSCO, LTD.")).toBe("SLSCO, Ltd.");
    expect(companyDisplay("ERAPSCO")).toBe("ERAPSCO");
    expect(companyDisplay("THE MITRE CORPORATION")).toBe("The MITRE Corporation");
  });

  it("uses the company's own mixed-case spelling where a rule cannot derive it", () => {
    expect(companyDisplay("L3HARRIS TECHNOLOGIES, INC")).toBe("L3Harris Technologies, Inc");
    expect(companyDisplay("MCKESSON CORPORATION")).toBe("McKesson Corporation");
    expect(companyDisplay("UNITEDHEALTH GROUP INCORPORATED")).toBe("UnitedHealth Group Incorporated");
    expect(companyDisplay("MANTECH INTERNATIONAL CORPORATION")).toBe("ManTech International Corporation");
    expect(companyDisplay("FEDEX CORP")).toBe("FedEx Corp");
    expect(companyDisplay("TRANSDIGM GROUP INCORPORATED")).toBe("TransDigm Group Incorporated");
  });

  it("keeps initialism legal forms upper and title-cases the word ones", () => {
    expect(companyDisplay("AXIENT LLC")).toBe("Axient LLC");
    expect(companyDisplay("UNITED LAUNCH ALLIANCE, L.L.C")).toBe("United Launch Alliance, L.L.C");
    expect(companyDisplay("BP P.L.C.")).toBe("BP P.L.C.");
    expect(companyDisplay("M1 SUPPORT SERVICES, L.P.")).toBe("M1 Support Services, L.P.");
    expect(companyDisplay("CHICAGO BRIDGE & IRON COMPANY N.V.")).toBe(
      "Chicago Bridge & Iron Company N.V.",
    );
    expect(companyDisplay("LEONARDO SPA")).toBe("Leonardo S.p.A.");
    expect(companyDisplay("KONGSBERG GRUPPEN ASA")).toBe("Kongsberg Gruppen ASA");
    expect(companyDisplay("ANHAM FZCO")).toBe("ANHAM FZCO");
  });

  it("handles ampersands, hyphens, initials, digits and roman numerals", () => {
    expect(companyDisplay("AT&T INC.")).toBe("AT&T Inc.");
    expect(companyDisplay("W S DARLEY & CO")).toBe("W S Darley & Co");
    expect(companyDisplay("J & J MAINTENANCE INC")).toBe("J & J Maintenance Inc");
    expect(companyDisplay("ROLLS-ROYCE HOLDINGS PLC")).toBe("Rolls-Royce Holdings PLC");
    expect(companyDisplay("S-OIL CORPORATION")).toBe("S-Oil Corporation");
    expect(companyDisplay("PHILLIPS 66")).toBe("Phillips 66");
    expect(companyDisplay("L3 TECHNOLOGIES, INC.")).toBe("L3 Technologies, Inc.");
    expect(companyDisplay("AIRBUS U.S. SPACE & DEFENSE, INC.")).toBe(
      "Airbus U.S. Space & Defense, Inc.",
    );
    expect(companyDisplay("PARSONS BRINCKERHOFF-FSB-H&A-A JOINT VENTURE")).toBe(
      "Parsons Brinckerhoff-FSB-H&A-A Joint Venture",
    );
  });

  it("lower-cases minor words only strictly inside the name", () => {
    expect(companyDisplay("GOVERNMENT OF THE UNITED STATES")).toBe(
      "Government of the United States",
    );
    expect(companyDisplay("THE BOEING COMPANY")).toBe("The Boeing Company");
    expect(companyDisplay("DAY & ZIMMERMANN GROUP INC., THE")).toBe(
      "Day & Zimmermann Group Inc., The",
    );
    expect(companyDisplay("ALION SCIENCE AND TECHNOLOGY CORPORATION")).toBe(
      "Alion Science and Technology Corporation",
    );
  });

  it("recurses into parentheses", () => {
    expect(companyDisplay("DOMESTIC AWARDEES (UNDISCLOSED)")).toBe(
      "Domestic Awardees (Undisclosed)",
    );
    expect(companyDisplay("MOTOR OIL (HELLAS) CORINTH REFINERIES S.A.")).toBe(
      "Motor Oil (Hellas) Corinth Refineries S.A.",
    );
  });
});

describe("displayCompanyName — the refusal path", () => {
  it("refuses the WHOLE name when any token is not classifiable", () => {
    const r = displayCompanyName("QQZ DEFENSE SYSTEMS");
    expect(r.refused).toBe(true);
    expect(r.refusedOn).toBe("QQZ");
    expect(r.display).toBe("QQZ DEFENSE SYSTEMS");
    expect(r.display).toBe(r.registry);
  });

  it("refuses rather than half-casing — no partial output escapes", () => {
    const r = displayCompanyName("LOCKHEED ZZQ CORPORATION");
    expect(r.refused).toBe(true);
    expect(r.display).toBe("LOCKHEED ZZQ CORPORATION");
    expect(r.display).not.toContain("Lockheed");
  });

  it("refuses short unknown tokens rather than guessing they are words", () => {
    expect(displayCompanyName("ABC HOLDINGS").refused).toBe(true);
    expect(displayCompanyName("XY SYSTEMS").refused).toBe(true);
  });

  it("passes an empty or whitespace name through untouched", () => {
    expect(displayCompanyName("").display).toBe("");
    expect(displayCompanyName("   ").refused).toBe(false);
  });
});

describe("the shipped corpus", () => {
  const entitiesPath = path.join(JSON_DIR, "entities_top.json");
  const familiesPath = path.join(JSON_DIR, "entity_family_events.json");
  const haveData = fs.existsSync(entitiesPath) && fs.existsSync(familiesPath);

  it.runIf(haveData)("every published registry name is classifiable", () => {
    const names = new Set<string>();
    for (const e of JSON.parse(fs.readFileSync(entitiesPath, "utf8"))) {
      names.add(e.display_name);
    }
    const fams = JSON.parse(fs.readFileSync(familiesPath, "utf8"));
    for (const f of fams.families ?? []) {
      for (const m of f.members ?? []) names.add(m.display_name);
    }
    const refused = [...names]
      .map((n) => displayCompanyName(n))
      .filter((r) => r.refused)
      .map((r) => `${r.registry} (on "${r.refusedOn}")`);
    // Refusal is SAFE, never a failure — but a refusal in the shipped corpus
    // is a curation gap worth seeing, so it is pinned rather than tolerated.
    expect(refused).toEqual([]);
  });

  it.runIf(haveData)("no display name loses a word from its registry string", () => {
    for (const e of JSON.parse(fs.readFileSync(entitiesPath, "utf8"))) {
      const r = displayCompanyName(e.display_name);
      const words = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
      // AARCORP → "AAR Corp" is the one curated split; everything else must
      // preserve its token count.
      if (r.registry === "AARCORP") continue;
      expect(words(r.display).split(" ").length).toBe(words(r.registry).split(" ").length);
    }
  });
});
