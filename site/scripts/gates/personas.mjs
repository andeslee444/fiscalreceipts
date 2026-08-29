/**
 * gate — personas_gate (Phase 5C, G5)
 *
 * Goal 7 contract: five persona journeys, each with a HARD ≤ 6 interaction
 * budget (a click or keypress = 1; typing a query = 1; scrolling is free).
 *
 * Journeys (live, Playwright, 1440×900):
 * 1. journalist — / → receipt-moment cite → copy-footnote → clipboard
 *    contains "retrieved" (clipboard-read/write granted on the context).
 * 2. staffer — / → Districts nav → first district row → a program link →
 *    emulateMedia(print) → header hidden + [data-print-only] visible.
 * 3. bd — / → Feed nav → new_entrant section. ADAPTATION (documented per
 *    plan): in the current dataset NO new_entrant family is inside the
 *    top-200 entity index, so the section renders zero /company/ links —
 *    every card must instead carry data-no-company-page (honest absence,
 *    G1 contract). The journey goal — reach a company's
 *    lobbying-vs-obligations view — is then completed via the Companies nav
 *    → first company row. If a future build has a company link in the
 *    new_entrant section, the gate clicks it directly instead.
 * 4. academic — / → footer Downloads → citations.parquet card present +
 *    schema/data-dictionary text present (degraded banner acceptable).
 * 5. citizen — / → open search with "/" → type "hypersonic" → first program
 *    result → program page has answer strip or dossier + og:image meta, AND
 *    the code that identifies the page (PE / BLI) links to its own /glossary/
 *    entry — clicked, and the entry asserted to actually define it — with at
 *    least one further stamped term reachable the same way (tri-persona Wave
 *    3: this journey asserted REACHABILITY, and the layman review's complaint
 *    was COMPREHENSION). 4 of 6 interactions.
 *
 * Per-journey error reporting: every journey returns
 * { name, ok, interactions, steps, errors } and the gate output carries one
 * note (or error set) per journey.
 *
 * Export: runPersonasGate({ baseUrl }) → { pass, errors, notes }
 */

import { chromium } from "playwright";

const VIEWPORT = { width: 1440, height: 900 };
const BUDGET = 6;

/**
 * Journey runner harness: tracks interaction count and step labels so
 * failures report exactly where a journey broke.
 */
function makeJourney(name) {
  return {
    name,
    interactions: 0,
    steps: [],
    errors: [],
    /** Record an interaction (click/keypress/typed query). */
    spend(label) {
      this.interactions += 1;
      this.steps.push(`${label} [interaction ${this.interactions}]`);
      if (this.interactions > BUDGET) {
        throw new Error(`interaction budget exceeded (${this.interactions} > ${BUDGET}) at: ${label}`);
      }
    },
    /** Record a free step (navigation wait, assertion). */
    note(label) {
      this.steps.push(label);
    },
    fail(msg) {
      this.errors.push(msg);
    },
  };
}

// ── Journey 1: journalist ─────────────────────────────────────────────────────

async function journeyJournalist(browser, baseUrl) {
  const j = makeJourney("journalist");
  const context = await browser.newContext({
    viewport: VIEWPORT,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 30000 });
    j.note("loaded /");

    const cite = page.locator('[data-testid="receipt-moment"] [data-fact-id]').first();
    await cite.waitFor({ state: "visible", timeout: 10000 });
    await cite.click();
    j.spend("click receipt-moment cite");

    await page.waitForSelector('[data-testid="citation-panel"]', {
      state: "visible",
      timeout: 10000,
    });
    j.note("citation panel visible");

    const copyBtn = page.locator('[data-testid="copy-footnote"]');
    await copyBtn.waitFor({ state: "visible", timeout: 10000 });
    await copyBtn.click();
    j.spend("click copy-footnote");

    // Wait for the transient "Copied ✓" state, then read the clipboard.
    await page
      .waitForSelector('[data-testid="copy-footnote"] >> text=/copied/i', { timeout: 5000 })
      .catch(() => {});
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    if (!clip || !clip.includes("retrieved")) {
      j.fail(`clipboard does not contain "retrieved" — got: ${(clip || "").slice(0, 120)}`);
    } else {
      j.note('clipboard contains "retrieved" ✓');
    }
  } catch (e) {
    j.fail(e.message.split("\n")[0]);
  } finally {
    await context.close();
  }
  return j;
}

