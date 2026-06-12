/**
 * Slug utilities for entity URLs.
 *
 * The slug formula (per recon: verified collision-free on entities_top.json top-200):
 *   slug = family_key.toLowerCase().replace(/ /g, '-')
 *
 * This matches the Python export-site output exactly.
 */

/**
 * Convert a family_key (or any label) to a URL slug.
 *
 * Rules:
 *   1. Lowercase
 *   2. Replace all spaces with hyphens
 *
 * Example:
 *   slugify("LOCKHEED MARTIN") → "lockheed-martin"
 *   slugify("GENERAL DYNAMICS") → "general-dynamics"
 */
export function slugify(input: string): string {
  return input.toLowerCase().replace(/ /g, "-");
}

/**
 * Reverse a slug back to a display-friendly form (best-effort; only used for
 * breadcrumbs where the canonical display_name is unavailable).
 * Not guaranteed to be the original value.
 */
export function deslugify(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
