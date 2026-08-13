/**
 * prose-allowlist.mjs — the narrow, enumerated escape hatch for dollar tokens
 * in the site's OWN explanatory prose.
 *
 * render-static (b) requires every rendered currency token to sit inside a
 * [data-amount] (a <Cite>) or a [data-prose-cite]. A handful of tokens on the
 * site are neither: they are PARAMETERS of the methodology ("programs where
 * FY2025 total is ≥ $50M"), tolerances ("±$0.001M"), figures quoted from an
 * outside body ("$186 billion in improper payments"), and worked examples in
 * the write-up of a defect we fixed ("hiding $7.07B of real FY2025 money").
 * None of them is a figure the site computed for the reader to check, so none
 * of them can be a <Cite>.
 *
 * Until backlog #38 those tokens were covered by wrapping the whole page in
 * `data-source-text`, which switched the scan off for the entire container.
 * This file replaces that with an enumeration: one entry per token, scoped to
 * the pages it may appear on, each carrying a written reason. Changing the
 * $50M threshold in prose now fails the gate until the entry changes with it.
 *
 * SHAPE (prose-allowlist.json):
 *   { "pattern": "$50M", "pages": ["/methodology/", "/feed/"], "reason": "…" }
 *
 * `pages` are page paths as the reader sees them — "/methodology/", "/" —
 * or the single wildcard "*". It was present in the JSON from the beginning
 * and IGNORED by the gate, which matched patterns site-wide; honouring it is
 * part of this fix.
 *
 * HYGIENE (both enforced by render-static, both FAIL not warn):
 *   - a `pattern` that the currency scanner could never produce is dead text
 *     pretending to be a rule (the file shipped a "currency examples" entry
 *     for months);
 *   - an entry that matched nothing in the whole build is a stale exemption,
 *     and stale exemptions are how an escape hatch grows without anyone
 *     noticing. Deleting one is a one-line edit; keeping it is a decision.
 *
 * The used-entry rule doubles as the non-vacuity proof for /methodology/: the
 * six entries scoped only to that page can only be used if the negative
 * currency scan actually reaches it.
 */

import path from "path";

/** Anchored form of render-static's CURRENCY_RE — a legal allowlist pattern. */
const CURRENCY_TOKEN_RE = /^\$[\d,]+(\.\d+)?\s*[TBMK]?$/;

/**
 * Built-file path → the page path a reader sees.
 *   "methodology/index.html" → "/methodology/"
 *   "index.html"             → "/"
 *   "fact/3134a6e0.html"     → "/fact/3134a6e0.html"
 *
 * @param {string} relPath path relative to out/, in either separator style
 */
export function pagePathFromRelPath(relPath) {
  const p = String(relPath).split(path.sep).join("/").replace(/^\/+/, "");
  if (p === "index.html") return "/";
  if (p.endsWith("/index.html")) return `/${p.slice(0, -"index.html".length)}`;
  return `/${p}`;
}

/**
 * Build a page-scoped matcher over the allowlist entries.
 *
 * @param {Array<{pattern?: string, pages?: string[], reason?: string}>} entries
 * @returns {{
 *   isAllowed: (pagePath: string, token: string) => boolean,
 *   shapeErrors: string[],
 *   unusedErrors: () => string[],
 * }}
 */
export function makeProseAllowlist(entries) {
  const shapeErrors = [];
  const compiled = [];

  if (!Array.isArray(entries)) {
    return {
      isAllowed: () => false,
      shapeErrors: ["prose-allowlist.json is not an array"],
      unusedErrors: () => [],
    };
  }

  entries.forEach((entry, i) => {
    const where = `prose-allowlist.json[${i}]`;
    const pattern = typeof entry?.pattern === "string" ? entry.pattern.trim() : "";
    if (!pattern) {
      shapeErrors.push(`${where}: missing "pattern"`);
      return;
    }
    if (!CURRENCY_TOKEN_RE.test(pattern)) {
      shapeErrors.push(
        `${where}: pattern ${JSON.stringify(pattern)} is not a currency token ` +
          `the scan can ever produce — it exempts nothing and reads like a rule`,
      );
      return;
    }
    const pages = Array.isArray(entry?.pages) ? entry.pages : null;
    if (!pages || pages.length === 0) {
      shapeErrors.push(
        `${where} (${pattern}): "pages" must be a non-empty array of page ` +
          `paths (e.g. ["/methodology/"]) or ["*"]`,
      );
      return;
    }
    if (!pages.every((p) => typeof p === "string" && p.length > 0)) {
      shapeErrors.push(`${where} (${pattern}): every "pages" entry must be a string`);
      return;
    }
    if (typeof entry?.reason !== "string" || entry.reason.trim() === "") {
      shapeErrors.push(
        `${where} (${pattern}): "reason" is required — an exemption nobody ` +
          `explained is an exemption nobody can review`,
      );
      return;
    }
    compiled.push({
      pattern,
      pages: new Set(pages),
      wildcard: pages.includes("*"),
      used: 0,
      index: i,
    });
  });

  return {
    isAllowed(pagePath, token) {
      const t = String(token).trim();
      let hit = false;
      for (const e of compiled) {
        if (e.pattern !== t) continue;
        if (!e.wildcard && !e.pages.has(pagePath)) continue;
        e.used += 1;
        hit = true;
      }
      return hit;
    },
    shapeErrors,
    unusedErrors() {
      return compiled
        .filter((e) => e.used === 0)
        .map(
          (e) =>
            `prose-allowlist.json[${e.index}] (${e.pattern} on ` +
            `${[...e.pages].join(", ")}) matched nothing in this build — a ` +
            `stale exemption still switched on`,
        );
    },
  };
}