// ── Journey 2: staffer ────────────────────────────────────────────────────────

async function journeyStaffer(browser, baseUrl) {
  const j = makeJourney("staffer");
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 30000 });
    j.note("loaded /");

    await page.locator('[data-site-nav] a[href="/district/"]').click();
    j.spend("click Districts nav");
    await page.waitForURL("**/district/", { timeout: 15000 });
    j.note("on /district/");

    const firstDistrict = page.locator('tbody a[href^="/district/"]').first();
    await firstDistrict.waitFor({ state: "visible", timeout: 10000 });
    await firstDistrict.click();
    j.spend("click first district row");
    await page.waitForURL(/\/district\/[^/]+\/$/, { timeout: 15000 });
    j.note(`on district page ${new URL(page.url()).pathname}`);

    const firstProgram = page.locator('a[href^="/program/"]').first();
    await firstProgram.waitFor({ state: "visible", timeout: 10000 });
    await firstProgram.click();
    j.spend("click program link on district page");
    await page.waitForURL(/\/program\/[^/]+\/$/, { timeout: 15000 });
    j.note(`on program page ${new URL(page.url()).pathname}`);

    await page.emulateMedia({ media: "print" });
    const headerDisplay = await page.$eval(
      "header",
      (el) => getComputedStyle(el).display
    );
    if (headerDisplay !== "none") {
      j.fail(`print media: header display is "${headerDisplay}" (expected none)`);
    } else {
      j.note("print: header hidden ✓");
    }
    const printOnly = await page.$('[data-print-only]');
    if (!printOnly) {
      j.fail("print media: no [data-print-only] element on program page");
    } else {
      const display = await printOnly.evaluate((el) => getComputedStyle(el).display);
      if (display === "none") {
        j.fail("print media: [data-print-only] still hidden");
      } else {
        j.note("print: [data-print-only] byline visible ✓");
      }
    }
  } catch (e) {
    j.fail(e.message.split("\n")[0]);
  } finally {
    await context.close();
  }
  return j;
}

// ── Journey 3: BD analyst ─────────────────────────────────────────────────────

async function journeyBd(browser, baseUrl) {
  const j = makeJourney("bd");
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 30000 });
    j.note("loaded /");

    await page.locator('[data-site-nav] a[href="/feed/"]').click();
    j.spend("click Feed nav");
    await page.waitForURL("**/feed/", { timeout: 15000 });
    await page.waitForSelector("#feed-new_entrant", { timeout: 10000 });
    j.note("on /feed/ with new_entrant section");

    const companyLinks = page.locator('#feed-new_entrant a[href^="/company/"]');
    const linkCount = await companyLinks.count();

    if (linkCount > 0) {
      await companyLinks.first().click();
      j.spend("click company link in new_entrant section");
      await page.waitForURL(/\/company\/[^/]+\/$/, { timeout: 15000 });
    } else {
      // Honest absence: every new_entrant card must declare it has no
      // company page (see gate header ADAPTATION note).
      // Contract: FeedCardItem root carries data-feed-card=""; select by that
      // attribute for stable counts (was: .divide-y > * Reveal wrappers).
      const cardCount = await page
        .locator("#feed-new_entrant [data-feed-card]")
        .count();
      const flagged = await page
        .locator("#feed-new_entrant [data-no-company-page]")
        .count();
      if (cardCount === 0) {
        j.fail("new_entrant section has no cards");
      } else if (flagged !== cardCount) {
        j.fail(
          `new_entrant: ${cardCount} cards but only ${flagged} carry data-no-company-page`
        );
      } else {
        j.note(`new_entrant: 0 company links, all ${cardCount} cards carry data-no-company-page ✓`);
      }

      await page.locator('[data-site-nav] a[href="/companies/"]').click();
      j.spend("click Companies nav");
      await page.waitForURL("**/companies/", { timeout: 15000 });

      const firstCompany = page.locator('tbody a[href^="/company/"]').first();
      await firstCompany.waitFor({ state: "visible", timeout: 10000 });
      await firstCompany.click();
      j.spend("click first company row");
      await page.waitForURL(/\/company\/[^/]+\/$/, { timeout: 15000 });
    }
    j.note(`on company page ${new URL(page.url()).pathname}`);

    // Lobbying-vs-obligations view: the Lobbying Activity section with at
    // least one filing-year row (income/expense/total beside obligations).
    const lobbyingHeading = page.locator("h2", { hasText: /lobbying activity/i });
    if ((await lobbyingHeading.count()) === 0) {
      j.fail("company page has no 'Lobbying Activity' section");
    } else {
      const rows = await page
        .locator("section", { has: lobbyingHeading })
        .locator("tbody tr")
        .count();
      if (rows === 0) {
        j.fail("Lobbying Activity table has no rows");
      } else {
        j.note(`lobbying-vs-obligations view: ${rows} filing-year row(s) ✓`);
      }
    }
  } catch (e) {
    j.fail(e.message.split("\n")[0]);
  } finally {
    await context.close();
  }
  return j;
}

