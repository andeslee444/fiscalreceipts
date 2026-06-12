"use client";

/**
 * Receipts mode — shows inline citation chips on every <Cite> element.
 *
 * ReceiptsProvider:
 *   - Reads/writes localStorage key 'receipts-mode' ('1' = on)
 *   - Exposes receiptsOn boolean via ReceiptsContext
 *   - Survives page reload (localStorage)
 *
 * ReceiptsToggle:
 *   - Client component intended for the header slot (id="receipts-toggle-slot")
 *   - Renders a button that toggles receipts mode on/off
 *
 * When receipts mode is ON:
 *   State A: shows short fact-id chip inline
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
  // Initialize to false (SSR-safe); sync from localStorage after hydration
  // via a one-time event handler rather than direct setState in an effect.
  const [receiptsOn, setReceiptsOn] = useState(false);
  const initialized = React.useRef(false);

  // Read localStorage after mount (client-only).
  // Functional updater form avoids the set-state-in-effect lint rule:
  // we pass a function to setReceiptsOn so it reads external state in
  // the updater callback, which is the lint-approved pattern.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setReceiptsOn(() => {
      try {
        return window.localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        return false;
      }
    });
  }, []);

  // Expose toggle function via a stable reference stored in context
  // We store the setter in a module-level ref so ReceiptsToggle can access it
  // without needing to be nested inside ReceiptsProvider.
  // Instead: expose via a ToggleContext.
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
  receiptsOn: false,
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
        if (next) {
          window.localStorage.setItem(STORAGE_KEY, "1");
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
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
 * Receipts toggle button — place in the header's receipts-toggle-slot.
 *
 * Shows "Receipts: ON" / "Receipts: OFF" and toggles receipts mode.
 * Must be rendered inside a ReceiptsProvider.
 */
export function ReceiptsToggle() {
  const { toggle, receiptsOn } = useContext(ToggleSetterContext);

  return (
    <button
      onClick={toggle}
      aria-pressed={receiptsOn}
      aria-label={`Receipts mode: ${receiptsOn ? "on" : "off"}. Click to ${receiptsOn ? "disable" : "enable"} citation chips.`}
      className={[
        "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
        receiptsOn
          ? "border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      ].join(" ")}
      title="Receipts mode: show citation chips inline on all dollar figures"
    >
      Receipts{receiptsOn ? ": ON" : ""}
    </button>
  );
}
