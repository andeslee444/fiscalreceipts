/**
 * agency-names.ts — what the workbook organization codes stand for
 * (tri-persona Wave 3, Task 3).
 *
 * THE DEFECT. The home page's "Browse by agency" grid rendered 24 cards, 21
 * of them a bare acronym: TJS, DMACT, DHRA, CBDP, DTRA, DCSA. `/agency/TJS/`
 * was titled, in full, "TJS". The layman review's verdict on the site was
 * "a filing cabinet, not an answer", and a grid of unexpanded internal codes
 * is what a filing cabinet's drawer labels look like. `serviceOrgName()` in
 * program-tier.ts expanded exactly three of them (A/N/F) and returned the
 * code unchanged for everything else, by design — it exists for the short
 * service badge on a program row, not for a page heading.
 *
 * WHY A CURATED MAP AND NOT A DERIVATION. There is no derived source. The
 * workbook `organization` column carries the code and nothing else;
 * `jbook_documents.title` is a FILENAME ("PROC_TJS_PB_2026.pdf"); the
 * citation payload has no document title at all. Checked before writing this
 * file, not assumed.
 *
 * WHAT WAS CHECKED, AND THE ONE THAT WOULD HAVE BEEN WRONG. Every entry was
 * cross-read against the program titles this corpus actually files under the
 * code (`select distinct title from dim_programs where org = ?`). That check
 * earned its keep on DPAP: the reflexive expansion of a DoD "DPAP" is
 * Defense Pricing/Procurement and Acquisition Policy, and this corpus files
 * exactly one program under it — "Defense Production Act Purchases". Five
 * more were confirmed the same way (CBDP, DTIC, OTE, TJS, DPAA-adjacent
 * naming); the rest are the components' own published names.
 *
 * IT REFUSES RATHER THAN GUESSES. An unmapped code returns null and the
 * caller renders the bare code — the same discipline company-name.mjs uses.
 * A new agency book landing in the corpus therefore shows a code nobody has
 * expanded yet, which is honest, instead of a plausible expansion nobody
 * checked. `assertAgencyNamesCoverAgencies` in the unit tests pins the
 * shipped set so the omission is visible in CI rather than on the page.
 */

/** Workbook organization code → the component's published name. */
export const AGENCY_NAMES: Record<string, string> = {
  // The three service departments. Same strings serviceOrgName() returns —
  // that function stays the short badge; this map is the page heading.
  A: "Army",
  N: "Navy",
  F: "Air Force",

  // Defense-wide components, alphabetical by code.
  CBDP: "Chemical and Biological Defense Program",
  CYBERCOM: "U.S. Cyber Command",
  DARPA: "Defense Advanced Research Projects Agency",
  DCAA: "Defense Contract Audit Agency",
  DCMA: "Defense Contract Management Agency",
  DCSA: "Defense Counterintelligence and Security Agency",
  DHRA: "Defense Human Resources Activity",
  DISA: "Defense Information Systems Agency",
  DLA: "Defense Logistics Agency",
  DMACT: "Defense Media Activity",
  DPAA: "Defense POW/MIA Accounting Agency",
  // NOT "Defense Procurement and Acquisition Policy" — see the doc-comment.
  // This corpus files one program under DPAP and it is the purchases account.
  DPAP: "Defense Production Act Purchases",
  DSCA: "Defense Security Cooperation Agency",
  DTIC: "Defense Technical Information Center",
  DTRA: "Defense Threat Reduction Agency",
  MDA: "Missile Defense Agency",
  OSD: "Office of the Secretary of Defense",
  OTE: "Operational Test and Evaluation",
  SOCOM: "U.S. Special Operations Command",
  TJS: "The Joint Staff",
  WHS: "Washington Headquarters Services",
};

/**
 * The component's name, or null when this file has never been taught the
 * code. Callers render the bare code on null — never a guess.
 */
export function agencyFullName(code: string): string | null {
  return AGENCY_NAMES[code] ?? null;
}

/**
 * The string to put in a heading: the full name where one is known, the raw
 * code otherwise. The code itself stays on the page beside it either way —
 * it is the workbook's identifier and the page's identity.
 */
export function agencyDisplayName(code: string): string {
  return agencyFullName(code) ?? code;
}
