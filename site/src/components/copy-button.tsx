"use client";

/**
 * copy-button.tsx — small clipboard affordance.
 *
 * Extracted from app/fact/fact-resolver.tsx (PM-review Sprint 2 §P1-9.6) so
 * the citation drawer's truncated SHA-256 can offer the SAME control the fact
 * page already offers, instead of a second implementation. Behaviour is
 * unchanged: an icon button that flips to a check for 2s, announces state in
 * a polite live region, and silently leaves the text selectable when the
 * clipboard is unavailable (insecure context / denied permission) — it never
 * reports a copy that did not happen.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({
  text,
  label,
  testId,
}: {
  text: string;
  label: string;
  /** data-testid for gate/vitest selection (optional). */
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — leave the text selectable instead.
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="inline-flex translate-y-[1px] items-center text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3" aria-hidden="true" />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
