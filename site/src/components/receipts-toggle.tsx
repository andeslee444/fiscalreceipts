"use client";

/**
 * Receipts mode — DEFAULT ON (P1-1). Controls fact-id chip VISIBILITY only;
 * citations themselves are always clickable.
 *
 * ReceiptsProvider:
 *   - Default (first visit, no stored preference): ON. The server renders
 *     chips visible and the first client render matches — no flash and no
 *     layout jump on the default path. Only OPTED-OUT users ('0' stored)
 *     have chips removed on mount (a brief flash for them is the accepted
 *     trade — the default path stays jump-free).
 *   - localStorage key 'receipts-mode': '1' = on, '0' = off, absent = ON.
 *     Persisted BOTH ways (an explicit re-enable writes '1', not a key
 *     removal, so the choice survives a future default change).
 *   - Exposes receiptsOn boolean via ReceiptsContext.
 *
 * ReceiptsToggle:
 *   - Header control. Visible label "Fact IDs"; accessible name
 *     "Show fact IDs" (spec §P1-1 — the old name "Receipts mode: off…"
 *     explained nothing to first-time visitors).
 *
 * When receipts mode is ON:
 *   State A: public fact-id chip renders as a SIBLING of [data-amount]
 *   State B: xml-path chip already always visible — no change
 *   State C: ⁂ gains a visible "uncited" label
 */

import React, { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "receipts-mode";

// ── Context (re-export ReceiptsContext from cite.tsx) ────────────────────────
// We keep the provider here to separate the toggle UI from the Cite renderer.
// ReceiptsContext is defined in cite.tsx; ReceiptsProvider reads from localStorage.

import { ReceiptsContext } from "@/components/cite";

interface ReceiptsProviderProps {
  children: React.ReactNode;
}

/**
 * Wraps the application (or layout) to provide receipts mode state.
 * Must be a client component because it reads localStorage.
 */
export function ReceiptsProvider({ children }: ReceiptsProviderProps) {
  // Initialize to TRUE (the shipped default): SSR and the first client
  // render agree, so hydration never mismatches and the default path never
  // flashes. The mount effect below only flips state for opted-out users.
  const [receiptsOn, setReceiptsOn] = useState(true);
  const initialized = React.useRef(false);

  // Read localStorage after mount (client-only). Functional updater form
  // avoids the set-state-in-effect lint rule.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setReceiptsOn(() => {
      try {
        // Only an explicit opt-out ('0') turns chips off; anything else —
        // absent key, legacy '1' — is ON.
        return window.localStorage.getItem(STORAGE_KEY) !== "0";
      } catch {
        return true;
      }
    });
  }, []);

  return (
    <ReceiptsContext.Provider value={{ receiptsOn }}>
      <ReceiptsToggleInternalProvider setReceiptsOn={setReceiptsOn}>
        {children}
      </ReceiptsToggleInternalProvider>
    </ReceiptsContext.Provider>
  );
}

// Internal context for the toggle setter
interface ToggleSetterContextValue {
  toggle: () => void;
  receiptsOn: boolean;
}

const ToggleSetterContext = createContext<ToggleSetterContextValue>({
  toggle: () => undefined,
  receiptsOn: true,
});

function ReceiptsToggleInternalProvider({
  children,
  setReceiptsOn,
}: {
  children: React.ReactNode;
  setReceiptsOn: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { receiptsOn } = useContext(ReceiptsContext);

  const toggle = React.useCallback(() => {
    setReceiptsOn((prev) => {
      const next = !prev;
      try {
        // Persist BOTH directions explicitly ('1'/'0') — absence means
        // "never chose", which maps to the default (ON).
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, [setReceiptsOn]);

  return (
    <ToggleSetterContext.Provider value={{ toggle, receiptsOn }}>
      {children}
    </ToggleSetterContext.Provider>
  );
}

/**
 * "Fact IDs" toggle button — place in the header's receipts-toggle-slot.
 * Accessible name "Show fact IDs"; aria-pressed carries the state.
 */
export function ReceiptsToggle() {
  const { toggle, receiptsOn } = useContext(ToggleSetterContext);

  return (
    <button
      data-testid="receipts-toggle"
      data-receipts-toggle
      onClick={toggle}
      aria-pressed={receiptsOn}
      aria-label="Show fact IDs"
      className={[
        "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
        receiptsOn
          ? "border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      ].join(" ")}
      title="Show fact IDs: inline id chips beside every cited figure (citations stay clickable either way)"
    >
      Fact IDs
    </button>
  );
}
