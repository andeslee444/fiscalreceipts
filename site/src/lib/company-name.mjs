/**
 * company-name.mjs — display casing for USAspending registry names (§P2-4).
 *
 * THE DEFECT. `LOCKHEED MARTIN CORPORATION` was an `<h1>` on 200 pages, 200
 * shouted rows on /companies/, and the title on 200 OG cards. The registry
 * string is what ties a row to its source, so it cannot be thrown away — but
 * it does not have to be the thing a reader is shouted at with.
 *
 * THE RULE, and why it is allow-listed rather than derived.
 * No casing algorithm is safe on this corpus. `AECOM`, `COLSA`, `ERAPSCO`,
 * `SLSCO`, `ANHAM`, `MITRE`, `L3HARRIS`, `MCKESSON`, `UNITEDHEALTH` are
 * ordinary-looking alphabetic tokens that must NOT be naively title-cased,
 * and nothing in their spelling says so. So the transform runs token by
 * token, and it REFUSES rather than guesses:
 *
 *   1. Only SHOUTED names are candidates. A name already carrying a
 *      lower-case letter is curated or already mixed — returned untouched.
 *   2. Split on whitespace; `-`, `/` and `&` split further; each part is
 *      classified independently:
 *        - CASED  — curated spelling (initialisms that keep their caps:
 *          BAE, KBR, SAIC, AECOM; and mixed-case names no rule can produce:
 *          L3Harris, McKesson, UnitedHealth, ManTech, FedEx);
 *        - LEGAL_FORMS — INC. → Inc., LLC → LLC, SPA → S.p.A. Forms read as
 *          initialisms stay upper: "Llc" and "Plc" are the exact failure this
 *          file exists to prevent;
 *        - SHORT_WORDS — the curated 2–4-letter English words and surnames
 *          that occur in this corpus (NET, DOCK, TEAM, TECH, IRON, Bell,
 *          Booz, Moog). Below 5 letters, nothing is guessed;
 *        - pass-through, unchanged — pure punctuation, `&`, a bare number, a
 *          letter+digit token (L3, M1, V2X, 66), a single letter or initial
 *          (`A`, `W.`), a dotted initialism (`U.S.`), a roman numeral;
 *        - the GENERIC WORD RULE — a plain alphabetic token of ≥ 5 letters
 *          that is not on NOT_A_WORD → Title Case.
 *   3. ANY part that matches none of those makes the WHOLE NAME REFUSE: the
 *      raw registry string renders verbatim. One wrong word is worse than a
 *      shouted name, and a half-cased name is worse than either.
 *
 * KNOWN LIMIT, stated rather than hidden: the generic word rule is a
 * heuristic, and a FUTURE ≥5-letter all-caps acronym that is not on
 * NOT_A_WORD would be title-cased ("SOTEC" → "Sotec"). Every such token in
 * the shipped corpus is listed. The gate re-runs this function against the
 * built HTML, so display and rule can never drift from each other — but the
 * gate cannot know English, so NOT_A_WORD is a curation duty when the
 * contractor set changes. It is deliberately kept separate from CASED so
 * "this is not a word" and "this is how the word is spelled" stay
 * distinguishable in review.
 *
 * `displayCompanyName()` returns BOTH strings plus the refusal flag. Callers
 * render `display` and keep `registry` reachable — visibly on /company/ and
 * /companies/, and as `title` + the `data-company-name` value everywhere else.
 *
 * WHY .mjs IN src/lib: three consumers must agree exactly and none can be the
 * other's source — the Next pages, scripts/generate-og.mjs (a prebuild Node
 * script), and scripts/gates/render-static.mjs. Same reason as feed-model.mjs.
 * Pure: no fs, no React, no DOM.
 */

// ── Legal forms ─────────────────────────────────────────────────────────────
const LEGAL_FORMS = new Map(
  Object.entries({
    INC: "Inc",
    "INC.": "Inc.",
    INCORPORATED: "Incorporated",
    CORP: "Corp",
    "CORP.": "Corp.",
    CORPORATION: "Corporation",
    CO: "Co",
    "CO.": "Co.",
    COMPANY: "Company",
    COMPANIES: "Companies",
    LTD: "Ltd",
    "LTD.": "Ltd.",
    LIMITED: "Limited",
    HOLDING: "Holding",
    HOLDINGS: "Holdings",
    GROUP: "Group",
    LLC: "LLC",
    "L.L.C.": "L.L.C.",
    "L.L.C": "L.L.C",
    LLP: "LLP",
    PLC: "PLC",
    "P.L.C.": "P.L.C.",
    LP: "LP",
    "L.P.": "L.P.",
    "N.V.": "N.V.",
    NV: "NV",
    "S.A.": "S.A.",
    "S.A": "S.A",
    "A.S.": "A.S.",
    ASA: "ASA",
    AG: "AG",
    SPA: "S.p.A.",
    "S.P.A.": "S.p.A.",
    GMBH: "GmbH",
    PTY: "Pty",
    SE: "SE",
    AB: "AB",
    SAS: "SAS",
    FZCO: "FZCO",
    AKTIENGESELLSCHAFT: "Aktiengesellschaft",
    // Entered the corpus with the FY2017-FY2026 crosswalk rebuild (Task 5b).
    AS: "AS", // Norwegian aksjeselskap — "Kongsberg Defence & Aerospace AS"
    JV: "JV", // joint venture — "Dragados/Hawaiian Dredging/Orion JV"
    // Registered without the space. Cased, NOT respaced — inserting the space
    // would split one registry token into two and lose the token-count
    // invariant that keeps a display name a faithful rendering of what was filed.
    "CO.,LTD.": "Co.,Ltd.",
  }),
);