// ── Journey 4: academic ───────────────────────────────────────────────────────

async function journeyAcademic(browser, baseUrl) {
  const j = makeJourney("academic");
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 30000 });
    j.note("loaded /");

    await page.locator('footer a[href="/downloads/"]').click();
    j.spend("click footer Downloads link");
    await page.waitForURL("**/downloads/", { timeout: 15000 });
    j.note("on /downloads/");

    const citationsCard = page.locator("text=citations.parquet").first();
    if ((await citationsCard.count()) === 0) {
      j.fail("downloads page does not list citations.parquet");
    } else {
      j.note("citations.parquet card present ✓");
    }

    const body = await page.locator("main").innerText();
    if (!/schema/i.test(body)) {
      j.fail("downloads page has no schema text");
    } else if (!/data dictionary/i.test(body)) {
      j.fail("downloads page has no data-dictionary text");
    } else {
      j.note("schema + data dictionary text present ✓");
    }
  } catch (e) {
    j.fail(e.message.split("\n")[0]);
  } finally {
    await context.close();
  }
  return j;
}

// ── Journey 5: citizen ────────────────────────────────────────────────────────

async function journeyCitizen(browser, baseUrl) {
  const j = makeJourney("citizen");
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 30000 });
    j.note("loaded /");

    await page.keyboard.press("/");
    j.spend('press "/" to open search');
    await page.waitForSelector('[data-testid="search-input"]', { timeout: 10000 });
    j.note("search palette open");

    await page.keyboard.type("hypersonic");
    j.spend('type "hypersonic" (typed query = 1 interaction)');

    const firstProgram = page
      .locator('[data-testid="search-result"] a[href^="/program/"]')
      .first();
    await firstProgram.waitFor({ state: "visible", timeout: 10000 });
    await firstProgram.click();
    j.spend("click first program result");
    await page.waitForURL(/\/program\/[^/]+\/$/, { timeout: 15000 });
    j.note(`on program page ${new URL(page.url()).pathname}`);

    const answerStrip = await page.$('[data-testid="answer-what"]');
    const dossier = await page.$('[data-testid="program-dossier"], #dossier, [data-dossier]');
    if (!answerStrip && !dossier) {
      j.fail("program page has neither an answer strip nor a dossier section");
    } else {
      j.note(`program page has ${answerStrip ? "answer strip" : "dossier"} ✓`);
    }

    const ogImage = await page.$('meta[property="og:image"]');
    const ogContent = ogImage ? await ogImage.getAttribute("content") : null;
    if (!ogContent) {
      j.fail("program page has no og:image meta");
    } else {
      j.note("og:image meta present ✓");
    }

    // ── COMPREHENSION (tri-persona Wave 3, Task 3) ────────────────────────
    // Reachability was all this journey ever asserted: the citizen arrives at
    // a program page, and the gate checked that a card and a social image
    // exist. The layman review arrived at the same page and could not read
    // it — "TOA", "P-40", "PE", "HHI" are stamped all over it and /glossary/,
    // which is genuinely good, was linked twice per page and BOTH times from
    // the footer, below six thousand pixels of the jargon it explains.
    //
    // So this journey now asserts what it is for: a reader who does not know
    // a word can reach its definition IN ONE CLICK, from where the word is
    // used, and what they land on actually defines it. Interaction 4 of 6 —
    // the budget is not touched.
    const termLinks = await page
      .locator('main a[href^="/glossary/#"]')
      .evaluateAll((els) =>
        els.map((el) => ({
          id: (el.getAttribute("href") || "").split("#")[1] || "",
          text: (el.textContent || "").trim(),
        })),
      );
    const ids = [...new Set(termLinks.map((t) => t.id))];
    // The code beside the <h1> is the FIRST unexplained thing on the page and
    // the one every figure below is keyed to. If a reader cannot find out
    // what "PE" or "BLI" means from the page that shouts one at them, no
    // other link on the page is going to rescue them.
    const identifier = termLinks.find((t) => t.id === "pe" || t.id === "bli");
    if (!identifier) {
      j.fail(
        `program page never links its own identifier term to a definition — ` +
          `glossary ids reachable from main: [${ids.join(", ") || "none"}]`,
      );
    } else if (ids.length < 2) {
      j.fail(
        `program page links exactly one stamped term (${ids[0]}); the words on ` +
          `its own headline figures still go unexplained`,
      );
    } else {
      await page.locator(`main a[href="/glossary/#${identifier.id}"]`).first().click();
      j.spend(`click the glossary link on "${identifier.text}"`);
      await page.waitForURL(/\/glossary\/#/, { timeout: 15000 });
      const entry = page.locator(`#${identifier.id}`);
      if ((await entry.count()) === 0) {
        j.fail(`/glossary/#${identifier.id} has no entry — the term links to nothing`);
      } else {
        const dd = (await entry.innerText()).replace(/\s+/g, " ").trim();
        // A stub that echoes the acronym back is not a definition.
        if (dd.length < 80) {
          j.fail(
            `/glossary/#${identifier.id} defines "${identifier.text}" in ${dd.length} chars`,
          );
        } else {
          j.note(
            `${ids.length} stamped terms link out; "${identifier.text}" → ` +
              `/glossary/#${identifier.id}, defined in ${dd.length} chars ✓`,
          );
        }
      }
    }
  } catch (e) {
    j.fail(e.message.split("\n")[0]);
  } finally {
    await context.close();
  }
  return j;
}

// ── Gate runner ───────────────────────────────────────────────────────────────

export async function runPersonasGate({ baseUrl }) {
  const errors = [];
  const notes = [];

  const browser = await chromium.launch({ headless: true });

  try {
    const journeys = [
      journeyJournalist,
      journeyStaffer,
      journeyBd,
      journeyAcademic,
      journeyCitizen,
    ];

    for (const run of journeys) {
      const j = await run(browser, baseUrl);
      const ok = j.errors.length === 0 && j.interactions <= BUDGET;
      if (ok) {
        notes.push(`persona:${j.name} OK (${j.interactions}/${BUDGET} interactions)`);
      } else {
        for (const e of j.errors) {
          errors.push(`persona:${j.name} — ${e}`);
        }
        if (j.interactions > BUDGET) {
          errors.push(
            `persona:${j.name} — over budget: ${j.interactions}/${BUDGET} interactions`
          );
        }
        errors.push(
          `persona:${j.name} — steps: ${j.steps.join(" → ") || "(none)"}`
        );
      }
    }
  } finally {
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}
