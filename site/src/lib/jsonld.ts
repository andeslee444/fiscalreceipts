/**
 * jsonld.ts — JSON-LD schema.org helper builders
 *
 * Usage: import helper, pass to <script type="application/ld+json">
 * All helpers return plain objects; serialise with safeJsonLd().
 *
 * Callers: layout.tsx (WebSite+SearchAction), breadcrumbs.tsx (BreadcrumbList),
 *          /agency pages (GovernmentOrganization), /methodology (FAQPage),
 *          /downloads (Dataset per card).
 */

import { SITE_NAME, SITE_URL } from "@/lib/site";

/** Safely serialise a JSON-LD object — escapes </script> injection. */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

// ── WebSite + SearchAction ────────────────────────────────────────────────────

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "Federal defense budget data — every number citation-backed with PDF page-level provenance.",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/programs/?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

// ── BreadcrumbList ────────────────────────────────────────────────────────────

export interface BreadcrumbItemLd {
  label: string;
  href?: string;
}

export function breadcrumbListJsonLd(items: BreadcrumbItemLd[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: item.href.startsWith("http") ? item.href : `${SITE_URL}${item.href}` } : {}),
    })),
  };
}

// ── GovernmentOrganization ────────────────────────────────────────────────────

export function governmentOrganizationJsonLd(org: string, pageUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "GovernmentOrganization",
    name: org,
    url: pageUrl.startsWith("http") ? pageUrl : `${SITE_URL}${pageUrl}`,
    description: `${org}: U.S. Department of Defense agency — defense program elements budget data.`,
    parentOrganization: {
      "@type": "GovernmentOrganization",
      name: "U.S. Department of Defense",
      url: "https://www.defense.gov",
    },
  };
}

// ── FAQPage ───────────────────────────────────────────────────────────────────

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqPageJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

// ── Dataset ───────────────────────────────────────────────────────────────────

export interface DatasetJsonLdProps {
  name: string;
  description: string;
  url: string;
  contentUrl?: string;
  encodingFormat?: string;
  dateModified?: string;
  creator?: string;
}

export function datasetJsonLd({
  name,
  description,
  url,
  contentUrl,
  encodingFormat,
  dateModified,
  creator = SITE_NAME,
}: DatasetJsonLdProps) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name,
    description,
    url: url.startsWith("http") ? url : `${SITE_URL}${url}`,
    ...(contentUrl ? { contentUrl } : {}),
    ...(encodingFormat ? { encodingFormat } : {}),
    ...(dateModified ? { dateModified } : {}),
    creator: {
      "@type": "Organization",
      name: creator,
      url: SITE_URL,
    },
    license: "https://creativecommons.org/publicdomain/zero/1.0/",
    isAccessibleForFree: true,
    keywords: ["federal budget", "defense spending", "U.S. DoD", "government data"],
  };
}