// ── Curated spellings ───────────────────────────────────────────────────────
// Every entry was checked against the company's own name.
const CASED = new Map(
  Object.entries({
    // Initialisms that keep their caps
    AAR: "AAR",
    AARCORP: "AAR Corp",
    ABU: "Abu",
    ADS: "ADS",
    AECOM: "AECOM",
    ANHAM: "ANHAM",
    APM: "APM",
    "AT&T": "AT&T",
    BAE: "BAE",
    BP: "BP",
    CACI: "CACI",
    CDW: "CDW",
    CFM: "CFM",
    CGM: "CGM",
    CHU: "CHU",
    CMA: "CMA",
    COLSA: "COLSA",
    DCS: "DCS",
    DS: "DS",
    DXC: "DXC",
    ERAPSCO: "ERAPSCO",
    FLIR: "FLIR",
    FRS: "FRS",
    FSB: "FSB",
    GATR: "GATR",
    IAP: "IAP",
    IBM: "IBM",
    JX: "JX",
    KBR: "KBR",
    MAG: "MAG",
    MITRE: "MITRE",
    NANA: "NANA",
    PAE: "PAE",
    RQ: "RQ",
    RTX: "RTX",
    SAIC: "SAIC",
    SLSCO: "SLSCO",
    SRC: "SRC",
    TRAX: "TRAX",
    USF: "USF",
    VSE: "VSE",
    // Mixed-case spellings the companies themselves use
    AMERIQUAL: "AmeriQual",
    CARAHSOFT: "Carahsoft",
    EXITCERTIFIED: "ExitCertified",
    EXXON: "Exxon",
    FEDEX: "FedEx",
    L3HARRIS: "L3Harris",
    LINQUEST: "LinQuest",
    MACANDREWS: "MacAndrews",
    MANTECH: "ManTech",
    MCKESSON: "McKesson",
    SODEXO: "Sodexo",
    STANDARDAERO: "StandardAero",
    STARHUB: "StarHub",
    SUPPLYCORE: "SupplyCore",
    TRANSDIGM: "TransDigm",
    UNITEDHEALTH: "UnitedHealth",
    VIASAT: "Viasat",
    // Short proper nouns the generic ≥5 rule cannot reach
    BELL: "Bell",
    BOOZ: "Booz",
    DELL: "Dell",
    MOOG: "Moog",
    PAR: "Par",
    // ── Entered the top-200 with the FY2017-FY2026 crosswalk rebuild ────────
    // (Task 5b: FY2020-FY2026 recipients were invisible while the crosswalk
    // was stale at FY2017-FY2019.)  Initialisms are recorded as the REGISTRY
    // records them — keeping a token in caps asserts less than title-casing
    // it, so an initialism we cannot independently expand stays as filed.
    CAE: "CAE",
    DLT: "DLT",
    DMS: "DMS",
    ECC: "ECC",
    HIG: "HIG",
    HP: "HP",
    KPMG: "KPMG",
    RAM: "RAM", // RAM-System GmbH (Rolling Airframe Missile)
    TCOM: "TCOM",
    TSG: "TSG", // "ManTech TSG-2 Joint Venture"
    WICO: "WICO",
    WPP: "WPP",
    // Mixed-case spellings the companies themselves use
    IHEALTH: "iHealth",
    SAAB: "Saab",
    // Short proper nouns
    ELI: "Eli", // Eli Lilly and Company
    OLIN: "Olin",
    ROOT: "Root", // Brown & Root
  }),
);

/** Alphabetic tokens that LOOK like words but are not. Never title-cased. */
const NOT_A_WORD = new Set([
  "AECOM",
  "AARCORP",
  "ANHAM",
  "COLSA",
  "ERAPSCO",
  "MITRE",
  "SLSCO",
]);

/** 2–4-letter English words that occur in this corpus. Nothing short is guessed. */
const SHORT_WORDS = new Map(
  Object.entries({
    AND: "and",
    AUTO: "Auto",
    BLUE: "Blue",
    BOW: "Bow",
    CARE: "Care",
    DAY: "Day",
    DE: "de",
    DOCK: "Dock",
    DU: "du",
    FOR: "for",
    FUND: "Fund",
    IRON: "Iron",
    LA: "la",
    LABS: "Labs",
    LE: "le",
    NET: "Net",
    NEXT: "Next",
    OF: "of",
    OIL: "Oil",
    ON: "On",
    RED: "Red",
    SONS: "Sons",
    STAR: "Star",
    TEAM: "Team",
    TECH: "Tech",
    THE: "The",
    VAN: "van",
    VON: "von",
    WIDE: "Wide",
  }),
);

