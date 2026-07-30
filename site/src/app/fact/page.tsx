import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { FactResolver } from "./fact-resolver";

/**
 * /fact/ — fact-permalink resolver (PM Sprint 1 Task 5, spec §P0-4.1).
 *
 * The permalink form is /fact/{id} (8-hex public id or 16-hex full id). On
 * the deployed site a Vercel rewrite (site/public/vercel.json, shipped into
 * out/) serves THIS page for every /fact/{id} request; the client resolver
 * parses the id from location.pathname (falling back to ?id= — the form that
 * works without the rewrite) and resolves it from the cite-shard files.
 * Full per-fact SSG (134k+ pages) is deferred by design — this page is the
 * canonical URL of the route, so every rewritten /fact/{id} response also
 * declares /fact/ canonical (no duplicate-content indexing).
 */
export const metadata: Metadata = {
  title: "Fact permalink",
  description:
    `Resolve a ${SITE_NAME} fact id to its source receipt — value, source ` +
    "document, page, SHA-256, and retrieval date.",
  alternates: { canonical: `${SITE_URL}/fact/` },
};

export default function FactPage() {
  return <FactResolver />;
}
