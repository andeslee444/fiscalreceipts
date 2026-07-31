"use client";

/**
 * ReceiptsIntro — one-time dismissible coach mark for receipts mode
 * (Phase 5C Goal 1: first-visit introduction).
 *
 * Renders a small callout fixed just below the header's right side (where the
 * receipts toggle lives) until the visitor dismisses it. Dismissal is stored
 * in localStorage["receipts-intro-seen"], so it appears at most once per
 * browser. Mounted on the home page only.
 *
 * xl+ only: below md the receipts toggle sits inside the hamburger menu, so a
 * callout pointing at the header would reference an invisible control. Between
 * md and xl the fixed right-4 callout overlaps the centered hero heading
 * (visual-judge D3 finding at 768: it covered "Federal defense spen…"), so it
 * renders only at xl+ where the callout clears the max-w-4xl hero column.
 *
 * SSR-safe: renders nothing on the server and on first client paint; the
 * localStorage read happens in a mount effect (functional-updater form, same
 * lint-approved pattern as ReceiptsProvider).
 */

import React, { useEffect, useState } from "react";

const STORAGE_KEY = "receipts-intro-seen";

export function ReceiptsIntro() {
  const [visible, setVisible] = useState(false);
  const initialized = React.useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setVisible(() => {
      try {
        return window.localStorage.getItem(STORAGE_KEY) === null;
      } catch {
        return false;
      }
    });
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // localStorage unavailable — dismiss for this page view only
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside
      data-testid="receipts-intro"
      role="status"
      className="hidden xl:block fixed right-4 top-16 z-30 w-64 rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <p className="text-xs leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">
          Every number has a receipt
        </span>{" "}
        — click any dotted figure to see its source. The &ldquo;Fact
        IDs&rdquo; toggle hides the id chips if you prefer a quieter page.
      </p>
      <button
        onClick={dismiss}
        className="mt-2 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        Dismiss
      </button>
    </aside>
  );
}