/** Words that drop to lower case when they sit inside a name, never at either end. */
const MINOR = new Set(["and", "of", "the", "for", "de", "du", "la", "le", "van", "von"]);

const ROMAN = /^[IVXLCDM]{1,4}$/;

function titleWord(word) {
  return word[0] + word.slice(1).toLowerCase();
}

/**
 * Transform ONE atom (a whitespace token, or one part of a `-`/`/`/`&` split).
 * @param {string} core
 * @returns {{ ok: true, out: string } | { ok: false, reason: string }}
 */
function transformAtom(core) {
  if (core === "") return { ok: true, out: core };

  // Parenthesised token — "(UNDISCLOSED)", "(HELLAS)".
  const paren = /^\((.*)\)([.,;]*)$/.exec(core);
  if (paren) {
    const inner = transformAtom(paren[1]);
    if (!inner.ok) return inner;
    return { ok: true, out: `(${inner.out})${paren[2]}` };
  }

  const upper = core.toUpperCase();

  if (CASED.has(upper)) return { ok: true, out: CASED.get(upper) };
  if (LEGAL_FORMS.has(upper)) return { ok: true, out: LEGAL_FORMS.get(upper) };
  if (SHORT_WORDS.has(upper)) return { ok: true, out: SHORT_WORDS.get(upper) };

  // Pass-through, unchanged.
  if (!/[A-Za-z]/.test(core)) return { ok: true, out: core }; // "66", "&", "-"
  if (/^[A-Za-z][0-9][A-Za-z0-9]*$/.test(core)) return { ok: true, out: core }; // L3, M1, V2X
  if (/^[A-Z]\.?[.,;]*$/.test(core)) return { ok: true, out: core }; // "A", "W."
  if (/^(?:[A-Z]\.)+[.,;]*$/.test(core)) return { ok: true, out: core }; // "U.S."
  if (ROMAN.test(core)) return { ok: true, out: core };

  // Generic word rule: ≥5 plain letters, not a known non-word.
  if (/^[A-Za-z]+$/.test(core) && core.length >= 5 && !NOT_A_WORD.has(upper)) {
    return { ok: true, out: titleWord(upper) };
  }

  return { ok: false, reason: core };
}

/** Split a whitespace token on `-`, `/` and `&`, keeping the separators. */
function transformToken(token) {
  let trailing = "";
  let core = token;
  while (core.length > 1 && /[.,;]$/.test(core) && !LEGAL_FORMS.has(core.toUpperCase())) {
    // Keep a trailing period when it belongs to the token ("INC." / "U.S.");
    // peel a comma or semicolon so the atom itself can be classified.
    if (core.endsWith(".")) break;
    trailing = core.slice(-1) + trailing;
    core = core.slice(0, -1);
  }
  // A curated spelling may itself contain a separator ("AT&T"), so the whole
  // token gets its lookup before the split runs.
  const whole = core.toUpperCase();
  if (CASED.has(whole)) return { ok: true, out: CASED.get(whole) + trailing };

  const parts = core.split(/([-/&])/);
  const outs = [];
  for (const p of parts) {
    if (p === "-" || p === "/" || p === "&") {
      outs.push(p);
      continue;
    }
    const r = transformAtom(p);
    if (!r.ok) return r;
    outs.push(r.out);
  }
  return { ok: true, out: outs.join("") + trailing };
}

/**
 * Display casing for a raw registry name.
 *
 * @param {string} raw the registry string exactly as the award data records it
 * @returns {{ display: string, registry: string, refused: boolean, refusedOn: string | null }}
 *   `display === registry` whenever `refused` is true.
 */
export function displayCompanyName(raw) {
  const registry = String(raw ?? "");
  const trimmed = registry.trim();
  if (trimmed === "" || /[a-z]/.test(trimmed)) {
    return { display: registry, registry, refused: false, refusedOn: null };
  }

  const tokens = trimmed.split(/\s+/);
  const out = [];
  for (const token of tokens) {
    const r = transformToken(token);
    if (!r.ok) {
      return { display: registry, registry, refused: true, refusedOn: r.reason };
    }
    out.push(r.out);
  }
  // MINOR words drop to lower case only strictly inside the name.
  for (let i = 1; i < out.length - 1; i += 1) {
    const bare = out[i].replace(/[.,;]+$/, "");
    if (MINOR.has(bare.toLowerCase()) && bare === titleWord(bare.toUpperCase())) {
      out[i] = bare.toLowerCase() + out[i].slice(bare.length);
    }
  }
  return { display: out.join(" "), registry, refused: false, refusedOn: null };
}

/** Convenience: the display string only. */
export function companyDisplay(raw) {
  return displayCompanyName(raw).display;
}
