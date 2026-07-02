/**
 * gate — receiptmoment_gate (Phase 5C, G4)
 *
 * Goal 1 contract: the home page stages a "receipt moment" — one big cited
 * number above the fold whose citation panel is at most 2 clicks away
 * (should be 1).
 *
 * Checks (live, Playwright):
 * 1. 1440×900, fresh context: [data-testid="receipt-moment"] fully above the
 *    fold (boundingBox().y + height < viewport height, no scrolling).
 * 2. Coach mark: [data-testid="receipts-intro"] visible on first visit
 *    (fresh context = fresh localStorage), gone after clicking Dismiss and
 *    reloading.
 * 3. Click the receipt moment's cite → [data-testid="citation-panel"] visible
 *    with a REAL PDF receipt within ≤ 2 clicks total (expected: 1):
 *      - a rendered PDF canvas (jbook_pdf citations), OR
 *      - [data-degraded="pdf"] (asset bundle unreachable — G3 contract).
 *    The receipt moment features the largest FY2024-actuals figure with a
 *    jbook_pdf citation (getReceiptMomentFact), so the spec Goal 1 contract
 *    ("the citation panel with the PDF page + highlight") is asserted
 *    literally — a derived card, spinner, or empty panel is NOT accepted.
 * 4. 390×844, fresh context: fold assert repeated (click leg once is enough
 *    per plan; the coach mark is xl+ only so it is not asserted on mobile).
 *
 * Export: runReceiptMomentGate({ baseUrl }) → { pass, errors, notes }
 */

import { chromium } from "playwright";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Assert the receipt moment is fully inside the initial viewport. */
async function assertAboveFold(page, viewport, errors, notes) {
  const label = `${viewport.width}x${viewport.height}`;
  const el = page.locator('[data-testid="receipt-moment"]').first();
  const count = await el.count();
  if (count === 0) {
    errors.push(`${label}: [data-testid="receipt-moment"] missing on /`);
    return false;
  }
  const box = await el.boundingBox();
  if (!box) {
    errors.push(`${label}: receipt-moment not visible (no bounding box)`);
    return false;
  }
  const bottom = box.y + box.height;
  if (box.y < 0 || bottom >= viewport.height) {
    errors.push(
      `${label}: receipt-moment not fully above the fold — top=${box.y.toFixed(0)}px bottom=${bottom.toFixed(0)}px viewport=${viewport.height}px`
    );
    return false;
  }
  notes.push(`${label}: receipt-moment fully above fold (bottom=${bottom.toFixed(0)}px) ✓`);
  return true;
}

/**
 * Wait for the real PDF receipt inside the open panel: a rendered PDF canvas,
 * or the explicit degraded-pdf fallback when the asset bundle is unreachable.
 * A derived card is NOT accepted — the receipt moment's fact is jbook_pdf.
 * Returns a string describing what was found, or null on timeout.
 */
async function waitForPanelContent(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Rendered PDF canvas (pdf-page-fade.is-ready = render completed)
    const canvasReady = await page
      .$eval(
        '[data-testid="citation-panel"] canvas.pdf-page-fade.is-ready',
        (c) => c.width > 0 && c.height > 0
      )
      .catch(() => false);
    if (canvasReady) return "rendered PDF canvas";

    const degraded = await page.$('[data-degraded="pdf"]');
    if (degraded && (await degraded.isVisible())) return '[data-degraded="pdf"] fallback';

    await page.waitForTimeout(200);
  }
  return null;
}

export async function runReceiptMomentGate({ baseUrl }) {
  const errors = [];
  const notes = [];

  const browser = await chromium.launch({ headless: true });

  try {
    // ── Desktop: fold + coach mark + cite click ─────────────────────────────
    {
      const context = await browser.newContext({ viewport: DESKTOP });
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 30000 });

        // 1. Fold
        await assertAboveFold(page, DESKTOP, errors, notes);

        // 2. Coach mark — visible on first visit (fresh localStorage)
        const intro = page.locator('[data-testid="receipts-intro"]');
        const introVisible = await intro
          .waitFor({ state: "visible", timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        if (!introVisible) {
          errors.push("1440x900: [data-testid=\"receipts-intro\"] coach mark not visible on first visit");
        } else {
          notes.push("coach mark visible on first visit ✓");
          await intro.getByRole("button", { name: /dismiss/i }).click();
          await page.reload({ waitUntil: "load" });
          const afterReload = await page.$('[data-testid="receipts-intro"]');
          if (afterReload) {
            errors.push("1440x900: coach mark still present after dismiss + reload");
          } else {
            notes.push("coach mark absent after dismiss + reload ✓");
          }
        }

        // 3. Cite click → panel with real content, ≤ 2 clicks (expected 1)
        let clicks = 0;
        const cite = page.locator('[data-testid="receipt-moment"] [data-fact-id]').first();
        if ((await cite.count()) === 0) {
          errors.push("1440x900: no [data-fact-id] cite inside receipt-moment");
        } else {
          await cite.click();
          clicks += 1;

          let panelVisible = await page
            .waitForSelector('[data-testid="citation-panel"]', { state: "visible", timeout: 5000 })
            .then(() => true)
            .catch(() => false);

          if (!panelVisible && clicks < 2) {
            // Second allowed click: the explicit "See the page it's printed on" button
            const btn = page
              .locator('[data-testid="receipt-moment"] button', {
                hasText: /see the page/i,
              })
              .first();
            if ((await btn.count()) > 0) {
              await btn.click();
              clicks += 1;
              panelVisible = await page
                .waitForSelector('[data-testid="citation-panel"]', { state: "visible", timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            }
          }

          if (!panelVisible) {
            errors.push(`1440x900: citation panel not visible after ${clicks} click(s)`);
          } else if (clicks > 2) {
            errors.push(`1440x900: needed ${clicks} clicks to open the panel (budget: 2)`);
          } else {
            const content = await waitForPanelContent(page);
            if (!content) {
              errors.push(
                "1440x900: citation panel open but no real content (no rendered canvas, no [data-degraded=\"pdf\"], no derived card)"
              );
            } else {
              notes.push(`panel open in ${clicks} click(s) with ${content} ✓`);
            }
          }
        }
      } catch (e) {
        errors.push(`desktop leg: ${e.message.split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }

    // ── Mobile: fold assert repeated ────────────────────────────────────────
    {
      const context = await browser.newContext({ viewport: MOBILE });
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 30000 });
        await assertAboveFold(page, MOBILE, errors, notes);
      } catch (e) {
        errors.push(`mobile leg: ${e.message.split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return { pass: errors.length === 0, errors, notes };
}
