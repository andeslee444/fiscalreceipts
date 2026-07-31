// Canonical site origin for tests — set BEFORE any module import so
// lib/site.ts captures it at module evaluation (SITE_URL is read once).
// Fact permalinks pin to this origin regardless of the jsdom origin
// (visual-judge M3: permalinks are identifiers, never the runtime origin).
process.env.NEXT_PUBLIC_SITE_URL = "https://fiscalreceipts.com";

import "@testing-library/jest-dom";
